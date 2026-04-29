const axios = require('axios');
const PAT = 'pat_W6i65ewEG6DwyRZhU8rxOWYcCrinlHcz8F9aWjuRPitfPGV7eyEj2CYBWmBwXuxK';
const BOT = '7630406469892063272';
const HIFLY = 'PaYYZsqJKt8e4aYezV5c8VxgtvNvFhAO7tS-LSLOPuE';
const H = { Authorization: 'Bearer ' + PAT, 'Content-Type': 'application/json' };

(async () => {
  const msg = [
    '请调用飞影数字人插件的 get_account_credit 工具。',
    '',
    `Authorization 参数固定传：Bearer ${HIFLY}`,
    '',
    '请直接调用工具，工具返回后把原始 JSON 包在 ```json ... ``` 代码块里告诉我。',
  ].join('\n');

  const cr = await axios.post('https://api.coze.cn/v3/chat', {
    bot_id: BOT, user_id: 'vido_debug', stream: false, auto_save_history: true,
    additional_messages: [{ role: 'user', content: msg, content_type: 'text' }],
  }, { headers: H, timeout: 20000 });
  console.log('create:', cr.status, JSON.stringify(cr.data).slice(0, 300));
  const chat_id = cr.data.data.id;
  const conv_id = cr.data.data.conversation_id;

  // 等
  for (let i = 0; i < 60; i++) {
    const rr = await axios.get('https://api.coze.cn/v3/chat/retrieve', { headers: H, params: { chat_id, conversation_id: conv_id }, timeout: 10000 });
    const d = rr.data.data;
    if (d.status === 'completed' || d.status === 'failed') {
      console.log('status:', d.status);
      break;
    }
    await new Promise(r => setTimeout(r, 3000));
  }

  const mr = await axios.get('https://api.coze.cn/v3/chat/message/list', { headers: H, params: { chat_id, conversation_id: conv_id }, timeout: 10000 });
  console.log('\n=== messages ===');
  (mr.data.data || []).forEach((m, i) => {
    console.log(`\n[${i}] role=${m.role} type=${m.type}`);
    console.log('content:', (m.content || '').slice(0, 500));
  });
})();
