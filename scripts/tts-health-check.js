#!/usr/bin/env node
/**
 * TTS 供应商健康体检
 * - 用每家供应商合成一句 "测试" 文本
 * - 成功 → provider.test_status='success' + last_tested
 * - 失败 → provider.test_status='error' + last_error_message
 * - 写回 outputs/settings.json
 *
 * 运行：node scripts/tts-health-check.js [--provider=volcengine]
 */
require('dotenv').config();
const path = require('path');
const fs = require('fs');
const { testProviderSynthesis } = require('../src/services/ttsService');
const { loadSettings, saveSettings } = require('../src/services/settingsService');

const TTS_PROVIDER_IDS = [
  'volcengine', 'zhipu', 'baidu', 'aliyun-tts',
  'fishaudio', 'minimax', 'xunfei', 'elevenlabs', 'openai',
];

async function testProvider(providerId) {
  const outDir = path.join(__dirname, '..', 'outputs', 'tts-health');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `test_${providerId}_${Date.now()}`);
  const started = Date.now();
  try {
    const result = await Promise.race([
      testProviderSynthesis(providerId, outPath),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout 15s')), 15000)),
    ]);
    const latency = Date.now() - started;
    const ok = !!result && fs.existsSync(result) && fs.statSync(result).size > 200;
    try { if (result && fs.existsSync(result)) fs.unlinkSync(result); } catch {}
    return { ok, latency, error: ok ? null : '输出文件为空或过小' };
  } catch (e) {
    return { ok: false, latency: Date.now() - started, error: e.message };
  }
}

async function main() {
  const onlyArg = (process.argv.find(a => a.startsWith('--provider=')) || '').split('=')[1];
  const settings = loadSettings();
  const targets = (onlyArg ? [onlyArg] : TTS_PROVIDER_IDS);

  console.log('\n=== TTS 供应商体检 ===');
  for (const pid of targets) {
    const p = (settings.providers || []).find(x => x.id === pid);
    if (!p) { console.log(`  [跳过] ${pid} 未配置`); continue; }
    if (!p.api_key) { console.log(`  [跳过] ${pid} 无 API Key`); continue; }
    if (!p.enabled) { console.log(`  [跳过] ${pid} 已停用`); continue; }
    const hasTTSModel = (p.models || []).some(m => m.enabled !== false && m.use === 'tts');
    if (!hasTTSModel) { console.log(`  [跳过] ${pid} 没有启用的 TTS 模型`); continue; }

    process.stdout.write(`  [测试] ${pid} ... `);
    const r = await testProvider(pid);
    if (r.ok) {
      console.log(`✅ ${r.latency}ms`);
      p.test_status = 'success';
      p.last_tested = new Date().toISOString();
      p.last_error_message = '';
    } else {
      console.log(`❌ ${r.error} (${r.latency}ms)`);
      p.test_status = 'error';
      p.last_tested = new Date().toISOString();
      p.last_error_message = r.error;
    }
  }

  saveSettings(settings);
  console.log('\n结果已写入 outputs/settings.json');
  console.log('失败的供应商会在前端音色列表、数字人配音下拉中自动隐藏。\n');
}

if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
module.exports = { testProvider };
