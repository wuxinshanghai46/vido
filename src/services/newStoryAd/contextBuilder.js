const { v4: uuidv4 } = require('uuid');
const shotDesign = require('./shotDesignService');
const subjectProfileText = require('./subjectProfileTextService');
const referenceEvidenceText = require('./referenceEvidenceTextService');
const benchmarkStrategy = require('./benchmarkStrategyService');
const productAssetResolver = require('./productAssetResolverService');
const referenceUnderstandingService = require('./referenceUnderstandingService');

function cleanText(value = '', max = 2000) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function cleanMultilineText(value = '', max = 3000) {
  return String(value || '')
    .replace(/\r\n?|\u2028|\u2029/g, '\n')
    .replace(/\u00a0/g, ' ')
    .split('\n')
    .map(line => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, max);
}

function normalizeReferenceVideoAnalysis(input = null) {
  if (!input || typeof input !== 'object') return null;
  input = referenceEvidenceText.sanitizeAnalysis(input);
  const status = cleanText(input.status || '', 30);
  const quality = input.analysis_quality && typeof input.analysis_quality === 'object'
    ? input.analysis_quality
    : {};
  const sourceFacts = input.source_facts && typeof input.source_facts === 'object'
    ? input.source_facts
    : {};
  const storyOutline = input.story_outline && typeof input.story_outline === 'object'
    ? input.story_outline
    : {};
  const plotBeats = Array.isArray(input.plot_beats) ? input.plot_beats.slice(0, 24) : [];
  const scenePrompts = Array.isArray(input.scene_prompts) ? input.scene_prompts.slice(0, 120) : [];
  const cameraIntents = Array.isArray(input.camera_intents) ? input.camera_intents.slice(0, 24) : [];
  const rawSource = input.source && typeof input.source === 'object' ? input.source : {};
  const rawMetadata = rawSource.metadata && typeof rawSource.metadata === 'object' ? rawSource.metadata : {};
  const rawError = input.error && typeof input.error === 'object' ? input.error : {};
  const referenceUnderstanding = referenceUnderstandingService.contextDigest(input.reference_understanding);
  if (status === 'completed' && (
    quality.valid !== true
    || (Number(input.schema_version || 0) >= 5 && quality.visual_evidence_complete !== true)
    || !cleanText(sourceFacts.product_or_service || '', 200)
    || !cleanText(sourceFacts.environment || '', 300)
    || !plotBeats.length
    || !scenePrompts.length
    || !cameraIntents.length
    || !Object.keys(storyOutline).length
    || (Number(input.schema_version || 0) >= 6 && referenceUnderstanding?.completeness?.valid !== true)
  )) {
    const error = new Error('参考视频识别结果缺少产品、场景、剧情或机位证据，请删除旧分析并重新识别；已停止后续场景和剧情生成');
    error.code = 'REFERENCE_VIDEO_ANALYSIS_INCOMPLETE';
    error.status = 409;
    error.retryable = true;
    throw error;
  }
  return {
    schema_version: Math.max(0, Number(input.schema_version || 0) || 0),
    analysis_id: cleanText(input.analysis_id || '', 100),
    status,
    created_at: cleanText(input.created_at || '', 60),
    started_at: cleanText(input.started_at || '', 60),
    updated_at: cleanText(input.updated_at || '', 60),
    completed_at: cleanText(input.completed_at || '', 60),
    failed_at: cleanText(input.failed_at || '', 60),
    cancelled_at: cleanText(input.cancelled_at || '', 60),
    progress: Math.max(0, Math.min(100, Number(input.progress || 0) || 0)),
    phase: cleanText(input.phase || '', 240),
    checkpoints: Array.isArray(input.checkpoints) ? input.checkpoints.slice(-12) : [],
    source: {
      original_name: cleanText(rawSource.original_name || '', 240),
      size_bytes: Math.max(0, Number(rawSource.size_bytes || 0) || 0),
      metadata: {
        duration_seconds: Math.max(0, Number(rawMetadata.duration_seconds || 0) || 0),
        width: Math.max(0, Number(rawMetadata.width || 0) || 0),
        height: Math.max(0, Number(rawMetadata.height || 0) || 0),
        video_codec: cleanText(rawMetadata.video_codec || '', 40),
      },
    },
    error: cleanText(rawError.code || '', 100)
      ? {
          code: cleanText(rawError.code || '', 100),
          message: cleanText(rawError.message || '', 500),
          retryable: rawError.retryable === true,
          retry_after_ms: Math.max(0, Number(rawError.retry_after_ms || 0) || 0),
          failures: Array.isArray(rawError.failures)
            ? rawError.failures.slice(0, 20).map(item => cleanText(item, 100)).filter(Boolean)
            : [],
        }
      : null,
    evidence_batch_progress: {
      total: Math.max(0, Number(input.evidence_batch_progress?.total || 0) || 0),
      completed: Math.max(0, Number(input.evidence_batch_progress?.completed || 0) || 0),
      remaining: Math.max(0, Number(input.evidence_batch_progress?.remaining || 0) || 0),
      failed: Math.max(0, Number(input.evidence_batch_progress?.failed || 0) || 0),
    },
    analysis_scope: cleanText(input.analysis_scope || 'reference_content_and_creative_structure', 80),
    generated_brief: cleanMultilineText(input.generated_brief || '', 4000),
    source_facts: sourceFacts,
    analysis_quality: quality,
    story_outline: storyOutline,
    plot_beats: plotBeats,
    reference_understanding: referenceUnderstanding,
    character_prompts: Array.isArray(input.character_prompts) ? input.character_prompts.slice(0, 12) : [],
    scene_prompts: scenePrompts,
    camera_intents: cameraIntents,
    character_actions: Array.isArray(input.character_actions) ? input.character_actions.slice(0, 24) : [],
    animal_actions: Array.isArray(input.animal_actions) ? input.animal_actions.slice(0, 48) : [],
    animal_prompts: Array.isArray(input.animal_prompts) ? input.animal_prompts.slice(0, 24) : [],
    shot_breakdown: Array.isArray(input.shot_breakdown) ? input.shot_breakdown.slice(0, 120) : [],
    prompt_suggestions: input.prompt_suggestions && typeof input.prompt_suggestions === 'object'
      ? input.prompt_suggestions
      : {},
    scene_view_mapping: input.scene_view_mapping && typeof input.scene_view_mapping === 'object'
      ? input.scene_view_mapping
      : null,
    transcript_status: cleanText(input.transcript_status || input.transcript?.status || '', 60),
    warnings: Array.isArray(input.warnings) ? input.warnings.slice(0, 12).map(item => cleanText(item, 300)).filter(Boolean) : [],
    identity_extraction_allowed: false,
  };
}

function inferGenderFromText(text = '') {
  const s = cleanText(text, 500).toLowerCase();
  if (/female|woman|girl|女士|女性|女主|美女|姑娘|女孩|太太|妈妈|姐姐/.test(s)) return 'female';
  if (/male|man|boy|男士|男性|男主|帅哥|先生|爸爸|哥哥/.test(s)) return 'male';
  return '';
}

const NAME_SURNAMES = '赵钱孙李周吴郑王冯陈褚卫蒋沈韩杨朱秦尤许何吕施张孔曹严华金魏陶姜谢邹喻柏水窦章云苏潘葛范彭郎鲁韦昌马苗凤花方俞任袁柳鲍史唐费廉岑薛雷贺倪汤滕罗毕郝邬安常乐于时傅皮卞齐康伍余元卜顾孟平黄和穆萧尹';
const NAME_GIVEN_CHARS = '安然宁清雅知辰一诺可言景舟明远若初思予嘉禾亦晨书衡子墨云舒星河沐阳承宇温言卓然之夏南乔予白青禾映川宥宁启航修远以恒';

function hashSeed(seed = '') {
  const text = cleanText(seed, 1000) || 'new_story_ad_character_seed';
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0);
}

function generatedFormalName({ seed = '', gender = '', idx = 0, role = '' } = {}) {
  const base = hashSeed(`${seed}|${gender}|${role}|${idx}`);
  const surname = NAME_SURNAMES[base % NAME_SURNAMES.length];
  const first = NAME_GIVEN_CHARS[(base + idx * 7) % NAME_GIVEN_CHARS.length];
  const second = NAME_GIVEN_CHARS[(Math.floor(base / 13) + idx * 11) % NAME_GIVEN_CHARS.length];
  return `${surname}${first}${second === first ? '' : second}`;
}

function looksLikeDescriptorName(name = '') {
  const s = cleanText(name, 80);
  if (!s) return true;
  const exactDescriptors = [
    '\u89d2\u8272', '\u4eba\u7269', '\u4e3b\u89d2', '\u5973\u4e3b', '\u7537\u4e3b', '\u65c1\u767d',
    '\u8bb2\u89e3\u8005', '\u5c55\u793a\u8005', '\u5f15\u5bfc\u8005', '\u5ba2\u6237', '\u987e\u95ee',
    '\u9500\u552e', '\u7528\u6237', '\u6f14\u5458', '\u6a21\u7279', '\u7f8e\u5973', '\u5e05\u54e5',
  ];
  if (exactDescriptors.some(word => s === word || new RegExp(`^${word}(\\d+|[A-Z]|[甲乙丙丁一二三四五六])$`, 'i').test(s))) return true;
  const descriptorWords = [
    '\u6c14\u8d28', '\u7f8e\u5973', '\u5e05\u54e5', '\u9ad8\u8d35', '\u4f18\u96c5',
    '\u957f\u53d1', '\u77ed\u53d1', '\u5ba2\u6237', '\u987e\u95ee', '\u9500\u552e',
    '\u5c55\u793a', '\u5f15\u5bfc', '\u8bb2\u89e3', '\u7528\u6237', '\u8001\u677f',
    '\u7ecf\u7406', '\u8d1f\u8d23\u4eba',
  ];
  if (descriptorWords.some(word => s.includes(word))) return true;
  return s.length > 8;
}

function defaultCharacterName(gender = '', idx = 0, seed = '', role = '') {
  return generatedFormalName({ seed, gender, idx, role });
}

