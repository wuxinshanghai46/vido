/**
 * 数据同步服务 — 通过 SSH/SFTP 同步本地数据到远程 VPS
 */
const fs = require('fs');
const path = require('path');
const { Client } = require('ssh2');
const { loadSettings, saveSettings } = require('./settingsService');

const OUTPUTS_DIR = path.join(__dirname, '../../outputs');

// 需要同步的子目录
const SYNC_DIRS = ['videos', 'projects', 'characters', 'scenes', 'music', 'voice', 'i2v_uploads', 'assets'];
// 需要同步的数据库文件
const SYNC_FILES = ['settings.json', 'vido_db.json', 'edit_db.json'];

/** 获取同步配置 */
function getSyncConfig() {
  const settings = loadSettings();
  return settings.sync || null;
}

/** 保存同步配置 */
function saveSyncConfig(config) {
  const settings = loadSettings();
  settings.sync = {
    ...config,
    updated_at: new Date().toISOString(),
  };
  if (!config.created_at) settings.sync.created_at = new Date().toISOString();
  saveSettings(settings);
  return settings.sync;
}

/** 创建 SSH 连接 */
function createConnection(config) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    const opts = {
      host: config.host,
      port: config.port || 22,
      username: config.username,
    };
    if (config.auth_type === 'key') {
      // 私钥认证
      try {
        const keyPath = config.private_key_path.replace(/^~/, process.env.HOME || process.env.USERPROFILE);
        opts.privateKey = fs.readFileSync(keyPath);
        if (config.passphrase) opts.passphrase = config.passphrase;
      } catch (e) {
        return reject(new Error('无法读取私钥文件: ' + e.message));
      }
    } else {
      // 密码认证
      opts.password = config.password;
    }
    conn.on('ready', () => resolve(conn));
    conn.on('error', (err) => reject(new Error('SSH 连接失败: ' + err.message)));
    conn.connect(opts);
  });
}

/** 测试 SSH 连接 */
async function testConnection(config) {
  const conn = await createConnection(config);
  return new Promise((resolve, reject) => {
    conn.exec('echo "VIDO_SYNC_OK" && uname -a', (err, stream) => {
      if (err) { conn.end(); return reject(err); }
      let output = '';
      stream.on('data', d => { output += d.toString(); });
      stream.on('close', () => {
        conn.end();
        if (output.includes('VIDO_SYNC_OK')) {
          resolve({ success: true, message: '连接成功', detail: output.trim().split('\n').pop() });
        } else {
          reject(new Error('远程命令执行失败'));
        }
      });
    });
  });
}

/** 通过 SFTP 递归上传目录 */
function uploadDir(sftp, localDir, remoteDir, progressCb) {
  return new Promise(async (resolve, reject) => {
    try {
      // 确保远程目录存在
      await mkdirRemote(sftp, remoteDir);
      const entries = fs.readdirSync(localDir, { withFileTypes: true });
      let uploaded = 0;
      for (const entry of entries) {
        const localPath = path.join(localDir, entry.name);
        const remotePath = remoteDir + '/' + entry.name;
        if (entry.isDirectory()) {
          await uploadDir(sftp, localPath, remotePath, progressCb);
        } else if (entry.isFile()) {
          await uploadFile(sftp, localPath, remotePath);
          uploaded++;
          if (progressCb) progressCb(entry.name, uploaded);
        }
      }
      resolve(uploaded);
    } catch (e) { reject(e); }
  });
}

/** 上传单个文件 */
function uploadFile(sftp, localPath, remotePath) {
  return new Promise((resolve, reject) => {
    const readStream = fs.createReadStream(localPath);
    const writeStream = sftp.createWriteStream(remotePath);
    writeStream.on('close', resolve);
    writeStream.on('error', reject);
    readStream.on('error', reject);
    readStream.pipe(writeStream);
  });
}

