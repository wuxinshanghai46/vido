#!/usr/bin/env node
require('dotenv').config();
const { VideoCanvasWorker } = require('../../services/videoCanvas/workerService');

const worker = new VideoCanvasWorker().start();
console.log(`[VideoCanvasWorker] started id=${worker.workerId} concurrency=${worker.concurrency} mode=${worker.stub ? 'stub' : 'real'}`);

let shuttingDown = false;
const keepAlive = setInterval(() => {}, 60 * 60 * 1000);

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[VideoCanvasWorker] ${signal}, waiting for active jobs=${worker.active.size}`);
  worker.stop();
  const deadline = Date.now() + 30000;
  const timer = setInterval(() => {
    if (!worker.active.size || Date.now() > deadline) {
      clearInterval(timer);
      clearInterval(keepAlive);
      process.exit(worker.active.size ? 1 : 0);
    }
  }, 250);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('disconnect', () => shutdown('IPC disconnect'));
process.on('message', message => {
  if (message?.type === 'shutdown') shutdown('IPC shutdown');
});

// Standalone/PM2 mode has no HTTP server handle. Keep the process alive even
// when the poll timer is unref'ed so graceful signals and IPC shutdown work.