function normalizeCharacter(item, idx = 0, seed = '') {
  if (typeof item === 'string') {
    const role = cleanText(item, 80);
    const gender = inferGenderFromText(role);
    return {
      name: defaultCharacterName(gender, idx, seed, role),
      role,
      gender,
      description: role,
      name_generated: true,
    };
  }
  const source = item && typeof item === 'object' ? item : {};
  const role = cleanText(source.role || source.relationship || source.identity || source.job || '', 80);
  const description = cleanText(source.description || source.appearance || source.profile || source.desc || '', 360);
  const gender = cleanText(source.gender || inferGenderFromText(`${source.name || ''} ${role} ${description}`), 30);
  const rawName = cleanText(source.name || source.character_name || source.displayName || source.label || '', 40);
  const shouldGenerateName = looksLikeDescriptorName(rawName);
  return {
    name: shouldGenerateName ? defaultCharacterName(gender, idx, seed, role || description) : rawName,
    role,
    gender,
    description,
    name_generated: shouldGenerateName || undefined,
  };
}

function normalizeCharacters(input, seed = '') {
  const raw = Array.isArray(input) ? input : [];
  return raw
    .map((item, idx) => normalizeCharacter(item, idx, seed))
    .filter(x => x.name || x.role || x.description);
}

function normalizePetProfiles(input, fallback = {}) {
  const raw = Array.isArray(input) ? input : [];
  const profiles = raw.map((item, idx) => ({
    id: cleanText(item?.id || `pet_${idx + 1}`, 80),
    name: cleanText(item?.name || item?.display_name || item?.displayName || '', 80),
    type: cleanText(item?.type || item?.species || item?.pet_type || item?.petType || '', 80),
    breed: cleanText(item?.breed || '', 100),
    appearance: cleanText(item?.appearance || item?.description || item?.pet_description || item?.petDescription || '', 500),
    image_url: cleanText(item?.image_url || item?.url || '', 1000),
    view_images: Array.isArray(item?.view_images) ? item.view_images.map(view => ({
      key: cleanText(view?.key || view?.view || '', 40),
      url: cleanText(view?.url || view?.image_url || '', 1000),
      image_url: cleanText(view?.image_url || view?.url || '', 1000),
    })).filter(view => view.url || view.image_url).slice(0, 4) : [],
    reference_images: (Array.isArray(item?.reference_images) ? item.reference_images : [])
      .map(value => cleanText(value, 1000)).filter(Boolean).slice(0, 8),
    pet_contract: item?.pet_contract && typeof item.pet_contract === 'object' ? item.pet_contract : null,
  })).filter(item => item.name || item.type || item.breed || item.appearance || item.reference_images.length);
  if (profiles.length) return profiles.slice(0, 8);
  const type = cleanText(fallback.petType || fallback.pet_type || '', 80);
  const appearance = cleanText(fallback.petDescription || fallback.pet_description || '', 500);
  if (!type && !appearance) return [];
  return [{
    id: 'pet_1',
    name: '',
    type,
    breed: '',
    appearance,
    reference_images: [],
  }];
}

function inferCastMode({ castMode = '', characters = [], brief = '' } = {}) {
  const explicit = cleanText(castMode, 40);
  if (/no_human|none|无人物|无人|只拍主体|只拍产品|只拍空间/i.test(explicit)) return 'no_human';
  if (/human_pet|person_pet|人物.*宠物|人.*宠物|人物.*动物|人.*动物/i.test(explicit)) return 'human_pet';
  if (/animal|pet|动物|宠物/i.test(explicit)) return 'animal';
  if (/multi|多人|三人|群像|团队/i.test(explicit)) return 'multi';
  if (/dual|双人|两人/i.test(explicit)) return 'dual';
  if (/single|单人|一人/i.test(explicit)) return 'single';
  const text = `${brief} ${characters.map(c => `${c.name}${c.role}`).join(' ')}`;
  if (/无人|无人物|不出现人|不要人物|只拍产品|只拍空间|纯产品|纯空间/.test(text)) return 'no_human';
  const hasPet = /动物|宠物|萌宠|猫|狗|犬|金毛|柯基|萨摩耶|拉布拉多/.test(text);
  const hasHuman = characters.length > 0
    || /人物|真人|演员|主人|一家人|一家(?:[一二三四五六七八九十\d]+)口|家庭|父母|妈妈|母亲|爸爸|父亲|孩子|儿童|夫妻|男女|男士|女士|顾问|客户|用户|员工|团队/.test(text);
  if (hasPet && hasHuman) return 'human_pet';
  if (hasPet) return 'animal';
  if (characters.length >= 3 || /多人|三人|四人|团队|群像/.test(text)) return 'multi';
  if (characters.length === 2 || /双人|两人|夫妻|同事|客户.*顾问|主播.*助理/.test(text)) return 'dual';
  return 'auto';
}

function normalizeAssets(input) {
  const raw = Array.isArray(input) ? input : [];
  return raw.map((item, idx) => ({
    id: cleanText(item?.id || `asset_${idx + 1}`, 80),
    type: cleanText(item?.type || item?.kind || 'reference', 40),
    url: cleanText(item?.url || item?.image_url || item?.src || '', 1000),
    name: cleanText(item?.name || item?.filename || '', 120),
    description: cleanText(item?.description || item?.summary || '', 500),
  })).filter(x => x.url || x.description || x.name);
}

function normalizeBrandOverlay(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const asset = source.asset && typeof source.asset === 'object' ? source.asset : null;
  const allowedPositions = new Set(['top_left', 'top_right', 'center', 'bottom_left', 'bottom_center', 'bottom_right']);
  const position = cleanText(source.position || 'bottom_center', 40);
  return {
    enabled: source.enabled === true && !!asset,
    authorization_confirmed: source.authorization_confirmed === true || source.authorizationConfirmed === true,
    asset: asset ? {
      id: cleanText(asset.id || '', 100),
      role: 'brand_logo',
      name: cleanText(asset.name || asset.original_name || '品牌 Logo', 160),
      url: cleanText(asset.url || asset.image_url || asset.file_url || '', 1000),
      image_url: cleanText(asset.image_url || asset.url || asset.file_url || '', 1000),
      file_url: cleanText(asset.file_url || asset.url || asset.image_url || '', 1000),
      mimetype: cleanText(asset.mimetype || '', 100),
    } : null,
    position: allowedPositions.has(position) ? position : 'bottom_center',
    width_percent: Math.max(8, Math.min(45, Number(source.width_percent ?? source.widthPercent ?? 22) || 22)),
    margin_percent: Math.max(0, Math.min(20, Number(source.margin_percent ?? source.marginPercent ?? 5) || 5)),
    end_duration_sec: Math.max(0.5, Math.min(15, Number(source.end_duration_sec ?? source.endDurationSec ?? 3) || 3)),
  };
}

function normalizeSceneAssets(input) {
  const raw = Array.isArray(input) ? input : [];
  return raw.map((item, idx) => {
    if (!item || typeof item !== 'object') return null;
    const viewImages = Array.isArray(item.view_images) ? item.view_images.map((view, viewIdx) => ({
      ...view,
      key: cleanText(view?.key || view?.view || ['master', 'reverse', 'interaction', 'detail'][viewIdx] || `view_${viewIdx + 1}`, 40),
      label: cleanText(view?.label || view?.name || '', 80),
      url: cleanText(view?.url || view?.image_url || view?.imageUrl || '', 1000),
      image_url: cleanText(view?.image_url || view?.url || view?.imageUrl || '', 1000),
      camera_id: cleanText(view?.camera_id || ('camera_' + (view?.key || view?.view || ['master', 'reverse', 'interaction', 'detail'][viewIdx] || ('view_' + (viewIdx + 1)))), 100),
    })).filter(view => view.url || view.image_url).slice(0, 8) : [];
    const imageUrl = cleanText(item.image_url || item.imageUrl || item.url || viewImages[0]?.url || viewImages[0]?.image_url || '', 1000);
    if (!imageUrl && !viewImages.length && !item.layout_summary && !item.material_summary) return null;
    return {
      id: cleanText(item.id || item.scene_id || `scene_${idx + 1}`, 120),
      scene_id: cleanText(item.scene_id || item.id || `scene_${idx + 1}`, 120),
      name: cleanText(item.name || `任务场景 ${idx + 1}`, 120),
      source: cleanText(item.source || 'new_story_ad_scene_asset', 120),
      lock_strength: cleanText(item.lock_strength || item.lockStrength || 'standard', 40),
      layout_summary: cleanText(item.layout_summary || item.layoutSummary || item.description || '', 1000),
      material_summary: cleanText(item.material_summary || item.materialSummary || '', 1000),
      interaction_summary: cleanText(item.interaction_summary || item.interactionSummary || '', 800),
      style_summary: cleanText(item.style_summary || item.styleSummary || '', 800),
      negative: cleanText(item.negative || item.negative_prompt || '', 800),
      surface_topology: shotDesign.normalizeSurfaceTopology(item.surface_topology || item.surfaceTopology),
      material_contract: item.material_contract && typeof item.material_contract === 'object' ? item.material_contract : null,
      image_url: imageUrl,
      view_images: viewImages,
      view_count: Number(item.view_count || viewImages.length || (imageUrl ? 1 : 0)) || 0,
      view_strategy: cleanText(item.view_strategy || item.viewStrategy || '', 40),
      view_acquisition: item.view_acquisition && typeof item.view_acquisition === 'object' ? item.view_acquisition : null,
      space_asset_contract: item.space_asset_contract && typeof item.space_asset_contract === 'object' ? item.space_asset_contract : null,
      generation_contract_version: Math.max(0, Number(item.generation_contract_version || item.view_acquisition?.generation_contract_version || 0) || 0),
      scene_revision: Math.max(1, Number(item.scene_revision || item.sceneRevision || 1) || 1),
      scene_contract: item.scene_contract && typeof item.scene_contract === 'object' ? item.scene_contract : null,
      cross_view_qa: item.cross_view_qa && typeof item.cross_view_qa === 'object' ? item.cross_view_qa : null,
      requirement_qa: item.requirement_qa && typeof item.requirement_qa === 'object' ? item.requirement_qa : null,
      photographic_realism_qa: item.photographic_realism_qa && typeof item.photographic_realism_qa === 'object' ? item.photographic_realism_qa : null,
      camera_design_qa: item.camera_design_qa && typeof item.camera_design_qa === 'object' ? item.camera_design_qa : null,
      spatial_coverage_qa: item.spatial_coverage_qa && typeof item.spatial_coverage_qa === 'object' ? item.spatial_coverage_qa : null,
      layout_contract: item.layout_contract && typeof item.layout_contract === 'object' ? item.layout_contract : null,
      verification: item.verification && typeof item.verification === 'object' ? item.verification : null,
      repair_plan: item.repair_plan && typeof item.repair_plan === 'object' ? item.repair_plan : null,
      repair_history: Array.isArray(item.repair_history) ? item.repair_history.slice(-8) : [],
      provider_used: cleanText(item.provider_used || '', 240),
    };
  }).filter(Boolean);
}

