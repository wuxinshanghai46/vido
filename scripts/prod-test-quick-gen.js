const jwt = require('jsonwebtoken');
const axios = require('axios');
const path = require('path');
const authStore = require(path.join(__dirname, '..', 'src', 'models', 'authStore'));
if (authStore.init) try { authStore.init(); } catch {}
const admin = authStore.getUsers().find(u => u.role === 'admin' && u.status === 'active');
const token = jwt.sign({ userId: admin.id, role: admin.role }, process.env.JWT_SECRET || 'vido_default_secret_change_me', { expiresIn: '2h' });
const H = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };

const TEXT = '大家好，我是 VIDO 平台的数字人。今天给大家展示一下我们最新接入的飞影免费通道，输入一段文字，一键就能生成对口型的数字人视频，整个过程完全免费不限次数。';

(async () => {
  console.log('[submit] text =', TEXT.slice(0, 50) + '...');
  const sub = await axios.post('http://127.0.0.1:4600/api/hifly/quick-generate', { text: TEXT }, { headers: H, timeout: 20000 });
  console.log('submitted:', JSON.stringify(sub.data));
  const taskId = sub.data.taskId;

  // 轮询
  const start = Date.now();
  while (Date.now() - start < 10 * 60 * 1000) {
    await new Promise(r => setTimeout(r, 8000));
    try {
      const r = await axios.get(`http://127.0.0.1:4600/api/hifly/quick-generate/${taskId}/status`, { headers: H, timeout: 15000 });
      const t = r.data.task;
      console.log(`[${Math.round((Date.now()-start)/1000)}s] status=${t.status} stage=${t.stage} job_id=${t.job_id||'-'} hifly_status=${t.hifly_status||'-'}`);
      if (t.status === 'done') {
        console.log('✅ DONE video_url:', t.video_url);
        console.log('  local_path:', t.local_path);
        console.log('  duration:', t.duration);
        process.exit(0);
      }
      if (t.status === 'error') {
        console.error('❌ ERROR:', t.error);
        process.exit(2);
      }
    } catch (e) { console.log('poll err:', e.message); }
  }
  console.error('timeout');
})();
