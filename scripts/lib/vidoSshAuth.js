const fs = require('fs');
const os = require('os');
const path = require('path');

/**
 * 构造生产 SSH 连接参数：优先使用显式密码兼容旧流程，默认使用本机私钥。
 * 私钥和密码都不写入仓库、日志或交接文档。
 */
function connectionOptions({
  host = process.env.VIDO_DEPLOY_HOST || '43.98.167.151',
  port = Number(process.env.VIDO_DEPLOY_PORT || 2222),
  username = process.env.VIDO_DEPLOY_USER || 'root',
  readyTimeout = 25000,
  keepaliveInterval = Number(process.env.VIDO_DEPLOY_KEEPALIVE_INTERVAL || 15000),
  keepaliveCountMax = Number(process.env.VIDO_DEPLOY_KEEPALIVE_COUNT_MAX || 6),
} = {}) {
  const password = String(process.env.VIDO_DEPLOY_PASSWORD || '');
  if (password) return { host, port, username, password, readyTimeout, keepaliveInterval, keepaliveCountMax };
  const sshDir = path.join(os.homedir(), '.ssh');
  const privateKeyPath = process.env.VIDO_DEPLOY_KEY
    || [path.join(sshDir, 'id_ed25519_vido_prod'), path.join(sshDir, 'id_ed25519')].find(fs.existsSync)
    || path.join(sshDir, 'id_ed25519_vido_prod');
  if (!fs.existsSync(privateKeyPath)) {
    throw new Error(`SSH private key not found: ${privateKeyPath}`);
  }
  return {
    host,
    port,
    username,
    privateKey: fs.readFileSync(privateKeyPath),
    readyTimeout,
    keepaliveInterval,
    keepaliveCountMax,
  };
}

module.exports = { connectionOptions };