function normalizePropAssets(input) {
  const raw = Array.isArray(input) ? input : [];
  return raw.map((item, index) => {
    if (!item || typeof item !== 'object') return null;
    const views = Array.isArray(item.view_images) ? item.view_images.map(view => ({
      ...view,
      key: cleanText(view?.key || '', 100),
      url: cleanText(view?.url || view?.image_url || '', 1000),
      image_url: cleanText(view?.image_url || view?.url || '', 1000),
    })).filter(view => view.url || view.image_url) : [];
    return {
      ...item,
      id: cleanText(item.id || item.prop_id || `prop_${index + 1}`, 120),
      prop_id: cleanText(item.prop_id || item.id || `prop_${index + 1}`, 120),
      name: cleanText(item.name || `道具${index + 1}`, 160),
      type: cleanText(item.type || item.classification || 'story_prop', 80),
      description: cleanText(item.description || item.contract?.identity?.description || '', 800),
      material: cleanText(item.material || item.contract?.identity?.material || '', 300),
      scale: cleanText(item.scale || item.contract?.identity?.scale || '', 200),
      owner_id: cleanText(item.owner_id || item.contract?.ownership?.owner_id || '', 120),
      scene_id: cleanText(item.scene_id || item.contract?.ownership?.scene_id || '', 120),
      placement: cleanText(item.placement || item.contract?.interaction?.placement || '', 400),
      hand_contact: cleanText(item.hand_contact || item.contract?.interaction?.hand_contact || '', 400),
      image_url: cleanText(item.image_url || views[0]?.image_url || '', 1000),
      cover_image_url: cleanText(item.cover_image_url || '', 1000),
      view_images: views,
      state_views: Array.isArray(item.state_views) ? item.state_views : [],
      shot_timeline: Array.isArray(item.shot_timeline) ? item.shot_timeline : [],
      contract: item.contract && typeof item.contract === 'object' ? item.contract : null,
    };
  }).filter(Boolean);
}

function normalizeSceneSpec(input = {}) {
  const raw = input && typeof input === 'object' ? input : {};
  const layoutText = cleanText(raw.layoutText || raw.layout_text || raw.layout || '', 600);
  const materialLightText = cleanText(raw.materialLightText || raw.material_light_text || raw.material || raw.light || '', 600);
  const negativeText = cleanText(raw.negativeText || raw.negative_text || raw.negative || '', 500);
  const textList = (value, maxItems = 12, maxText = 220) => (Array.isArray(value) ? value : [])
    .map(item => cleanText(typeof item === 'object' ? (item.label || item.name || item.text || item.content || '') : item, maxText))
    .filter(Boolean)
    .slice(0, maxItems);
  const storyStates = (Array.isArray(raw.storyStates || raw.story_states || raw.stateTimeline || raw.state_timeline)
    ? (raw.storyStates || raw.story_states || raw.stateTimeline || raw.state_timeline)
    : []).slice(0, 20).map((state, index) => ({
    id: cleanText(state?.id || `state_${index + 1}`, 100),
    label: cleanText(state?.label || state?.name || `状态 ${index + 1}`, 100),
    state_before: textList(state?.state_before || state?.before, 8, 220),
    visible_change: textList(state?.visible_change || state?.change || state?.trigger, 8, 220),
    state_after: textList(state?.state_after || state?.after, 8, 220),
    shot_refs: textList(state?.shot_refs || state?.shots, 20, 40),
  }));
  const interactionAnchors = (Array.isArray(raw.interactionAnchors || raw.interaction_anchors)
    ? (raw.interactionAnchors || raw.interaction_anchors)
    : []).slice(0, 16).map((anchor, index) => ({
    id: cleanText(anchor?.id || `interaction_anchor_${index + 1}`, 100),
    label: cleanText(anchor?.label || anchor?.name || `互动点 ${index + 1}`, 100),
    purpose: cleanText(anchor?.purpose || anchor?.description, 220),
    contact_rules: textList(anchor?.contact_rules || anchor?.rules, 8, 200),
  }));
  const routes = (Array.isArray(raw.routes || raw.movement_routes)
    ? (raw.routes || raw.movement_routes)
    : []).slice(0, 12).map((route, index) => ({
    id: cleanText(route?.id || `route_${index + 1}`, 100),
    label: cleanText(route?.label || route?.name || `路线 ${index + 1}`, 100),
    from: cleanText(route?.from, 120),
    to: cleanText(route?.to, 120),
    actor: cleanText(route?.actor, 120),
    continuity: cleanText(route?.continuity || route?.rule, 220),
  }));
  const cameraPlan = (Array.isArray(raw.cameraPlan || raw.camera_plan)
    ? (raw.cameraPlan || raw.camera_plan)
    : []).slice(0, 24).map((camera, index) => ({
    id: cleanText(camera?.id || camera?.camera_id || `camera_${index + 1}`, 100),
    label: cleanText(camera?.label || camera?.name || `机位 ${index + 1}`, 100),
    zone: cleanText(camera?.zone || camera?.zone_id, 120),
    framing: cleanText(camera?.framing || camera?.shot_size, 100),
    lens: cleanText(camera?.lens || camera?.lens_class || camera?.focal_length, 100),
    movement: cleanText(camera?.movement || camera?.camera_movement || camera?.move, 300),
    start_state: cleanText(camera?.start_state || camera?.start, 220),
    end_state: cleanText(camera?.end_state || camera?.end, 220),
    duration: Math.max(0, Math.min(60, Number(camera?.duration || camera?.duration_sec || 0) || 0)),
    notes: cleanText(camera?.notes || camera?.purpose, 260),
  }));
  const surfaceTopology = shotDesign.reconcileSceneSurfaceTopology(
    raw.surfaceTopology || raw.surface_topology,
    [layoutText, materialLightText, negativeText, raw.surfaceTopology?.notes, raw.surface_topology?.notes],
  );
  return {
    mode: cleanText(raw.mode || raw.sceneMode || 'auto', 40),
    layoutText,
    materialLightText,
    interactionText: cleanText(raw.interactionText || raw.interaction_text || raw.interaction || raw.camera || '', 500),
    negativeText,
    storyStates,
    interactionAnchors,
    routes,
    cameraPlan,
    surfaceTopology,
    materialContract: shotDesign.normalizeMaterialContract(raw.materialContract || raw.material_contract, {
      sourceText: materialLightText,
      topology: surfaceTopology,
      referenceAvailable: false,
    }),
  };
}

function normalizePersonDossierItem(item = {}, index = 0) {
  return {
    id: cleanText(item?.id || `dossier_item_${index + 1}`, 120),
    kind: cleanText(item?.kind || item?.type || 'reference', 40),
    key: cleanText(item?.key || item?.view || `item_${index + 1}`, 80),
    label: cleanText(item?.label || item?.name || item?.key || '', 100),
    image_url: cleanText(item?.image_url || item?.url || '', 1000),
    url: cleanText(item?.url || item?.image_url || '', 1000),
    filename: cleanText(item?.filename || '', 220),
    provider_used: cleanText(item?.provider_used || '', 160),
  };
}

function normalizePersonDossierRows(input = []) {
  return (Array.isArray(input) ? input : [])
    .map(normalizePersonDossierItem)
    .filter(item => item.image_url || item.url)
    .slice(0, 24);
}

function normalizePersonDossierFields(input = {}) {
  const sheet = input.dossier_sheet && typeof input.dossier_sheet === 'object'
    ? {
        filename: cleanText(input.dossier_sheet.filename || '', 220),
        image_url: cleanText(input.dossier_sheet.image_url || input.dossier_sheet.url || '', 1000),
        composition: cleanText(input.dossier_sheet.composition || '', 80),
        model_generated_text: input.dossier_sheet.model_generated_text === true,
        atomic_count: Math.max(0, Number(input.dossier_sheet.atomic_count || 0) || 0),
      }
    : null;
  return {
    cover_image_url: cleanText(input.cover_image_url || sheet?.image_url || '', 1000),
    dossier_sheet: sheet,
    dossier_schema_version: Math.max(0, Number(input.dossier_schema_version || 0) || 0),
    quality_status: cleanText(input.quality_status || (input.native_masters?.face?.image_url && input.native_masters?.body?.image_url ? 'native_masters_ready' : 'legacy_view_only'), 50),
    native_masters: Object.fromEntries(['face', 'body'].map(key => [key, normalizePersonDossierItem(input.native_masters?.[key] || {})])
      .filter(([, item]) => item.image_url || item.url)),
    category_atlases: (Array.isArray(input.category_atlases) ? input.category_atlases : []).map((atlas, index) => ({
      kind: cleanText(atlas?.kind || atlas?.key || `atlas_${index + 1}`, 40),
      image_url: cleanText(atlas?.image_url || atlas?.url || '', 1000),
      filename: cleanText(atlas?.filename || '', 220),
      provider_used: cleanText(atlas?.provider_used || '', 160),
      grid: atlas?.grid && typeof atlas.grid === 'object'
        ? {
            columns: Math.max(1, Number(atlas.grid.columns || 1) || 1),
            rows: Math.max(1, Number(atlas.grid.rows || 1) || 1),
          }
        : null,
    })).filter(atlas => atlas.image_url).slice(0, 8),
    atomic_assets: normalizePersonDossierRows(input.atomic_assets),
    body_views: normalizePersonDossierRows(input.body_views),
    identity_views: normalizePersonDossierRows(input.identity_views),
    expressions: normalizePersonDossierRows(input.expressions),
    base_actions: normalizePersonDossierRows(input.base_actions),
    accessory_details: normalizePersonDossierRows(input.accessory_details || input.accessoryDetails),
    generation_summary: input.generation_summary && typeof input.generation_summary === 'object'
      ? {
          planned_provider_calls: Math.max(0, Number(input.generation_summary.planned_provider_calls || 0) || 0),
          provider_calls_this_run: Math.max(0, Number(input.generation_summary.provider_calls_this_run || 0) || 0),
          checkpoint_hits: Math.max(0, Number(input.generation_summary.checkpoint_hits || 0) || 0),
          category_count: Math.max(0, Number(input.generation_summary.category_count || 0) || 0),
          native_master_count: Math.max(0, Number(input.generation_summary.native_master_count || 0) || 0),
          atomic_count: Math.max(0, Number(input.generation_summary.atomic_count || 0) || 0),
        }
      : null,
  };
}

