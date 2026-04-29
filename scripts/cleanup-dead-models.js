#!/usr/bin/env node
/**
 * 清理未生效/无 key/测试失败的模型
 *
 * 规则：
 *   - provider.enabled === false → 保持不变
 *   - provider.api_key 为空 → provider 设为 enabled=false
 *   - provider.test_status === 'error' → 全部模型 enabled=false
 *   - model.use 前缀 'image_disabled' / 'disabled' / '*_disabled' → enabled=false
 *   - volcengine 的 BV_* 语音合成模型 → enabled=false（用户要关闭豆包语音合成避免费用，保留声音复刻链路）
 *
 * 用法：
 *   node scripts/cleanup-dead-models.js [--dry-run]
 *   VIDO_DEPLOY_HOST=... VIDO_DEPLOY_PASSWORD='...' node scripts/cleanup-dead-models.js --remote
 */
const path = require('path');
const fs = require('fs');

const DRY = process.argv.includes('--dry-run');
const REMOTE = process.argv.includes('--remote');

async function cleanup(settings) {
  const changes = [];
  for (const p of (settings.providers || [])) {
    if (p.enabled === false) { changes.push(`保持禁用 · ${p.id}（已 disabled）`); continue; }

    // 规则 1：无 api_key → 整个 provider 禁用
    if (!p.api_key || !String(p.api_key).trim()) {
      p.enabled = false;
      changes.push(`⛔ 禁用 provider · ${p.id}（${p.name}）· 无 api_key`);
      continue;
    }

    // 规则 2：test_status='error' → 禁用 provider
    if (p.test_status === 'error') {
      p.enabled = false;
      changes.push(`⛔ 禁用 provider · ${p.id}（${p.name}）· test_status=error`);
      continue;
    }

    for (const m of (p.models || [])) {
      // 规则 3：use 带 _disabled 后缀
      if (typeof m.use === 'string' && /_disabled$/.test(m.use)) {
        if (m.enabled !== false) {
          m.enabled = false;
          changes.push(`  · ${p.id}/${m.id} · use=${m.use} → 禁用`);
        }
      }
      // 规则 4：火山 BV_* 语音合成模型 → 禁用（用户要关掉豆包语音合成避免调用费）
      if (p.id === 'volcengine' && /^BV[0-9]/.test(m.id)) {
        if (m.enabled !== false) {
          m.enabled = false;
          changes.push(`  · volcengine/${m.id} · 豆包语音合成 → 禁用（只保留声音复刻链路避免意外计费）`);
        }
      }
    }
  }
  return { settings, changes };
}

async function main() {
  if (REMOTE) {
    const { Client } = require('ssh2');
    const HOST = process.env.VIDO_DEPLOY_HOST, PASSWORD = process.env.VIDO_DEPLOY_PASSWORD, USER = process.env.VIDO_DEPLOY_USER || 'root';
    if (!HOST || !PASSWORD) { console.error('需要 VIDO_DEPLOY_HOST / PASSWORD'); process.exit(1); }
    const conn = new Client();
    conn.on('ready', () => {
      const REMOTE_FILE = '/data/vido/outputs/settings.json';
      conn.exec(`cat ${REMOTE_FILE}`, (err, stream) => {
        if (err) { console.error(err); process.exit(1); }
        let raw = '';
        stream.on('data', d => raw += d);
        stream.on('close', async () => {
          const settings = JSON.parse(raw);
          const { changes } = await cleanup(settings);
          console.log('━━━ 生产 settings 清理预览 ━━━');
          changes.forEach(c => console.log(c));
          console.log(`共 ${changes.length} 处变更`);
          if (DRY) { conn.end(); return; }
          // 写回
          const payload = JSON.stringify(settings, null, 2).replace(/'/g, "'\\''");
          conn.exec(`cat > ${REMOTE_FILE} << 'VIDOEOF'\n${JSON.stringify(settings, null, 2)}\nVIDOEOF`, (err2, s2) => {
            if (err2) { console.error(err2); process.exit(1); }
            s2.on('close', () => {
              conn.exec('pm2 reload vido --update-env', (err3, s3) => {
                s3.on('data', d => process.stdout.write(d));
                s3.on('close', () => { console.log('\n✓ 生产 settings 已清理并重启 PM2'); conn.end(); });
              });
            });
          });
        });
      });
    }).connect({ host: HOST, username: USER, password: PASSWORD, port: 22 });
  } else {
    const settingsPath = path.join(__dirname, '..', 'outputs', 'settings.json');
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    const { changes } = await cleanup(settings);
    console.log('━━━ 本地 settings 清理预览 ━━━');
    changes.forEach(c => console.log(c));
    console.log(`\n共 ${changes.length} 处变更`);
    if (DRY) return;
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
    console.log(`\n✓ 已写入 ${settingsPath}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
