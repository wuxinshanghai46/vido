const jwt = require('jsonwebtoken');
const axios = require('axios');
const path = require('path');
const authStore = require(path.join(__dirname, '..', 'src', 'models', 'authStore'));
if (authStore.init) try { authStore.init(); } catch {}
const admin = authStore.getUsers().find(u => u.role === 'admin' && u.status === 'active');
const token = jwt.sign({ userId: admin.id, role: admin.role }, process.env.JWT_SECRET || 'vido_default_secret_change_me', { expiresIn: '2h' });

const tool = process.argv[2] || 'get_account_credit';
const args = process.argv[3] ? JSON.parse(process.argv[3]) : {};

(async () => {
  console.log('calling', tool, 'args=', JSON.stringify(args));
  try {
    const r = await axios.post('http://127.0.0.1:4600/api/hifly/coze-tool', { tool, args }, {
      headers: { Authorization: 'Bearer ' + token }, timeout: 6 * 60 * 1000,
    });
    console.log('[success]');
    console.log('parsed:', JSON.stringify(r.data.parsed, null, 2));
    console.log('finalAnswer:', (r.data.finalAnswer || '').slice(0, 400));
    console.log('toolResponseCount:', r.data.toolResponseCount);
  } catch (e) {
    console.error('[error]', e.response?.status, JSON.stringify(e.response?.data || e.message).slice(0, 500));
  }
})();
