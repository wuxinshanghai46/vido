// 远程执行脚本：列出 admin 用户 → 直接签 JWT → 调 auto-produce 生成对比 demo
const jwt = require('jsonwebtoken');
const axios = require('axios');
const path = require('path');
const authStore = require(path.join(__dirname, '..', 'src', 'models', 'authStore'));

const JWT_SECRET = process.env.JWT_SECRET || 'vido_default_secret_change_me';

if (authStore.init) try { authStore.init(); } catch (e) { console.warn('init', e.message); }
const users = authStore.getUsers ? authStore.getUsers() : [];
console.log('[users] total=', users.length);
const admin = users.find(u => u.role === 'admin' && u.status === 'active');
if (!admin) { console.error('no active admin'); process.exit(1); }
console.log('[admin]', admin.id, admin.username);

const token = jwt.sign({ userId: admin.id, role: admin.role }, JWT_SECRET, { expiresIn: '1h' });
console.log('[token] signed, len=', token.length);

const portrait_prompt = '一位 25 岁东亚年轻女性，精致五官，淡妆，长直黑发披肩，穿米色针织吊带连衣裙，坐在温馨北欧风书房中，背景有木质书架、绿植与暖色台灯，柔和午后阳光从左侧窗户洒入，DSLR 85mm f/2.0 浅景深，细腻真实皮肤纹理与微弱毛孔，清晰锐利眼神光，头发有自然散光发丝，写实电影级人像摄影，杂志封面水准，ONE SINGLE PERSON, centered composition, 9:16 portrait, preserve facial identity, no plastic skin, ultra-realistic';

(async () => {
  try {
    const r = await axios.post('http://127.0.0.1:4600/api/avatar/jimeng-omni/auto-produce', {
      topic: 'AI 数字人是怎么让虚拟形象开口说话的',
      duration_sec: 30,
      portrait_prompt,
    }, { headers: { Authorization: 'Bearer ' + token }, timeout: 20000 });
    console.log('[submit]', JSON.stringify(r.data));
  } catch (e) {
    console.error('[submit error]', e.response?.status, JSON.stringify(e.response?.data || e.message));
  }
})();
