const modelGateway = require('./modelGateway');
const jsonRepair = require('./jsonRepairService');

function localReview(ctx, shots) {
  const blocking = [];
  const rewrite = [];
  const warnings = [];
  const list = Array.isArray(shots) ? shots : [];
  if (!list.length) blocking.push('分镜表为空');
  if (ctx.shot_count && list.length !== ctx.shot_count) blocking.push(`镜头数量不符合用户指定：需要 ${ctx.shot_count}，实际 ${list.length}`);

  const forbiddenText = (ctx.forbidden || []).filter(Boolean);
  const charNames = (ctx.characters || []).map(c => c.name).filter(Boolean);
  const multiMode = ctx.cast_mode === 'multi' || charNames.length >= 3;
  const requiredHints = `${ctx.brief || ''} ${ctx.product_subject || ''}`;

  list.forEach((shot, idx) => {
    const n = idx + 1;
    const visual = String(shot.visual || '');
    const visualLayers = Array.isArray(shot.visual_layers) ? shot.visual_layers : [];
    const layerText = visualLayers.map(layer => `${layer?.type || ''} ${layer?.content || ''}`).join(' ');
    const storyVisual = String(shot.story_visual || '');
    const promoVisual = String(shot.promo_visual || shot.visual_proof || shot.material_usage || '');
    const action = String(shot.action || '');
    const voice = String(shot.voiceover || '');
    const dialogue = Array.isArray(shot.dialogue_lines) ? shot.dialogue_lines : [];
    const dialogueText = dialogue.map(d => `${d?.speaker || ''} ${d?.line || ''}`).join(' ');
    const all = `${visual} ${layerText} ${storyVisual} ${promoVisual} ${action} ${voice} ${dialogueText} ${shot.purpose || ''}`;

    if (!visual.trim()) blocking.push(`第 ${n} 镜缺少画面`);
    if (!action.trim()) blocking.push(`第 ${n} 镜缺少动作`);
    if (!voice.trim() && !dialogue.some(d => String(d?.line || '').trim())) blocking.push(`第 ${n} 镜缺少台词/旁白`);
    const asksStory = /(剧情|故事|人物|客户|顾问|销售|用户|情绪|冲突|对话|对白|真人|主角)/.test(requiredHints);
    const asksProduct = /(产品|服务|主体|卖点|材质|材料|纹理|界面|功能|品牌|证明|证据|对比|结果|方案|报价|优惠)/.test(requiredHints);
    if (!visualLayers.length && !visual.trim()) rewrite.push(`第 ${n} 镜缺少按用户需求拆出的视觉层`);
    if (asksStory && !/(story|character|emotion|故事|人物|情绪|关系|对话)/i.test(layerText) && !/(人物|客户|顾问|销售|用户|表情|情绪|看|拿|走|触摸|确认|转身|交流|对话|点头|微笑)/.test(all)) {
      rewrite.push(`第 ${n} 镜用户需求需要故事/人物，但故事视觉维度偏弱`);
    }
    if (asksProduct && !/(product|material|proof|comparison|brand|ui|result|offer|产品|材料|证据|对比|品牌|界面|结果)/i.test(layerText) && !/(产品|服务|主体|纹理|质感|界面|材料|对比|结果|证据|卖点|品牌|细节|方案|客户价值)/.test(all)) {
      rewrite.push(`第 ${n} 镜用户需求需要宣传/产品证据，但商业视觉维度偏弱`);
    }

    forbiddenText.forEach((word) => {
      if (word && all.includes(word)) blocking.push(`第 ${n} 镜出现用户明确禁止项：${word}`);
    });
    if (/广告需求|系统识别|后台|prompt|QA|审核|模型|合同/.test(all)) blocking.push(`第 ${n} 镜包含内部流程词`);
    if (/高级感|氛围感|诗意|质感|光影|存在感/.test(all) && !/(展示|操作|对比|出现|变化|结果|证据|完成|查看|确认|使用|打开|点击|递给|拿起|靠近|纹理|界面|材料)/.test(all)) {
      rewrite.push(`第 ${n} 镜高级感/氛围词没有落到具体可拍事件`);
    }
    if (!/(拿起|放下|打开|点击|滑动|查看|确认|展示|对比|走向|递给|操作|使用|切换|生成|同步|完成|标注|出现|变化|触摸|靠近|转身|停留|扫过|推进|拉近|切到|掠过|环绕|定格)/.test(action)) {
      rewrite.push(`第 ${n} 镜动作不够具体`);
    }
    if (/[.。…]{3,}|……/.test(voice)) rewrite.push(`第 ${n} 镜台词含省略留白`);

    if (multiMode) {
      const mentioned = new Set([
        ...(Array.isArray(shot.characters) ? shot.characters.map(c => c.name).filter(Boolean) : []),
        ...dialogue.map(d => d.speaker).filter(Boolean),
      ]);
      if (!dialogue.length) blocking.push(`第 ${n} 镜多人剧情缺少可归属 speaker 的 dialogue_lines`);
      if (dialogue.some(d => !d.speaker || !d.line)) blocking.push(`第 ${n} 镜多人对白缺少 speaker 或 line`);
      if (charNames.length >= 3 && mentioned.size > 0 && mentioned.size < Math.min(2, charNames.length)) {
        warnings.push(`第 ${n} 镜多人关系呈现偏弱`);
      }
    }
  });

  return {
    pass: blocking.length === 0,
    blocking_issues: Array.from(new Set(blocking)),
    rewrite_issues: Array.from(new Set(rewrite)),
    warnings: Array.from(new Set(warnings)),
    scores: {
      commercial: Math.max(0.3, 1 - rewrite.length * 0.06 - blocking.length * 0.2),
      shootability: Math.max(0.3, 1 - rewrite.filter(x => /动作|可拍|画面/.test(x)).length * 0.08 - blocking.length * 0.15),
      character_consistency: multiMode ? (blocking.some(x => /多人|speaker/.test(x)) ? 0.45 : 0.82) : 0.9,
    },
  };
}

