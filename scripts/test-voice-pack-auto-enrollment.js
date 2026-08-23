#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const service = require('../src/services/voicePackEnrollmentService');

function fakeDb() {
  const rows = [];
  return {
    rows,
    listVoices(userId) { return rows.filter(row => !userId || row.user_id === userId); },
    getVoice(id) { return rows.find(row => row.id === id) || null; },
    insertVoice(row) {
      assert.ok(!rows.some(item => item.id === row.id), `duplicate voice id ${row.id}`);
      rows.push({ ...row });
    },
    updateVoice(id, fields) {
      const row = rows.find(item => item.id === id);
      assert.ok(row, `missing voice ${id}`);
      Object.assign(row, fields);
    },
  };
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vido-auto-voice-'));
  const source = path.join(root, 'source.mp3');
  fs.writeFileSync(source, Buffer.alloc(2048, 1));
  const db = fakeDb();
  const calls = [];
  const tracked = [];
  const packId = 'vp_0123456789abcdef';
  const deps = {
    db,
    voicesDir: path.join(root, 'voices'),
    publicAssetsDir: path.join(root, 'public'),
    voicePacks: {
      resolveVoicePackAudio(id) {
        if (id !== packId) return null;
        return { voice: { id, name: '授权测试音色', gender: 'female', clonable: true, rights_status: 'user_confirmed_licensed' }, file: source };
      },
    },
    pipelineModels: {
      pickModelWithDefault(stage) {
        assert.strictEqual(stage, 'voice.enrollment');
        return { provider_id: 'aliyun-tts', model_id: 'cosyvoice-v3.5-plus' };
      },
    },
    aliyun: {
      hasKey: () => true,
      async enrollVoice(url, options) {
        calls.push({ url, options });
        await new Promise(resolve => setTimeout(resolve, 15));
        return { voice_id: `aliyun_${calls.length}`, request_id: `request_${calls.length}`, target_model: options.targetModel };
      },
    },
    tracker: { record(row) { tracked.push(row); } },
  };

  const input = { userId: 'user-a', voicePackId: packId, requestBaseUrl: 'https://vido.example.com' };
  const concurrent = await Promise.all(Array.from({ length: 8 }, () => service.ensureRegisteredVoicePack(input, deps)));
  assert.strictEqual(calls.length, 1, '同账号并发只能提交一次供应商注册');
  assert.strictEqual(new Set(concurrent.map(row => row.voice_id)).size, 1);
  assert.strictEqual(db.rows.length, 1);
  assert.strictEqual(db.rows[0].user_id, 'user-a');
  assert.strictEqual(db.rows[0].status, 'ready');
  assert.ok(db.rows[0].aliyun_voice_id);
  assert.strictEqual(tracked.length, 1);
  assert.strictEqual(tracked[0].agentId, 'voice.enrollment');

  const reused = await service.ensureRegisteredVoicePack(input, deps);
  assert.strictEqual(reused.reused, true);
  assert.strictEqual(calls.length, 1, '重复使用不能再次计费');

  const other = await service.ensureRegisteredVoicePack({ ...input, userId: 'user-b' }, deps);
  assert.notStrictEqual(other.voice_id, reused.voice_id, '不同账号必须使用不同绑定记录');
  assert.strictEqual(calls.length, 2);
  await assert.rejects(
    service.resolveVoiceForAccount(reused.voice_id, { userId: 'user-b' }, deps),
    error => error.code === 'VOICE_ACCOUNT_MISMATCH',
  );
  await assert.rejects(
    service.ensureRegisteredVoicePack({ voicePackId: packId, requestBaseUrl: 'https://vido.example.com' }, deps),
    error => error.code === 'VOICE_ACCOUNT_REQUIRED',
  );

  const uncertainDb = fakeDb();
  let uncertainCalls = 0;
  const uncertainDeps = {
    ...deps,
    db: uncertainDb,
    aliyun: {
      hasKey: () => true,
      async enrollVoice() { uncertainCalls++; throw new Error('socket timeout after submission'); },
    },
  };
  await assert.rejects(service.ensureRegisteredVoicePack(input, uncertainDeps), /socket timeout/);
  assert.strictEqual(uncertainDb.rows[0].status, 'enrollment_uncertain');
  await assert.rejects(
    service.ensureRegisteredVoicePack(input, uncertainDeps),
    error => error.code === 'VOICE_ENROLLMENT_UNCERTAIN',
  );
  assert.strictEqual(uncertainCalls, 1, '结果不确定时不得自动重复提交');

  fs.rmSync(root, { recursive: true, force: true });
  console.log('voice pack auto enrollment: 20 assertions passed');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
