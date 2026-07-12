// AI 画布 — Agent 面板与节点运行时的后端接口
//   POST /api/agent/chat   画布右侧 Agent 对话
//   POST /api/agent/run    文本类节点（text/story）运行时快速调 LLM
//
// 认证与权限由 server.js 统一挂载（authenticate + requirePermission('aicanvas')）
const router = require('express').Router();
const { callLLM } = require('../services/storyService');

// 构造 Agent system prompt，把选中节点的上下文注入
function buildSystemPrompt(context) {
  const base = [
    '你是 VIDO 视频画布的创作助手，也是能理解当前应用状态的工作流助手。',
    '用户正在一个无限画布上编排文本、图像、人物、场景、视频、数字人、语音、音乐和合成节点。',
    '当前可用节点仅限：文本、图片、背景、人物、I2V、视频、数字人、语音、音乐、合成。不要建议不存在的 Loop、参考图或其他节点；需要参考图时使用图片节点，需要循环时说明复制节点。',
    '请用简洁、富有启发性的中文回答。回复控制在 400 字以内，必要时分点。',
    '你的任务是帮助用户：构思内容、完善提示词、判断缺少的节点、安排节点顺序、解释失败原因并给出下一步可执行操作。',
    '回答必须结合用户当前画布；如果画布为空，明确建议从哪个节点或模板开始；不要假装已经执行尚未执行的生成操作。',
    '除非必要，不要输出 markdown 标题或代码块。'
  ];
  if (context?.project_name) base.push(`当前项目：${String(context.project_name).slice(0, 100)}`);
  if (context && Array.isArray(context.canvas_nodes) && context.canvas_nodes.length > 0) {
    base.push('', '当前画布节点概览：');
    for (const n of context.canvas_nodes.slice(0, 30)) {
      base.push(`- [${n.label || n.type || '节点'}] 提示词：${n.prompt || '未填写'}；结果：${n.result || '未生成'}`);
    }
  } else {
    base.push('', '当前画布为空。');
  }
  if (context && Array.isArray(context.selected_nodes) && context.selected_nodes.length > 0) {
    base.push('');
    base.push('用户当前在画布上选中了以下节点作为上下文：');
    for (const n of context.selected_nodes) {
      const label = n.label || n.type || '未知节点';
      const desc = n.description || n.prompt || n.content || '';
      base.push(`- [${label}] ${desc}`);
    }
    base.push('');
    base.push('请围绕这些节点给出建议或下一步操作。');
  }
  return base.join('\n');
}

async function createAgentReply(message, context, history) {
  const systemPrompt = buildSystemPrompt(context);
  const userPrompt = buildUserPrompt(String(message).trim(), history);
  const reply = await callLLM(systemPrompt, userPrompt, { kb: { scene: 'copy', query: String(message).slice(0, 200), limit: 3 } });
  return String(reply || '').trim();
}

function agentActions(reply, context) {
  const actions = [{ type: 'add_text_node', label: '添加为文本节点', payload: { text: reply } }];
  if (Array.isArray(context?.canvas_nodes) && context.canvas_nodes.length > 0) {
    actions.push({ type: 'add_next_step', label: '作为下一步加入画布', payload: { text: reply } });
  }
  return actions;
}

function splitReply(reply) {
  const chunks = String(reply || '').split(/(?<=[。！？；\n])/).map(item => item.trim()).filter(Boolean);
  if (chunks.length) return chunks;
  return [String(reply || '')];
}

function buildUserPrompt(message, history) {
  // 简单的多轮：把 history 串成对话
  const parts = [];
  if (Array.isArray(history) && history.length) {
    for (const m of history.slice(-10)) {
      const role = m.role === 'assistant' ? 'AI' : '用户';
      parts.push(`${role}: ${m.content || ''}`);
    }
  }
  parts.push(`用户: ${message}`);
  parts.push('AI:');
  return parts.join('\n');
}

router.post('/chat', async (req, res) => {
  try {
    const { message, context, history } = req.body || {};
    if (!message || !String(message).trim()) {
      return res.status(400).json({ success: false, error: '请输入消息' });
    }
    const reply = await createAgentReply(message, context, history);
    res.json({ success: true, reply, actions: agentActions(reply, context) });
  } catch (e) {
    console.error('[Agent] chat failed:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

router.post('/chat-stream', async (req, res) => {
  const { message, context, history } = req.body || {};
  if (!message || !String(message).trim()) return res.status(400).json({ success: false, error: '请输入消息' });
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();
  let closed = false;
  req.on('aborted', () => { closed = true; });
  res.on('close', () => { if (!res.writableEnded) closed = true; });
  const send = (event, data) => {
    if (!closed && !res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  try {
    send('phase', { id: 'understand', label: '理解你的目标', state: 'running' });
    send('phase', { id: 'understand', label: '理解你的目标', state: 'done' });
    send('phase', { id: 'canvas', label: '读取当前画布与节点关系', state: 'running' });
    const nodeCount = Array.isArray(context?.canvas_nodes) ? context.canvas_nodes.length : 0;
    send('phase', { id: 'canvas', label: `已读取 ${nodeCount} 个画布节点`, state: 'done' });
    send('phase', { id: 'answer', label: '生成可执行建议', state: 'running' });
    const reply = await createAgentReply(message, context, history);
    send('phase', { id: 'answer', label: '生成可执行建议', state: 'done' });
    for (const chunk of splitReply(reply)) send('chunk', { text: chunk });
    send('actions', { actions: agentActions(reply, context) });
    send('done', { reply });
  } catch (error) {
    console.error('[Agent] stream chat failed:', error.message);
    send('error', { error: error.message || '生成失败' });
  } finally {
    if (!res.writableEnded) res.end();
  }
});

// 文本类节点运行（text 节点）— 单次 LLM 调用，不带对话历史
router.post('/run-text', async (req, res) => {
  try {
    const { prompt, style = '' } = req.body || {};
    if (!prompt || !String(prompt).trim()) {
      return res.status(400).json({ success: false, error: '请填写提示词' });
    }
    const systemPrompt = '你是一位专业的内容创作助手。根据用户的提示词生成自然流畅、富有画面感的文字。直接输出结果，不要解释、前言、后记。' + (style ? `风格：${style}` : '');
    const reply = await callLLM(systemPrompt, String(prompt).trim(), { kb: { scene: 'copy', query: String(prompt).slice(0, 200), limit: 2 } });
    res.json({ success: true, text: (reply || '').trim() });
  } catch (e) {
    console.error('[Agent] run-text failed:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;
