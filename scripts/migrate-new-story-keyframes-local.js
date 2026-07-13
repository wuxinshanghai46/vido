const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const axios = require('axios');

async function main() {
  const taskId = String(process.argv[2] || '').trim();
  const dbPath = path.resolve(process.argv[3] || path.join(__dirname, '../outputs/new_story_ad_db.json'));
  const assetDir = path.resolve(process.argv[4] || path.join(__dirname, '../outputs/new-story-ad-assets'));
  if (!taskId) throw new Error('task id is required');
  const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
  const output = (db.outputs || [])
    .filter(item => item.task_id === taskId && item.kind === 'keyframes')
    .sort((a, b) => String(a.updated_at || '').localeCompare(String(b.updated_at || '')))
    .at(-1);
  if (!output || !Array.isArray(output.payload)) throw new Error('keyframes output not found');
  fs.mkdirSync(assetDir, { recursive: true });
  let migrated = 0;
  for (let i = 0; i < output.payload.length; i += 1) {
    const frame = output.payload[i] || {};
    const remoteUrl = String(frame.image_url || frame.imageUrl || frame.url || '').trim();
    if (!/^https?:\/\//i.test(remoteUrl)) continue;
    const response = await axios.get(remoteUrl, { responseType: 'arraybuffer', timeout: 120000 });
    const buffer = Buffer.from(response.data);
    const metadata = await sharp(buffer).metadata();
    if (!metadata.width || !metadata.height) throw new Error(`shot ${i + 1} is not a readable image`);
    const filename = `recovered_keyframe_${taskId}_${String(i + 1).padStart(2, '0')}_${Date.now()}.png`;
    const filePath = path.join(assetDir, filename);
    await sharp(buffer).rotate().png({ compressionLevel: 8 }).toFile(filePath);
    const localUrl = `/api/new-story-ad/assets/${filename}`;
    frame.source_url = remoteUrl;
    frame.image_url = localUrl;
    frame.imageUrl = localUrl;
    frame.url = localUrl;
    if (Array.isArray(frame.candidates)) {
      frame.candidates.forEach(candidate => {
        if ([candidate.image_url, candidate.imageUrl, candidate.url].includes(remoteUrl)) {
          candidate.source_url = remoteUrl;
          candidate.image_url = localUrl;
          candidate.imageUrl = localUrl;
          candidate.url = localUrl;
        }
      });
    }
    migrated += 1;
  }
  if (!migrated) {
    console.log(JSON.stringify({ task_id: taskId, migrated: 0, unchanged: true }));
    return;
  }
  output.updated_at = new Date().toISOString();
  const tempPath = `${dbPath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(db, null, 2), 'utf8');
  fs.renameSync(tempPath, dbPath);
  console.log(JSON.stringify({ task_id: taskId, migrated }));
}

main().catch(error => {
  console.error(error.message || error);
  process.exit(1);
});