function splitModelBlockingIssues(issues = []) {
  const hard = [];
  const demoted = [];
  issues.map(String).filter(Boolean).forEach((issue) => {
    if (/高级感|氛围感|质感|诗意|文案|商业事件|商业证据|可拍|动作|台词|目的|空泛|自然|品牌感|卖点|故事画面|宣传画面|视觉维度/.test(issue)) {
      demoted.push(issue);
    } else {
      hard.push(issue);
    }
  });
  return { hard, demoted };
}

function mergeReviews(local, model) {
  const safeModel = model && typeof model === 'object' ? model : {};
  const modelBlocking = splitModelBlockingIssues(safeModel.blocking_issues || []);
  return {
    pass: local.blocking_issues.length === 0 && !modelBlocking.hard.length,
    blocking_issues: Array.from(new Set([...(local.blocking_issues || []), ...modelBlocking.hard])),
    rewrite_issues: Array.from(new Set([
      ...(local.rewrite_issues || []),
      ...modelBlocking.demoted,
      ...((safeModel.rewrite_issues || []).map(String)),
    ])),
    warnings: Array.from(new Set([...(local.warnings || []), ...((safeModel.warnings || []).map(String))])),
    scores: {
      commercial: Number(safeModel.scores?.commercial || local.scores.commercial || 0),
      shootability: Number(safeModel.scores?.shootability || local.scores.shootability || 0),
      character_consistency: Number(safeModel.scores?.character_consistency || local.scores.character_consistency || 0),
    },
  };
}

async function reviewStoryboard(ctx, shots, { taskId = '' } = {}) {
  const local = localReview(ctx, shots);
  const systemPrompt = [
    'You are commercial QA for New Story Ad. Return strict JSON only.',
    'Do not treat "premium feel / texture / atmosphere" as hard blocking by itself.',
    'Only structural breakage, subject drift, explicit forbidden items, or multi-person identity conflict should be blocking.',
    'Weak required visual dimensions, vague action, or unnatural line should be rewrite_issues or warnings.',
  ].join('\n');
  const userPrompt = `Context: ${JSON.stringify(ctx).slice(0, 8000)}
Storyboard: ${JSON.stringify(shots).slice(0, 18000)}

Return JSON:
{
  "pass": true,
  "blocking_issues": [],
  "rewrite_issues": [],
  "warnings": [],
  "scores": {"commercial":0.8,"shootability":0.8,"character_consistency":0.8}
}`;

  let modelReview = {};
  try {
    const result = await modelGateway.generateText({
      taskId,
      stage: 'new_story_ad.qa',
      systemPrompt,
      userPrompt,
      maxTokens: 4000,
    });
    modelReview = await jsonRepair.parseOrRepair({
      raw: result.text,
      expected: 'object',
      modelGateway,
      taskId,
      stage: 'new_story_ad.json_repair',
    });
  } catch (err) {
    local.warnings.push(`模型 QA 不可用，已使用本地 QA：${String(err.message || err).slice(0, 120)}`);
  }
  return mergeReviews(local, modelReview);
}

module.exports = {
  localReview,
  reviewStoryboard,
  mergeReviews,
};