/** 递归创建远程目录 */
function mkdirRemote(sftp, dirPath) {
  return new Promise((resolve, reject) => {
    sftp.stat(dirPath, (err) => {
      if (!err) return resolve(); // 已存在
      // 先创建父目录
      const parent = dirPath.substring(0, dirPath.lastIndexOf('/'));
      if (parent && parent !== dirPath) {
        mkdirRemote(sftp, parent).then(() => {
          sftp.mkdir(dirPath, (err2) => {
            if (err2 && err2.code !== 4) return reject(err2); // code 4 = already exists
            resolve();
          });
        }).catch(reject);
      } else {
        sftp.mkdir(dirPath, (err2) => {
          if (err2 && err2.code !== 4) return reject(err2);
          resolve();
        });
      }
    });
  });
}

/** 收集本地需要同步的文件统计信息 */
function collectSyncStats() {
  const stats = { files: 0, totalSize: 0, dirs: {} };

  // 数据库文件
  for (const f of SYNC_FILES) {
    const fp = path.join(OUTPUTS_DIR, f);
    if (fs.existsSync(fp)) {
      const s = fs.statSync(fp);
      stats.files++;
      stats.totalSize += s.size;
    }
  }

  // 子目录
  for (const dir of SYNC_DIRS) {
    const dp = path.join(OUTPUTS_DIR, dir);
    if (!fs.existsSync(dp)) continue;
    const dirStats = { files: 0, size: 0 };
    countDirFiles(dp, dirStats);
    stats.dirs[dir] = dirStats;
    stats.files += dirStats.files;
    stats.totalSize += dirStats.size;
  }
  return stats;
}

function countDirFiles(dirPath, result) {
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const e of entries) {
      const p = path.join(dirPath, e.name);
      if (e.isDirectory()) {
        countDirFiles(p, result);
      } else if (e.isFile()) {
        result.files++;
        result.size += fs.statSync(p).size;
      }
    }
  } catch {}
}

/** 执行完整同步（SSE 流式进度） */
async function performSync(config, onProgress) {
  const emit = (step, msg, detail) => {
    if (onProgress) onProgress({ step, message: msg, detail, timestamp: new Date().toISOString() });
  };

  emit('connecting', '正在连接远程服务器...');
  const conn = await createConnection(config);

  return new Promise((resolve, reject) => {
    conn.sftp((err, sftp) => {
      if (err) { conn.end(); return reject(new Error('SFTP 会话创建失败: ' + err.message)); }

      const remoteBase = config.remote_path || '/home/' + config.username + '/vido-sync';

      (async () => {
        try {
          emit('preparing', '正在准备远程目录...', remoteBase);
          await mkdirRemote(sftp, remoteBase);

          let totalUploaded = 0;

          // 1. 同步数据库文件
          emit('uploading_db', '正在同步数据库文件...');
          for (const f of SYNC_FILES) {
            const fp = path.join(OUTPUTS_DIR, f);
            if (fs.existsSync(fp)) {
              await uploadFile(sftp, fp, remoteBase + '/' + f);
              totalUploaded++;
              emit('uploading_db', `已上传: ${f}`, `${totalUploaded} 个文件`);
            }
          }

          // 2. 同步媒体目录
          for (const dir of SYNC_DIRS) {
            const dp = path.join(OUTPUTS_DIR, dir);
            if (!fs.existsSync(dp)) continue;
            emit('uploading_media', `正在同步 ${dir}/...`);
            const count = await uploadDir(sftp, dp, remoteBase + '/' + dir, (filename, n) => {
              totalUploaded++;
              emit('uploading_media', `${dir}/ — ${filename}`, `已上传 ${totalUploaded} 个文件`);
            });
          }

          emit('done', '同步完成', `共上传 ${totalUploaded} 个文件`);

          // 更新同步记录
          const settings = loadSettings();
          if (settings.sync) {
            settings.sync.last_synced = new Date().toISOString();
            settings.sync.last_sync_files = totalUploaded;
            saveSettings(settings);
          }

          sftp.end();
          conn.end();
          resolve({ success: true, files: totalUploaded });
        } catch (e) {
          sftp.end();
          conn.end();
          reject(e);
        }
      })();
    });
  });
}

module.exports = {
  getSyncConfig,
  saveSyncConfig,
  testConnection,
  collectSyncStats,
  performSync,
};
