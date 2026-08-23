#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vido-voice-pack-test-'));
const source = path.join(root, '授权音色');
const dest = path.join(root, 'library');
fs.mkdirSync(path.join(source, '不同年龄', '中年男声'), { recursive: true });
const ffmpeg = require('ffmpeg-static');
const sample = path.join(source, '不同年龄', '中年男声', `${'沉稳专业男声'.repeat(14)}.wav`);
const generated = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=12', '-ac', '2', '-ar', '44100', sample], { encoding: 'utf8', timeout: 30000 });
assert.strictEqual(generated.status, 0, generated.stderr);
fs.copyFileSync(sample, path.join(source, '不同年龄', '中年男声', '重复样本.wav'));

const importer = path.join(__dirname, 'import-authorized-voice-pack.js');
const denied = spawnSync(process.execPath, [importer, '--source', source, '--dest', dest], { encoding: 'utf8', timeout: 30000 });
assert.notStrictEqual(denied.status, 0, '未确认授权时必须拒绝导入');

const imported = spawnSync(process.execPath, [importer, '--source', source, '--dest', dest, '--rights-confirmed'], { encoding: 'utf8', timeout: 120000 });
assert.strictEqual(imported.status, 0, imported.stderr || imported.stdout);
const catalog = JSON.parse(fs.readFileSync(path.join(dest, 'catalog.json'), 'utf8'));
assert.strictEqual(catalog.summary.source_audio_files, 2);
assert.strictEqual(catalog.summary.imported_unique, 1);
assert.strictEqual(catalog.summary.duplicate_files, 1);
assert.strictEqual(catalog.summary.failed_files, 0);
assert.strictEqual(catalog.summary.clonable_files, 1);
assert.strictEqual(catalog.voices[0].rights_status, 'user_confirmed_licensed');
assert.match(catalog.voices[0].file, /^audio\/vp_[a-f0-9]+\.mp3$/);
assert.ok(fs.existsSync(path.join(dest, catalog.voices[0].file)));
assert.ok(catalog.voices[0].duration >= 10 && catalog.voices[0].duration <= 60.1);

process.env.VOICE_PACK_ROOT = dest;
const service = require('../src/services/voicePackService');
const listed = service.listVoicePacks({ q: '沉稳', page: 1, limit: 24 });
assert.strictEqual(listed.total, 1);
assert.strictEqual(listed.voices[0].clonable, true);
assert.strictEqual(listed.voices[0].rights_status, 'user_confirmed_licensed');
assert.ok(!Object.prototype.hasOwnProperty.call(listed.voices[0], 'source_relative_path'), 'API 不应暴露服务器源路径');
assert.ok(service.resolveVoicePackAudio(listed.voices[0].id)?.file);
assert.strictEqual(service.resolveVoicePackAudio('../../etc/passwd'), null);

const workbench = fs.readFileSync(path.join(__dirname, '../src/routes/workbench.js'), 'utf8');
const enrollment = fs.readFileSync(path.join(__dirname, '../src/services/voicePackEnrollmentService.js'), 'utf8');
assert.match(workbench, /voice-packs\/:id\/use/);
assert.doesNotMatch(workbench, /confirm_authorized_use/);
assert.doesNotMatch(workbench, /confirm_provider_charge/);
assert.match(enrollment, /source_voice_pack_id/);
assert.match(workbench, /ensureRegisteredVoicePack/);
assert.match(enrollment, /voice\.enrollment/);

const tts = fs.readFileSync(path.join(__dirname, '../src/services/ttsService.js'), 'utf8');
assert.match(tts, /if \(!v\.aliyun_voice_id \|\| v\.status !== 'ready'\) continue/);

const html = fs.readFileSync(path.join(__dirname, '../public/digital-human.html'), 'utf8');
const ui = fs.readFileSync(path.join(__dirname, '../public/js/digital-human.js'), 'utf8');
assert.match(html, /授权音色库/);
assert.match(html, /选择音色即可使用，系统按账号自动准备/);
assert.match(ui, /cloneVoicePack/);
assert.match(ui, /使用此音色/);

fs.rmSync(root, { recursive: true, force: true });
console.log('authorized voice pack library: 19 assertions passed');
