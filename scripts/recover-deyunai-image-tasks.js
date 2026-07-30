const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const sharp = require('sharp');
const { loadSettings } = require('../src/services/settingsService');

const BASE_HOST = 'https://api.deyunai.com';

function providerKey() {
  if (process.env.DEYUNAI_API_KEY) return process.env.DEYUNAI_API_KEY;
  const mirrorPath = path.resolve(process.env.OUTPUT_DIR || './outputs', 'settings.json');
  if (fs.existsSync(mirrorPath)) {
    const mirror = JSON.parse(fs.readFileSync(mirrorPath, 'utf8'));
    const mirrored = (mirror.providers || []).find(item => item.id === 'deyunai' || item.preset === 'deyunai');
    if (mirrored?.api_key) return mirrored.api_key;
  }
  const settings = loadSettings();
  const provider = (settings.providers || []).find(item => (
    item.id === 'deyunai'
    || item.preset === 'deyunai'
    || item.adapter === 'deyunai'
    || (item.models || []).some(model => String(model.id || '') === 'gpt-image-2')
  ));
  if (!provider?.api_key) throw new Error('deyunai provider key is unavailable');
  return provider.api_key;
}

function safeSegment(value = '') {
  return String(value || '').replace(/[^a-z0-9_-]/ig, '_').slice(0, 48) || 'image';
}

function imageUrls(value, found = new Set()) {
  if (typeof value === 'string') {
    if (/^https?:\/\//i.test(value) && /(?:image|output|cdn|png|jpe?g|webp)/i.test(value)) found.add(value);
    return found;
  }
  if (Array.isArray(value)) {
    value.forEach(item => imageUrls(item, found));
    return found;
  }
  if (value && typeof value === 'object') {
    Object.values(value).forEach(item => imageUrls(item, found));
  }
  return found;
}

async function recoverOne({ taskId, label, outputDir, apiKey }) {
  const endpoints = [
    `/ent/v1/images/edits/${encodeURIComponent(taskId)}`,
    `/ent/v1/images/generations/${encodeURIComponent(taskId)}`,
    `/v1/images/generations/${encodeURIComponent(taskId)}`,
  ];
  const attempts = [];
  for (const endpoint of endpoints) {
    let response;
    try {
      response = await axios.get(`${BASE_HOST}${endpoint}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        timeout: 60000,
        validateStatus: () => true,
      });
    } catch (error) {
      attempts.push({ endpoint, status: 0, error: String(error?.code || error?.message || error).slice(0, 160) });
      continue;
    }
    const urls = [...imageUrls(response.data)];
    attempts.push({
      endpoint,
      status: response.status,
      task_status: String(response.data?.status || response.data?.task_status || response.data?.data?.status || ''),
      provider_code: String(response.data?.code || response.data?.error?.code || ''),
      provider_message: String(response.data?.message || response.data?.msg || response.data?.error?.message || '').slice(0, 200),
      image_url_count: urls.length,
    });
    for (const url of urls) {
      try {
        const image = await axios.get(url, {
          responseType: 'arraybuffer',
          timeout: 120000,
          validateStatus: status => status >= 200 && status < 300,
        });
        const input = Buffer.from(image.data);
        const metadata = await sharp(input).metadata();
        if (!metadata.width || !metadata.height) continue;
        fs.mkdirSync(outputDir, { recursive: true });
        const filename = `recovered_${safeSegment(label)}_${safeSegment(taskId)}.png`;
        const filePath = path.join(outputDir, filename);
        await sharp(input).rotate().png({ compressionLevel: 8 }).toFile(filePath);
        return {
          task_id: taskId,
          label,
          recovered: true,
          endpoint,
          file_path: filePath,
          sha256: crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex'),
          width: metadata.width,
          height: metadata.height,
          attempts,
        };
      } catch (error) {
        attempts.push({
          endpoint,
          status: response.status,
          download_error: String(error?.code || error?.message || error).slice(0, 160),
        });
      }
    }
  }
  return { task_id: taskId, label, recovered: false, attempts };
}

async function main() {
  const outputDirArg = process.argv.find(value => value.startsWith('--output-dir='));
  const outputDir = path.resolve(outputDirArg ? outputDirArg.slice('--output-dir='.length) : './outputs/audits/recovered-image-tasks');
  const specs = process.argv
    .filter(value => value.startsWith('--task='))
    .map(value => value.slice('--task='.length))
    .map(value => {
      const [taskId, label = 'image'] = value.split(':');
      return { taskId: String(taskId || '').trim(), label: String(label || 'image').trim() };
    })
    .filter(item => item.taskId);
  if (!specs.length) throw new Error('provide at least one --task=<providerTaskId>:<label>');
  const apiKey = providerKey();
  const results = [];
  for (const spec of specs) results.push(await recoverOne({ ...spec, outputDir, apiKey }));
  console.log(JSON.stringify({ recovered: results.filter(item => item.recovered).length, results }, null, 2));
  if (results.some(item => !item.recovered)) process.exitCode = 2;
}

main().catch(error => {
  console.error(JSON.stringify({ recovered: 0, error: String(error?.message || error) }));
  process.exitCode = 1;
});