function normalizePersonAsset(input = null) {
  if (!input || typeof input !== 'object') return null;
  const imageUrl = cleanText(input.image_url || input.imageUrl || input.url || input.previewUrl || '', 1000);
  const actorAssetId = cleanText(input.actor_asset_id || input.actorAssetId || input.asset_library_id || input.material_id || input.id || '', 120);
  if (!imageUrl && !actorAssetId) return null;
  return {
    id: cleanText(input.id || actorAssetId || 'new_story_person_asset', 120),
    actor_asset_id: actorAssetId,
    deyunai_asset_id: cleanText(input.deyunai_asset_id || input.deyunaiAssetId || '', 160),
    deyunai_asset_status: cleanText(input.deyunai_asset_status || input.deyunaiAssetStatus || '', 40),
    deyunai_asset_group_id: cleanText(input.deyunai_asset_group_id || input.deyunaiAssetGroupId || '', 160),
    deyunai_asset_group_type: cleanText(input.deyunai_asset_group_type || input.deyunaiAssetGroupType || '', 40),
    actor_id: cleanText(input.actor_id || input.actorId || '', 120),
    name: cleanText(input.name || '', 120),
    type: cleanText(input.type || 'new_story_ad_actor', 80),
    source: cleanText(input.source || 'person_asset', 120),
    reference_kind: cleanText(input.reference_kind || input.referenceKind || '', 80),
    real_person_reference: input.real_person_reference === true || input.realPersonReference === true,
    production_usable_actor: input.production_usable_actor === true || input.productionUsableActor === true,
    is_ai_generated: input.is_ai_generated === true || input.isAiGenerated === true,
    gender: cleanText(input.gender || input.detected_gender || '', 40),
    age: cleanText(input.age || input.age_range || '', 80),
    origin: cleanText(input.origin || input.region || input.ethnicity || '', 120),
    cast_mode: cleanText(input.cast_mode || input.castMode || '', 40),
    expected_people: cleanText(input.expected_people || input.person_count || '', 20),
    image_url: imageUrl,
    ...normalizePersonDossierFields(input),
    extra_image_urls: Array.isArray(input.extra_image_urls) ? input.extra_image_urls.map(x => cleanText(x, 1000)).filter(Boolean).slice(0, 8) : [],
    view_images: Array.isArray(input.view_images) ? input.view_images.map(view => ({
      key: cleanText(view?.key || view?.view || view?.type || '', 40),
      label: cleanText(view?.label || view?.name || '', 80),
      url: cleanText(view?.url || view?.image_url || view?.imageUrl || '', 1000),
      image_url: cleanText(view?.image_url || view?.url || view?.imageUrl || '', 1000),
    })).filter(view => view.url || view.image_url).slice(0, 24) : [],
    person_revision: Math.max(1, Number(input.person_revision || input.personRevision || input.person_contract?.person_revision || 1) || 1),
      person_contract: input.person_contract && typeof input.person_contract === 'object' ? input.person_contract : null,
      subject_board_url: cleanText(input.subject_board_url || input.subjectBoardUrl || '', 1000),
    cast_assets: Array.isArray(input.cast_assets) ? input.cast_assets.map((member, idx) => ({
      cast_member_index: Number(member?.cast_member_index || member?.index || idx + 1) || idx + 1,
      cast_role: cleanText(member?.cast_role || member?.role || member?.name || `角色${idx + 1}`, 80),
      name: cleanText(member?.name || member?.cast_role || `角色${idx + 1}`, 80),
      id: cleanText(member?.id || member?.actor_asset_id || `cast_${idx + 1}`, 120),
      actor_asset_id: cleanText(member?.actor_asset_id || member?.id || '', 120),
      actor_id: cleanText(member?.actor_id || '', 120),
      deyunai_asset_id: cleanText(member?.deyunai_asset_id || member?.deyunaiAssetId || '', 160),
      deyunai_asset_status: cleanText(member?.deyunai_asset_status || member?.deyunaiAssetStatus || '', 40),
      deyunai_asset_group_id: cleanText(member?.deyunai_asset_group_id || member?.deyunaiAssetGroupId || '', 160),
      deyunai_asset_group_type: cleanText(member?.deyunai_asset_group_type || member?.deyunaiAssetGroupType || '', 40),
      image_url: cleanText(member?.image_url || member?.url || '', 1000),
      ...normalizePersonDossierFields(member),
      extra_image_urls: Array.isArray(member?.extra_image_urls) ? member.extra_image_urls.map(x => cleanText(x, 1000)).filter(Boolean).slice(0, 6) : [],
      view_images: Array.isArray(member?.view_images) ? member.view_images.map(view => ({
        key: cleanText(view?.key || view?.view || '', 40),
        url: cleanText(view?.url || view?.image_url || '', 1000),
        image_url: cleanText(view?.image_url || view?.url || '', 1000),
      })).filter(view => view.url || view.image_url).slice(0, 4) : [],
      person_contract: member?.person_contract && typeof member.person_contract === 'object' ? member.person_contract : null,
    })).filter(member => member.image_url || member.name).slice(0, 8) : [],
    description: cleanText(input.description || input.spec_description || '', 1000),
  };
}

function normalizeCastProfiles(input) {
  const raw = Array.isArray(input) ? input : [];
  return raw.map((profile, idx) => {
    if (!profile || typeof profile !== 'object') return null;
    const resolved = subjectProfileText.profileTexts(profile);
    return {
      id: cleanText(profile.id || `cast_${idx + 1}`, 80),
      name: cleanText(profile.name || profile.displayName || profile.roleName || `角色${idx + 1}`, 120),
      displayName: cleanText(profile.displayName || profile.name || '', 120),
      roleName: cleanText(profile.roleName || profile.role || '', 120),
      field_authority: subjectProfileText.profileFieldAuthority(profile),
      user_edited_fields: subjectProfileText.userEditedFields(profile),
      sourceType: cleanText(profile.sourceType || profile.reference_kind || '', 80),
      assetId: cleanText(profile.assetId || profile.actor_asset_id || profile.id || '', 120),
      actor_asset_id: cleanText(profile.actor_asset_id || '', 120),
      actor_id: cleanText(profile.actor_id || '', 120),
      referenceImageUrl: cleanText(profile.referenceImageUrl || profile.image_url || profile.url || '', 1000),
      image_url: cleanText(profile.image_url || profile.referenceImageUrl || profile.url || '', 1000),
      extra_image_urls: Array.isArray(profile.extra_image_urls) ? profile.extra_image_urls.map(x => cleanText(x, 1000)).filter(Boolean).slice(0, 8) : [],
      view_images: Array.isArray(profile.view_images) ? profile.view_images.map(view => ({
        key: cleanText(view?.key || view?.view || '', 40),
        url: cleanText(view?.url || view?.image_url || '', 1000),
        image_url: cleanText(view?.image_url || view?.url || '', 1000),
      })).filter(view => view.url || view.image_url).slice(0, 4) : [],
      person_contract: profile.person_contract && typeof profile.person_contract === 'object' ? profile.person_contract : null,
      ...resolved,
      appearance: {
        ...(profile.appearance && typeof profile.appearance === 'object' ? profile.appearance : {}),
        userPrompt: resolved.appearanceText,
      },
      wardrobe: {
        ...(profile.wardrobe && typeof profile.wardrobe === 'object' ? profile.wardrobe : {}),
        userPrompt: resolved.wardrobeText,
      },
      hairMakeup: {
        ...(profile.hairMakeup && typeof profile.hairMakeup === 'object' ? profile.hairMakeup : {}),
        userPrompt: resolved.hairMakeupText,
      },
      outfit: resolved.wardrobeText,
      description: cleanText(profile.description || [
        resolved.appearanceText,
        resolved.wardrobeText ? `服装：${resolved.wardrobeText}` : '',
        resolved.hairMakeupText ? `发型妆造：${resolved.hairMakeupText}` : '',
      ].filter(Boolean).join('；'), 1000),
      identityLock: profile.identityLock && typeof profile.identityLock === 'object' ? profile.identityLock : {},
    };
  }).filter(Boolean);
}

function normalizeControlledProduction(input = null) {
  const src = input && typeof input === 'object' ? input : {};
  const environment = src.environment_control || src.environment || {};
  const product = src.product_control || src.product || {};
  const style = src.style_control || src.style || {};
  const negative = src.negative_control || src.negative || {};
  const envMode = cleanText(environment.mode || 'auto', 40);
  const productMethods = Array.isArray(product.methods)
    ? product.methods.map(x => cleanText(x, 40)).filter(Boolean).slice(0, 12)
    : [];
  const result = {
    enabled: src.enabled === true || src.mode === 'controlled',
    mode: src.mode === 'controlled' ? 'controlled' : 'classic',
    environment_control: {
      mode: ['auto', 'indoor', 'outdoor', 'mixed', 'tech_commercial', 'custom'].includes(envMode) ? envMode : 'auto',
      custom: cleanText(environment.custom || '', 200),
    },
    product_control: {
      enabled: product.enabled === true,
      presence: ['low', 'medium', 'high'].includes(product.presence) ? product.presence : 'medium',
      lock_strength: ['loose', 'standard', 'strict'].includes(product.lock_strength || product.lockStrength) ? (product.lock_strength || product.lockStrength) : 'standard',
      methods: productMethods,
    },
    style_control: {
      mode: cleanText(style.mode || 'classic', 40),
      notes: cleanText(style.notes || style.text || '', 500),
    },
    negative_control: {
      text: cleanText(negative.text || src.negative_text || '', 500),
    },
  };
  result.enabled = result.enabled
    || result.environment_control.mode !== 'auto'
    || !!result.environment_control.custom
    || result.product_control.enabled
    || !!result.style_control.notes
    || !!result.negative_control.text;
  if (result.enabled) result.mode = 'controlled';
  return result;
}

