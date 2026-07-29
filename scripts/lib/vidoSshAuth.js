const fs = require('fs');
const os = require('os');
const path = require('path');

/**
 * 构造生产 SSH 连接参数：优先使用显式密码兼容旧流程，默认使用本机私钥。
 * 私钥和密码都不写入仓库、日志或交接文档。
 */
function connectionOptions({
  host = process.env.VIDO_DEPLOY_HOST || '43.98.167.151',
  port = Number(process.env.VIDO_DEPLOY_PORT || 22),
  username = process.env.VIDO_DEPLOY_USER || 'root',
  readyTimeout = 25000,
} = {}) {
  const password = String(process.env.VIDO_DEPLOY_PASSWORD || '');
  if (password) return { host, port, username, password, readyTimeout };
  const privateKeyPath = process.env.VIDO_DEPLOY_KEY
    || path.join(os.homedir(), '.ssh', 'id_ed25519');
  if (!fs.existsSync(privateKeyPath)) {
    throw new Error(`SSH private key not found: ${privateKeyPath}`);
  }
  return {
    host,
    port,
    username,
    privateKey: fs.readFileSync(privateKeyPath),
    readyTimeout,
  };
}

module.exports = { connectionOptions };
