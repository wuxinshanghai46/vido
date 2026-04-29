/**
 * Coze /v3/chat API 封装（用 PAT 调已发布 bot，间接调用飞影插件）
 *   飞影直调 REST 不可用（需更高会员）→ 走 Coze 代理架构：
 *   VIDO → Coze /v3/chat (PAT) → Bot 调飞影插件 (hifly_agent_token) → 飞影生成视频
 *
 * Coze PAT 从 settings 按 /coze/i 或 name 含 Coze 匹配；兜底 env COZE_PAT
 * Bot ID 从 settings.providers.find(x=>/coze/i.test(x.id)).metadata?.bot_id 或 env COZE_BOT_ID
 */
const axios = require('axios');
const { loadSettings } = require('./settingsService');

const COZE_BASE = 'https://api.coze.cn';

function _getCozeProvider() {
  const settings = loadSettings();
  return (settings.providers || []).find(p => {
    const hay = ((p.id||'')+ '|' +(p.preset||'')+ '|' +(p.name||'')).toLowerCase();
    return hay.includes('coze');
  });
}

function getCozePAT() {
  const p = _getCozeProvider();
  if (p?.api_key) return p.api_key;
  return process.env.COZE_PAT || null;
}

function getCozeBotId() {
  const p = _getCozeProvider();
  if (p?.metadata?.bot_id) return p.metadata.bot_id;
  if (p?.bot_id) return p.bot_id;
  return process.env.COZE_BOT_ID || null;
}

function _headers() {
  const pat = getCozePAT();
  if (!pat) throw new Error('未配置 Coze PAT（settings 或 env COZE_PAT）');
  return { Authorization: `Bearer ${pat}`, 'Content-Type': 'application/json' };
}

/**
 * 非流式提交一条消息给 bot，返回 chat_id + conversation_id
 * Coze /v3/chat 是异步的：先创建 chat，然后轮询消息
 */
async function createChat({ bot_id, user_id, message, additional_messages }) {
  const body = {
    bot_id,
    user_id: user_id || 'vido_user',
    stream: false,
    auto_save_history: true,
    additional_messages: additional_messages || [
      { role: 'user', content: message, content_type: 'text' },
    ],
  };
  const r = await axios.post(`${COZE_BASE}/v3/chat`, body, { headers: _headers(), timeout: 30000 });
  if (r.data?.code && r.data.code !== 0) throw new Error('Coze /v3/chat 失败 code=' + r.data.code + ': ' + r.data.msg);
  return { chat_id: r.data.data?.id, conversation_id: r.data.data?.conversation_id, status: r.data.data?.status };
}

/**
 * 查询 chat 状态（completed / in_progress / failed / requires_action）
 */
async function retrieveChat({ chat_id, conversation_id }) {
  const r = await axios.get(`${COZE_BASE}/v3/chat/retrieve`, {
    headers: _headers(),
    params: { chat_id, conversation_id },
    timeout: 15000,
  });
  if (r.data?.code && r.data.code !== 0) throw new Error('Coze retrieve 失败: ' + r.data.msg);
  return r.data.data; // { id, conversation_id, status, usage, ... }
}

/**
 * 取回 chat 的所有消息（包括 tool_call / tool_response / assistant）
 */
async function listChatMessages({ chat_id, conversation_id }) {
  const r = await axios.get(`${COZE_BASE}/v3/chat/message/list`, {
    headers: _headers(),
    params: { chat_id, conversation_id },
    timeout: 15000,
  });
  if (r.data?.code && r.data.code !== 0) throw new Error('Coze message list 失败: ' + r.data.msg);
  return r.data.data || [];
}

/**
 * 轮询直到完成，返回所有消息
 */
async function waitAndCollect({ chat_id, conversation_id, intervalMs = 3000, timeoutMs = 15 * 60 * 1000, onTick }) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const s = await retrieveChat({ chat_id, conversation_id });
    if (onTick) try { onTick(s); } catch {}
    if (s.status === 'completed') {
      const messages = await listChatMessages({ chat_id, conversation_id });
      return { status: s.status, usage: s.usage, messages };
    }
    if (s.status === 'failed' || s.status === 'canceled' || s.status === 'requires_action') {
      throw new Error(`Coze chat 异常状态 ${s.status}: ${s.last_error?.msg || ''}`);
    }
    await new Promise(r => setTimeout(r, intervalMs));
  }
  throw new Error('Coze chat 轮询超时');
}

