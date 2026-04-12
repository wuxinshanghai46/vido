/**
 * Agent Orchestrator - 跨 agent 调用与任务编排
 *
 * 核心能力：
 *   1. 统一的 executeAgent(agentId, task, context) 入口
 *   2. LLM 驱动的任务路由：分析任务 → 决定调用哪些 agent + 顺序
 *   3. 多 agent 链式协作：上一个 agent 的产出作为下一个的输入
 *   4. 自动注入 KB（静态注入 + RAG 动态检索）
 *   5. 调用链追踪（供前端展示 workflow 执行路径）
 *
 * 设计原则：
 *   - 任何 agent 都可以通过 orchestrator 调其他 agent
 *   - 调用链有最大深度限制（防止循环）
 *   - 每次调用有完整的 trace log
 */

const { callLLM } = require('./storyService');
const kb = require('./knowledgeBaseService');
const aiTeam = require('./aiTeamService');

// ———————————————————————————————————————————————
// 调用链追踪（避免循环 + 观察性）
// ———————————————————————————————————————————————
const MAX_CALL_DEPTH = 5;

class AgentCallContext {
  constructor(rootTask, initiator = 'user') {
    this.rootTask = rootTask;
    this.initiator = initiator;
    this.depth = 0;
    this.callStack = [];  // 当前调用栈（检测循环）
    this.trace = [];       // 完整调用记录
    this.startTime = Date.now();
  }

  enter(agentId) {
    if (this.depth >= MAX_CALL_DEPTH) {
      throw new Error(`Max call depth ${MAX_CALL_DEPTH} exceeded`);
    }
    if (this.callStack.includes(agentId)) {
      throw new Error(`Circular call detected: ${[...this.callStack, agentId].join(' → ')}`);
    }
    this.depth++;
    this.callStack.push(agentId);
    const record = {
      agent_id: agentId,
      depth: this.depth,
      started_at: Date.now(),
      path: [...this.callStack],
    };
    this.trace.push(record);
    return record;
  }

  exit(record, result, error) {
    record.finished_at = Date.now();
    record.duration_ms = record.finished_at - record.started_at;
    if (error) record.error = error.message;
    else record.output_preview = typeof result === 'string'
      ? result.slice(0, 200)
      : JSON.stringify(result).slice(0, 200);
    this.callStack.pop();
    this.depth--;
  }

  toJSON() {
    return {
      root_task: this.rootTask,
      initiator: this.initiator,
      total_duration_ms: Date.now() - this.startTime,
      total_calls: this.trace.length,
      trace: this.trace,
    };
  }
}

// ———————————————————————————————————————————————
// 单 agent 执行：统一接口
// 任何 agent 都可以通过此接口被调用
// ———————————————————————————————————————————————
async function executeAgent(agentId, task, context = null) {
  const ctx = context || new AgentCallContext(task);
  const record = ctx.enter(agentId);

  try {
    // 获取 agent 元信息
    const agent = kb.listAgentTypes().find(a => a.id === agentId);
    if (!agent) throw new Error(`Unknown agent: ${agentId}`);

    // 组装 KB 上下文：静态注入 + RAG 动态检索
    const staticCtx = kb.buildAgentContext(agentId, { maxDocs: 3 });
    const dynamicCtx = kb.searchForAgent(agentId, task, { limit: 5 });
    const kbContext = [staticCtx, dynamicCtx].filter(Boolean).join('\n\n');

    // 4 个已有的 callable agent 走专门实现
    let result;
    if (agentId === 'market_research') {
      result = await aiTeam.agentMarketResearch({ query: task, platform: '全网', market: '国内', goal: '调研' });
    } else if (agentId === 'copywriter') {
      result = await aiTeam.agentCopywriter({ content: task, platform: 'douyin', variantCount: 5 });
    } else if (agentId === 'editor') {
      // editor 需要 shots 数组，这里把 task 作为 scene description 降级处理
      result = { note: 'editor 需要结构化 shots 输入，请使用 /api/ai-team/editor 直接调用' };
    } else if (agentId === 'localizer') {
      result = await aiTeam.agentLocalizer({ content: task, targetMarket: 'us', contentType: 'script' });
    } else {
      // 通用 agent 执行：基于 LLM + KB 注入
      result = await executeGenericAgent(agent, task, kbContext, ctx);
    }

    ctx.exit(record, result);
    return { agent_id: agentId, result, trace: ctx.trace };
  } catch (e) {
    ctx.exit(record, null, e);
    throw e;
  }
}