function normalizeProductionMode(value = '') {
  const raw = cleanText(value, 60).toLowerCase();
  const aliases = {
    narrative: 'narrative_live_action',
    live_action: 'narrative_live_action',
    product: 'product_story',
    product_ad: 'product_story',
    service: 'service_app_story',
    app: 'service_app_story',
    software: 'service_app_story',
  };
  const normalized = aliases[raw] || raw;
  return ['auto', 'narrative_live_action', 'product_story', 'service_app_story'].includes(normalized) ? normalized : 'auto';
}

function productionModeDescription(value = '') {
  return {
    auto: '按已确认人物、主体和场景判断故事呈现方式',
    narrative_live_action: '真人剧情演绎，以已确认人物的动作、表情和对白推动故事',
    product_story: '无人产品故事或产品演示，以主体状态、使用过程和可见证据推动故事',
    service_app_story: '服务、SaaS 或应用场景叙事，以用户问题、使用过程和结果变化推动故事',
  }[normalizeProductionMode(value)] || '按当前任务判断';
}

function normalizeCreativeDirection(input = null) {
  const source = typeof input === 'string' ? { raw: input } : (input && typeof input === 'object' ? input : {});
  const list = (value, max = 20) => (Array.isArray(value) ? value : (value ? String(value).split(/[\n；;]/) : []))
    .map(item => cleanText(item, 300))
    .filter(Boolean)
    .slice(0, max);
  const actions = (Array.isArray(source.actions) ? source.actions : []).map((action, index) => ({
    id: cleanText(action?.id || `action_${index + 1}`, 80),
    actor_id: cleanText(action?.actor_id || action?.actorId || '', 120),
    actor: cleanText(action?.actor || action?.character || '', 120),
    action: cleanText(action?.action || action?.description || '', 500),
    target_id: cleanText(action?.target_id || action?.targetId || '', 120),
    target: cleanText(action?.target || action?.object || '', 160),
    phase: cleanText(action?.phase || action?.stage || 'auto', 40),
    expression: cleanText(action?.expression || '', 200),
    dialogue: cleanText(action?.dialogue || action?.line || '', 500),
    required: action?.required !== false,
    constraints: list(action?.constraints, 8),
  })).filter(action => action.action || action.dialogue || action.expression).slice(0, 30);
  return {
    raw: cleanMultilineText(source.raw || source.text || source.requirement || source.story || '', 3000),
    plot_direction: cleanText(source.plot_direction || source.plotDirection || source.plot || '', 1000),
    tone: cleanText(source.tone || source.emotion || '', 300),
    pace: cleanText(source.pace || source.rhythm || '', 300),
    ending: cleanText(source.ending || '', 600),
    dialogue_notes: cleanText(source.dialogue_notes || source.dialogueNotes || '', 1000),
    must_have: list(source.must_have || source.mustHave),
    must_avoid: list(source.must_avoid || source.mustAvoid),
    actions,
  };
}

function inferVisibleTextPolicy(body = {}, brief = '') {
  const raw = body.visible_text_policy || body.visibleTextPolicy || {};
  const language = typeof raw === 'string'
    ? cleanText(raw, 40).toLowerCase()
    : cleanText(raw.language || raw.mode || '', 40).toLowerCase();
  const explicitStrict = language === 'zh_only'
    || language === 'chinese_only'
    || body.strict_chinese_only === true
    || body.strictChineseOnly === true;
  const requestText = cleanText(brief, 3000);
  const inferredStrict = /(?:纯中文|全中文|只(?:能|用|使用)中文|仅(?:能|用|使用)中文|禁止(?:出现|使用).{0,12}(?:英文|英文字母|拉丁字母)|不得(?:出现|使用).{0,12}(?:英文|英文字母|拉丁字母)|无英文)/u.test(requestText);
  const strictChineseOnly = explicitStrict || inferredStrict;
  return {
    language: strictChineseOnly ? 'zh_only' : (language || 'auto'),
    forbid_question_marks: strictChineseOnly
      || raw.forbid_question_marks === true
      || raw.forbidQuestionMarks === true,
    forbid_replacement_character: strictChineseOnly
      || raw.forbid_replacement_character === true
      || raw.forbidReplacementCharacter === true,
    source: explicitStrict ? 'explicit_field' : (inferredStrict ? 'explicit_brief_requirement' : 'default'),
  };
}

function inferExpectedPeopleCount(brief = '', characters = []) {
  if (Array.isArray(characters) && characters.length) return Math.min(12, characters.length);
  const text = cleanText(brief, 1200);
  const arabic = text.match(/(?:一家|家庭|共|有)?\s*(\d{1,2})\s*(?:口|人|位)(?:家庭成员|家人|人物|真人|演员)?/);
  if (arabic) return Math.max(1, Math.min(12, Number(arabic[1]) || 0));
  const chinese = [
    [/一家十二口|十二人/, 12], [/一家十一口|十一人/, 11], [/一家十口|十人/, 10],
    [/一家九口|九人/, 9], [/一家八口|八人/, 8], [/一家七口|七人/, 7],
    [/一家六口|六人/, 6], [/一家五口|五人/, 5], [/一家四口|四人/, 4],
    [/一家三口|三人/, 3], [/一家两口|两人|双人|夫妻/, 2], [/一人|单人/, 1],
  ].find(([pattern]) => pattern.test(text));
  return chinese ? chinese[1] : 0;
}

function inferExpectedAnimalCount(brief = '') {
  const text = cleanText(brief, 1200);
  const arabic = text.match(/(\d{1,2})\s*(?:只|条|头)(?:宠物|动物|猫|狗|犬)?/);
  if (arabic) return Math.max(1, Math.min(8, Number(arabic[1]) || 0));
  const chinese = [
    [/八只/, 8], [/七只/, 7], [/六只/, 6], [/五只/, 5],
    [/四只/, 4], [/三只/, 3], [/两只|二只/, 2], [/一只/, 1],
  ].find(([pattern]) => pattern.test(text));
  return chinese ? chinese[1] : 0;
}

const DEFAULT_TARGET_DURATION = 30;
const MIN_TARGET_DURATION = 10;
const MAX_TARGET_DURATION = 120;

function chineseDurationNumber(value = '') {
  const raw = cleanText(value, 20).replace(/[秒分钟钟\s]/g, '');
  if (!raw) return 0;
  if (/^\d+(?:\.\d+)?$/.test(raw)) return Number(raw);
  const digits = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  let total = 0;
  let current = 0;
  for (const char of raw) {
    if (Object.prototype.hasOwnProperty.call(digits, char)) {
      current = digits[char];
      continue;
    }
    if (char === '十') {
      total += (current || 1) * 10;
      current = 0;
      continue;
    }
    if (char === '百') {
      total += (current || 1) * 100;
      current = 0;
      continue;
    }
    return 0;
  }
  return total + current;
}

function inferBriefTargetDuration(brief = '') {
  const text = cleanText(brief, 3000);
  if (!text) return 0;
  const numberToken = '([0-9]+(?:\\.[0-9]+)?|[零一二两三四五六七八九十百]{1,8})';
  const unitToken = '(秒(?:钟)?|分钟|分(?:钟)?)';
  const patterns = [
    new RegExp(`(?:目标时长|总时长|成片时长|视频时长|广告时长|宣传片时长|短片时长|时长(?:为|约|控制在)?)\\s*${numberToken}\\s*${unitToken}`, 'gu'),
    new RegExp(`(?:制作|生成)(?:一条|一个|一段)?[^，。；;\\n]{0,8}?${numberToken}\\s*${unitToken}(?:横屏|竖屏|的)?(?:广告|宣传片|视频|短片)?`, 'gu'),
    new RegExp(`(?:一条|一个|一段)\\s*${numberToken}\\s*${unitToken}(?:横屏|竖屏|的)?(?:广告|宣传片|视频|短片)`, 'gu'),
  ];
  const candidates = [];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const amount = chineseDurationNumber(match[1]);
      const seconds = /分/.test(match[2]) ? amount * 60 : amount;
      if (Number.isFinite(seconds) && seconds >= MIN_TARGET_DURATION && seconds <= MAX_TARGET_DURATION) {
        candidates.push(Math.round(seconds));
      }
    }
  }
  const unique = [...new Set(candidates)];
  return unique.length === 1 ? unique[0] : 0;
}

function resolveTargetDuration(body = {}, brief = '') {
  const durationSource = cleanText(body.duration_source || body.durationSource || '', 40).toLowerCase();
  const structuredCandidates = [
    body.target_duration,
    body.targetDuration,
    body.duration_sec,
    body.durationSec,
    body.duration,
  ];
  const structuredDuration = structuredCandidates
    .map(Number)
    .find(value => Number.isFinite(value) && value > 0) || 0;
  const briefDuration = inferBriefTargetDuration(brief);
  const injectedDefault = ['ui_default', 'hidden_ui_default', 'default_control'].includes(durationSource);
  const chosen = briefDuration && (!structuredDuration || injectedDefault)
    ? briefDuration
    : (structuredDuration || briefDuration || DEFAULT_TARGET_DURATION);
  return {
    value: Math.max(MIN_TARGET_DURATION, Math.min(MAX_TARGET_DURATION, Math.round(chosen))),
    source: briefDuration && chosen === briefDuration
      ? 'explicit_brief'
      : (durationSource || (structuredDuration ? 'structured_request' : 'system_default')),
    brief_duration: briefDuration || 0,
    structured_duration: structuredDuration || 0,
  };
}

