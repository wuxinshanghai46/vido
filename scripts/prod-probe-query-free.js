const path = require('path');
const coze = require(path.join(__dirname, '..', 'src', 'services', 'cozeService'));
(async () => {
  const message = `请查询我之前提交的免费数字人视频任务的生成状态，任务 ID 是 12795923。调用 inspect_video_creation_status 工具，这是免费任务无需 Authorization 参数。`;
  const r = await coze.chatAndWait({ user_id: 'vido_probe_query', message, timeoutMs: 3 * 60 * 1000 });
  r.messages.forEach((m, i) => {
    console.log(`[${i}] role=${m.role} type=${m.type}`);
    console.log('  content:', (m.content || '').slice(0, 500));
  });
})();