// ———————————————————————————————————————————————
// 通用 agent 执行：基于 LLM + KB + 允许调用其他 agent
// ———————————————————————————————————————————————
async function executeGenericAgent(agent, task, kbContext, ctx) {
  // 列出可供协作调用的其他 agent（不含自己，且不在当前调用栈）
  const availableAgents = kb.listAgentTypes()
    .filter(a => a.id !== agent.id && !ctx.callStack.includes(a.id))
    .map(a => `- \`${a.id}\` (${a.emoji} ${a.name}) - ${a.desc || ''}`)
    .join('\n');

  const systemPrompt = `你是 VIDO AI 团队的 **${agent.emoji} ${agent.name}**（${agent.team === 'rd' ? '研发团队' : '市场运营团队'}）。

## 你的职责
${agent.desc || ''}

## 你的核心技能
${(agent.skills || []).map(s => `- ${s}`).join('\n')}

## 你可以协作的其他 agent
你在完成任务时，如果需要其他 agent 的专业能力，可以通过"委派 delegate"机制请求协作。

可协作的 agent：
${availableAgents}

## 协作决策
分析当前任务，判断：
1. **是否可以独立完成**？如果可以，直接给出结果。
2. **是否需要其他 agent 协助**？如果需要，返回委派请求。

## 输出格式（严格 JSON）
如果独立完成：
\`\`\`json
{
  "type": "result",
  "content": "你的最终输出内容",
  "reasoning": "你是如何得出这个结论的"
}
\`\`\`

如果需要委派：
\`\`\`json
{
  "type": "delegate",
  "delegations": [
    { "agent_id": "目标 agent ID", "subtask": "给该 agent 的具体子任务描述" }
  ],
  "integration_plan": "拿到各 agent 返回结果后你打算如何整合"
}
\`\`\`

${kbContext}

**严格遵守上述 JSON 格式，不要任何额外文字。**`;

  const userPrompt = `## 任务
${task}

## 根任务（原始用户需求）
${ctx.rootTask}

## 当前调用栈
${ctx.callStack.join(' → ')}

## 剩余调用深度
${MAX_CALL_DEPTH - ctx.depth}

请深度学习上面知识库中的内容，基于你的专业能力和可协作的 agent，判断如何完成这个任务。`;

  const raw = await callLLM(systemPrompt, userPrompt);
  let parsed;
  try {
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    parsed = JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
  } catch (e) {
    return { type: 'result', content: raw, reasoning: '(LLM 返回非 JSON 原文)' };
  }

  // 如果是委派请求，递归执行
  if (parsed.type === 'delegate' && Array.isArray(parsed.delegations)) {
    const subResults = [];
    for (const d of parsed.delegations) {
      try {
        const sub = await executeAgent(d.agent_id, d.subtask, ctx);
        subResults.push({
          agent_id: d.agent_id,
          subtask: d.subtask,
          result: sub.result,
          success: true,
        });
      } catch (e) {
        subResults.push({
          agent_id: d.agent_id,
          subtask: d.subtask,
          error: e.message,
          success: false,
        });
      }
    }

    // 整合结果：让当前 agent 用最后一次 LLM 调用合成
    const integrateSystem = `你是 **${agent.name}**，刚才委派了 ${subResults.length} 个子任务给其他 agent。现在请整合他们的返回结果，给出最终答复。

整合计划：${parsed.integration_plan || '按需综合'}

严格输出 JSON：
{ "type": "result", "content": "最终整合后的内容", "reasoning": "整合思路" }`;

    const integrateUser = `## 原始任务
${task}

## 各 agent 返回结果
${JSON.stringify(subResults, null, 2)}

请整合以上信息，给出最终输出。`;

    const integRaw = await callLLM(integrateSystem, integrateUser);
    try {
      const cleaned = integRaw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
      const firstBrace = cleaned.indexOf('{');
      const lastBrace = cleaned.lastIndexOf('}');
      const finalParsed = JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
      return {
        ...finalParsed,
        delegations: subResults,
      };
    } catch {
      return { type: 'result', content: integRaw, delegations: subResults };
    }
  }

  return parsed;
}

// ———————————————————————————————————————————————
// 自主编排：用户只给自然语言任务，系统自动决定整个执行流程
// ———————————————————————————————————————————————
async function autoExecute(task, opts = {}) {
  const ctx = new AgentCallContext(task, 'user');

  // Step 1: LLM 任务路由 - 决定谁做主 agent + 工作流
  const allAgents = kb.listAgentTypes();
  const agentList = allAgents.map(a =>
    `- \`${a.id}\` (${a.emoji} ${a.name}, ${a.team === 'rd' ? '研发' : '运营'}) - ${a.desc || ''}`
  ).join('\n');

  const routerSystem = `你是 VIDO AI 团队的 **任务路由器**。用户给了一个任务，你需要决定：
1. 这是 **业务任务** 还是 **研发任务**
2. 哪个 agent 应该作为"主 agent"总负责
3. 建议协作的其他 agent

## 全部可用 agent
${agentList}

## 🔑 任务类型判断（v10 新增：业务 vs 研发 双工作流）

**业务任务 (business)** = 用 VIDO 平台**产出内容**
- 关键词: 生成视频/剧本/漫画/小说/数字人/分镜/角色/推广文案
- 典型: "写一个重生复仇的剧本" / "生成 10 集甜宠漫剧" / "做一个带货短视频脚本"
- 主 agent 候选: screenwriter / director / character_consistency / art_director / storyboard / atmosphere / digital_human / editor / market_research / copywriter / localizer / growth_ops / executive_producer

**研发任务 (rd)** = 建设 / 优化 VIDO 平台**本身**
- 关键词: 写代码/修 bug/加功能/优化性能/部署/测试/UI 设计/接入模型/集成组件
- 典型: "优化视频生成速度" / "加一个新模型接入" / "修复 i18n 问题" / "部署到生产" / "设计新的仪表盘 UI"
- 主 agent 候选: backend_engineer / frontend_engineer / algorithm_engineer / test_engineer / ui_designer / llm_engineer / component_engineer / ops_engineer / comfyui_engineer / crawler_engineer / workflow_engineer

## 决策原则

1. 先判断 task_type (business / rd)
2. 再按类型选主 agent
3. **不要跨类型混用**（业务任务不要选工程师，研发任务不要选编剧）
4. 复杂业务任务选 executive_producer 为主，由他委派创作/运营类
5. 复杂研发任务选 workflow_engineer 为主，由他委派技术类
6. 明确的单职能任务直接选专职 agent

## 输出严格 JSON
\`\`\`json
{
  "task_type": "business" | "rd",
  "primary_agent": "主 agent 的 ID",
  "reasoning": "判断理由（先说类型判断依据，再说 agent 选择依据）",
  "workflow_phase": "在工作流中属于哪个阶段（业务: research/script/direct/character/image/video/edit/publish; 研发: requirements/design/develop/test/deploy/monitor）",
  "suggested_collaborators": ["建议协作的其他 agent id 列表"],
  "expected_outcome": "预期产出描述"
}
\`\`\``;

  const routerUser = `## 用户任务
${task}

请分析任务性质，指派主 agent。`;

  const routeRaw = await callLLM(routerSystem, routerUser);
  let route;
  try {
    const cleaned = routeRaw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    route = JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
  } catch (e) {
    throw new Error('Task router LLM failed to return JSON');
  }

  if (!route.primary_agent) {
    throw new Error('Task router did not specify primary_agent');
  }

  console.log(`[Orchestrator] 🎯 Route: ${task.slice(0, 60)}… → ${route.primary_agent}`);

  // Step 2: 执行主 agent（它会自主决定是否委派）
  const mainResult = await executeAgent(route.primary_agent, task, ctx);

  return {
    success: true,
    task,
    routing: route,
    main_agent: route.primary_agent,
    result: mainResult.result,
    trace: ctx.toJSON(),
  };
}