function buildContext(body = {}, user = {}) {
  const brief = cleanMultilineText(body.brief || body.content || body.requirement || body.prompt, 5000);
  const productSubject = cleanText(body.product_subject || body.productSubject || body.subject || body.product_name || body.productName || '', 200);
  const requestId = cleanText(body.request_id || body.requestId || uuidv4(), 80);
  const characters = normalizeCharacters(body.characters || body.cast || body.people, `${requestId}|${brief}|${productSubject}`);
  const assets = normalizeAssets(body.assets || body.references || body.images);
  const durationContract = resolveTargetDuration(body, brief);
  const targetDuration = durationContract.value;
  const rawShotCount = Number(body.shot_count || body.shotCount || 0) || 0;
  const shotCount = rawShotCount > 0 ? Math.max(1, Math.min(18, rawShotCount)) : 0;
  const outputRatio = cleanText(body.output_ratio || body.outputRatio || body.ratio || '9:16', 20);
  const forbidden = Array.isArray(body.forbidden)
    ? body.forbidden.map(x => cleanText(x, 100)).filter(Boolean)
    : cleanText(body.forbidden || body.negative || '', 500).split(/[，,;\n]/).map(x => cleanText(x, 100)).filter(Boolean);
  const castMode = inferCastMode({ castMode: body.cast_mode || body.castMode, characters, brief });
  const expectedPeopleRaw = Number(body.expected_people || body.expectedPeople || body.person_count || body.personCount || 0)
    || inferExpectedPeopleCount(brief, characters)
    || 0;
  const controlledProduction = normalizeControlledProduction(body.controlled_production || body.controlledProduction);
  const creativeDirection = normalizeCreativeDirection(
    body.creative_direction || body.creativeDirection || body.story_direction || body.storyDirection,
  );
  const personSpec = body.person_spec && typeof body.person_spec === 'object' ? body.person_spec : {};
  const petProfiles = normalizePetProfiles(
    body.pet_profiles || body.petProfiles || body.pet_contract?.profiles || body.petContract?.profiles,
    personSpec,
  );
  const expectedAnimalsRaw = Number(
    body.expected_animals || body.expectedAnimals
      || body.pet_count || body.petCount
      || personSpec.expectedAnimals || personSpec.expected_animals
      || 0,
  ) || inferExpectedAnimalCount(brief) || 0;
  const personAsset = normalizePersonAsset(body.person_asset || body.personAsset);
  const sceneAssets = normalizeSceneAssets(body.scene_assets || body.sceneAssets);
  const propAssets = normalizePropAssets(body.prop_assets || body.propAssets);
  const sceneSpec = normalizeSceneSpec(body.scene_spec || body.sceneSpec);
  const castProfiles = normalizeCastProfiles(body.cast_profiles || body.castProfiles);
  const personContext = body.person_context && typeof body.person_context === 'object' ? body.person_context : {};
  const rawPersonSpecSource = personContext.spec_source && typeof personContext.spec_source === 'object'
    ? personContext.spec_source
    : {};
  const personSpecSource = {
    kind: cleanText(rawPersonSpecSource.kind || '', 40),
    analysisId: cleanText(rawPersonSpecSource.analysisId || rawPersonSpecSource.analysis_id || '', 120),
    manualOverride: rawPersonSpecSource.manualOverride === true || rawPersonSpecSource.manual_override === true,
  };
  const noHuman = castMode === 'no_human';
  const animalOnly = castMode === 'animal';
  const petRequired = ['animal', 'human_pet'].includes(castMode);
  const normalizedPersonSpec = { ...personSpec };
  if (normalizedPersonSpec.appearanceText || normalizedPersonSpec.appearance || normalizedPersonSpec.description) {
    normalizedPersonSpec.appearanceText = subjectProfileText.alignAgeDescription(
      normalizedPersonSpec.appearanceText || normalizedPersonSpec.appearance || normalizedPersonSpec.description,
      normalizedPersonSpec.age,
      800,
    );
  }
  if (normalizedPersonSpec.wardrobeText || normalizedPersonSpec.wardrobe || normalizedPersonSpec.outfit) {
    normalizedPersonSpec.wardrobeText = subjectProfileText.dedupeClauses(
      normalizedPersonSpec.wardrobeText || normalizedPersonSpec.wardrobe || normalizedPersonSpec.outfit,
      600,
    );
  }
  if (normalizedPersonSpec.hairMakeupText || normalizedPersonSpec.hair_makeup || normalizedPersonSpec.hair) {
    normalizedPersonSpec.hairMakeupText = subjectProfileText.dedupeClauses(
      normalizedPersonSpec.hairMakeupText || normalizedPersonSpec.hair_makeup || normalizedPersonSpec.hair,
      400,
    );
  }
  if (normalizedPersonSpec.negativeText || normalizedPersonSpec.negative) {
    normalizedPersonSpec.negativeText = subjectProfileText.dedupeClauses(
      normalizedPersonSpec.negativeText || normalizedPersonSpec.negative,
      500,
    );
  }
  if (!petRequired) {
    delete normalizedPersonSpec.expectedAnimals;
    delete normalizedPersonSpec.expected_animals;
    delete normalizedPersonSpec.petType;
    delete normalizedPersonSpec.pet_type;
    delete normalizedPersonSpec.petDescription;
    delete normalizedPersonSpec.pet_description;
  }
  const expectedPeople = noHuman || animalOnly
    ? 0
    : (expectedPeopleRaw > 0
      ? Math.max(1, Math.min(12, Math.round(expectedPeopleRaw)))
      : (castMode === 'single' ? 1 : (castMode === 'dual' ? 2 : 0)));
  const expectedAnimals = petRequired
    ? Math.max(1, Math.min(8, Math.round(expectedAnimalsRaw || petProfiles.length || 1)))
    : 0;
  const normalizedPetProfiles = petRequired
    ? (petProfiles.length ? petProfiles : [{ id: 'pet_1', name: '', type: '按广告需求判断', breed: '', appearance: '', reference_images: [] }])
    : [];
  const voiceId = cleanText(body.voice_id || body.voiceId || '', 120);
  const includeVoiceover = body.include_voiceover === false || body.includeVoiceover === false
    ? false
    : !!voiceId;
  const rawSubtitleConfig = body.subtitle_config || body.subtitleConfig || {};
  const subtitleEnabled = body.subtitle !== false && rawSubtitleConfig.show !== false;
  const subtitleStyle = cleanText(body.subtitle_style || body.subtitleStyle || rawSubtitleConfig.style || 'popup', 60);
  const bgmAsset = body.bgm_asset || body.bgmAsset || null;
  const brandOverlay = normalizeBrandOverlay(body.brand_overlay || body.brandOverlay);
  const contextAssets = noHuman || animalOnly
    ? assets.filter(asset => !/(?:person|character|actor)/i.test(asset.type || ''))
    : assets;
  return {
    request_id: requestId,
    request_source: cleanText(body.source || body.request_source || body.requestSource || '', 80),
    project_name: cleanText(body.project_name || body.projectName || '', 120),
    brief,
    brief_source: ['user', 'reference_analysis', 'system'].includes(cleanText(body.brief_source || body.briefSource || '', 40))
      ? cleanText(body.brief_source || body.briefSource, 40)
      : '',
    product_subject: productAssetResolver.inferredSubject({ product_subject: productSubject || inferSubjectFromBrief(brief), brief, reference_video_analysis: body.reference_video_analysis || body.referenceVideoAnalysis }),
    product_presentation: productAssetResolver.productPresentation({
      product_subject: productSubject || inferSubjectFromBrief(brief),
      brief,
      product_asset: body.product_asset || body.productAsset,
      assets,
      product_presentation: body.product_presentation || body.productPresentation,
      reference_video_analysis: body.reference_video_analysis || body.referenceVideoAnalysis,
    }),
    target_duration: targetDuration,
    duration_source: durationContract.source,
    shot_count: shotCount,
    output_ratio: outputRatio,
    video_resolution: cleanText(body.video_resolution || body.videoResolution || '1080p', 20),
    video_quality: cleanText(body.video_quality || body.videoQuality || 'final', 20),
    visible_text_policy: inferVisibleTextPolicy(body, brief),
    production_mode: normalizeProductionMode(body.production_mode || body.productionMode || 'auto'),
    story_setup_confirmed: body.story_setup_confirmed === true || body.storySetupConfirmed === true,
    asset_setup_confirmed: body.asset_setup_confirmed === true || body.assetSetupConfirmed === true,
    shot_design_confirmed: body.shot_design_confirmed === true || body.shotDesignConfirmed === true,
    voice_id: voiceId,
    voice_name: cleanText(body.voice_name || body.voiceName || '', 120),
    include_voiceover: includeVoiceover,
    voice_volume: Math.max(0, Math.min(1.5, Number(body.voice_volume ?? body.voiceVolume ?? 1) || 1)),
    bgm_volume: Math.max(0, Math.min(1, Number(body.bgm_volume ?? body.bgmVolume ?? 0.16) || 0)),
    bgm_profile: cleanText(body.bgm_profile || body.bgmProfile || 'auto', 60),
    bgm_asset: bgmAsset && typeof bgmAsset === 'object' ? bgmAsset : null,
    brand_overlay: brandOverlay,
    subtitle: subtitleEnabled,
    subtitle_style: subtitleStyle,
    subtitle_config: {
      ...(rawSubtitleConfig && typeof rawSubtitleConfig === 'object' ? rawSubtitleConfig : {}),
      show: subtitleEnabled,
      style: subtitleStyle,
    },
    cast_mode: castMode,
    expected_people: expectedPeople,
    expected_animals: expectedAnimals,
    characters: noHuman || animalOnly ? [] : characters,
    pet_profiles: normalizedPetProfiles,
    pet_contract: petRequired ? {
      status: 'declared',
      expected_animals: expectedAnimals,
      profiles: normalizedPetProfiles,
    } : null,
    subject_board_url: cleanText(body.subject_board_url || body.subjectBoardUrl || personAsset?.subject_board_url || body.person_contract?.subject_board_url || body.pet_contract?.subject_board_url || '', 1000),
    assets: contextAssets,
    forbidden,
    controlled_production: controlledProduction,
    creative_direction: creativeDirection,
    benchmark_strategy: benchmarkStrategy.normalize(body.benchmark_strategy || body.benchmarkStrategy),
    person_spec: noHuman ? { castMode: 'no_human' } : normalizedPersonSpec,
    person_asset: noHuman || animalOnly ? null : personAsset,
    person_contract: noHuman || animalOnly ? null : (body.person_contract && typeof body.person_contract === 'object'
      ? body.person_contract
      : (personAsset?.person_contract || null)),
    product_contract: body.product_contract && typeof body.product_contract === 'object' ? body.product_contract : null,
    scene_spec: sceneSpec,
    scene_assets: sceneAssets,
    prop_assets: propAssets,
    reference_video_analysis: normalizeReferenceVideoAnalysis(body.reference_video_analysis),
    reference_understanding_override: body.reference_understanding_override && typeof body.reference_understanding_override === 'object'
      ? body.reference_understanding_override
      : null,
    scene_mode: ['auto', 'single', 'multi'].includes(cleanText(body.scene_mode || body.sceneMode || 'auto', 20))
      ? cleanText(body.scene_mode || body.sceneMode || 'auto', 20)
      : 'auto',
    revisions: body.revisions && typeof body.revisions === 'object' ? {
      source: Math.max(1, Number(body.revisions.source || 1) || 1),
      scene: Math.max(1, Number(body.revisions.scene || 1) || 1),
      person: Math.max(1, Number(body.revisions.person || 1) || 1),
      product: Math.max(1, Number(body.revisions.product || 1) || 1),
      creative: Math.max(1, Number(body.revisions.creative || 1) || 1),
      voice: Math.max(1, Number(body.revisions.voice || 1) || 1),
      compose: Math.max(1, Number(body.revisions.compose || 1) || 1),
    } : { source: 1, scene: 1, person: 1, product: 1, creative: 1, voice: 1, compose: 1 },
    cast_profiles: noHuman || animalOnly ? [] : castProfiles,
    person_context: noHuman || animalOnly ? {
      source: noHuman ? 'no_human_mode' : 'animal_only_mode',
      spec_source: personSpecSource,
      real_person_locked: false,
      production_usable_actor: false,
      person_notes: [],
    } : {
      source: cleanText(personContext.source || (personAsset ? 'selected_real_actor_or_person_asset' : 'person_spec'), 120),
      spec_source: personSpecSource,
      real_person_locked: personContext.real_person_locked === true || personAsset?.real_person_reference === true,
      production_usable_actor: personContext.production_usable_actor === true || personAsset?.production_usable_actor === true,
      person_notes: Array.isArray(personContext.person_notes) ? personContext.person_notes.map(x => cleanText(x, 1000)).filter(Boolean).slice(0, 12) : [],
    },
    user_id: user?.id || user?.userId || '',
    created_at: new Date().toISOString(),
  };
}

