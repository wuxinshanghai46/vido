const shotDesign = require('./shotDesignService');

function requiredRules(options = {}) {
  return [
    { needed: true, code: 'semantic_fidelity', pattern: /Semantic fidelity rule:/i },
    { needed: options.sceneRequired === true, code: 'scene_binding', pattern: /Shot scene binding:/i },
    { needed: options.personRequired === true && options.actorLocked === true, code: 'actor_identity', pattern: /Locked real actor\/person asset:/i },
    { needed: options.personForbidden === true, code: 'no_human', pattern: /Explicit no-human lock:/i },
    { needed: options.productRequired === true && options.productLocked === true, code: 'product_identity', pattern: /Product identity lock:/i },
    { needed: options.userVisualOverride === true, code: 'user_visual_override', pattern: /User-edited visual override, highest priority:/i },
  ].filter(rule => rule.needed);
}

function issues(prompt = '', options = {}) {
  const source = String(prompt || '');
  const missing = requiredRules(options)
    .filter(rule => !rule.pattern.test(source))
    .map(rule => `missing_${rule.code}`);
  return [
    ...shotDesign.surfacePromptInvariantIssues(source, options.design || {}),
    ...missing,
  ];
}

function assertPrompt(prompt = '', options = {}) {
  const found = issues(prompt, options);
  if (!found.length) return prompt;
  const error = new Error(`关键帧提示词未通过生成前语义门禁：${found.join(', ')}`);
  error.code = 'KEYFRAME_PROMPT_INVARIANT_FAILED';
  error.status = 422;
  error.retryable = false;
  error.details = { issues: found };
  throw error;
}

module.exports = { requiredRules, issues, assertPrompt };
