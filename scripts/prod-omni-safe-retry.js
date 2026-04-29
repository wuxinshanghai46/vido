// 用无风险话题 + 新 idol prompt 链路 重跑 Omni auto-produce
const jwt = require('jsonwebtoken');
const axios = require('axios');
const path = require('path');
const authStore = require(path.join(__dirname, '..', 'src', 'models', 'authStore'));

const JWT_SECRET = process.env.JWT_SECRET || 'vido_default_secret_change_me';

if (authStore.init) try { authStore.init(); } catch {}
const admin = authStore.getUsers().find(u => u.role === 'admin' && u.status === 'active');
const token = jwt.sign({ userId: admin.id, role: admin.role }, JWT_SECRET, { expiresIn: '2h' });

(async () => {
  try {
    const r = await axios.post('http://127.0.0.1:4600/api/avatar/jimeng-omni/auto-produce', {
      topic: '早上醒来如何 10 分钟让自己彻底清醒进入工作状态',
      duration_sec: 30,
      // 不传 portrait_prompt，走新的默认 idol prompt（已部署）
    }, { headers: { Authorization: 'Bearer ' + token }, timeout: 20000 });
    console.log('[submit]', JSON.stringify(r.data));
  } catch (e) {
    console.error('[submit error]', e.response?.status, JSON.stringify(e.response?.data || e.message));
  }
})();
