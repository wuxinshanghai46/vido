const express = require('express');
const router = express.Router();
const { getSyncConfig, saveSyncConfig, testConnection, collectSyncStats, performSync } = require('../services/syncService');

function maskSecret(s) {
  if (!s) return '';
  if (s.length <= 6) return '***';
  return s.substring(0, 3) + '***' + s.slice(-3);
}

// 获取同步配置
router.get('/config', (req, res) => {
  const config = getSyncConfig();
  if (!config) return res.json({ success: true, data: null });
  // 遮蔽敏感字段
  res.json({
    success: true,
    data: {
      ...config,
      password: undefined,
      passphrase: undefined,
      password_masked: maskSecret(config.password),
      private_key_path: config.private_key_path || '',
    },
  });
});

// 保存同步配置
router.post('/config', (req, res) => {
  const { host, port, username, auth_type, password, private_key_path, passphrase, remote_path } = req.body;
  if (!host || !username) return res.status(400).json({ success: false, error: '请填写主机地址和用户名' });

  const existing = getSyncConfig();
  const config = {
    host,
    port: parseInt(port) || 22,
    username,
    auth_type: auth_type || 'password',
    // 密码/密钥：如果前端没填新值则保留旧值
    password: password || existing?.password || '',
    private_key_path: private_key_path || '',
    passphrase: passphrase || existing?.passphrase || '',
    remote_path: remote_path || '/home/' + username + '/vido-sync',
    created_at: existing?.created_at,
    last_synced: existing?.last_synced,
    last_sync_files: existing?.last_sync_files,
  };
  saveSyncConfig(config);
  res.json({ success: true });
});

// 测试连接
router.post('/test', async (req, res) => {
  const config = getSyncConfig();
  if (!config) return res.status(400).json({ success: false, error: '请先配置同步信息' });
  try {
    const result = await testConnection(config);
    res.json({ success: true, message: result.message, detail: result.detail });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

// 获取待同步数据统计
router.get('/stats', (req, res) => {
  const stats = collectSyncStats();
  res.json({ success: true, data: stats });
});

// 执行同步（SSE 流式进度）
router.get('/execute', async (req, res) => {
  const config = getSyncConfig();
  if (!config) return res.status(400).json({ success: false, error: '请先配置同步信息' });

  // SSE 头
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  const send = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const result = await performSync(config, (progress) => {
      send(progress);
    });
    send({ step: 'complete', message: '同步完成', files: result.files });
  } catch (e) {
    send({ step: 'error', message: '同步失败: ' + e.message });
  } finally {
    res.end();
  }
});

module.exports = router;