/**
 * 发起 chat 并等待完成；从 messages 里提取最终 assistant 回复 + 所有 tool_response
 */
async function chatAndWait({ bot_id, user_id, message, additional_messages, onTick, timeoutMs }) {
  const botId = bot_id || getCozeBotId();
  if (!botId) throw new Error('未配置 Coze bot_id');
  const { chat_id, conversation_id, status } = await createChat({ bot_id: botId, user_id, message, additional_messages });
  if (status === 'completed') {
    const messages = await listChatMessages({ chat_id, conversation_id });
    return { chat_id, conversation_id, messages };
  }
  const result = await waitAndCollect({ chat_id, conversation_id, onTick, timeoutMs });
  return { chat_id, conversation_id, ...result };
}

/**
 * 从 Coze 消息数组里挑出 tool_response（插件返回）——飞影插件返回的 JSON 在这里
 * Coze 消息结构：
 *   role: assistant|tool
 *   type: answer|tool_call|tool_response|function_call|function_response
 *   content: string (JSON for tool responses)
 */
function extractToolResponses(messages) {
  return (messages || [])
    .filter(m => m.type === 'tool_response' || m.type === 'function_response')
    .map(m => {
      let content;
      try { content = JSON.parse(m.content); } catch { content = m.content; }
      return { ...m, parsed: content };
    });
}

function extractAssistantFinal(messages) {
  const finals = (messages || []).filter(m => m.role === 'assistant' && (m.type === 'answer' || m.type === 'verbose'));
  return finals[finals.length - 1]?.content || null;
}

// ═══════════════════════════════════════════════
// 飞影专用：通过 Coze bot 调用飞影插件工具
// ═══════════════════════════════════════════════
// 飞影插件要求运行时传 "Bearer <hifly_agent_token>" 格式的 Authorization 参数。
// bot 的人设里已经写死了 token，我们只要告诉 bot 调哪个工具 + 参数即可。

function getHiflyAgentToken() {
  const { loadSettings: _load } = require('./settingsService');
  const settings = _load();
  for (const p of (settings.providers || [])) {
    const hay = ((p.id||'') + '|' + (p.preset||'') + '|' + (p.name||'') + '|' + (p.api_url||'')).toLowerCase();
    if (hay.includes('hifly') || hay.includes('lingverse')) {
      if (p.api_key) return p.api_key;
    }
  }
  return process.env.HIFLY_TOKEN || process.env.HIFLY_AGENT_TOKEN || null;
}

/**
 * 调用飞影工具（通过 Coze bot）
 * @param {string} tool 飞影工具名，如 'get_account_credit' / 'query_avatar' / 'video_create_by_tts'
 * @param {object} args 工具参数
 * @param {object} opts { user_id, onTick, timeoutMs, botId }
 * @returns {Promise<{toolResponses: array, finalAnswer: string, messages: array, raw}>}
 */
async function callHiflyTool(tool, args = {}, opts = {}) {
  const hiflyToken = getHiflyAgentToken();
  if (!hiflyToken) throw new Error('未配置 Hifly agent token（settings providers 或 env HIFLY_TOKEN）');

  // 显式告诉 bot：调哪个工具 + 参数，Authorization 用下面这个完整字符串
  const authHeader = `Bearer ${hiflyToken}`;
  const argStr = Object.keys(args).length
    ? '参数：\n' + Object.entries(args).map(([k, v]) => `  ${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`).join('\n')
    : '无额外参数';
  const message = [
    `请调用飞影数字人插件的 ${tool} 工具。`,
    '',
    `Authorization 参数固定传：${authHeader}`,
    '',
    argStr,
    '',
    '请直接调用工具，不要问我要参数。工具返回后，把工具返回的原始 JSON 包在 ```json ... ``` 代码块里告诉我。',
  ].join('\n');

  const result = await chatAndWait({
    bot_id: opts.botId,
    user_id: opts.user_id || 'vido',
    message,
    onTick: opts.onTick,
    timeoutMs: opts.timeoutMs || 10 * 60 * 1000,
  });

  const toolResponses = extractToolResponses(result.messages);
  const finalAnswer = extractAssistantFinal(result.messages) || '';
  return { toolResponses, finalAnswer, messages: result.messages, chat_id: result.chat_id, conversation_id: result.conversation_id };
}

