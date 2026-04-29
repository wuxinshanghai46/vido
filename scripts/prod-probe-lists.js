const path = require('path');
const coze = require(path.join(__dirname, '..', 'src', 'services', 'cozeService'));

(async () => {
  console.log('=== query_avatar ===');
  try {
    const r = await coze.chatAndWait({
      user_id: 'probe_avatar',
      message: '请调用飞影数字人的 query_avatar 工具，查询公共数字人列表。这是免费工具无需 Authorization 参数。参数 page=1 size=30 kind=2。工具返回后直接把原始 JSON 告诉我。',
      timeoutMs: 5 * 60 * 1000,
    });
    r.messages.forEach(m => {
      if (m.type === 'tool_response' || m.type === 'function_call') {
        console.log(m.type + ':', (m.content || '').slice(0, 600));
      }
    });
  } catch (e) { console.log('avatar err:', e.message); }

  console.log('\n=== query_voice ===');
  try {
    const r = await coze.chatAndWait({
      user_id: 'probe_voice',
      message: '请调用飞影数字人的 query_voice 或 get_voice_list 工具，查询公版声音列表。这是免费工具无需 Authorization 参数。参数 page=1 size=50。工具返回后直接把原始 JSON 告诉我。',
      timeoutMs: 5 * 60 * 1000,
    });
    r.messages.forEach(m => {
      if (m.type === 'tool_response' || m.type === 'function_call') {
        console.log(m.type + ':', (m.content || '').slice(0, 800));
      }
    });
  } catch (e) { console.log('voice err:', e.message); }
})();
