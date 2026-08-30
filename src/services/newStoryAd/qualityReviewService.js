const modelGateway = require('./modelGateway');
const jsonRepair = require('./jsonRepairService');
const { completeSpaceLock } = require('./sceneBindingService');
const storage = require('./storageService');
const sceneVisualAcceptance = require('./sceneVisualAcceptanceService');

const INTERNAL_PROCESS_PATTERNS = [
  ['广告需求', /广告需求/],
  ['系统识别', /系统识别/],
  ['后台流程', /后台(?:任务|流程|执行|生成|处理|重试|队列|报错|错误)/],
  ['Prompt', /\bprompt\b/i],
  ['QA', /\bQA\b/i],
  ['审核流程', /(?:自动|人工)?审核(?:中|通过|失败|结果|流程)?/],
  ['模型内部状态', /(?:模型|供应商)(?:输出异常|返回失败|报错|错误|重试|候选|路由|配置|超时)/],
  ['生成契约', /(?:分镜|关键帧|场景)(?:合同|契约)/],
  ['结构化处理', /(?:JSON|schema|字段)(?:解析|修复|校验|输出)/i],
];

function internalProcessHits(value = '') {
  const text = String(value || '');
  return INTERNAL_PROCESS_PATTERNS.filter(([, pattern]) => pattern.test(text)).map(([label]) => label);
}

const STORYBOARD_DETAIL_POLICY_VERSION = 2;
const GARBLED_TEXT_PATTERN = /\uFFFD|\?{3,}|(?:锛|銆|鈥|鈦|馃|绗\?|闀滃ご|鐢婚潰|瑙嗛)/;
const PLACEHOLDER_TEXT_PATTERN = /^(?:待定|待补充|暂无|无|默认|自动|自动生成|由\s*AI\s*决定|TBD|N\/?A|-+)$/i;

