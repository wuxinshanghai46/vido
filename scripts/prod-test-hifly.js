const jwt = require('jsonwebtoken');
const axios = require('axios');
const path = require('path');
const authStore = require(path.join(__dirname, '..', 'src', 'models', 'authStore'));
if (authStore.init) try { authStore.init(); } catch {}
const admin = authStore.getUsers().find(u => u.role === 'admin' && u.status === 'active');
const token = jwt.sign({ userId: admin.id, role: admin.role }, process.env.JWT_SECRET || 'vido_default_secret_change_me', { expiresIn: '2h' });
const H = { Authorization: 'Bearer ' + token };
const BASE = 'http://127.0.0.1:4600';

(async () => {
  for (const [label, url] of [
    ['credit', BASE + '/api/hifly/credit'],
    ['avatars', BASE + '/api/hifly/avatars?page=1&size=5'],
    ['voices', BASE + '/api/hifly/voices?page=1&size=5'],
  ]) {
    try {
      const r = await axios.get(url, { headers: H, timeout: 15000, validateStatus: () => true });
      console.log(`[${label}]`, r.status, JSON.stringify(r.data).slice(0, 300));
    } catch (e) {
      console.log(`[${label}] ERR`, e.message.slice(0, 200));
    }
  }
})();
