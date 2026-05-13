#!/usr/bin/env node
/**
 * 把生产服务器（43.98.167.151:/opt/vido/app）的代码改动拉回本地。
 *
 * 用法：
 *   VIDO_SYNC_HOST=43.98.167.151 \
 *   VIDO_SYNC_USER=root \
 *   VIDO_SYNC_PASSWORD='...' \
 *   node scripts/sync-from-server.js [--apply]
 *
 *   不带 --apply 默认 dry-run，只打印差异清单。
 *   加 --apply 才会真的下载并覆盖（覆盖前自动备份到 .sync-backup/<timestamp>/<relpath>）。
 *
 * 排除：node_modules / .git / outputs / uploads / tmp / logs / docs/logs / .env / *.log / 大于 10MB 的文件
 */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { Client } = require('ssh2');

const HOST = process.env.VIDO_SYNC_HOST;
const USER = process.env.VIDO_SYNC_USER || 'root';
const PASSWORD = process.env.VIDO_SYNC_PASSWORD;
const PORT = parseInt(process.env.VIDO_SYNC_PORT || '22', 10);
const REMOTE_ROOT = process.env.VIDO_SYNC_REMOTE || '/opt/vido/app';
const APPLY = process.argv.includes('--apply');

if (!HOST || !PASSWORD) {
  console.error('ERROR: 缺少 VIDO_SYNC_HOST / VIDO_SYNC_PASSWORD 环境变量');
  process.exit(1);
}

const LOCAL_ROOT = path.resolve(__dirname, '..');
const BACKUP_DIR = path.join(LOCAL_ROOT, '.sync-backup', new Date().toISOString().replace(/[:.]/g, '-'));

const REMOTE_FIND = [
  `cd ${REMOTE_ROOT} &&`,
  `find .`,
  `\\( -path ./node_modules -o -path ./.git -o -path ./outputs -o -path './outputs.bak.*' -o -path ./uploads -o -path ./tmp -o -path ./logs -o -path ./docs/logs -o -path ./.sync-backup -o -path ./.deploy-backup \\)`,
  `-prune`,
  `-o -type f`,
  `! -name '*.log'`,
  `! -name '.env'`,
  `! -name '.env.*'`,
  `! -name '*.bak-*'`,
  `! -name '*.bak.*'`,
  `! -name '*.swp'`,
  `-size -10M`,
  `-exec sha256sum {} +`,
].join(' ');

function sha256OfFile(filePath) {
  try {
    const buf = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(buf).digest('hex');
  } catch {
    return null;
  }
}

function execRemote(conn, cmd) {
  return new Promise((resolve, reject) => {
    conn.exec(cmd, (err, stream) => {
      if (err) return reject(err);
      let stdout = '';
      let stderr = '';
      stream
        .on('close', (code) => {
          if (code !== 0 && !stdout) {
            return reject(new Error(`remote exit=${code}: ${stderr.slice(0, 500)}`));
          }
          resolve(stdout);
        })
        .on('data', (d) => (stdout += d.toString('utf8')))
        .stderr.on('data', (d) => (stderr += d.toString('utf8')));
    });
  });
}

function parseShaOutput(text) {
  const map = new Map();
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const m = line.match(/^([0-9a-f]{64})\s+\.\/(.+)$/);
    if (!m) continue;
    map.set(m[2].replace(/\\/g, '/'), m[1]);
  }
  return map;
}

function shouldSkipPath(rel) {
  if (rel.startsWith('node_modules/')) return true;
  if (rel.startsWith('.git/')) return true;
  if (rel.startsWith('outputs/')) return true;
  if (rel.startsWith('outputs.bak')) return true;
  if (rel.startsWith('uploads/')) return true;
  if (rel.startsWith('tmp/')) return true;
  if (rel.startsWith('logs/')) return true;
  if (rel.startsWith('docs/logs/')) return true;
  if (rel.startsWith('.sync-backup/')) return true;
  if (rel.startsWith('.deploy-backup/')) return true;
  if (rel.endsWith('.log')) return true;
  if (rel === '.env' || rel.startsWith('.env.')) return true;
  if (/\.bak[-.]/.test(rel)) return true;
  if (rel.endsWith('.swp')) return true;
  return false;
}