/**
 * 尝试把 finalAnswer/toolResponse 里的 JSON 结构提取成对象
 */
function parseHiflyResult({ toolResponses, finalAnswer }) {
  // 1. 优先从 toolResponses 里找
  for (const tr of (toolResponses || [])) {
    if (tr.parsed && typeof tr.parsed === 'object') return tr.parsed;
  }
  // 2. 再从 finalAnswer 里抽 ```json ... ```
  if (finalAnswer) {
    const m = finalAnswer.match(/```json\s*([\s\S]+?)\s*```/);
    if (m) { try { return JSON.parse(m[1]); } catch {} }
    // 没有代码块时，尝试直接 parse
    try { return JSON.parse(finalAnswer); } catch {}
  }
  return null;
}

// ═══════════════════════════════════════════════
// 飞影免费路径（create_lipsync_video2 + inspect_video_creation_status）
// ═══════════════════════════════════════════════
// 默认公共资源（bot 会用的免费试验 avatar + speaker）
const HIFLY_FREE_DEFAULTS = {
  digital_human_id: 1544344,
  speaker_id: '1169ef2d-7911-4b0c-855e-188e8a76ca53',
};

/**
 * 用自然语言让 bot 调工具（绕开"Authorization 参数缺失"的结构化调用问题）
 * 飞影免费工具即使我们结构化传 args 也会被 bot 工具桥要求 token；
 * 但用自然语言描述 + 告诉 bot "免费任务无需 Authorization"，bot 会正确地 skip token 字段。
 */
async function askBotAndExtract(naturalLanguageMessage, { timeoutMs = 5 * 60 * 1000, user_id = 'vido' } = {}) {
  const result = await chatAndWait({
    user_id, message: naturalLanguageMessage,
    timeoutMs,
  });
  // 提取所有 tool_response
  const tool = (result.messages || []).filter(m => m.type === 'tool_response');
  const parsed = tool.map(m => { try { return JSON.parse(m.content); } catch { return m.content; } });
  return { messages: result.messages, toolResponses: parsed, chat_id: result.chat_id };
}

/**
 * 提交免费对口型数字人视频
 */
