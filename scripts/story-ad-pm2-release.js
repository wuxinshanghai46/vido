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

function main(argv = process.argv.slice(2)) {
  const mode = value(argv, 'mode');
  const releaseDir = path.resolve(value(argv, 'release'));
  const buildId = value(argv, 'build');
  const nodePath = path.resolve(value(argv, 'node', process.execPath));
  const appName = value(argv, 'app', 'vido');
  const candidateName = value(argv, 'candidate', `vido-candidate-${buildId}`.slice(0, 80));
  if (!['candidate', 'cutover'].includes(mode)) throw new Error('mode 必须为 candidate 或 cutover');
  if (!releaseDir || !fs.existsSync(path.join(releaseDir, 'src', 'server.js'))) throw new Error('不可变 release 目录无效');
  if (!fs.existsSync(nodePath)) throw new Error(`固定 Node 解释器不存在：${nodePath}`);
  const list = JSON.parse(childProcess.execFileSync('pm2', ['jlist'], { encoding: 'utf8' }) || '[]');
  const source = list.find(item => item?.name === appName) || list.find(item => item?.name === candidateName);
  if (!source) throw new Error(`未找到可继承环境的 PM2 应用：${appName}`);
  const inherited = buildPm2Env(source, process.env);
  const staleCandidateNames = [...new Set(list
    .map(item => String(item?.name || ''))
    .filter(name => name.startsWith('vido-candidate-')))];
  const start = (name, port) => pm2([
    'start', path.join(releaseDir, 'src', 'server.js'), '--name', name, '--cwd', releaseDir,
    '--interpreter', nodePath, '--update-env',
  ], { env: { ...inherited, PORT: String(port), STORY_AD_BUILD_ID: buildId, STORY_AD_VERIFY_RELEASE: '1', STORY_AD_ALLOW_LEGACY_CLIENT: '0', STORY_AD_ENFORCE_NODE_RUNTIME: '1' } });
  if (mode === 'candidate') {
    staleCandidateNames.forEach((name) => { try { pm2(['delete', name]); } catch {} });
    start(candidateName, 4601);
    console.log(JSON.stringify({ mode, candidate_name: candidateName, release_dir: releaseDir, port: 4601 }));
    return;
  }
  pm2(['delete', appName]);
  start(appName, 4600);
  try { pm2(['delete', candidateName]); } catch {}
  pm2(['save', '--force']);
  console.log(JSON.stringify({ mode, app_name: appName, release_dir: releaseDir, port: 4600 }));
}

if (require.main === module) {
  try { main(); } catch (error) { console.error(error.message || error); process.exitCode = 1; }
}

module.exports = { main };
