'use strict';

const modelGateway = require('../newStoryAd/modelGateway');
const stageProgress = require('../newStoryAd/stageProgressService');
const flowContracts = require('./storyFlowContractService');

const STAGE = 'new_story_ad.story_flow_planning';

function list(value) { return Array.isArray(value) ? value.filter(Boolean) : []; }

function promptPayload(draft = {}) {
  return {
    task: '把每个剧情节点绑定到已经确认的人物与场景，并建立有剧情依据的场景切换。只允许使用下列 ID，不得创造人物、场景或剧情节点。',
    rules: [
      '必须原样返回每一个 beat_id，且每个只出现一次。',
      'scene_id 必须从 scenes 中选择；不得根据数组顺序猜测。',
      '必须优先根据 scene.story_purpose、layout、interaction 与当前剧情动作选择场景；description 只作补充，不能让其他地点词覆盖所选场景。',
      'required_in_story=true 的每个已确认场景必须至少承载一个剧情节点；covered_beat_ids 指定的节点必须使用对应场景。',
      '尽量让同一地点的连续剧情保持在同一场景，只有剧情地点或用途真正变化时才切换，禁止在一个节点内混合多个地点。',
      'scene_id 与上一节点不同时，transition_from 必须等于上一节点 scene_id，transition_reason 必须说明剧情为何在此切换；未切换时两字段均为空字符串。',
      'character_ids 只能来自 people；纯空镜可以为空，人物出现或行动时必须绑定对应人物。',
      '每个出镜人物都必须在 look_bindings 中选择该人物 looks 列表内最符合当前剧情、动作和场景的 look_id；人物只有一个造型时也必须原样返回。',
      '不要改写剧情、人物、场景、对白或动作。',
      '只返回 JSON 对象：{"units":[{"beat_id":"...","scene_id":"...","transition_from":"","transition_reason":"","character_ids":["..."],"look_bindings":{"character_id":"look_id"}}]}。',
    ],
    people: list(draft.people),
    scenes: list(draft.scenes),
    beats: list(draft.units).map(unit => ({
      beat_id: unit.beat_id,
      title: unit.title,
      plot: unit.plot,
      action: unit.action,
      state_before: unit.state_before,
      state_after: unit.state_after,
      spoken_line: unit.spoken_line,
    })),
  };
}

function unitsFromResult(result = {}) {
  const parsed = result.parsed_json;
  return Array.isArray(parsed) ? parsed : list(parsed?.units);
}

async function ensure(taskId, options = {}) {
  const existing = flowContracts.inspect(taskId);
  if (existing.ready) {
    return { contract: flowContracts.assertReady(taskId).contract, reused: true, model_call_count: 0 };
  }
  const draft = flowContracts.draft(taskId);
  const total = Math.max(1, list(draft.units).length);
  stageProgress.update(taskId, {
    stage: 'storyboard', status: 'running', phase: 'binding_story_authorities',
    completed: 0, total, percent: 0,
    generationId: options.generation_id || options.generationId || '',
    startedAt: options.started_at || '',
    message: '系统正在把剧情节点绑定到已确认人物与场景',
  });
  let result;
  try {
    result = await modelGateway.generateText({
      taskId,
      stage: STAGE,
      systemPrompt: '你是影视制作数据绑定器。只能从输入的权威 ID 中选择，禁止创造、替换或省略任何实体。输出必须是严格 JSON。',
      userPrompt: JSON.stringify(promptPayload(draft)),
      maxTokens: 5000,
      temperature: 0,
      maxCandidates: 2,
      structuredOutput: { mode: 'json_object', name: 'story_flow_authority_binding' },
      validateText: async (_text, meta = {}) => {
        const parsed = meta.parsed_json;
        const units = Array.isArray(parsed) ? parsed : list(parsed?.units);
        try {
          flowContracts.validateUnits(draft, units, { requireExact: true });
        } catch (error) {
          error.details = list(error.issues).map(message => ({ message }));
          throw error;
        }
      },
    });
  } catch (error) {
    const issues = list(error.failed_models)
      .flatMap(item => list(item.response_diagnostics?.issues))
      .filter((item, index, rows) => rows.indexOf(item) === index);
    const detail = issues.length ? issues.slice(0, 8).join('；') : '文本模型未返回完整且合法的人物、场景 ID 绑定';
    const blocked = new Error(`分镜生成已在图片调用前停止：${detail}`);
    blocked.code = 'STORY_FLOW_SYSTEM_BINDING_FAILED';
    blocked.status = 422;
    blocked.retryable = error.billing_state !== 'unknown';
    blocked.cause_code = error.code || '';
    blocked.issues = issues;
    blocked.billing_state = error.billing_state || error.billingState || 'confirmed';
    throw blocked;
  }
  const units = unitsFromResult(result);
  const saved = flowContracts.confirmSystem(taskId, units, result);
  stageProgress.update(taskId, {
    stage: 'storyboard', status: 'running', phase: 'story_authorities_bound',
    completed: total, total, percent: 8,
    generationId: options.generation_id || options.generationId || '',
    startedAt: options.started_at || '',
    message: '人物与场景绑定通过，正在建立逐镜合同',
  });
  return { ...saved, reused: false };
}

module.exports = { STAGE, ensure, promptPayload, unitsFromResult };