// ═══════════════════════════════════════════════════
// 【v12 新增】runWorkflow - 真正的多阶段 pipeline
//   每个 phase 调多个 agent，按顺序执行
//   每步真实调 LLM 产出 agent 的观点/决策/产物
//   全程可追溯
// ═══════════════════════════════════════════════════

// R&D 工作流 phase 定义
const RD_PHASES = [
  {
    id: 'requirements',
    name: '需求接收与分析',
    emoji: '📋',
    agents: [
      {
        id: 'project_manager',
        action: '承接任务并做初步分发规划',
        instruction: '作为项目经理，你刚收到这个任务。说明: (1) 你对任务的理解, (2) 初步的工作量评估, (3) 打算分配给哪些角色去做需求分析和开发。',
      },
      {
        id: 'product_manager',
        action: '撰写 PRD 和需求文档',
        instruction: '作为产品经理，分析这个任务的用户价值。输出简化的 PRD: 包含问题背景、用户故事、功能清单 (MoSCoW 优先级)、验收标准、是否需要新 UI。',
      },
    ],
  },
  {
    id: 'design',
    name: 'UI/UX 设计',
    emoji: '🎨',
    agents: [
      {
        id: 'ui_designer',
        action: '设计界面原型与交互方案',
        instruction: '作为 UI 设计师，根据 PRD 判断是否需要新界面。如果需要，描述界面的布局、组件、交互流程、视觉风格（配色/字号/动效）。如果不需要新 UI，说明"N/A - 此任务不涉及界面修改"。',
      },
    ],
  },
  {
    id: 'develop',
    name: '研发实现',
    emoji: '🔧',
    agents: [
      {
        id: 'project_manager',
        action: '分配开发任务给具体工程师',
        instruction: '作为项目经理，基于 PRD 和设计方案，决定这个任务应该分配给哪些工程师（后端/前端/算法/LLM/组件/ComfyUI/爬虫/工作流）。说明每人的子任务和预期交付。',
      },
      {
        id: 'backend_engineer',
        action: '后端实现方案',
        instruction: '作为后端工程师，描述后端需要做什么改动：新增的文件/接口/数据模型/依赖。给出具体的技术方案（语言、框架、关键代码片段）。如果不涉及后端，说明"N/A"。',
      },
      {
        id: 'frontend_engineer',
        action: '前端实现方案',
        instruction: '作为前端工程师，描述前端需要做什么改动：新组件/页面/API 调用/状态管理。给出具体实现方案。如果不涉及前端，说明"N/A"。',
      },
    ],
  },
  {
    id: 'test',
    name: '测试验证',
    emoji: '🧪',
    agents: [
      {
        id: 'test_engineer',
        action: '设计测试方案与执行结果',
        instruction: '作为测试工程师，为这次改动设计测试方案: (1) 测试类型 (单元/集成/E2E/性能/安全), (2) 用什么工具 (Jest/Playwright/k6), (3) 具体测试用例 (至少 5 个), (4) 模拟执行后的预期测试结果。',
      },
    ],
  },
  {
    id: 'deploy',
    name: '部署上线',
    emoji: '🛡️',
    agents: [
      {
        id: 'ops_engineer',
        action: '部署方案与验证',
        instruction: '作为运维工程师，给出部署方案: (1) 部署步骤 (本地→测试→生产), (2) 使用的工具 (PM2/Docker/deploy-kb.js 等), (3) 验证清单 (HTTP 健康检查/smoke test/回滚预案), (4) 预期部署耗时。',
      },
    ],
  },
];

