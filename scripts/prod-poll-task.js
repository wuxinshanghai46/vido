// 轮询 jimeng-omni auto-produce 任务
const jwt = require('jsonwebtoken');
const axios = require('axios');
const path = require('path');
const authStore = require(path.join(__dirname, '..', 'src', 'models', 'authStore'));

const JWT_SECRET = process.env.JWT_SECRET || 'vido_default_secret_change_me';
const taskId = process.argv[2];
if (!taskId) { console.error('usage: node prod-poll-task.js <taskId>'); process.exit(1); }

if (authStore.init) try { authStore.init(); } catch {}
const users = authStore.getUsers();
const admin = users.find(u => u.role === 'admin' && u.status === 'active');
const token = jwt.sign({ userId: admin.id, role: admin.role }, JWT_SECRET, { expiresIn: '1h' });

(async () => {
  const start = Date.now();
  const MAX_MS = 8 * 60 * 1000;
  let last = '';
  while (Date.now() - start < MAX_MS) {
    try {
      const r = await axios.get('http://127.0.0.1:4600/api/avatar/jimeng-omni/tasks/' + taskId, {
        headers: { Authorization: 'Bearer ' + token }, timeout: 10000,
      });
      const t = r.data?.task || r.data;
      const sig = `${t.status}/${t.stage}${t.elapsed?'('+t.elapsed+'s)':''}`;
      if (sig !== last) {
        console.log(`[${Math.round((Date.now()-start)/1000)}s]`, sig, t.script_preview ? '· preview='+t.script_preview.slice(0,40) : '', t.error?' · ERR='+t.error:'');
        last = sig;
      }
      if (t.status === 'done') {
        console.log('---DONE---');
        console.log('script:', (t.script||'').slice(0,200));
        console.log('image_url:', t.image_url);
        console.log('audio_url:', t.audio_url);
        console.log('video_url:', t.video_url);
        console.log('local:', t.local_path);
        process.exit(0);
      }
      if (t.status === 'error') { console.error('task failed:', t.error); process.exit(2); }
    } catch (e) {
      console.log('poll err:', e.response?.status, e.message);
    }
    await new Promise(r => setTimeout(r, 10000));
  }
  console.log('timeout 8min, last state:', last);
})();