async function submitHiflyFreeLipsync({ text, digital_human_id, speaker_id, subtitle = null, opts = {} }) {
  const did = digital_human_id || HIFLY_FREE_DEFAULTS.digital_human_id;
  const sid = speaker_id || HIFLY_FREE_DEFAULTS.speaker_id;
  const safeText = String(text || '').replace(/["'`]/g, ''); // 防 prompt 注入

  const extra = [];
  if (subtitle && subtitle.show) extra.push('  st_show: 1');

  const msg = `请调用飞影数字人的 create_lipsync_video2 工具，参数如下（这是免费任务，无需 Authorization 参数）：
  digital_human_id: ${did}
  speaker_id: ${sid}
  text: "${safeText}"
${extra.join('\n')}
直接调用，不要问我。工具返回后只告诉我 job_id 即可。`;

  const r = await askBotAndExtract(msg, opts);
  // tool_response 里拿 job_id
  for (const tr of r.toolResponses) {
    if (tr && typeof tr === 'object') {
      if (tr.job_id) return { job_id: tr.job_id, code: tr.code, message: tr.message, raw: tr };
      if (tr.data?.job_id) return { job_id: tr.data.job_id, raw: tr };
    }
  }
  // 如果没有从 tool_response 拿到，fallback 到 final answer 里抽数字
  const finalAnswer = extractAssistantFinal(r.messages) || '';
  const m = finalAnswer.match(/(?:job[_\s-]?id|任务\s*ID)[^\d]*(\d{6,})/i);
  if (m) return { job_id: parseInt(m[1]), raw: null, finalAnswer };
  throw new Error('未能从 bot 响应里提取 job_id：' + finalAnswer.slice(0, 200));
}

/**
 * 查询免费任务状态（用自然语言，避开"需要 token"的结构化调用）
 */
async function queryHiflyFreeTask(job_id, opts = {}) {
  const msg = `请查询我之前提交的免费数字人视频任务生成状态，任务 ID（job_id）是 ${job_id}。调用 inspect_video_creation_status 工具，这是免费任务无需 Authorization 参数。直接返回工具原始 JSON。`;
  const r = await askBotAndExtract(msg, opts);
  for (const tr of r.toolResponses) {
    if (tr && typeof tr === 'object' && (tr.status != null || tr.code != null)) {
      return {
        status: tr.status,                       // 1|2|3|4
        video_url: tr.video_Url || tr.video_url, // 注意飞影返回的是大写 U
        duration: tr.duration,
        code: tr.code,
        message: tr.message,
        raw: tr,
      };
    }
  }
  return { status: null, raw: r.toolResponses, messages: r.messages };
}

async function waitHiflyFreeTask(job_id, { intervalMs = 10000, timeoutMs = 15 * 60 * 1000, onProgress } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const s = await queryHiflyFreeTask(job_id);
    if (onProgress) try { onProgress(s); } catch {}
    if (s.status === 3) return s; // 完成
    if (s.status === 4) throw new Error('Hifly 免费任务失败: ' + (s.message || JSON.stringify(s.raw).slice(0, 200)));
    await new Promise(r => setTimeout(r, intervalMs));
  }
  throw new Error('Hifly 免费任务轮询超时 job_id=' + job_id);
}

// ═══════════════════════════════════════════════
// 飞影付费工具（走 Coze bot + Authorization=Bearer ${agent_token}）
// ═══════════════════════════════════════════════

function _bearerStr() {
  const t = getHiflyAgentToken();
  if (!t) throw new Error('未配置 hifly_agent_token');
  return 'Bearer ' + t;
}

/**
 * 克隆图片数字人：通过 Coze bot 调 avatar_create_by_image
 * @param {object} opts { image_url (公网 URL), title, model (1 或 2) }
 * @returns {Promise<{task_id, raw}>}
 */
// 统一的错误识别：bot 的 tool_response 可能是字符串（"Unauthorized"）或对象（{status:"error",message:"..."}）
function _interpretToolResponses(toolResponses) {
  for (const tr of toolResponses) {
    // 对象形式
    if (tr && typeof tr === 'object') {
      if (tr.task_id) return { task_id: tr.task_id, raw: tr };
      if (tr.data?.task_id) return { task_id: tr.data.task_id, raw: tr };
      if (tr.job_id) return { task_id: tr.job_id, raw: tr };
      if (tr.status === 'error' || (tr.code && tr.code !== 0)) {
        return { error: tr.message || tr.msg || JSON.stringify(tr).slice(0, 200), raw: tr };
      }
    }
    // 字符串形式（如 "Unauthorized"）
    if (typeof tr === 'string') {
      const s = tr.trim();
      if (/unauthorized/i.test(s)) {
        return { error: 'Unauthorized — 你的 hifly_agent_token 对该付费工具无效。需要去 https://hifly.cc/p/eEQGVbJD0cGb2vIT 获取独立的 API token 填入 settings。', raw: tr };
      }
      if (s.length < 300) return { error: s, raw: tr };
    }
  }
  return { error: null, raw: toolResponses };
}

async function submitHiflyCloneFromImage({ image_url, title = '未命名', model = 2 }) {
  // 飞影 Coze 插件不提供 avatar_create_by_image 工具
  throw new Error('飞影 Coze 插件不支持图片克隆（仅有 avatar_create_by_video），请改用视频克隆');
}

async function submitHiflyCloneFromVideo({ video_url, title = '未命名', aigc_flag = 0 }) {
  if (!video_url) throw new Error('video_url 必填');
  const msg = `请调用飞影数字人的 avatar_create_by_video 工具，克隆一个视频数字人。参数：
  Authorization: ${_bearerStr()}
  video_url: ${video_url}
  title: ${title}
  aigc_flag: ${aigc_flag}
直接调用，工具返回后告诉我 task_id 或错误信息。`;
  const r = await askBotAndExtract(msg);
  const interpreted = _interpretToolResponses(r.toolResponses);
  if (interpreted.task_id) return { task_id: interpreted.task_id, raw: interpreted.raw };
  if (interpreted.error) throw new Error('飞影视频克隆失败: ' + interpreted.error);
  const fa = extractAssistantFinal(r.messages) || '';
  const m = fa.match(/task[_\s-]?id[^\w]*([A-Za-z0-9\-]{6,})/i);
  if (m) return { task_id: m[1], raw: null };
  throw new Error('未拿到 task_id，bot 回复: ' + fa.slice(0, 200));
}

async function submitHiflyVoiceClone({ audio_url, title, voice_type = 8, languages }) {
  if (!audio_url) throw new Error('audio_url 必填');
  if (!title) throw new Error('title 必填');
  const langPart = languages ? `\n  languages: ${languages}` : '';
  const msg = `请调用飞影数字人的 create_voice 工具，克隆一个声音。参数：
  Authorization: ${_bearerStr()}
  audio_url: ${audio_url}
  title: ${title}
  voice_type: ${voice_type}${langPart}
直接调用，工具返回后告诉我 task_id 或错误信息。`;
  const r = await askBotAndExtract(msg);
  const interpreted = _interpretToolResponses(r.toolResponses);
  if (interpreted.task_id) return { task_id: interpreted.task_id, raw: interpreted.raw };
  if (interpreted.error) throw new Error('飞影声音克隆失败: ' + interpreted.error);
  const fa = extractAssistantFinal(r.messages) || '';
  const m = fa.match(/task[_\s-]?id[^\w]*([A-Za-z0-9\-]{6,})/i);
  if (m) return { task_id: m[1], raw: null };
  throw new Error('未拿到 task_id，bot 回复: ' + fa.slice(0, 200));
}

async function queryHiflyAvatarTask(task_id) {
  const msg = `请调用飞影数字人的 avatar_task 工具查询克隆进度。参数：
  Authorization: ${_bearerStr()}
  task_id: ${task_id}
直接调用并返回工具原始 JSON。`;
  const r = await askBotAndExtract(msg);
  for (const tr of r.toolResponses) {
    if (tr && typeof tr === 'object' && (tr.status != null || tr.code != null)) {
      return { status: tr.status, avatar: tr.avatar, code: tr.code, message: tr.message, raw: tr };
    }
  }
  return { status: null, raw: r.toolResponses };
}

async function queryHiflyVoiceTask(task_id) {
  const msg = `请调用飞影数字人的 voice/task 或 query_task 工具查询声音克隆进度。参数：
  Authorization: ${_bearerStr()}
  task_id: ${task_id}
直接调用并返回工具原始 JSON。`;
  const r = await askBotAndExtract(msg);
  for (const tr of r.toolResponses) {
    if (tr && typeof tr === 'object' && (tr.status != null || tr.code != null)) {
      return { status: tr.status, voice: tr.voice, demo_url: tr.demo_url, code: tr.code, message: tr.message, raw: tr };
    }
  }
  return { status: null, raw: r.toolResponses };
}

async function waitHiflyAvatarTask(task_id, { intervalMs = 10000, timeoutMs = 10 * 60 * 1000, onProgress } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const s = await queryHiflyAvatarTask(task_id);
    if (onProgress) try { onProgress(s); } catch {}
    if (s.status === 3) return s;
    if (s.status === 4) throw new Error('飞影克隆失败: ' + (s.message || JSON.stringify(s.raw).slice(0, 200)));
    await new Promise(r => setTimeout(r, intervalMs));
  }
  throw new Error('飞影克隆轮询超时');
}

