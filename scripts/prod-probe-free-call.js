// 直接用自然语言让 bot 调 create_lipsync_video2 不带 token 试试
const jwt = require('jsonwebtoken');
const axios = require('axios');
const path = require('path');
const authStore = require(path.join(__dirname, '..', 'src', 'models', 'authStore'));
if (authStore.init) try { authStore.init(); } catch {}
const admin = authStore.getUsers().find(u => u.role === 'admin' && u.status === 'active');
const token = jwt.sign({ userId: admin.id, role: admin.role }, process.env.JWT_SECRET || 'vido_default_secret_change_me', { expiresIn: '2h' });

const coze = require(path.join(__dirname, '..', 'src', 'services', 'cozeService'));

(async () => {
  // 让 bot 用自然语言调（不传结构化 args）
  const message = `请调用飞影数字人的 create_lipsync_video2 工具，帮我生成一条免费对口型数字人视频。不需要传 Authorization 参数，直接用免费测试流程。`;
  try {
    const r = await coze.chatAndWait({ user_id: 'vido_probe', message, timeoutMs: 5 * 60 * 1000 });
    console.log('=== messages ===');
    r.messages.forEach((m, i) => {
      console.log(`[${i}] role=${m.role} type=${m.type}`);
      if (m.type === 'function_call' || m.type === 'tool_response') {
        console.log('  content:', (m.content || '').slice(0, 600));
      } else {
        console.log('  content:', (m.content || '').slice(0, 300));
      }
    });
  } catch (e) { console.error('err:', e.message); }
})();
