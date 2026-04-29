const jwt = require('jsonwebtoken');
const axios = require('axios');
const path = require('path');
const authStore = require(path.join(__dirname, '..', 'src', 'models', 'authStore'));
if (authStore.init) try { authStore.init(); } catch {}
const admin = authStore.getUsers().find(u => u.role === 'admin' && u.status === 'active');
const token = jwt.sign({ userId: admin.id, role: admin.role }, process.env.JWT_SECRET || 'vido_default_secret_change_me', { expiresIn: '2h' });

(async () => {
  try {
    const r = await axios.post('http://127.0.0.1:4600/api/avatar/generate', {
      avatar: 'http://43.98.167.151:4600/public/jimeng-assets/idol_idol_warm.png',
      text: '早上闹钟一响就爬起来太反人性。给你一个小诀窍：先坐起来喝下一杯温水，再打开窗户深呼吸三次，然后做三组简单的肩颈拉伸。十分钟后你会发现，整个人彻底醒过来，大脑清晰得像换了个CPU。',
      ratio: '9:16',
      model: 'I2V-01-live',
      background: 'office',
      bodyFrame: 'half_body',
    }, {
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      timeout: 20000,
    });
    console.log('[submit]', JSON.stringify(r.data));
  } catch (e) {
    console.error('[error]', e.response?.status, JSON.stringify(e.response?.data || e.message));
  }
})();