async function waitHiflyVoiceTask(task_id, opts) {
  const start = Date.now();
  const { intervalMs = 10000, timeoutMs = 10 * 60 * 1000, onProgress } = opts || {};
  while (Date.now() - start < timeoutMs) {
    const s = await queryHiflyVoiceTask(task_id);
    if (onProgress) try { onProgress(s); } catch {}
    if (s.status === 3) return s;
    if (s.status === 4) throw new Error('声音克隆失败: ' + (s.message || JSON.stringify(s.raw).slice(0, 200)));
    await new Promise(r => setTimeout(r, intervalMs));
  }
  throw new Error('声音克隆轮询超时');
}

module.exports = {
  getCozePAT, getCozeBotId, getHiflyAgentToken,
  createChat, retrieveChat, listChatMessages, waitAndCollect, chatAndWait,
  extractToolResponses, extractAssistantFinal,
  callHiflyTool, parseHiflyResult,
  askBotAndExtract,
  submitHiflyFreeLipsync, queryHiflyFreeTask, waitHiflyFreeTask,
  submitHiflyCloneFromImage, submitHiflyCloneFromVideo, submitHiflyVoiceClone,
  queryHiflyAvatarTask, queryHiflyVoiceTask,
  waitHiflyAvatarTask, waitHiflyVoiceTask,
  HIFLY_FREE_DEFAULTS,
  COZE_BASE,
};
