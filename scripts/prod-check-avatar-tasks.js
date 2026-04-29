const jwt = require('jsonwebtoken');
const axios = require('axios');
const path = require('path');
const authStore = require(path.join(__dirname, '..', 'src', 'models', 'authStore'));
if (authStore.init) try { authStore.init(); } catch {}
const admin = authStore.getUsers().find(u => u.role === 'admin' && u.status === 'active');
const token = jwt.sign({ userId: admin.id, role: admin.role }, process.env.JWT_SECRET || 'vido_default_secret_change_me', { expiresIn: '2h' });

const IDS = process.argv.slice(2);
(async () => {
  for (const id of IDS) {
    try {
      const r = await axios.get(`http://127.0.0.1:4600/api/avatar/tasks/${id}/status`, {
        headers: { Authorization: 'Bearer ' + token }, timeout: 10000,
      });
      const t = r.data?.task || r.data;
      console.log(`\n=== ${id} ===`);
      console.log('status:', t.status, '· model:', t.model, '· ratio:', t.ratio);
      console.log('title:', t.title || '-');
      console.log('created:', t.created_at);
      console.log('error:', t.error || '-');
      if (t.video_url) console.log('video_url:', t.video_url);
      if (t.local_path) console.log('local_path:', t.local_path);
      if (t.progress) console.log('progress:', JSON.stringify(t.progress).slice(0,200));
      if (t.step) console.log('step:', t.step, 'message:', t.message);
    } catch (e) {
      console.log(`\n=== ${id} ERROR ===`, e.response?.status, JSON.stringify(e.response?.data || e.message).slice(0,200));
    }
  }
})();