async function downloadFile(sftp, remotePath, localPath) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(localPath), { recursive: true });
    sftp.fastGet(remotePath, localPath, (err) => (err ? reject(err) : resolve()));
  });
}

(async () => {
  console.log(`[sync] mode = ${APPLY ? 'APPLY (will overwrite local)' : 'DRY-RUN'}`);
  console.log(`[sync] remote = ${USER}@${HOST}:${REMOTE_ROOT}`);
  console.log(`[sync] local  = ${LOCAL_ROOT}`);
  console.log('');

  const conn = new Client();
  await new Promise((resolve, reject) => {
    conn
      .on('ready', resolve)
      .on('error', reject)
      .connect({
        host: HOST,
        port: PORT,
        username: USER,
        password: PASSWORD,
        readyTimeout: 30_000,
      });
  });

  console.log('[sync] connected. Hashing remote files…');
  const remoteOutput = await execRemote(conn, REMOTE_FIND);
  const remoteMap = parseShaOutput(remoteOutput);
  console.log(`[sync] remote files: ${remoteMap.size}`);

  // Build local map for the same set of remote paths (only relative paths the remote has).
  // Plus: files that exist locally but not on remote → ignore (we only PULL).
  const diffs = []; // { rel, status: 'new'|'changed', remoteHash, localHash, sizeRemote? }
  for (const [rel, remoteHash] of remoteMap.entries()) {
    if (shouldSkipPath(rel)) continue;
    const localPath = path.join(LOCAL_ROOT, rel);
    const localHash = sha256OfFile(localPath);
    if (!localHash) {
      diffs.push({ rel, status: 'new', remoteHash, localHash: null });
    } else if (localHash !== remoteHash) {
      diffs.push({ rel, status: 'changed', remoteHash, localHash });
    }
  }

  diffs.sort((a, b) => a.rel.localeCompare(b.rel));

  console.log('');
  console.log(`[sync] diff total: ${diffs.length} (new=${diffs.filter(d => d.status === 'new').length}, changed=${diffs.filter(d => d.status === 'changed').length})`);

  // Group by top-level dir for readable output
  const byTop = new Map();
  for (const d of diffs) {
    const top = d.rel.split('/')[0];
    if (!byTop.has(top)) byTop.set(top, []);
    byTop.get(top).push(d);
  }
  for (const [top, list] of byTop.entries()) {
    console.log(`\n  [${top}] ${list.length}`);
    for (const d of list.slice(0, 200)) {
      console.log(`    ${d.status === 'new' ? '+' : '~'} ${d.rel}`);
    }
    if (list.length > 200) console.log(`    … and ${list.length - 200} more`);
  }

  if (!APPLY) {
    console.log('\n[sync] DRY-RUN done. Run with --apply to actually download.');
    conn.end();
    return;
  }

  if (diffs.length === 0) {
    console.log('\n[sync] nothing to do.');
    conn.end();
    return;
  }

  console.log(`\n[sync] downloading ${diffs.length} files…  (backup → ${path.relative(LOCAL_ROOT, BACKUP_DIR)})`);
  const sftp = await new Promise((resolve, reject) => {
    conn.sftp((err, s) => (err ? reject(err) : resolve(s)));
  });

  let ok = 0;
  let fail = 0;
  for (const d of diffs) {
    const localPath = path.join(LOCAL_ROOT, d.rel);
    const remotePath = `${REMOTE_ROOT}/${d.rel}`;
    try {
      // Backup existing local file (only if it exists)
      if (d.status === 'changed') {
        const backupPath = path.join(BACKUP_DIR, d.rel);
        fs.mkdirSync(path.dirname(backupPath), { recursive: true });
        fs.copyFileSync(localPath, backupPath);
      }
      await downloadFile(sftp, remotePath, localPath);
      ok++;
      if (ok % 25 === 0) console.log(`  …${ok}/${diffs.length}`);
    } catch (err) {
      console.error(`  FAIL ${d.rel}: ${err.message}`);
      fail++;
    }
  }

  console.log(`\n[sync] done. ok=${ok}, fail=${fail}`);
  if (fs.existsSync(BACKUP_DIR)) {
    console.log(`[sync] overwritten files backed up at: ${path.relative(LOCAL_ROOT, BACKUP_DIR)}`);
  }
  conn.end();
})().catch((err) => {
  console.error('[sync] fatal:', err && err.message ? err.message : err);
  process.exit(1);
});