function inferSubjectFromBrief(brief = '') {
  const text = cleanText(brief, 300);
  if (!text) return '当前广告主体';
  const m = text.match(/(?:推广|介绍|展示|宣传|卖点|广告|为|给)([^，。；,.!?！？]{2,30})/);
  return cleanText(m?.[1] || text.slice(0, 24), 80) || '当前广告主体';
}

function controlledProductionPrompt(ctrl = {}) {
  if (!ctrl || ctrl.enabled !== true) return 'Advanced production controls: disabled.';
  const env = ctrl.environment_control || {};
  const product = ctrl.product_control || {};
  const style = ctrl.style_control || {};
  const negative = ctrl.negative_control || {};
  const lines = ['Advanced production controls: enabled. These are hard creative constraints for scene config, blueprint, storyboard and keyframes.'];
  if (env.mode && env.mode !== 'auto') lines.push(`Scene direction: ${env.mode}.`);
  if (env.custom) lines.push(`Custom scene requirement: ${env.custom}`);
  if (product.enabled) {
    lines.push(`Product must appear according to shot rules. Presence: ${product.presence || 'medium'}. Lock strength: ${product.lock_strength || 'standard'}.`);
    if (Array.isArray(product.methods) && product.methods.length) {
      lines.push(`Required product presentation methods when suitable: ${product.methods.join(', ')}.`);
    }
  }
  if (style.notes) lines.push(`Visual style direction: ${style.notes}`);
  if (negative.text) lines.push(`Negative visual requirements: ${negative.text}`);
  return lines.join('\n');
}

function sceneAssetsPrompt(sceneAssets = []) {
  const list = Array.isArray(sceneAssets) ? sceneAssets : [];
  if (!list.length) return [
    '场景空间锁：未生成。',
    '如本任务需要空间，必须按当前广告需求和用户设置动态判断，不能套用固定行业、固定场景或历史任务空间。',
  ].join('\n');
  const digest = list.map((asset, index) => ({
    scene_id: cleanText(asset.scene_id || asset.id || `scene_${index + 1}`, 120),
    name: cleanText(asset.name || `任务场景 ${index + 1}`, 120),
    lock_strength: cleanText(asset.lock_strength || 'standard', 40),
    layout_summary: cleanText(asset.layout_summary || '', 500),
    material_summary: cleanText(asset.material_summary || '', 500),
    style_summary: cleanText(asset.style_summary || '', 300),
    scene_revision: Math.max(1, Number(asset.scene_revision || asset.scene_contract?.scene_revision || 1) || 1),
    space_lock_status: cleanText(asset.scene_contract?.space_lock_status || asset.space_lock_status || 'upgrade_required', 40),
    full_space_lock: asset.scene_contract?.full_space_lock === true || asset.full_space_lock === true,
    schema_version: Number(asset.scene_contract?.schema_version || asset.schema_version || 0) || 0,
    layout_contract: asset.scene_contract?.layout_contract || asset.layout_contract || null,
    spatial_coverage_qa: asset.scene_contract?.spatial_coverage_qa || asset.spatial_coverage_qa || null,
    photographic_realism_qa: asset.scene_contract?.photographic_realism_qa || asset.photographic_realism_qa || null,
    camera_design_qa: asset.scene_contract?.camera_design_qa || asset.camera_design_qa || null,
    anchors: (Array.isArray(asset.scene_contract?.anchors) ? asset.scene_contract.anchors : []).map(anchor => ({
      id: cleanText(anchor.id || '', 100),
      label: cleanText(anchor.label || '', 120),
      relative_position: cleanText(anchor.relative_position || '', 180),
    })).slice(0, 16),
    zones: (Array.isArray(asset.scene_contract?.zones) ? asset.scene_contract.zones : []).map(zone => ({
      id: cleanText(zone.id || '', 100),
      label: cleanText(zone.label || '', 120),
      label_zh: cleanText(zone.label_zh || zone.labelZh || '', 120),
      purpose: cleanText(zone.purpose || '', 180),
    })).slice(0, 16),
    views: (Array.isArray(asset.view_images) ? asset.view_images : []).map((view, viewIndex) => ({
      key: cleanText(view?.key || view?.view || ['master', 'reverse', 'interaction', 'detail'][viewIndex] || `view_${viewIndex + 1}`, 40),
      label: cleanText(view?.label || view?.name || '', 80),
    })).slice(0, 8),
  }));
  return [
    '场景空间锁：已生成，后续剧本、分镜和关键帧必须优先使用当前任务 scene_assets。',
    `当前任务场景资产：${JSON.stringify(digest)}`,
    '只有 full_space_lock=true 的场景才允许进入分镜与关键帧生成。俯视/轴测 layout 只用于理解整体拓扑、区域和机位关系，不得直接作为商业镜头构图。',
    '镜头不得发明空间蓝图和已验证商业视图都未覆盖的新房间、通道、入口、墙体、功能区或交互位置。',
    '分镜必须为每镜输出 scene_id、scene_revision、scene_view、camera_id、scene_zone、zone_ids、anchor_ids、transition_from、transition_reason。',
    '单场景任务必须保持同一 scene_id；多场景任务只有在剧情或商业表达需要时才能切换 scene_id，并说明转场原因。',
    '禁止凭空新增当前任务场景资产之外的行业或具体空间。',
  ].join('\n');
}

function propAssetsPrompt(propAssets = []) {
  const list = Array.isArray(propAssets) ? propAssets : [];
  if (!list.length) return '独立道具档案：未提供。不得凭行业模板自动发明无关道具。';
  const digest = list.map(prop => ({
    prop_id: prop.prop_id || prop.id,
    name: prop.name,
    type: prop.type,
    material: prop.material,
    scale: prop.scale,
    owner_id: prop.owner_id,
    scene_id: prop.scene_id,
    placement: prop.placement,
    hand_contact: prop.hand_contact,
    states: prop.contract?.states || prop.states || [],
    shot_timeline: prop.shot_timeline || [],
  }));
  return [
    '独立道具档案：后续剧情、分镜和关键帧只能使用以下已确认道具。',
    JSON.stringify(digest),
    '每镜必须保持道具身份、数量、材质、尺度、归属、接触方式、位置和状态时间线一致。',
  ].join('\n');
}

function referenceVideoAnalysisPrompt(reference = null) {
  if (!reference || reference.status !== 'completed') return '参考视频分析：未提供。';
  const digest = {
    analysis_id: reference.analysis_id,
    generated_brief: reference.generated_brief || '',
    source_facts: reference.source_facts || {},
    analysis_quality: reference.analysis_quality || {},
    story_outline: reference.story_outline || {},
    plot_beats: reference.plot_beats || [],
    reference_understanding: referenceUnderstandingService.contextDigest(reference.reference_understanding),
    character_prompts: reference.character_prompts || [],
    scene_prompts: reference.scene_prompts || [],
    character_actions: reference.character_actions || [],
    animal_actions: reference.animal_actions || [],
    animal_prompts: reference.animal_prompts || [],
    shot_breakdown: reference.shot_breakdown || [],
    camera_intents: reference.camera_intents || [],
    prompt_suggestions: reference.prompt_suggestions || {},
    scene_view_mapping: reference.scene_view_mapping || null,
  };
  return [
    '参考视频内容与原创改写合同：已完成有效分析，以下可见产品、真实空间、核心材质、完整剧情、人物/动物提示词、真实动作、逐镜拆解和机位运镜必须作为场景、剧情与剧本生成的显式参考。',
    `结构化分析：${JSON.stringify(digest)}`,
    '用户当前“广告需求”文本是可编辑权威版本；若用户已经修改了分析成稿，必须以当前广告需求、人物档案、场景配置和已确认资产为准，结构化分析只补充未冲突的细节。',
    '人物提示词只能用于重新设计当前任务的原创角色，禁止复制参考视频人物身份、肖像、原片服装或私密属性。',
    '除非用户明确修改，场景与剧情必须保留 source_facts 中的产品类别、物理空间、材质、布局、人物动作和时间顺序；只能移除未授权品牌标识、水印或身份信息，禁止借“原创改写”把参考内容替换成无证据行业或房间。',
    '后续输出必须让完整剧情、逐角色/动物设定、逐场景设定、人物/动物动作、shot_breakdown 的顺序与时间范围、场景/主体绑定、景别、角度、运镜和时长能够在剧本/分镜字段中被核对，不得只写一句“参考原片风格”。',
  ].join('\n');
}

