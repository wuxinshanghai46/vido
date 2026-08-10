const briefGoalAssist = require('./briefGoalAssistService');
const knowledgePolicyRuntime = require('./knowledgePolicyRuntimeService');

/** 只为内容目标帮写构建当前模式提示，避免混入人物、场景、3D 与镜头规则。 */
function systemPrompt(context = {}, policy = {}) {
  return [
    briefGoalAssist.assistantRole(context),
    briefGoalAssist.taskRule(context),
    '用户明确写出的内容类型、人物、关系、时代、地点、事件、动作、冲突、结局和业务事实均为不可删除的当前任务事实。只允许补充因果与表达细节，不得用旧任务或固定行业模板替换。',
    briefGoalAssist.systemRule(context),
    '必须返回详细概述、出场人物或展示主体、主要场景、剧情段落与结尾；剧情段落至少两个且有先后因果关系。只写剧本层内容，不输出分镜、镜号、机位、运镜或生成提示词。',
    '各字段使用可直接阅读的纯文本，不使用 Markdown 标题符号或字面量反斜杠换行。',
    knowledgePolicyRuntime.promptBlock(policy || {}),
  ].filter(Boolean).join('\n');
}

module.exports = { systemPrompt };
