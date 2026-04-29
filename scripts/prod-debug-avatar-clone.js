// 直接调 avatar_create_by_image 拿完整 bot 响应看问题
const path = require('path');
const coze = require(path.join(__dirname, '..', 'src', 'services', 'cozeService'));

const TOKEN = process.env.HIFLY_TOKEN || 'PaYYZsqJKt8e4aYezV5c8VxgtvNvFhAO7tS-LSLOPuE';
const IMAGE_URL = process.argv[2] || 'http://43.98.167.151:4600/public/jimeng-assets/idol_idol_warm.png';

(async () => {
  const msg = `请调用飞影数字人的 avatar_create_by_image 工具，克隆一个图片数字人。参数：
  Authorization: Bearer ${TOKEN}
  image_url: ${IMAGE_URL}
  title: 调试测试
  model: 2
  aigc_flag: 0
直接调用，工具返回后告诉我原始 JSON。`;

  console.log('[sending msg]', msg.slice(0, 200));
  const r = await coze.chatAndWait({ user_id: 'debug_clone', message: msg, timeoutMs: 5 * 60 * 1000 });
  console.log('\n=== ALL MESSAGES ===');
  r.messages.forEach((m, i) => {
    console.log(`\n[${i}] role=${m.role} type=${m.type}`);
    console.log('  content:', (m.content || '').slice(0, 700));
  });
})();
