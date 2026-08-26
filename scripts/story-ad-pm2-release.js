#!/usr/bin/env node
'use strict';

const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');
const { buildPm2Env } = require('./run-with-pm2-env');

function value(args, name, fallback = '') {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
}

function pm2(args, options = {}) {
  const result = childProcess.spawnSync('pm2', args, { encoding: 'utf8', stdio: 'pipe', ...options });
  if (result.status !== 0) throw new Error(`${result.stdout || ''}\n${result.stderr || ''}`.trim());
  return String(result.stdout || '').trim();
}

function waitForPortFree(port, timeoutMs = 15000) {
  const probe = `
    const net = require('net');
    const port = Number(process.argv[1]);
    const deadline = Date.now() + Number(process.argv[2]);
    const check = () => {
      const socket = net.createConnection({ host: '127.0.0.1', port });
      socket.once('connect', () => { socket.destroy(); if (Date.now() >= deadline) process.exit(1); setTimeout(check, 100); });
      socket.once('error', () => process.exit(0));
      socket.setTimeout(500, () => { socket.destroy(); if (Date.now() >= deadline) process.exit(1); setTimeout(check, 100); });
    };
    check();
  `;
  const result = childProcess.spawnSync(process.execPath, ['-e', probe, String(port), String(timeoutMs)], {
    encoding: 'utf8', timeout: timeoutMs + 2000,
  });
  if (result.status !== 0) throw new Error(`候选端口 ${port} 未在 ${timeoutMs}ms 内释放`);
}

function main(argv = process.argv.slice(2)) {
  const mode = value(argv, 'mode');
  const releaseDir = path.resolve(value(argv, 'release'));
  const buildId = value(argv, 'build');
  const nodePath = path.resolve(value(argv, 'node', process.execPath));
  const appName = value(argv, 'app', 'vido');
  const candidateName = value(argv, 'candidate', `vido-candidate-${buildId}`.slice(0, 80));
  const logDir = String(process.env.VIDO_PM2_LOG_DIR || '/data/vido/logs/pm2').trim();
  if (!['candidate', 'cutover'].includes(mode)) throw new Error('mode 必须为 candidate 或 cutover');
  if (!releaseDir || !fs.existsSync(path.join(releaseDir, 'src', 'server.js'))) throw new Error('不可变 release 目录无效');
  if (!fs.existsSync(nodePath)) throw new Error(`固定 Node 解释器不存在：${nodePath}`);
  if (!path.isAbsolute(logDir)) throw new Error('VIDO_PM2_LOG_DIR 必须是绝对路径');
  fs.mkdirSync(logDir, { recursive: true, mode: 0o750 });
  const list = JSON.parse(childProcess.execFileSync('pm2', ['jlist'], { encoding: 'utf8' }) || '[]');
  const source = list.find(item => item?.name === appName) || list.find(item => item?.name === candidateName);
  if (!source) throw new Error(`未找到可继承环境的 PM2 应用：${appName}`);
  const inherited = buildPm2Env(source, process.env);
  const staleCandidateIds = [...new Set(list
    .filter(item => String(item?.name || '').startsWith('vido-candidate-')
      || String(item?.pm2_env?.env?.PORT || item?.pm2_env?.PORT || '') === '4601')
    .map(item => Number(item?.pm_id))
    .filter(Number.isInteger))];
  const start = (name, port) => {
    const safeName = String(name).replace(/[^a-z0-9._-]+/gi, '_').slice(0, 100) || 'vido';
    return pm2([
    'start', path.join(releaseDir, 'src', 'server.js'), '--name', name, '--cwd', releaseDir,
    '--interpreter', nodePath,
    '--output', path.join(logDir, `${safeName}-out.log`),
    '--error', path.join(logDir, `${safeName}-error.log`),
    '--update-env',
  ], { env: { ...inherited, PORT: String(port), STORY_AD_BUILD_ID: buildId, STORY_AD_VERIFY_RELEASE: '1', STORY_AD_ALLOW_LEGACY_CLIENT: '0', STORY_AD_ENFORCE_NODE_RUNTIME: '1' } });
  };
  if (mode === 'candidate') {
    staleCandidateIds.forEach((id) => { try { pm2(['delete', String(id)]); } catch {} });
    waitForPortFree(4601);
    start(candidateName, 4601);
    console.log(JSON.stringify({ mode, candidate_name: candidateName, release_dir: releaseDir, port: 4601 }));
    return;
  }
  pm2(['delete', appName]);
  try { pm2(['delete', candidateName]); } catch {}
  waitForPortFree(4600, 30000);
  start(appName, 4600);
  pm2(['save', '--force']);
  console.log(JSON.stringify({ mode, app_name: appName, release_dir: releaseDir, port: 4600 }));
}

if (require.main === module) {
  try { main(); } catch (error) { console.error(error.message || error); process.exitCode = 1; }
}

module.exports = { main, waitForPortFree };