function textValue(value = '') {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function storyboardTextValues(shot = {}) {
  const dialogue = Array.isArray(shot.dialogue_lines) ? shot.dialogue_lines : [];
  const characters = Array.isArray(shot.characters) ? shot.characters : [];
  const layers = Array.isArray(shot.visual_layers) ? shot.visual_layers : [];
  return [
    shot.title, shot.role, shot.purpose, shot.visual, shot.action, shot.voiceover,
    shot.material_usage, shot.keyframe_notes, shot.composition, shot.subject_position,
    shot.entry_frame_state, shot.exit_frame_state, shot.action_start, shot.action_end,
    shot.screen_direction, shot.eyeline, shot.camera_axis, shot.camera_movement,
    shot.object_states, shot.transition_reason, shot.audio_bridge, shot.ambient_sound,
    shot.music_cue, shot.voiceover_timing,
    ...(Array.isArray(shot.sfx) ? shot.sfx : []), shot.explicit_silence_reason,
    ...dialogue.flatMap(item => [item?.speaker, item?.line]),
    ...characters.flatMap(item => [item?.name, item?.action]),
    ...layers.flatMap(item => [item?.type, item?.content]),
  ].map(textValue).filter(Boolean);
}

const GENERIC_SCENE_LABELS = new Set([
  '场景', '空间', '区域', '主区域', '互动区', '展示区', '入口', '出口', '人物', '主体',
  '产品', '材料', '材质', '背景', '墙面', '地面', '面板', '自然光', '灯光',
]);

// Cross-scene rejection must only use persisted physical labels. Narrative prose,
// lighting adjectives and interaction verbs are intentionally excluded: those
// words describe how a shot is filmed, not which physical world it belongs to.
function sceneAuthorityTerms(asset = {}) {
  const contract = asset.scene_contract && typeof asset.scene_contract === 'object' ? asset.scene_contract : {};
  const layout = contract.layout_contract && typeof contract.layout_contract === 'object' ? contract.layout_contract : {};
  return Array.from(new Set([
    asset.name, asset.scene_name, asset.title,
    ...(Array.isArray(contract.zones) ? contract.zones.flatMap(item => [item.label, item.label_zh, item.name]) : []),
    ...(Array.isArray(contract.anchors) ? contract.anchors.flatMap(item => [item.label, item.label_zh, item.name]) : []),
    ...(Array.isArray(layout.zones) ? layout.zones.flatMap(item => [item.label, item.label_zh, item.name]) : []),
    ...(Array.isArray(layout.anchors) ? layout.anchors.flatMap(item => [item.label, item.label_zh, item.name]) : []),
  ].map(textValue).filter(term => term.length >= 2 && !GENERIC_SCENE_LABELS.has(term))));
}

function shotSceneVisualText(shot = {}) {
  const layers = Array.isArray(shot.visual_layers) ? shot.visual_layers : [];
  return [
    shot.title, shot.visual, shot.visual_description, shot.story_visual, shot.promo_visual,
    shot.action, shot.material_usage, shot.keyframe_notes, shot.scene_zone, shot.scene_zone_label_zh,
    shot.entry_frame_state, shot.exit_frame_state, shot.action_start, shot.action_end, shot.object_states,
    ...layers.flatMap(item => [item?.type, item?.content]),
  ].map(textValue).filter(Boolean).join('；');
}

function sceneSemanticContaminationIssues(sceneAssets = [], shot = {}, index = 0) {
  const assets = Array.isArray(sceneAssets) ? sceneAssets : [];
  if (assets.length < 2) return [];
  const selectedId = String(shot.scene_id || shot.scene_asset_id || '').trim();
  const selected = assets.find((asset, assetIndex) => String(asset.scene_id || asset.id || `scene_${assetIndex + 1}`) === selectedId);
  if (!selected) return [];
  const selectedTerms = new Set(sceneAuthorityTerms(selected));
  const visualText = shotSceneVisualText(shot);
  const conflicts = [];
  assets.forEach((asset, assetIndex) => {
    const id = String(asset.scene_id || asset.id || `scene_${assetIndex + 1}`);
    if (id === selectedId) return;
    const unique = sceneAuthorityTerms(asset).filter(term => !selectedTerms.has(term) && visualText.includes(term));
    const foreignSceneName = textValue(asset.name || asset.scene_name || asset.title);
    // One short shared object (for example “面板” or “沙发”) is not enough to
    // prove contamination. A full scene name, one specific long label, or two
    // independent structured labels is required.
    const strong = unique.filter(term => term === foreignSceneName || term.length >= 4);
    if (strong.length || unique.length >= 2) conflicts.push(`${asset.name || asset.scene_name || id}：${unique.slice(0, 5).join('、')}`);
  });
  return conflicts.length
    ? [`第 ${index + 1} 镜绑定“${selected.name || selected.scene_name || selectedId}”，但画面混入其他场景独有元素（${conflicts.join('；')}）`]
    : [];
}

function hasGarbledStoryboardText(shot = {}) {
  return storyboardTextValues(shot).some(value => GARBLED_TEXT_PATTERN.test(value));
}

function detailContractIssues(shot = {}, index = 0) {
  const n = index + 1;
  const issues = [];
  const requiredText = [
    ['景别 shot_size', shot.shot_size],
    ['机位角度 camera_angle', shot.camera_angle],
    ['景深 depth_of_field', shot.depth_of_field],
    ['构图 composition', shot.composition],
    ['主体位置 subject_position', shot.subject_position],
    ['入镜状态 entry_frame_state', shot.entry_frame_state],
    ['出镜状态 exit_frame_state', shot.exit_frame_state],
    ['动作起点 action_start', shot.action_start],
    ['动作终点 action_end', shot.action_end],
    ['镜头运动 camera_movement', shot.camera_movement],
    ['物体状态 object_states', shot.object_states],
  ];
  requiredText.forEach(([label, value]) => {
    const normalized = textValue(value);
    if (!normalized || PLACEHOLDER_TEXT_PATTERN.test(normalized)) {
      issues.push(`第 ${n} 镜缺少动态生成的${label}`);
    }
  });
  const lens = Number(shot.lens_mm || 0);
  if (!Number.isFinite(lens) || lens < 8 || lens > 300) issues.push(`第 ${n} 镜缺少有效焦段 lens_mm`);

  const visual = textValue(shot.visual);
  const action = textValue(shot.action);
  if (visual.length < 32) issues.push(`第 ${n} 镜完整画面说明过短，必须写清主体、场景、位置关系、光线及本镜相关材质`);
  if (action.length < 18) issues.push(`第 ${n} 镜镜头动作过短，必须写清人物/产品动作与镜头如何运动`);

  const notes = textValue(shot.keyframe_notes);
  if (!/本镜目的/.test(notes)) issues.push(`第 ${n} 镜关键帧补充缺少“本镜目的”`);
  if (!/必须出现/.test(notes)) issues.push(`第 ${n} 镜关键帧补充缺少“必须出现”`);
  if (!/禁止出现/.test(notes)) issues.push(`第 ${n} 镜关键帧补充缺少“禁止出现”`);
  const soundMode = textValue(shot.sound_mode).toLowerCase();
  const hasDesignedSound = !!(textValue(shot.ambient_sound) || (Array.isArray(shot.sfx) && shot.sfx.some(textValue))
    || textValue(shot.music_cue) || textValue(shot.audio_bridge) || textValue(shot.sound_design));
  const requiresSoundContract = Number(shot.sound_contract_version || 0) >= 1 || !!soundMode;
  if (requiresSoundContract && soundMode === 'silent') {
    if (!textValue(shot.explicit_silence_reason)) issues.push(`第 ${n} 镜选择静默但没有说明静默原因`);
  } else if (requiresSoundContract && !hasDesignedSound) {
    issues.push(`第 ${n} 镜缺少可执行声音设计；请填写环境声、动作音效或音乐，或明确选择静默并说明原因`);
  }
  return issues;
}

function repeatedCameraTemplateIssue(shots = []) {
  const list = Array.isArray(shots) ? shots : [];
  if (list.length < 4) return '';
  const signatures = list.map(shot => [
    textValue(shot.shot_size),
    textValue(shot.camera_angle),
    Number(shot.lens_mm || 0),
    textValue(shot.depth_of_field),
    textValue(shot.composition),
    textValue(shot.subject_position),
  ].join('|'));
  const counts = signatures.reduce((map, signature) => map.set(signature, (map.get(signature) || 0) + 1), new Map());
  const repeated = Math.max(0, ...counts.values());
  return repeated >= Math.max(4, Math.ceil(list.length * 0.75))
    ? '多数镜头复用了同一套景别、机位、焦段、景深、构图和主体位置，必须按各镜叙事目的分别设计，不能套固定模板'
    : '';
}

function localReview(ctx, shots) {
  const blocking = [];
  const rewrite = [];
  const warnings = [];
  const list = Array.isArray(shots) ? shots : [];
  if (!list.length) blocking.push('分镜表为空');
  const expectedCount = Number(ctx.expected_storyboard_count || ctx.shot_count || 0);
  if (expectedCount && list.length !== expectedCount) blocking.push(`镜头数量与已确认剧本不一致：需要 ${expectedCount}，实际 ${list.length}`);

  const forbiddenText = (ctx.forbidden || []).filter(Boolean);
  const controls = ctx.controlled_production || {};
  const envControl = controls.environment_control || {};
  const productControl = controls.product_control || {};
  const styleControl = controls.style_control || {};
  const negativeControl = controls.negative_control || {};
  const productRequired = productControl.enabled === true;
  const productMethods = Array.isArray(productControl.methods) ? productControl.methods.filter(Boolean) : [];
  const explicitNegative = String(negativeControl.text || '').split(/[，,；;\n]/).map(x => x.trim()).filter(Boolean);
  const charNames = (ctx.characters || []).map(c => c.name).filter(Boolean);
  const multiMode = ctx.cast_mode === 'multi' || charNames.length >= 3;
  const requiredHints = `${ctx.brief || ''} ${ctx.product_subject || ''}`;
  const sceneAssets = Array.isArray(ctx.scene_assets) ? ctx.scene_assets : [];
  const sceneIds = sceneAssets.map((asset, index) => String(asset.scene_id || asset.id || `scene_${index + 1}`)).filter(Boolean);

  list.forEach((shot, idx) => {
    const n = idx + 1;
    const visual = String(shot.visual || '');
    const visualLayers = Array.isArray(shot.visual_layers) ? shot.visual_layers : [];
    const layerText = visualLayers.map(layer => `${layer?.type || ''} ${layer?.content || ''}`).join(' ');
    const storyVisual = String(shot.story_visual || '');
    const promoVisual = String(shot.promo_visual || shot.visual_proof || shot.material_usage || '');
    const action = String(shot.action || '');
    const voice = String(shot.voiceover || '');
    const approvedVoice = String(shot.blueprint_spoken_line || '').trim();
    const dialogue = Array.isArray(shot.dialogue_lines) ? shot.dialogue_lines : [];
    const dialogueText = dialogue.map(d => `${d?.speaker || ''} ${d?.line || ''}`).join(' ');
    const all = `${visual} ${layerText} ${storyVisual} ${promoVisual} ${action} ${voice} ${dialogueText} ${shot.purpose || ''}`;
    const hasProductLayer = /(product|material|proof|comparison|brand|offer|result|ui|商品|产品|材料|材质|证据|证明|品牌|细节|展示|演示|使用|手持|收束|引导)/i.test(`${layerText} ${promoVisual} ${shot.material_usage || ''} ${shot.keyframe_notes || ''}`);
    const sceneId = String(shot.scene_id || shot.sceneId || shot.scene_asset_id || shot.sceneAssetId || '').trim();

    if (hasGarbledStoryboardText(shot)) blocking.push(`第 ${n} 镜含乱码或连续问号，必须重新生成干净的简体中文字段`);
    blocking.push(...detailContractIssues(shot, idx));
    if (!visual.trim()) blocking.push(`第 ${n} 镜缺少画面`);
    if (!action.trim()) blocking.push(`第 ${n} 镜缺少动作`);
    if (!voice.trim() && !dialogue.some(d => String(d?.line || '').trim())) blocking.push(`第 ${n} 镜缺少台词/旁白`);
    if (approvedVoice && voice.trim() !== approvedVoice) blocking.push(`第 ${n} 镜台词偏离已确认剧本，必须保留 blueprint_spoken_line`);
    if (!String(shot.dialogue_function || '').trim()) rewrite.push(`第 ${n} 镜缺少台词叙事职责 dialogue_function`);
    const asksStory = /(剧情|故事|人物|客户|顾问|销售|用户|情绪|冲突|对话|对白|真人|主角)/.test(requiredHints);
    const asksProduct = /(产品|服务|主体|卖点|材质|材料|纹理|界面|功能|品牌|证明|证据|对比|结果|方案|报价|优惠)/.test(requiredHints);
    if (!visualLayers.length && !visual.trim()) rewrite.push(`第 ${n} 镜缺少按用户需求拆出的视觉层`);
    const hasNamedCharacterEvidence = charNames.some(name => name && all.includes(name));
    if (asksStory && !hasNamedCharacterEvidence && !/(story|character|emotion|故事|人物|情绪|关系|对话)/i.test(layerText) && !/(人物|客户|顾问|销售|用户|表情|情绪|看|拿|走|触摸|确认|转身|交流|对话|点头|微笑)/.test(all)) {
      rewrite.push(`第 ${n} 镜用户需求需要故事/人物，但故事视觉维度偏弱`);
    }
    if (asksProduct && !/(product|material|proof|comparison|brand|ui|result|offer|产品|材料|证据|对比|品牌|界面|结果)/i.test(layerText) && !/(产品|服务|主体|纹理|质感|界面|材料|对比|结果|证据|卖点|品牌|细节|方案|客户价值)/.test(all)) {
      rewrite.push(`第 ${n} 镜用户需求需要宣传/产品证据，但商业视觉维度偏弱`);
    }
    if (productRequired && !hasProductLayer) {
      rewrite.push(`第 ${n} 镜高级配置要求商品入镜，但分镜缺少商品/材料/证据呈现`);
    }
    if (productRequired && productMethods.length && !new RegExp(productMethods.join('|'), 'i').test(`${layerText} ${promoVisual} ${shot.material_usage || ''} ${shot.keyframe_notes || ''}`)) {
      warnings.push(`第 ${n} 镜未明确体现高级配置的商品呈现方式：${productMethods.join('、')}`);
    }
    if (envControl.mode && envControl.mode !== 'auto' && !String(shot.scene || shot.visual || shot.keyframe_notes || '').trim()) {
      rewrite.push(`第 ${n} 镜高级配置要求场景方向 ${envControl.mode}，但镜头没有明确空间承载`);
    }
    if (styleControl.notes && !String(shot.keyframe_notes || shot.visual || '').trim()) {
      rewrite.push(`第 ${n} 镜高级配置要求画面风格，但镜头缺少可传递给关键帧的视觉描述`);
    }

    forbiddenText.forEach((word) => {
      if (word && all.includes(word)) blocking.push(`第 ${n} 镜出现用户明确禁止项：${word}`);
    });
    explicitNegative.forEach((word) => {
      if (word && all.includes(word)) blocking.push(`第 ${n} 镜出现高级配置禁止项：${word}`);
    });
    const processHits = internalProcessHits(all);
    if (processHits.length) blocking.push(`第 ${n} 镜包含内部流程描述：${processHits.join('、')}`);
    if (/高级感|氛围感|诗意|质感|光影|存在感/.test(all) && !/(展示|操作|对比|出现|变化|结果|证据|完成|查看|确认|使用|打开|点击|递给|拿起|靠近|纹理|界面|材料)/.test(all)) {
      rewrite.push(`第 ${n} 镜高级感/氛围词没有落到具体可拍事件`);
    }
    if (action.trim().length < 12) {
      rewrite.push(`第 ${n} 镜动作不够具体`);
    }
    if (/[.。…]{3,}|……/.test(voice)) rewrite.push(`第 ${n} 镜台词含省略留白`);

    if (sceneIds.length) {
      if (!sceneId) {
        blocking.push(`第 ${n} 镜缺少当前任务场景绑定 scene_id`);
      } else if (!sceneIds.includes(sceneId)) {
        blocking.push(`第 ${n} 镜绑定了不存在的场景资产：${sceneId}`);
      }
      const sceneAsset = sceneAssets.find((asset, assetIndex) => String(asset.scene_id || asset.id || `scene_${assetIndex + 1}`) === sceneId);
      if (sceneAsset && !completeSpaceLock(sceneAsset) && ctx.scene_visual_acceptance_current !== true) {
        blocking.push(`第 ${n} 镜绑定的场景尚未完成空间锁定（需求符合度、多视图一致性、空间覆盖及俯视蓝图必须全部通过）`);
      }
      const expectedRevision = Math.max(1, Number(sceneAsset?.scene_revision || sceneAsset?.scene_contract?.scene_revision || 1) || 1);
      if (sceneAsset && Number(shot.scene_revision || 0) !== expectedRevision) {
        blocking.push(`第 ${n} 镜场景版本不一致：需要 r${expectedRevision}`);
      }
      if (!String(shot.scene_view || '').trim()) rewrite.push(`第 ${n} 镜缺少场景视角 scene_view`);
      const availableSceneViews = new Set((sceneAsset?.view_images || [])
        .map(view => String(view?.key || view?.view || '').trim())
        .filter(view => view && view !== 'layout'));
      // V2.0 按当前任务场景资产校验开放镜位，禁止再用四个固定名称卡死所有行业。
      if (shot.scene_view && availableSceneViews.size && !availableSceneViews.has(String(shot.scene_view))) {
        blocking.push(`第 ${n} 镜场景视角不属于当前场景资产：${shot.scene_view}`);
      }
      if (!String(shot.camera_id || '').trim()) rewrite.push(`第 ${n} 镜缺少场景机位 camera_id`);
      if (!String(shot.scene_zone || '').trim()) rewrite.push(`第 ${n} 镜缺少场景区域 scene_zone`);
      const shotSceneView = String(shot.scene_view || '').trim();
      const validZoneIds = new Set((sceneAsset?.scene_contract?.zones || [])
        .filter(zone => !Array.isArray(zone.visible_in_views)
          || !zone.visible_in_views.length
          || zone.visible_in_views.includes(shotSceneView))
        .map(zone => String(zone.id || '')).filter(Boolean));
      const shotZoneIds = Array.isArray(shot.zone_ids) ? shot.zone_ids.map(String) : [];
      if (validZoneIds.size && (!shotZoneIds.length || shotZoneIds.some(id => !validZoneIds.has(id)))) {
        rewrite.push(`第 ${n} 镜缺少有效的结构化场景区域 zone_ids`);
      }
      const prevSceneId = idx > 0 ? String(list[idx - 1]?.scene_id || list[idx - 1]?.scene_asset_id || '').trim() : '';
      if (prevSceneId && sceneId && prevSceneId !== sceneId && !String(shot.transition_reason || '').trim()) {
        rewrite.push(`第 ${n} 镜切换场景但缺少转场原因`);
      }
      blocking.push(...sceneSemanticContaminationIssues(sceneAssets, shot, idx));
    }

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

  const cameraTemplateIssue = repeatedCameraTemplateIssue(list);
  if (cameraTemplateIssue) blocking.push(cameraTemplateIssue);

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
  issues.map(normalizeIssue).filter(Boolean).forEach((issue) => {
    if (/高级感|氛围感|质感|诗意|文案|商业事件|商业证据|可拍|动作|台词|目的|空泛|自然|品牌感|卖点|故事画面|宣传画面|视觉维度/.test(issue)) {
      demoted.push(issue);
    } else {
      hard.push(issue);
    }
  });
  return { hard, demoted };
}

function normalizeIssue(value) {
  if (typeof value === 'string') return value.trim();
  if (!value || typeof value !== 'object') return String(value || '').trim();
  return String(value.message || value.issue || value.text || value.description || value.reason || '').trim();
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
      ...((safeModel.rewrite_issues || []).map(normalizeIssue).filter(Boolean)),
    ])),
    warnings: Array.from(new Set([...(local.warnings || []), ...((safeModel.warnings || []).map(normalizeIssue).filter(Boolean))])),
    scores: {
      commercial: Number(safeModel.scores?.commercial || local.scores.commercial || 0),
      shootability: Number(safeModel.scores?.shootability || local.scores.shootability || 0),
      character_consistency: Number(safeModel.scores?.character_consistency || local.scores.character_consistency || 0),
    },
  };
}