function contextPrompt(ctx) {
  return [
    `广告需求：${ctx.brief}`,
    `广告主体：${ctx.product_subject}`,
    ctx.product_presentation ? `主体展示方式：${ctx.product_presentation.label || ctx.product_presentation.mode}；${ctx.product_presentation.description || ''}` : '',
    `目标时长：${ctx.target_duration} 秒`,
    `镜头数量：${ctx.shot_count ? `用户指定 ${ctx.shot_count} 镜` : '由用户剧情内容决定'}`,
    `画面比例：${ctx.output_ratio}`,
    `人物/主体模式：${ctx.cast_mode}`,
    ctx.expected_people ? `精确人数：${ctx.expected_people}（必须保持，不得用默认群体数量替代）` : '',
    ctx.expected_animals ? `精确宠物/动物数量：${ctx.expected_animals}（与人物数量独立计数，人物不得替代宠物，宠物不得替代人物）` : '',
    `剧情呈现方式：${ctx.production_mode || 'auto'}（${productionModeDescription(ctx.production_mode)}）。该设置直接约束剧本叙事方式，但不得覆盖已确认人物、主体或场景。`,
    `剧情生成设置：${ctx.story_setup_confirmed === true ? '已在人物与场景形象确认后完成' : '尚未确认'}`,
    ctx.cast_mode === 'no_human'
      ? '角色设定：本任务选择无人物模式，不得强行加入真人、手部、背影或人形主体，除非用户需求另有明确要求。'
      : (ctx.cast_mode === 'animal'
        ? '角色设定：本任务为动物/宠物主体时，按用户需求建立动物主体一致性，不得强行改成人类角色。'
        : (ctx.cast_mode === 'human_pet'
          ? `角色设定：本任务为人物 + 宠物混合主体。人物和宠物是两个独立合同，必须分别保持数量、身份、外观和动作关系；人物设定：${ctx.characters.length ? JSON.stringify(ctx.characters) : '按当前任务建立稳定正式姓名'}。`
          : (ctx.characters.length ? `角色设定：${JSON.stringify(ctx.characters)}` : '角色设定：未指定，生成时如需要人物，必须生成当前任务专属的稳定正式姓名，name 不得写成占位名或“气质美女/客户顾问/展示者”这类描述。'))),
    ctx.pet_contract ? `宠物一致性合同：${JSON.stringify(ctx.pet_contract)}。每镜必须明确 expected_animals 和实际出镜宠物，不得增删、换品种、换毛色或把同一只复制成多只。` : '',
    ctx.assets.length ? `素材：${JSON.stringify(ctx.assets)}` : '素材：无上传素材',
    ctx.brand_overlay?.enabled && ctx.brand_overlay?.authorization_confirmed && (
      ctx.brand_overlay?.asset?.file_url || ctx.brand_overlay?.asset?.image_url || ctx.brand_overlay?.asset?.url
    )
      ? `品牌 Logo：已上传并确认授权。最后一个剧情镜头必须继续使用当前已确认场景，在 ${ctx.brand_overlay.position} 预留无遮挡品牌安全区；视频完整播放后冻结该镜头最后一帧 ${ctx.brand_overlay.end_duration_sec} 秒，并由成片阶段原样叠加授权 Logo。图片和视频模型不得生成、变形或仿制 Logo。`
      : (ctx.brand_overlay?.enabled
        ? '品牌 Logo：素材已上传但尚未确认授权。本轮不得启用品牌结尾、不得改变剧本或分镜构图，也不得要求图片或视频模型生成 Logo；请先确认授权或删除素材。'
        : '品牌 Logo：未上传。本轮必须按普通剧情自然结尾，不预留 Logo 区域、不追加品牌落版，也不得要求图片或视频模型生成 Logo。'),
    ctx.forbidden.length ? `禁止项：${ctx.forbidden.join('、')}` : '禁止项：无',
    ctx.creative_direction && (
      ctx.creative_direction.raw
      || ctx.creative_direction.plot_direction
      || ctx.creative_direction.actions?.length
      || ctx.creative_direction.must_have?.length
      || ctx.creative_direction.must_avoid?.length
    ) ? [
      '用户剧情与表演合同：以下内容只控制故事如何表达，不得覆盖商品、品牌、人物、场景和合规事实。',
      JSON.stringify(ctx.creative_direction),
      'required=true 的动作、表情和台词是硬约束；动作必须绑定当前人物、场景或商品，禁止擅自新增未确认实体。',
    ].join('\n') : '用户剧情与表演合同：未填写，由系统在已确认业务事实和资产范围内创作。',
    benchmarkStrategy.promptBlock(ctx),
    ctx.controlled_production?.enabled ? `高级设置：${JSON.stringify(ctx.controlled_production)}` : '高级设置：未启用',
    controlledProductionPrompt(ctx.controlled_production),
    ctx.person_asset ? `Locked real actor/person asset: ${JSON.stringify(ctx.person_asset)}` : '',
    ctx.cast_profiles?.length ? `Locked cast profiles: ${JSON.stringify(ctx.cast_profiles)}` : '',
    ctx.person_context?.person_notes?.length ? `Person context notes: ${ctx.person_context.person_notes.join('; ')}` : '',
    ctx.person_asset ? `真人/演员素材锁：${JSON.stringify(ctx.person_asset)}` : '',
    ctx.cast_profiles?.length ? `演员档案锁：${JSON.stringify(ctx.cast_profiles)}` : '',
    ctx.person_context?.person_notes?.length ? `人物上下文：${ctx.person_context.person_notes.join('；')}` : '',
    ctx.person_spec && Object.keys(ctx.person_spec).length ? `人物约束：${JSON.stringify(ctx.person_spec)}` : '',
    referenceVideoAnalysisPrompt(ctx.reference_video_analysis),
    propAssetsPrompt(ctx.prop_assets),
    sceneAssetsPrompt(ctx.scene_assets),
    `视频分辨率：${ctx.video_resolution || '1080p'}`,
  ].join('\n');
}

function contextConflicts(ctx = {}) {
  const conflicts = [];
  const forbidden = (Array.isArray(ctx.forbidden) ? ctx.forbidden : []).join('；');
  const negative = String(ctx.controlled_production?.negative_control?.text || '');
  const noPerson = /(?:不能|不要|禁止|不得)出现(?:任何)?(?:人物|真人|演员|人像|人类)|(?:完全)?无人物|无人出镜/.test(`${forbidden}；${negative}`);
  const personRequired = ['single', 'dual', 'multi', 'group', 'human_pet'].includes(String(ctx.cast_mode || ''))
    || (Array.isArray(ctx.characters) && ctx.characters.length > 0)
    || !!ctx.person_asset
    || /(?:人物|真人|演员|老师|顾问|客户|用户|主持人|模特|主角|面对镜头|出镜)/.test(String(ctx.brief || ''));
  if (personRequired && noPerson) {
    conflicts.push('任务要求人物出镜，但全局禁止项同时要求不出现人物');
  }
  const briefDuration = inferBriefTargetDuration(ctx.brief || '');
  const storedDuration = Number(ctx.target_duration || ctx.targetDuration || ctx.duration_sec || ctx.durationSec || ctx.duration || 0) || 0;
  const durationSource = cleanText(ctx.duration_source || ctx.durationSource || '', 40).toLowerCase();
  if (briefDuration && storedDuration && briefDuration !== storedDuration && durationSource !== 'user_selected') {
    conflicts.push(`需求文本明确要求 ${briefDuration} 秒，但任务结构化时长为 ${storedDuration} 秒`);
  }
  const creative = ctx.creative_direction || {};
  const creativeText = [
    creative.raw,
    creative.plot_direction,
    creative.ending,
    creative.dialogue_notes,
    ...(creative.must_have || []),
    ...(creative.must_avoid || []),
    ...(creative.actions || []).flatMap(action => [
      action.actor,
      action.action,
      action.target,
      action.expression,
      action.dialogue,
      ...(action.constraints || []),
    ]),
  ].filter(Boolean).join('；');
  if (String(ctx.cast_mode || '') === 'no_human'
    && /(?:人物|真人|演员|主角|主持人|模特|女孩|男孩|女人|男人|人手|手部|面对镜头说|开口说)/.test(creativeText)) {
    conflicts.push('当前选择无人物模式，但剧情表演要求中包含人物动作、表情或台词');
  }
  const knownActors = new Set([
    ...(ctx.characters || []).flatMap(character => [character.id, character.name]),
    ...(ctx.cast_profiles || []).flatMap(profile => [profile.id, profile.name, profile.actor_asset_id]),
    ...(ctx.pet_profiles || []).flatMap(profile => [profile.id, profile.name]),
    ctx.person_asset?.id,
    ctx.person_asset?.actor_id,
    ctx.person_asset?.name,
  ].filter(Boolean).map(value => String(value).trim().toLowerCase()));
  (creative.actions || []).forEach((action, index) => {
    const actorRef = String(action.actor_id || action.actor || '').trim().toLowerCase();
    if (actorRef && knownActors.size && !knownActors.has(actorRef)) {
      conflicts.push(`第 ${index + 1} 条关键动作引用了未确认人物或宠物“${action.actor_id || action.actor}”`);
    }
  });
  return conflicts;
}

function taskTitle(ctx = {}) {
  return cleanText(ctx.project_name || ctx.product_subject || ctx.brief || '剧情广告任务', 120);
}

function assertContextConsistent(ctx = {}) {
  const conflicts = contextConflicts(ctx);
  if (!conflicts.length) return ctx;
  const error = new Error(`广告需求约束冲突：${conflicts.join('；')}。请修改需求或禁止项后重试。`);
  error.status = 422;
  error.code = 'INPUT_CONSTRAINT_CONFLICT';
  error.conflicts = conflicts;
  throw error;
}

module.exports = {
  assertContextConsistent,
  buildContext,
  contextPrompt,
  referenceVideoAnalysisPrompt,
  normalizeReferenceVideoAnalysis,
  controlledProductionPrompt,
  cleanText,
  normalizeCharacters,
  normalizePetProfiles,
  inferExpectedPeopleCount,
  inferExpectedAnimalCount,
  normalizeCharacter,
  looksLikeDescriptorName,
  normalizeSceneSpec,
  normalizeCreativeDirection,
  normalizeSceneAssets,
  normalizePropAssets,
  normalizeBrandOverlay,
  normalizeProductionMode,
  inferVisibleTextPolicy,
  inferBriefTargetDuration,
  resolveTargetDuration,
  contextConflicts,
  taskTitle,
};
