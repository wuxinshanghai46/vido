const { getUserById, modifyCredits, getRoleById } = require('../models/authStore');

const CREDIT_COSTS = {
  story_gen: 5,
  image_gen: 10,
  video_gen: 50,
  video_gen_premium: 100,
  tts: 5,
  i2v: 50,
  avatar: 30,
  imggen: 10,
  novel_outline: 5,
  novel_chapter: 5,
};

const PREMIUM_MODELS = [
  'sora-2-pro', 'sora-2', 'gen4.5-turbo', 'gen4.5',
  'veo-3.1', 'veo-3', 'kling-v3', 'kling-v2.5-master',
  'luma-ray-3', 'luma-ray-2', 'minimax-video-01-director'
];

function getCreditCost(operation, modelId = '') {
  if (operation === 'video_gen' && PREMIUM_MODELS.some(m => modelId.includes(m))) {
    return CREDIT_COSTS.video_gen_premium;
  }
  return CREDIT_COSTS[operation] || 0;
}

// 预检查中间件：检查用户是否有足够积分
function requireCredits(operation) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ success: false, error: '未登录' });
    const cost = getCreditCost(operation);
    if (cost <= 0) return next();
    const user = getUserById(req.user.id);
    if (!user) return res.status(401).json({ success: false, error: '用户不存在' });
    if (user.credits < cost) {
      return res.status(402).json({
        success: false,
        error: `积分不足，需要 ${cost} 积分，当前余额 ${user.credits}`,
        required: cost, balance: user.credits
      });
    }
    next();
  };
}

// 实际扣减积分（在 service 层调用）
function deductCredits(userId, operation, detail = '', projectId = null, modelId = '') {
  if (!userId) return null;
  const cost = getCreditCost(operation, modelId);
  if (cost <= 0) return null;
  return modifyCredits(userId, -cost, 'deduct', operation, detail, projectId);
}

// 检查用户是否有权使用某个模型
function checkModelAccess(userId, providerId, modelId) {
  const user = getUserById(userId);
  if (!user) return { allowed: false, reason: '用户不存在' };
  // 用户级 allowed_models
  let allowed = user.allowed_models && user.allowed_models.length > 0
    ? user.allowed_models
    : null;
  // 回退到角色级
  if (!allowed) {
    const role = getRoleById(user.role);
    allowed = role ? role.allowed_models : [];
  }
  if (!allowed || allowed.length === 0) return { allowed: false, reason: '未配置可用模型' };
  if (allowed.includes('*')) return { allowed: true };
  if (allowed.includes(providerId) || allowed.includes(modelId)) return { allowed: true };
  return { allowed: false, reason: `您的账户无权使用此模型 (${providerId}/${modelId})` };
}

module.exports = { CREDIT_COSTS, getCreditCost, requireCredits, deductCredits, checkModelAccess, PREMIUM_MODELS };
