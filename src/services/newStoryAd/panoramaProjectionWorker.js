const { parentPort, workerData } = require('worker_threads');
const sharp = require('sharp');

function directionForPixel(x, y, width, height, yawDegrees, pitchDegrees, fovDegrees) {
  const yaw = yawDegrees * Math.PI / 180;
  const pitch = pitchDegrees * Math.PI / 180;
  const horizontal = Math.tan((fovDegrees * Math.PI / 180) / 2);
  const vertical = horizontal * height / width;
  let dx = ((x + 0.5) / width * 2 - 1) * horizontal;
  let dy = (1 - (y + 0.5) / height * 2) * vertical;
  let dz = 1;
  const length = Math.hypot(dx, dy, dz) || 1;
  dx /= length;
  dy /= length;
  dz /= length;
  const pitchY = dy * Math.cos(pitch) - dz * Math.sin(pitch);
  const pitchZ = dy * Math.sin(pitch) + dz * Math.cos(pitch);
  return [
    dx * Math.cos(yaw) + pitchZ * Math.sin(yaw),
    Math.max(-1, Math.min(1, pitchY)),
    -dx * Math.sin(yaw) + pitchZ * Math.cos(yaw),
  ];
}

async function run() {
  const { inputPath, outputPath, outputWidth, outputHeight, yaw, pitch, fov } = workerData;
  const source = await sharp(inputPath).toColourspace('srgb').removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const sourceWidth = source.info.width;
  const sourceHeight = source.info.height;
  const channels = source.info.channels;
  const output = Buffer.alloc(outputWidth * outputHeight * channels);
  for (let y = 0; y < outputHeight; y += 1) {
    for (let x = 0; x < outputWidth; x += 1) {
      const [dx, dy, dz] = directionForPixel(x, y, outputWidth, outputHeight, yaw, pitch, fov);
      const sourceX = ((Math.atan2(dx, dz) / (2 * Math.PI) + 0.5) * sourceWidth + sourceWidth) % sourceWidth;
      const sourceY = Math.max(0, Math.min(sourceHeight - 1, (0.5 - Math.asin(dy) / Math.PI) * sourceHeight));
      const sourceOffset = (Math.floor(sourceY) * sourceWidth + Math.min(sourceWidth - 1, Math.floor(sourceX))) * channels;
      const outputOffset = (y * outputWidth + x) * channels;
      for (let channel = 0; channel < channels; channel += 1) output[outputOffset + channel] = source.data[sourceOffset + channel];
    }
  }
  await sharp(output, { raw: { width: outputWidth, height: outputHeight, channels } })
    .jpeg({ quality: 90, chromaSubsampling: '4:4:4' })
    .toFile(outputPath);
}

run().then(() => parentPort.postMessage({ ok: true })).catch(error => {
  parentPort.postMessage({ ok: false, error: error.message });
});