async function reviewStoryboard(ctx, shots, { taskId = '' } = {}) {
  const acceptance = taskId ? storage.getOutput(taskId, sceneVisualAcceptance.OUTPUT_KIND) : null;
  const acceptanceState = sceneVisualAcceptance.inspect(ctx.scene_assets || [], acceptance, storage);
  const reviewCtx = { ...ctx, scene_visual_acceptance_current: acceptanceState.accepted === true };
  const local = localReview(reviewCtx, shots);
  const systemPrompt = [
    'You are commercial QA for New Story Ad. Return strict JSON only.',
    'Do not treat "premium feel / texture / atmosphere" as hard blocking by itself.',
    'Only structural breakage, subject drift, explicit forbidden items, or multi-person identity conflict should be blocking.',
    'Weak required visual dimensions, vague action, or unnatural line should be rewrite_issues or warnings.',
    'Check every shot for a task-specific production-ready visual, action, shot size, angle, lens, depth of field, composition, subject position, camera movement, entry/exit state, action start/end and object states.',
    'Check keyframe_notes for the three explicit task-specific clauses 本镜目的、必须出现、禁止出现.',
    'Reject mojibake, replacement characters, placeholders and repeated question marks.',
    'Flag copied camera signatures across unrelated beats. Do not demand a fixed lens, angle, scene, person, product or industry; all values must be derived from this task.',
  ].join('\n');
  const batches = storyboardQaChunks(shots);
  const modelReviews = [];
  for (const batch of batches) {
    const first = Number(batch[0]?.index || batch[0]?.shot_index || 1);
    const last = Number(batch.at(-1)?.index || batch.at(-1)?.shot_index || first);
    const userPrompt = `Context: ${JSON.stringify(reviewCtx).slice(0, 8000)}
Storyboard window ${first}-${last} of ${shots.length}: ${JSON.stringify(batch)}

Review every shot in this window. Prefix every shot-specific issue with its exact shot number. Return JSON:
{
  "pass": true,
  "blocking_issues": [],
  "rewrite_issues": [],
  "warnings": [],
  "scores": {"commercial":0.8,"shootability":0.8,"character_consistency":0.8}
}`;
    try {
      const result = await modelGateway.generateText({
        taskId,
        stage: 'new_story_ad.qa',
        systemPrompt,
        userPrompt,
        maxTokens: 4000,
      });
      modelReviews.push(await jsonRepair.parseOrRepair({
        raw: result.text,
        expected: 'object',
        modelGateway,
        taskId,
        stage: 'new_story_ad.json_repair',
      }));
    } catch (err) {
      local.warnings.push(`模型 QA 第 ${first}-${last} 镜不可用，已使用本地 QA：${String(err.message || err).slice(0, 120)}`);
    }
  }
  const scoreAverage = key => modelReviews.length
    ? modelReviews.reduce((sum, review) => sum + Number(review?.scores?.[key] || 0), 0) / modelReviews.length
    : 0;
  const modelReview = {
    blocking_issues: modelReviews.flatMap(review => review?.blocking_issues || []),
    rewrite_issues: modelReviews.flatMap(review => review?.rewrite_issues || []),
    warnings: modelReviews.flatMap(review => review?.warnings || []),
    scores: {
      commercial: scoreAverage('commercial'),
      shootability: scoreAverage('shootability'),
      character_consistency: scoreAverage('character_consistency'),
    },
  };
  return mergeReviews(local, modelReview);
}

function storyboardQaChunks(shots = [], size = 8) {
  const rows = Array.isArray(shots) ? shots : [];
  const width = Math.max(1, Math.min(12, Number(size) || 8));
  return Array.from({ length: Math.ceil(rows.length / width) }, (_, index) => rows.slice(index * width, (index + 1) * width));
}

module.exports = {
  STORYBOARD_DETAIL_POLICY_VERSION,
  GARBLED_TEXT_PATTERN,
  hasGarbledStoryboardText,
  detailContractIssues,
  repeatedCameraTemplateIssue,
  internalProcessHits,
  sceneSemanticContaminationIssues,
  localReview,
  reviewStoryboard,
  mergeReviews,
  storyboardQaChunks,
};
