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
    '你是 VIDO AI 画布的智能助手。',
    '用户正在一个无限画布上创作视频、图像、音频内容。',
    '请用简洁、富有启发性的中文回答。回复控制在 400 字以内，必要时分点。',
    '你的任务是帮助用户：构思故事、刻画角色、描绘画面、推进情节、完善提示词、挑选模型参数。',
    '除非必要，不要输出 markdown 标题或代码块。'
  ];
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
    const systemPrompt = buildSystemPrompt(context);
    const userPrompt = buildUserPrompt(String(message).trim(), history);
    const reply = await callLLM(systemPrompt, userPrompt);
    res.json({ success: true, reply: (reply || '').trim() });
  } catch (e) {
    console.error('[Agent] chat failed:', e.message);
    res.status(500).json({ success: false, error: e.message });
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
    const reply = await callLLM(systemPrompt, String(prompt).trim());
    res.json({ success: true, text: (reply || '').trim() });
  } catch (e) {
    console.error('[Agent] run-text failed:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;