// ═══════════════════════════════════════════════════
// 【v13】业务工作流 - 9 种细分流程
// 每种工作流明确定义参与的 agent + 阶段顺序 + 交接点
// ═══════════════════════════════════════════════════
const BUSINESS_WORKFLOWS = {
  // ① AI 视频生成（通用）
  video: {
    name: 'AI 视频生成',
    emoji: '🎬',
    desc: '从需求调研到成片发布的完整 AI 视频流水线',
    phases: [
      {
        id: 'research', name: '需求调研', emoji: '🎯',
        agents: [
          { id: 'market_research', action: '热点与竞品分析',
            instruction: '作为市场调研官，分析任务的市场机会：相关热点、竞品表现、目标用户画像、差异化切入点。' },
        ],
      },
      {
        id: 'creative', name: '创意编剧', emoji: '✍️',
        agents: [
          { id: 'screenwriter', action: '剧情大纲与对白',
            instruction: '作为编剧，设计剧情结构：主题、核心冲突、角色设定、3-5 个关键场景大纲、情绪曲线。' },
          { id: 'art_director', action: '视觉风格定调',
            instruction: '作为艺术总监，定义视觉风格：参考片/画风、色彩调板、光影设计、整体氛围锚点。' },
        ],
      },
      {
        id: 'character', name: '角色一致性', emoji: '🎭',
        agents: [
          { id: 'character_consistency', action: '角色 Bible 锁定',
            instruction: '作为角色一致性设定师，为关键角色写 Character Bible：外貌锁定关键词、服装、标志特征、ID token。' },
        ],
      },
      {
        id: 'storyboard', name: '分镜与氛围', emoji: '🎥',
        agents: [
          { id: 'storyboard', action: '分镜设计',
            instruction: '作为分镜师，为每个场景设计：景别、运镜、构图、核心 visual prompt。' },
          { id: 'atmosphere', action: '氛围词与去 AI 味',
            instruction: '作为氛围师，为每个分镜添加氛围词。**重点应用"去 AI 味"三大类提示词**：(1) 光源词 (头顶光/发丝光/侧光) (2) 面部细节 (可见毛孔/细微雀斑/肤色不均) (3) 前景遮挡 (虚化绿植/中景人物清晰/背景虚化)。' },
        ],
      },
      {
        id: 'generation', name: '图像与视频生成', emoji: '🖼️',
        agents: [
          { id: 'director', action: '调度生成与质检',
            instruction: '作为导演，规划图生视频的调度顺序，挑选合适的视频模型 (kling/runway/sora 等)，并对生成结果做质检。' },
        ],
      },
      {
        id: 'edit', name: '剪辑与配音', emoji: '✂️',
        agents: [
          { id: 'editor', action: '剪辑节奏方案',
            instruction: '作为剪辑师，给出剪辑方案：每镜时长、转场选择、BGM 情绪、开头 3 秒钩子设计。' },
        ],
      },
      {
        id: 'publish', name: '推广发布', emoji: '📈',
        agents: [
          { id: 'copywriter', action: '爆款文案',
            instruction: '作为文案策划，生成 5 个爆款标题变体、发布描述、hashtag 策略、封面文字建议。' },
        ],
      },
    ],
  },

  // ② 漫剧（多集付费短剧）— v15: 去掉 market_research，从角色开始
  drama: {
    name: '漫剧 / 短剧',
    emoji: '📺',
    desc: '直接进入创作 (无市场调研)：大纲 → 人物 → 分镜 → 生成 → 投放',
    phases: [
      {
        id: 'outline', name: '大纲与分集', emoji: '📜',
        agents: [
          { id: 'screenwriter', action: '剧集大纲',
            instruction: '作为编剧，设计 80-100 集短剧大纲：人物弧光、核心冲突、爽点节拍、3 集内出钩子、第 8/15 集付费节点。' },
          { id: 'executive_producer', action: '商业架构定调',
            instruction: '作为制片人，敲定全剧调性、目标 ARPU、主要付费点位置、营销卖点 (1 句话 logline)。' },
        ],
      },
      {
        id: 'character', name: '人物设定', emoji: '🎭',
        agents: [
          { id: 'character_consistency', action: '角色三视图与 Bible',
            instruction: '作为人物一致性设定师，为男女主+主要配角各做 Character Bible 与三视图描述 (正/侧/背)。' },
          { id: 'art_director', action: '美术风格统一',
            instruction: '作为艺术总监，给出全剧美术风格：参考片、色彩、年代质感、特殊视觉符号。' },
        ],
      },
      {
        id: 'episode', name: '单集分镜', emoji: '🎥',
        agents: [
          { id: 'director', action: '导演阐述与运镜',
            instruction: '作为导演，逐集列分镜表：时长、景别、运镜、关键 prompt、卡点情绪。' },
          { id: 'storyboard', action: '分镜可视化',
            instruction: '作为分镜师，为关键集 (1/8/15) 输出分镜脚本：每镜画面+台词+音效。' },
          { id: 'atmosphere', action: '氛围与去 AI 味',
            instruction: '作为氛围师，为分镜补充氛围词，**应用去 AI 味三大类**：光源词、面部细节、前景遮挡。' },
        ],
      },
      {
        id: 'production', name: '生成与配音', emoji: '🎙️',
        agents: [
          { id: 'digital_human', action: '数字人/口型',
            instruction: '作为数字人专家，为主要角色配音色与口型同步方案：模型选择、克隆样本要求。' },
          { id: 'editor', action: '剪辑与节奏',
            instruction: '作为剪辑师，给出每集剪辑节奏方案：开场 3 秒钩子、付费集卡点、结尾悬念。' },
        ],
      },
      {
        id: 'launch', name: '投放与运营', emoji: '🚀',
        agents: [
          { id: 'copywriter', action: '剧集文案与标题',
            instruction: '作为文案策划，为该剧产出剧名、副标题、平台简介、5 个投流素材脚本。' },
          { id: 'growth_ops', action: '投流策略',
            instruction: '作为运营增长，给出冷启动投流策略：目标平台、预算分配、人群包、ROI 预期。' },
        ],
      },
    ],
  },

  // ③ 漫画
  comic: {
    name: '漫画生成',
    emoji: '📖',
    desc: '从剧本到分格漫画图集的生成流水线',
    phases: [
      {
        id: 'concept', name: '题材策划', emoji: '🎯',
        agents: [
          { id: 'market_research', action: '品类与画风调研',
            instruction: '作为市场调研官，分析目标漫画品类的流行画风、读者画像、平台 (快看/腾讯漫画) 偏好。' },
        ],
      },
      {
        id: 'script', name: '剧本与分镜', emoji: '✍️',
        agents: [
          { id: 'screenwriter', action: '故事剧本',
            instruction: '作为编剧，写出漫画剧本：每页内容、对白、心理活动、关键转折。' },
          { id: 'storyboard', action: '分格设计',
            instruction: '作为分镜师，为每页设计分格：格数、构图、视线引导、留白节奏。' },
        ],
      },
      {
        id: 'character', name: '角色设定', emoji: '🎭',
        agents: [
          { id: 'character_consistency', action: '角色立绘锁定',
            instruction: '作为人物一致性设定师，为主要角色生成 Bible：发型/服饰/标志特征/表情库。' },
          { id: 'art_director', action: '画风定调',
            instruction: '作为艺术总监，定义画风：日漫/美漫/国风/Q 版，线条粗细、上色方案。' },
        ],
      },
      {
        id: 'generation', name: '图像生成', emoji: '🖼️',
        agents: [
          { id: 'director', action: '调度与质检',
            instruction: '作为导演，规划每页生成顺序，挑选合适的图像模型，对结果做质检与打回重做。' },
          { id: 'atmosphere', action: '氛围词补强',
            instruction: '作为氛围师，为关键格补充光影/氛围 prompt，避免 AI 味 (光源/细节/景深)。' },
        ],
      },
      {
        id: 'compose', name: '排版合成', emoji: '🖋️',
        agents: [
          { id: 'editor', action: '页面合成方案',
            instruction: '作为剪辑师 (此处充当排版师)，给出对白气泡、字体、拟声词、页码的排版方案。' },
        ],
      },
      {
        id: 'publish', name: '上架推广', emoji: '📣',
        agents: [
          { id: 'copywriter', action: '简介与标签',
            instruction: '作为文案策划，写出漫画简介、5 个章节标题、tag 策略。' },
        ],
      },
    ],
  },

  // ④ 小说
  novel: {
    name: '小说创作',
    emoji: '📚',
    desc: '网文/长篇小说从市场调研到成稿推广',
    phases: [
      {
        id: 'research', name: '市场调研', emoji: '🎯',
        agents: [
          { id: 'market_research', action: '赛道与卖点分析',
            instruction: '作为市场调研官，分析目标网文赛道 (男频/女频/科幻/玄幻)、起点/番茄/七猫的爆款规律、读者期待。' },
        ],
      },
      {
        id: 'outline', name: '大纲与世界观', emoji: '🌍',
        agents: [
          { id: 'screenwriter', action: '主线大纲',
            instruction: '作为编剧 (此处充当小说大纲师)，输出三幕结构 + 章节梗概 (前 30 章) + 世界观设定 (规则/势力/地图)。' },
        ],
      },
      {
        id: 'character', name: '人物档案', emoji: '🎭',
        agents: [
          { id: 'character_consistency', action: '角色档案',
            instruction: '作为人物一致性设定师，为主角+5 个核心配角写档案：外貌、性格、动机、弧光、关系图。' },
        ],
      },
      {
        id: 'writing', name: '章节写作', emoji: '✍️',
        agents: [
          { id: 'screenwriter', action: '正文写作',
            instruction: '作为小说作者，按大纲产出前 3 章正文 (每章 2500-3500 字)，包含场景、对白、心理描写，留下钩子。' },
        ],
      },
      {
        id: 'polish', name: '润色与金句', emoji: '💎',
        agents: [
          { id: 'copywriter', action: '金句与节奏',
            instruction: '作为文案策划 (此处充当润色师)，挑出可成金句的段落，建议节奏调整、删冗余、加爽点。' },
        ],
      },
      {
        id: 'publish', name: '封面与推广', emoji: '📢',
        agents: [
          { id: 'art_director', action: '封面美术',
            instruction: '作为艺术总监，给出封面设计方案：构图、配色、人物姿态、字体风格。' },
          { id: 'copywriter', action: '书名与简介',
            instruction: '作为文案策划，给出 5 个候选书名、200 字简介、10 个核心 tag。' },
        ],
      },
    ],
  },

  // ⑤ 数字人
  digital_human: {
    name: '数字人',
    emoji: '👤',
    desc: '人设策划→话术→形象→音色→口型→投放的完整数字人 IP',
    phases: [
      {
        id: 'persona', name: '人设策划', emoji: '🎭',
        agents: [
          { id: 'market_research', action: '账号定位调研',
            instruction: '作为市场调研官，分析目标平台 (抖音/视频号/小红书) 该垂类的头部数字人差异点、人设公式。' },
          { id: 'screenwriter', action: '人设档案',
            instruction: '作为编剧，写人设档案：身份、性格、口头禅、价值观、内容方向。' },
        ],
      },
      {
        id: 'script', name: '话术与脚本', emoji: '📝',
        agents: [
          { id: 'copywriter', action: '日常脚本',
            instruction: '作为文案策划，写 5 期数字人开口短视频脚本 (30-60 秒)，包含开场钩子、主体、行动号召。' },
        ],
      },
      {
        id: 'image', name: '人物形象', emoji: '🖼️',
        agents: [
          { id: 'character_consistency', action: '形象 Bible',
            instruction: '作为人物一致性设定师，为数字人写 Bible：脸型、五官、发型、服饰、ID token。' },
          { id: 'art_director', action: '风格定调',
            instruction: '作为艺术总监，定义视觉风格：写实/二次元/赛博、配色、滤镜风格。' },
        ],
      },
      {
        id: 'voice', name: '音色克隆', emoji: '🎙️',
        agents: [
          { id: 'digital_human', action: '音色方案',
            instruction: '作为数字人专家，给出音色克隆方案：用 Fish/MiniMax/ElevenLabs 哪个、样本要求 (5-30 分钟)、情绪标签。' },
        ],
      },
      {
        id: 'lipsync', name: '口型同步', emoji: '👄',
        agents: [
          { id: 'digital_human', action: '口型驱动方案',
            instruction: '作为数字人专家，给出口型驱动方案：用 SadTalker/HeyGen/MuseTalk 等，质量预期，常见坑。' },
        ],
      },
      {
        id: 'compose', name: '视频合成', emoji: '🎬',
        agents: [
          { id: 'editor', action: '合成与剪辑',
            instruction: '作为剪辑师，给出最终视频合成方案：背景、字幕、BGM、转场、节奏。' },
        ],
      },
      {
        id: 'launch', name: '投放策略', emoji: '🚀',
        agents: [
          { id: 'growth_ops', action: '冷启动方案',
            instruction: '作为运营增长，给出数字人账号冷启动方案：发布频率、话题选择、互动设计、起号技巧。' },
        ],
      },
    ],
  },

  // ⑥ 爆款复刻
  viral_replicate: {
    name: '爆款复刻',
    emoji: '🔥',
    desc: '拆解爆款 → 提取公式 → 复刻同款',
    phases: [
      {
        id: 'capture', name: '爆款采集', emoji: '🕷️',
        agents: [
          { id: 'market_research', action: '爆款采集与归类',
            instruction: '作为市场调研官，列出目标平台同类爆款 5-10 条，记录数据 (播放/点赞/评论比)。' },
        ],
      },
      {
        id: 'deconstruct', name: '结构拆解', emoji: '🔬',
        agents: [
          { id: 'data_analyst', action: '数据维度拆解',
            instruction: '作为数据分析师，从开场钩子、节奏、信息密度、情绪曲线、CTA 五个维度拆解爆款共性。' },
          { id: 'screenwriter', action: '剧本结构提取',
            instruction: '作为编剧，提炼爆款的剧本结构公式 (n 秒 hook + n 秒 build + n 秒 payoff)。' },
        ],
      },
      {
        id: 'creative', name: '差异化创意', emoji: '💡',
        agents: [
          { id: 'screenwriter', action: '复刻新脚本',
            instruction: '作为编剧，基于爆款公式写一份**新脚本** (不抄袭)，保留结构、换主题/角色/场景。' },
          { id: 'art_director', action: '视觉差异化',
            instruction: '作为艺术总监，给出复刻版的视觉差异：换风格、换调色、换标志符号。' },
        ],
      },
      {
        id: 'production', name: '生产执行', emoji: '🎬',
        agents: [
          { id: 'director', action: '分镜与生成',
            instruction: '作为导演，根据新脚本设计分镜，挑模型，规划生成顺序。' },
          { id: 'atmosphere', action: '去 AI 味',
            instruction: '作为氛围师，加去 AI 味提示词 (光源/细节/前景遮挡)，让复刻版看起来真实。' },
        ],
      },
      {
        id: 'release', name: '发布对照', emoji: '📊',
        agents: [
          { id: 'copywriter', action: '复刻文案',
            instruction: '作为文案策划，写 5 个对标爆款的标题/描述/tag。' },
          { id: 'growth_ops', action: 'AB 投放方案',
            instruction: '作为运营增长，给出 AB 测试投放方案，监测哪个变体表现更好。' },
        ],
      },
    ],
  },

  // ⑦ 声音克隆
  voice_clone: {
    name: '声音克隆',
    emoji: '🎙️',
    desc: '从样本采集到批量生成的音色克隆流水线',
    phases: [
      {
        id: 'sample', name: '样本准备', emoji: '🎤',
        agents: [
          { id: 'digital_human', action: '样本规范',
            instruction: '作为数字人专家，说明音色克隆所需样本规范：时长 (5-30 分钟)、环境 (无回声)、内容 (情绪覆盖)、采样率。' },
        ],
      },
      {
        id: 'train', name: '音色训练', emoji: '🧠',
        agents: [
          { id: 'digital_human', action: '模型选择',
            instruction: '作为数字人专家，对比 Fish/MiniMax/ElevenLabs/CosyVoice 在中文克隆上的表现，给出推荐与训练参数。' },
        ],
      },
      {
        id: 'qa', name: '质量评估', emoji: '🔍',
        agents: [
          { id: 'data_analyst', action: 'MOS 评估',
            instruction: '作为数据分析师，给出音色质量评估方案：相似度评分、自然度评分 (MOS)、情绪还原度测试集。' },
        ],
      },
      {
        id: 'script', name: '话术录制', emoji: '📝',
        agents: [
          { id: 'copywriter', action: '稿件撰写',
            instruction: '作为文案策划，写 10 条用于克隆音色批量合成的稿件：覆盖陈述/疑问/感叹/对话场景。' },
        ],
      },
      {
        id: 'batch', name: '批量生成', emoji: '⚙️',
        agents: [
          { id: 'editor', action: '批量合成方案',
            instruction: '作为剪辑师，给出批量调用 TTS 接口的脚本方案：并发数、命名规范、后处理 (响度/降噪)。' },
        ],
      },
    ],
  },

  // ⑧ 图片生成
  image_gen: {
    name: '图片生成',
    emoji: '🖼️',
    desc: '从需求到精修的高质量图像生成流水线',
    phases: [
      {
        id: 'brief', name: '需求分析', emoji: '🎯',
        agents: [
          { id: 'market_research', action: '用途与参考',
            instruction: '作为市场调研官，确认图片用途 (封面/海报/插图/电商)、尺寸、目标平台、视觉竞品参考。' },
        ],
      },
      {
        id: 'art', name: '艺术方向', emoji: '🎨',
        agents: [
          { id: 'art_director', action: '风格 moodboard',
            instruction: '作为艺术总监，给出 moodboard：参考画风、色板、构图原则、灯光、相机参数。' },
        ],
      },
      {
        id: 'prompt', name: 'Prompt 工程', emoji: '✨',
        agents: [
          { id: 'atmosphere', action: 'Prompt 撰写',
            instruction: '作为氛围师，写出详细 prompt：主体描述 + 风格 + 光影 + 镜头参数 + 负面词。**应用去 AI 味三大类**：光源词、面部细节、前景遮挡。' },
        ],
      },
      {
        id: 'generate', name: '图像生成', emoji: '🖼️',
        agents: [
          { id: 'director', action: '调度与质检',
            instruction: '作为导演，挑选合适的图像模型 (Flux/SDXL/MidJourney/Nano Banana)，规划批量生成参数 + 质检挑图。' },
        ],
      },
      {
        id: 'refine', name: '后期优化', emoji: '✂️',
        agents: [
          { id: 'editor', action: '后期精修',
            instruction: '作为剪辑师 (此处充当后期师)，给出后期方案：放大、修瑕、调色、加文字、出图规格。' },
        ],
      },
    ],
  },

  // ⑨ 角色背景生成
  character_bg: {
    name: '角色与背景',
    emoji: '🌅',
    desc: '从角色档案到三视图 + 背景场景的整合输出',
    phases: [
      {
        id: 'profile', name: '角色档案', emoji: '🎭',
        agents: [
          { id: 'screenwriter', action: '人物档案',
            instruction: '作为编剧，写角色档案：身份、性格、动机、外貌特征 (发型/眼睛/服饰/标志物)。' },
        ],
      },
      {
        id: 'scene', name: '场景描述', emoji: '🌄',
        agents: [
          { id: 'art_director', action: '场景 moodboard',
            instruction: '作为艺术总监，给出场景视觉描述：时间、地点、天气、灯光、色彩基调、参考片。' },
        ],
      },
      {
        id: 'three_view', name: '三视图生成', emoji: '🧍',
        agents: [
          { id: 'character_consistency', action: '三视图 prompt',
            instruction: '作为人物一致性设定师，给出正/侧/背三视图的 prompt + ID token，确保后续生成一致。' },
        ],
      },
      {
        id: 'background', name: '背景场景', emoji: '🏞️',
        agents: [
          { id: 'atmosphere', action: '环境与氛围',
            instruction: '作为氛围师，给出背景生成 prompt：环境、光影、氛围词，**应用去 AI 味提示词** (前景遮挡 + 景深)。' },
        ],
      },
      {
        id: 'composite', name: '整合输出', emoji: '🖼️',
        agents: [
          { id: 'director', action: '人景合成方案',
            instruction: '作为导演，给出人景合成方案：合图技巧、光影统一、ControlNet/IP-Adapter 调用建议。' },
        ],
      },
    ],
  },
};

