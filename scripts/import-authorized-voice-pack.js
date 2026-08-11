#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

function arg(name, fallback = '') {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const source = path.resolve(arg('source'));
const dest = path.resolve(arg('dest', path.join(__dirname, '../outputs/voice-packs')));
const rightsConfirmed = process.argv.includes('--rights-confirmed');
const ffmpeg = require('ffmpeg-static');
const ffprobe = require('ffprobe-static').path;

if (!arg('source') || !fs.existsSync(source)) throw new Error('必须通过 --source 指定存在的音色包目录');
if (!rightsConfirmed) throw new Error('缺少 --rights-confirmed；没有明确授权不得导入音色包');

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(file, out);
    else if (entry.isFile() && /\.(wav|mp3)$/i.test(entry.name)) out.push(file);
  }
  return out;
}

function sha256(file) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(file));
  return hash.digest('hex');
}

function cleanName(file) {
  return path.basename(file, path.extname(file))
    .replace(/-由微信公众号.*$/i, '')
    .replace(/[-_]?试听$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || '未命名音色';
}

function inferGender(text) {
  if (/女|奶奶|阿姨|少女|萝莉|御姐|姐姐|妈妈|姑娘|淑女/.test(text)) return 'female';
  if (/男|爷爷|老头|叔|大哥|少年|青年|公公|皇上|先生/.test(text)) return 'male';
  if (/童|孩|宝宝|幼儿/.test(text)) return 'child';
  return 'neutral';
}

function probe(file) {
  const p = spawnSync(ffprobe, ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name,sample_rate,channels:format=duration', '-of', 'json', file], { encoding: 'utf8', timeout: 30000 });
  if (p.status !== 0) throw new Error((p.stderr || 'ffprobe failed').trim().slice(0, 300));
  const json = JSON.parse(p.stdout || '{}');
  const audio = (json.streams || []).find(s => s.codec_type === 'audio');
  if (!audio) throw new Error('没有音频流');
  return {
    duration: Number(json.format?.duration || 0),
    codec: audio.codec_name || '',
    sample_rate: Number(audio.sample_rate || 0),
    channels: Number(audio.channels || 0),
  };
}

fs.mkdirSync(dest, { recursive: true });
const audioDir = path.join(dest, 'audio');
const tempDir = path.join(dest, '.import-tmp');
fs.mkdirSync(audioDir, { recursive: true });
fs.mkdirSync(tempDir, { recursive: true });

const files = walk(source).sort((a, b) => a.localeCompare(b, 'zh-CN'));
const seen = new Map();
const voices = [];
const failures = [];
let duplicateCount = 0;

for (let index = 0; index < files.length; index++) {
  const input = files[index];
  try {
    const hash = sha256(input);
    if (seen.has(hash)) {
      duplicateCount++;
      continue;
    }
    seen.set(hash, input);
    const id = `vp_${hash.slice(0, 24)}`;
    const temp = path.join(tempDir, `${id}${path.extname(input).toLowerCase()}`);
    const output = path.join(audioDir, `${id}.mp3`);
    fs.copyFileSync(input, temp);
    const transcode = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', temp, '-vn', '-ac', '1', '-ar', '24000', '-codec:a', 'libmp3lame', '-b:a', '96k', '-t', '60', output], { encoding: 'utf8', timeout: 120000 });
    fs.rmSync(temp, { force: true });
    if (transcode.status !== 0) throw new Error((transcode.stderr || 'ffmpeg failed').trim().slice(0, 300));
    const media = probe(output);
    if (!(media.duration > 0)) throw new Error('音频时长无效');
    const rel = path.relative(source, input);
    const parts = rel.split(path.sep);
    const category = parts.length > 1 ? parts.slice(0, Math.min(2, parts.length - 1)).join(' / ') : '未分类';
    const name = cleanName(input);
    const tagText = `${category} ${name}`;
    voices.push({
      id,
      name,
      gender: inferGender(tagText),
      category,
      tags: parts.slice(0, -1).filter(Boolean).slice(-3),
      duration: Number(media.duration.toFixed(3)),
      sample_rate: media.sample_rate,
      channels: media.channels,
      codec: media.codec,
      clonable: media.duration >= 10 && media.duration <= 180,
      file: `audio/${id}.mp3`,
      sha256: hash,
      source_name: path.basename(input),
      source_relative_path: rel,
      rights_status: 'user_confirmed_licensed',
    });
  } catch (error) {
    failures.push({ source_relative_path: path.relative(source, input), error: error.message });
  }
  if ((index + 1) % 50 === 0 || index === files.length - 1) {
    process.stdout.write(`processed=${index + 1}/${files.length} imported=${voices.length} duplicates=${duplicateCount} failures=${failures.length}\n`);
  }
}

fs.rmSync(tempDir, { recursive: true, force: true });
const manifest = {
  version: 1,
  generated_at: new Date().toISOString(),
  source_label: path.basename(source),
  rights: {
    status: 'user_confirmed_licensed',
    confirmed_at: new Date().toISOString(),
    note: '用户在项目对话中明确确认该素材包完全合法并授权上架；不包含凭证或个人隐私。',
  },
  summary: {
    available: true,
    source_audio_files: files.length,
    imported_unique: voices.length,
    duplicate_files: duplicateCount,
    failed_files: failures.length,
    clonable_files: voices.filter(v => v.clonable).length,
  },
  voices,
  failures,
};
const tmpManifest = path.join(dest, 'catalog.json.tmp');
fs.writeFileSync(tmpManifest, JSON.stringify(manifest, null, 2), 'utf8');
fs.renameSync(tmpManifest, path.join(dest, 'catalog.json'));
console.log(JSON.stringify(manifest.summary));
