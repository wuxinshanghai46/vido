'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { fork } = require('child_process');

const root = path.join(__dirname, '..');
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vido-video-canvas-worker-'));
const dbPath = path.join(tempDir, 'worker.sqlite');

process.env.DB_ENABLED = 'true';
process.env.DB_PATH = dbPath;
const sqlite = require('../src/db/sqlite');
const database = sqlite.openDatabase({ force: true, fresh: true });
for (const migrationFile of fs.readdirSync(path.join(root, 'src', 'db', 'migrations')).filter(name => name.endsWith('.sql')).sort()) {
  database.exec(fs.readFileSync(path.join(root, 'src', 'db', 'migrations', migrationFile), 'utf8'));
}
sqlite.closeDatabase();

async function main() {
  const worker = fork(path.join(root, 'src', 'workers', 'videoCanvas', 'worker.js'), [], {
    cwd: root,
    env: {
      ...process.env,
      DB_ENABLED: 'true',
      DB_PATH: dbPath,
      VIDEO_CANVAS_EXECUTION_MODE: 'stub',
      VIDEO_CANVAS_WORKER_MODE: 'external',
    },
    silent: true,
  });
  let stdout = '';
  let stderr = '';
  worker.stdout.on('data', chunk => { stdout += chunk; });
  worker.stderr.on('data', chunk => { stderr += chunk; });

  await new Promise((resolve, reject) => {
    const deadline = setTimeout(() => reject(new Error(`worker start timeout: ${stderr || stdout}`)), 5000);
    const onData = () => {
      if (!stdout.includes('[VideoCanvasWorker] started')) return;
      clearTimeout(deadline);
      worker.stdout.off('data', onData);
      resolve();
    };
    worker.stdout.on('data', onData);
  });

  const exited = new Promise((resolve, reject) => {
    const deadline = setTimeout(() => reject(new Error(`worker did not exit after IPC disconnect: ${stderr || stdout}`)), 5000);
    worker.once('exit', (code, signal) => {
      clearTimeout(deadline);
      resolve({ code, signal });
    });
  });
  worker.disconnect();
  const result = await exited;
  assert.equal(result.code, 0, stderr || stdout);
  assert.match(stdout, /IPC disconnect/);
  console.log(JSON.stringify({ passed: true, ipc_disconnect_exit: true, exit_code: result.code, paid_calls: 0 }));
}

main().finally(() => {
  try { sqlite.closeDatabase(); } catch {}
  fs.rmSync(tempDir, { recursive: true, force: true });
}).catch(error => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