// 兼容旧接口的别名 (其他地方可能引用)
const BUSINESS_PHASES = BUSINESS_WORKFLOWS.video.phases;

/**
 * 单个 agent 在某个 phase 内的执行
 */
async function runAgentInPhase(agent, phase, task, priorPhases, ctx) {
  const phaseRecord = ctx.enter(agent.id);
  const agentMeta = kb.listAgentTypes().find(a => a.id === agent.id);

  try {
    if (!agentMeta) {
      throw new Error('Agent not found: ' + agent.id);
    }

    // 组装 KB 上下文（静态 + 动态）
    const staticCtx = kb.buildAgentContext(agent.id, { maxDocs: 2 });
    const dynamicCtx = kb.searchForAgent(agent.id, task, { limit: 3 });
    const kbContext = [staticCtx, dynamicCtx].filter(Boolean).join('\n\n');

    // 格式化之前阶段的产出
    const priorSummary = priorPhases.length === 0 ? '(无，你是第一阶段)' :
      priorPhases.map(p => {
        const outputs = p.participants.map(pp =>
          `  - ${pp.emoji} ${pp.agent_name}: ${pp.summary || ''}`
        ).join('\n');
        return `### 阶段: ${p.emoji} ${p.name}\n${outputs}`;
      }).join('\n\n');

    const systemPrompt = `你是 VIDO AI 团队的 **${agentMeta.emoji} ${agentMeta.name}** (${agentMeta.team === 'rd' ? '研发团队' : '运营团队'})。

## 你的职责
${agentMeta.desc || ''}

## 你的核心技能
${(agentMeta.skills || []).map(s => `- ${s}`).join('\n')}

## 当前阶段: ${phase.emoji} ${phase.name}
## 你的工作: ${agent.action}

## 具体指令
${agent.instruction}

${kbContext}

## 输出严格 JSON (无 markdown 代码块)
{
  "summary": "一句话概括你做了什么（≤ 60 字）",
  "deliverable": "你的具体产出（PRD/代码/测试方案/部署步骤 等，≤ 500 字）",
  "reasoning": "你这样做的理由 / 决策依据（≤ 150 字）",
  "next_action": "下一步应该做什么 / 交接给谁（≤ 80 字）"
}`;

    const userPrompt = `## 用户任务
${task}

## 之前阶段的产出
${priorSummary}

请严格按上面的 JSON 格式输出你的工作成果。`;

    const { callLLM } = require('./storyService');
    const raw = await callLLM(systemPrompt, userPrompt, { agentId: agent.id });

    // 解析 JSON
    let parsed;
    try {
      let str = raw.trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```\s*$/i, '')
        .trim();
      const start = str.indexOf('{');
      const end = str.lastIndexOf('}');
      if (start !== -1 && end > start) str = str.slice(start, end + 1);
      parsed = JSON.parse(str);
    } catch (e) {
      // 降级：直接用原文
      parsed = {
        summary: raw.slice(0, 100),
        deliverable: raw.slice(0, 800),
        reasoning: '(LLM 返回非 JSON)',
        next_action: '',
      };
    }

    const result = {
      agent_id: agent.id,
      agent_name: agentMeta.name,
      emoji: agentMeta.emoji,
      action: agent.action,
      summary: parsed.summary || '',
      deliverable: parsed.deliverable || '',
      reasoning: parsed.reasoning || '',
      next_action: parsed.next_action || '',
    };

    ctx.exit(phaseRecord, result);
    return result;
  } catch (e) {
    ctx.exit(phaseRecord, null, e);
    return {
      agent_id: agent.id,
      agent_name: agentMeta?.name || agent.id,
      emoji: agentMeta?.emoji || '❓',
      action: agent.action,
      summary: '执行失败',
      deliverable: '',
      reasoning: '',
      next_action: '',
      error: e.message,
    };
  }
}

/**
 * 【v13】根据任务关键词判断走哪个业务子工作流
 * 返回 BUSINESS_WORKFLOWS 的 key，未命中返回 'video' (默认)
 */
function classifyWorkflow(task) {
  const t = String(task || '').toLowerCase();
  // 关键词 → workflow 映射 (顺序敏感: 先匹配更精确的)
  const rules = [
    // 注意顺序：先匹配更专门的，再匹配通用的 video
    { kw: ['爆款复刻', '复刻爆款', '复刻', '同款', '对标爆款', '爆款'], wf: 'viral_replicate' },
    { kw: ['声音克隆', '音色克隆', 'voice clone', 'tts 克隆', '克隆声音', '克隆音色', '克隆'], wf: 'voice_clone' },
    { kw: ['漫剧', '短剧', '网剧', '微短剧', '剧集'], wf: 'drama' },
    { kw: ['漫画', '连环画', '条漫'], wf: 'comic' },
    { kw: ['小说', '网文', '章节', '长篇'], wf: 'novel' },
    { kw: ['数字人', '虚拟主播', '虚拟人', '主播 ip'], wf: 'digital_human' },
    { kw: ['图片生成', '海报', '插画', '插图', '图像生成', '出图'], wf: 'image_gen' },
    { kw: ['角色背景', '三视图', '人物形象图', '人景合成'], wf: 'character_bg' },
    { kw: ['视频', '短视频', '成片', '生成视频'], wf: 'video' },
  ];
  for (const r of rules) {
    if (r.kw.some(k => t.includes(k))) return r.wf;
  }
  return 'video';
}

/**
 * 判断任务类型（业务 vs 研发）- 简单规则匹配，避免多一次 LLM 调用
 */
function classifyTaskType(task) {
  const rdKeywords = [
    '优化', '改 bug', 'bug', '修复', '加功能', '性能', '重构', '升级', '部署',
    '接入', '集成', '设计页面', '界面', 'UI', '设计', '后端', '前端', '数据库',
    '测试', '监控', '安全', 'API', '接口', 'ComfyUI', '爬虫', '工作流', '模型',
    '代码', '编程', '算法', '开发', '实现', '技术', '架构', 'refactor', 'fix',
    'optimize', 'add feature', 'deploy', 'test', 'implement', 'build',
  ];
  const businessKeywords = [
    '生成视频', '生成剧本', '写剧本', '生成漫画', '写小说', '数字人', '带货',
    '出海', '甜宠', '悬疑', '重生', '穿越', '古装', '仙侠', '末日', '战神',
    '分镜', '运镜', '角色形象', '配乐', '推广', '标题', '文案', 'hashtag',
    '抖音', '小红书', 'TikTok', '营销', '投流',
  ];

  const taskLower = task.toLowerCase();
  let rdScore = 0, bizScore = 0;
  rdKeywords.forEach(k => { if (taskLower.includes(k.toLowerCase())) rdScore++; });
  businessKeywords.forEach(k => { if (taskLower.includes(k.toLowerCase())) bizScore++; });

  if (bizScore > rdScore) return 'business';
  if (rdScore > bizScore) return 'rd';
  // 默认研发（因为需要团队协作看得更清楚）
  return 'rd';
}

/**
 * 执行完整工作流
 * @param {string} task
 * @param {object} opts
 *   - taskType: 'auto' | 'business' | 'rd'
 *   - workflowName: 'video' | 'drama' | 'comic' | 'novel' | 'digital_human' | 'viral_replicate' | 'voice_clone' | 'image_gen' | 'character_bg' | 'rd_task' | 'auto'
 *   - onProgress: function(event)
 */
async function runWorkflow(task, opts = {}) {
  const { taskType = 'auto', workflowName = 'auto', onProgress = null } = opts;

  // 解析 workflow
  let phases;
  let resolvedWorkflow;
  let resolvedType;

  if (workflowName === 'rd_task' || taskType === 'rd') {
    phases = RD_PHASES;
    resolvedType = 'rd';
    resolvedWorkflow = 'rd_task';
  } else if (workflowName !== 'auto' && BUSINESS_WORKFLOWS[workflowName]) {
    phases = BUSINESS_WORKFLOWS[workflowName].phases;
    resolvedType = 'business';
    resolvedWorkflow = workflowName;
  } else {
    // auto: 先判断业务/研发
    resolvedType = taskType === 'auto' ? classifyTaskType(task) : taskType;
    if (resolvedType === 'rd') {
      phases = RD_PHASES;
      resolvedWorkflow = 'rd_task';
    } else {
      resolvedWorkflow = classifyWorkflow(task);
      phases = BUSINESS_WORKFLOWS[resolvedWorkflow].phases;
    }
  }

  const ctx = new AgentCallContext(task, 'workflow');
  const workflowId = require('crypto').randomUUID();
  const startTime = Date.now();

  const phaseResults = [];

  for (let i = 0; i < phases.length; i++) {
    const phase = phases[i];
    const phaseStart = Date.now();

    // 进度回调
    if (onProgress) {
      try { onProgress({ type: 'phase_start', phase_index: i, phase }); } catch {}
    }

    // 并行执行该阶段内的所有 agent
    const participantsPromises = phase.agents.map(agent =>
      runAgentInPhase(agent, phase, task, phaseResults, ctx)
    );
    const participants = await Promise.all(participantsPromises);

    const phaseResult = {
      index: i,
      id: phase.id,
      name: phase.name,
      emoji: phase.emoji,
      participants,
      duration_ms: Date.now() - phaseStart,
      status: participants.every(p => !p.error) ? 'done' : 'partial',
    };

    phaseResults.push(phaseResult);

    if (onProgress) {
      try { onProgress({ type: 'phase_done', phase_index: i, phase: phaseResult }); } catch {}
    }
  }

  const totalDuration = Date.now() - startTime;

  const wfMeta = resolvedType === 'rd'
    ? { name: '研发任务', emoji: '🛠️' }
    : { name: BUSINESS_WORKFLOWS[resolvedWorkflow].name, emoji: BUSINESS_WORKFLOWS[resolvedWorkflow].emoji };

  const result = {
    workflow_id: workflowId,
    task,
    task_type: resolvedType,
    workflow_name: resolvedWorkflow,
    workflow_label: `${wfMeta.emoji} ${wfMeta.name}`,
    phases: phaseResults,
    total_duration_ms: totalDuration,
    total_agents_involved: new Set(phaseResults.flatMap(p => p.participants.map(pp => pp.agent_id))).size,
    started_at: new Date(startTime).toISOString(),
    finished_at: new Date().toISOString(),
  };

  // 项目助理自动记录
  try {
    const fs = require('fs');
    const path = require('path');
    const today = new Date().toISOString().slice(0, 10);
    const changesFile = path.resolve(__dirname, `../../docs/logs/changes/${today}.md`);
    const timestamp = new Date().toTimeString().slice(0, 5);

    let entry = `\n## [${timestamp}] 工作流执行: ${task.slice(0, 80)}\n\n`;
    entry += `**类型**: ${resolvedType === 'rd' ? '研发工作流' : '业务工作流'}\n`;
    entry += `**workflow_id**: ${workflowId}\n`;
    entry += `**耗时**: ${(totalDuration/1000).toFixed(1)}s\n`;
    entry += `**参与 agent**: ${result.total_agents_involved} 人\n\n`;

    for (const phase of phaseResults) {
      entry += `### ${phase.emoji} ${phase.name} (${(phase.duration_ms/1000).toFixed(1)}s)\n\n`;
      for (const p of phase.participants) {
        entry += `- ${p.emoji} **${p.agent_name}**: ${p.summary}\n`;
      }
      entry += `\n`;
    }

    entry += `---\n*由 📋 项目助理 (project_assistant) 自动记录*\n`;

    if (fs.existsSync(changesFile)) {
      fs.appendFileSync(changesFile, entry, 'utf8');
    } else {
      const header = `# VIDO 修改日志 - ${today}\n\n> 由 **📋 项目助理 agent** 维护\n\n`;
      fs.mkdirSync(path.dirname(changesFile), { recursive: true });
      fs.writeFileSync(changesFile, header + entry, 'utf8');
    }
  } catch (e) {
    console.warn('[Workflow] 项目助理记录失败:', e.message);
  }

  return result;
}

module.exports = {
  AgentCallContext,
  executeAgent,
  executeGenericAgent,
  autoExecute,
  runWorkflow,             // v12
  classifyTaskType,        // v12
  classifyWorkflow,        // v13
  RD_PHASES,               // v12
  BUSINESS_PHASES,         // v12 (legacy alias = video.phases)
  BUSINESS_WORKFLOWS,      // v13 - 9 种业务子工作流
  MAX_CALL_DEPTH,
};
