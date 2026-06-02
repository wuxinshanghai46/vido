const fs = require('fs');
const axios = require('axios');
const sharp = require('sharp');
const { getApiKey } = require('./settingsService');

const REPLICATE_MODEL = 'men1scus/birefnet';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function firstOutputUrl(output) {
  if (!output) return '';
  if (typeof output === 'string') return output;
  if (Array.isArray(output)) return firstOutputUrl(output[0]);
  if (typeof output === 'object') return output.url || output.image || output.output || '';
  return '';
}

async function downloadBuffer(url) {
  if (!url) throw new Error('matting output url is empty');
  if (url.startsWith('data:image/')) {
    return Buffer.from(url.replace(/^data:image\/\w+;base64,/, ''), 'base64');
  }
  const res = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 120000,
    maxContentLength: 80 * 1024 * 1024,
  });
  return Buffer.from(res.data);
}

async function validateForeground(buffer, provider) {
  const png = await sharp(buffer).rotate().ensureAlpha().png().toBuffer();
  const meta = await sharp(png).metadata();
  if (!meta.width || !meta.height) throw new Error(`${provider} returned invalid image`);
  const alphaStats = await sharp(png).extractChannel(3).stats();
  const alpha = alphaStats.channels?.[0] || {};
  if ((alpha.mean || 0) < 2 || (alpha.max || 0) < 8) {
    throw new Error(`${provider} returned empty foreground`);
  }
  return png;
}

async function runReplicateBirefnet({ inputUrl, resolution = '1024x1024' }) {
  const apiKey = getApiKey('replicate') || process.env.REPLICATE_API_TOKEN || process.env.REPLICATE_API_KEY;
  if (!apiKey) throw new Error('Replicate key is not configured');
  if (!/^https?:\/\//i.test(String(inputUrl || ''))) {
    throw new Error('Replicate BiRefNet requires a public image URL');
  }

  const headers = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    Prefer: 'wait=60',
  };
  const submit = await axios.post(
    `https://api.replicate.com/v1/models/${REPLICATE_MODEL}/predictions`,
    { input: { image: inputUrl, resolution } },
    { headers, timeout: 90000 },
  );
  let result = submit.data;
  for (let i = 0; i < 36 && result?.status && !['succeeded', 'failed', 'canceled'].includes(result.status); i++) {
    await sleep(2500);
    const poll = await axios.get(`https://api.replicate.com/v1/predictions/${result.id}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      timeout: 30000,
    });
    result = poll.data;
  }
  if (result?.status !== 'succeeded') throw new Error(result?.error || `Replicate status ${result?.status || 'unknown'}`);
  const outUrl = firstOutputUrl(result.output);
  return validateForeground(await downloadBuffer(outUrl), 'replicate-birefnet');
}

async function runBaiduBodySeg(buffer) {
  const baiduMatting = require('./baiduMattingService');
  return validateForeground(await baiduMatting.segmentFrame(buffer, 'foreground'), 'baidu-body-seg');
}

async function matteImageBuffer(buffer, opts = {}) {
  if (!Buffer.isBuffer(buffer)) throw new Error('matteImageBuffer requires a Buffer');
  const warnings = [];
  const prefer = opts.prefer || 'replicate';
  const methods = prefer === 'baidu'
    ? ['baidu', 'replicate']
    : ['replicate', 'baidu'];

  for (const method of methods) {
    try {
      if (method === 'replicate' && opts.allowReplicate !== false) {
        const out = await runReplicateBirefnet({
          inputUrl: opts.inputUrl,
          resolution: opts.resolution || '1024x1024',
        });
        return { buffer: out, provider: 'replicate', model: REPLICATE_MODEL, warnings };
      }
      if (method === 'baidu' && opts.allowBaidu !== false) {
        const out = await runBaiduBodySeg(buffer);
        return { buffer: out, provider: 'baidu-aip', model: 'body_seg', warnings };
      }
    } catch (err) {
      warnings.push(`${method}: ${err.message}`);
    }
  }
  throw new Error(`professional matting failed: ${warnings.join(' | ') || 'no provider available'}`);
}

async function matteImageFile(inputPath, outputPath, opts = {}) {
  const result = await matteImageBuffer(fs.readFileSync(inputPath), opts);
  fs.writeFileSync(outputPath, result.buffer);
  return { ...result, outputPath };
}

module.exports = {
  matteImageBuffer,
  matteImageFile,
  REPLICATE_MODEL,
};
