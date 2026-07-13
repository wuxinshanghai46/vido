const { v4: uuidv4 } = require('uuid');

function cleanText(value = '', max = 2000) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
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

function inferCastMode({ castMode = '', characters = [], brief = '' } = {}) {
  const explicit = cleanText(castMode, 40);
  if (/no_human|none|无人物|无人|只拍主体|只拍产品|只拍空间/i.test(explicit)) return 'no_human';
  if (/animal|pet|动物|宠物/i.test(explicit)) return 'animal';
  if (/multi|多人|三人|群像|团队/i.test(explicit)) return 'multi';
  if (/dual|双人|两人/i.test(explicit)) return 'dual';
  if (/single|单人|一人/i.test(explicit)) return 'single';
  const text = `${brief} ${characters.map(c => `${c.name}${c.role}`).join(' ')}`;
  if (/无人|无人物|不出现人|不要人物|只拍产品|只拍空间|纯产品|纯空间/.test(text)) return 'no_human';
  if (/动物|宠物|萌宠/.test(text)) return 'animal';
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

function normalizeSceneAssets(input) {
  const raw = Array.isArray(input) ? input : [];
  return raw.map((item, idx) => {
    if (!item || typeof item !== 'object') return null;
    const viewImages = Array.isArray(item.view_images) ? item.view_images.map((view, viewIdx) => ({
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
      style_summary: cleanText(item.style_summary || item.styleSummary || '', 800),
      negative: cleanText(item.negative || item.negative_prompt || '', 800),
      image_url: imageUrl,
      view_images: viewImages,
      view_count: Number(item.view_count || viewImages.length || (imageUrl ? 1 : 0)) || 0,
      scene_revision: Math.max(1, Number(item.scene_revision || item.sceneRevision || 1) || 1),
      scene_contract: item.scene_contract && typeof item.scene_contract === 'object' ? item.scene_contract : null,
      cross_view_qa: item.cross_view_qa && typeof item.cross_view_qa === 'object' ? item.cross_view_qa : null,
      provider_used: cleanText(item.provider_used || '', 240),
    };
  }).filter(Boolean);
}

function normalizeSceneSpec(input = {}) {
  const raw = input && typeof input === 'object' ? input : {};
  return {
    mode: cleanText(raw.mode || raw.sceneMode || 'auto', 40),
    layoutText: cleanText(raw.layoutText || raw.layout_text || raw.layout || '', 600),
    materialLightText: cleanText(raw.materialLightText || raw.material_light_text || raw.material || raw.light || '', 600),
    interactionText: cleanText(raw.interactionText || raw.interaction_text || raw.interaction || raw.camera || '', 500),
    negativeText: cleanText(raw.negativeText || raw.negative_text || raw.negative || '', 500),
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
    extra_image_urls: Array.isArray(input.extra_image_urls) ? input.extra_image_urls.map(x => cleanText(x, 1000)).filter(Boolean).slice(0, 8) : [],
    view_images: Array.isArray(input.view_images) ? input.view_images.map(view => ({
      key: cleanText(view?.key || view?.view || view?.type || '', 40),
      label: cleanText(view?.label || view?.name || '', 80),
      url: cleanText(view?.url || view?.image_url || view?.imageUrl || '', 1000),
      image_url: cleanText(view?.image_url || view?.url || view?.imageUrl || '', 1000),
    })).filter(view => view.url || view.image_url).slice(0, 8) : [],
    person_revision: Math.max(1, Number(input.person_revision || input.personRevision || input.person_contract?.person_revision || 1) || 1),
    person_contract: input.person_contract && typeof input.person_contract === 'object' ? input.person_contract : null,
    cast_assets: Array.isArray(input.cast_assets) ? input.cast_assets.map((member, idx) => ({
      cast_member_index: Number(member?.cast_member_index || member?.index || idx + 1) || idx + 1,
      cast_role: cleanText(member?.cast_role || member?.role || member?.name || `角色${idx + 1}`, 80),
      name: cleanText(member?.name || member?.cast_role || `角色${idx + 1}`, 80),
      image_url: cleanText(member?.image_url || member?.url || '', 1000),
      extra_image_urls: Array.isArray(member?.extra_image_urls) ? member.extra_image_urls.map(x => cleanText(x, 1000)).filter(Boolean).slice(0, 6) : [],
    })).filter(member => member.image_url || member.name).slice(0, 8) : [],
    description: cleanText(input.description || input.spec_description || '', 1000),
  };
}

function normalizeCastProfiles(input) {
  const raw = Array.isArray(input) ? input : [];
  return raw.map((profile, idx) => {
    if (!profile || typeof profile !== 'object') return null;
    return {
      id: cleanText(profile.id || `cast_${idx + 1}`, 80),
      name: cleanText(profile.name || profile.displayName || profile.roleName || `角色${idx + 1}`, 120),
      displayName: cleanText(profile.displayName || profile.name || '', 120),
      roleName: cleanText(profile.roleName || profile.role || '', 120),
      sourceType: cleanText(profile.sourceType || profile.reference_kind || '', 80),
      assetId: cleanText(profile.assetId || profile.actor_asset_id || profile.id || '', 120),
      actor_asset_id: cleanText(profile.actor_asset_id || '', 120),
      actor_id: cleanText(profile.actor_id || '', 120),
      referenceImageUrl: cleanText(profile.referenceImageUrl || profile.image_url || profile.url || '', 1000),
      image_url: cleanText(profile.image_url || profile.referenceImageUrl || profile.url || '', 1000),
      extra_image_urls: Array.isArray(profile.extra_image_urls) ? profile.extra_image_urls.map(x => cleanText(x, 1000)).filter(Boolean).slice(0, 8) : [],
      appearance: profile.appearance && typeof profile.appearance === 'object' ? profile.appearance : {},
      wardrobe: profile.wardrobe && typeof profile.wardrobe === 'object' ? profile.wardrobe : {},
      hairMakeup: profile.hairMakeup && typeof profile.hairMakeup === 'object' ? profile.hairMakeup : {},
      outfit: cleanText(profile.outfit || '', 500),
      negativeText: cleanText(profile.negativeText || '', 500),
      description: cleanText(profile.description || '', 1000),
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

function buildContext(body = {}, user = {}) {
  const brief = cleanText(body.brief || body.content || body.requirement || body.prompt, 3000);
  const productSubject = cleanText(body.product_subject || body.productSubject || body.subject || body.product_name || body.productName || '', 200);
  const requestId = cleanText(body.request_id || body.requestId || uuidv4(), 80);
  const characters = normalizeCharacters(body.characters || body.cast || body.people, `${requestId}|${brief}|${productSubject}`);
  const assets = normalizeAssets(body.assets || body.references || body.images);
  const targetDuration = Math.max(10, Math.min(120, Number(body.duration || body.target_duration || body.targetDuration || 30) || 30));
  const rawShotCount = Number(body.shot_count || body.shotCount || 0) || 0;
  const shotCount = rawShotCount > 0 ? Math.max(1, Math.min(18, rawShotCount)) : 0;
  const outputRatio = cleanText(body.output_ratio || body.outputRatio || body.ratio || '9:16', 20);
  const forbidden = Array.isArray(body.forbidden)
    ? body.forbidden.map(x => cleanText(x, 100)).filter(Boolean)
    : cleanText(body.forbidden || body.negative || '', 500).split(/[，,;\n]/).map(x => cleanText(x, 100)).filter(Boolean);
  const castMode = inferCastMode({ castMode: body.cast_mode || body.castMode, characters, brief });
  const expectedPeopleRaw = Number(body.expected_people || body.expectedPeople || body.person_count || body.personCount || 0) || 0;
  const controlledProduction = normalizeControlledProduction(body.controlled_production || body.controlledProduction);
  const personSpec = body.person_spec && typeof body.person_spec === 'object' ? body.person_spec : {};
  const personAsset = normalizePersonAsset(body.person_asset || body.personAsset);
  const sceneAssets = normalizeSceneAssets(body.scene_assets || body.sceneAssets);
  const sceneSpec = normalizeSceneSpec(body.scene_spec || body.sceneSpec);
  const castProfiles = normalizeCastProfiles(body.cast_profiles || body.castProfiles);
  const personContext = body.person_context && typeof body.person_context === 'object' ? body.person_context : {};
  return {
    request_id: requestId,
    brief,
    product_subject: productSubject || inferSubjectFromBrief(brief),
    target_duration: targetDuration,
    shot_count: shotCount,
    output_ratio: outputRatio,
    video_resolution: cleanText(body.video_resolution || body.videoResolution || '720p', 20),
    production_mode: normalizeProductionMode(body.production_mode || body.productionMode || 'auto'),
    cast_mode: castMode,
    expected_people: expectedPeopleRaw > 0 ? Math.max(1, Math.min(12, Math.round(expectedPeopleRaw))) : 0,
    characters,
    assets,
    forbidden,
    controlled_production: controlledProduction,
    person_spec: personSpec,
    person_asset: personAsset,
    person_contract: body.person_contract && typeof body.person_contract === 'object'
      ? body.person_contract
      : (personAsset?.person_contract || null),
    product_contract: body.product_contract && typeof body.product_contract === 'object' ? body.product_contract : null,
    scene_spec: sceneSpec,
    scene_assets: sceneAssets,
    revisions: body.revisions && typeof body.revisions === 'object' ? {
      source: Math.max(1, Number(body.revisions.source || 1) || 1),
      scene: Math.max(1, Number(body.revisions.scene || 1) || 1),
      person: Math.max(1, Number(body.revisions.person || 1) || 1),
      product: Math.max(1, Number(body.revisions.product || 1) || 1),
    } : { source: 1, scene: 1, person: 1, product: 1 },
    cast_profiles: castProfiles,
    person_context: {
      source: cleanText(personContext.source || (personAsset ? 'selected_real_actor_or_person_asset' : 'person_spec'), 120),
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
    anchors: (Array.isArray(asset.scene_contract?.anchors) ? asset.scene_contract.anchors : []).map(anchor => ({
      id: cleanText(anchor.id || '', 100),
      label: cleanText(anchor.label || '', 120),
      relative_position: cleanText(anchor.relative_position || '', 180),
    })).slice(0, 16),
    zones: (Array.isArray(asset.scene_contract?.zones) ? asset.scene_contract.zones : []).map(zone => ({
      id: cleanText(zone.id || '', 100),
      label: cleanText(zone.label || '', 120),
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
    '分镜必须为每镜输出 scene_id、scene_revision、scene_view、camera_id、scene_zone、zone_ids、anchor_ids、transition_from、transition_reason。',
    '单场景任务必须保持同一 scene_id；多场景任务只有在剧情或商业表达需要时才能切换 scene_id，并说明转场原因。',
    '禁止凭空新增当前任务场景资产之外的行业或具体空间。',
  ].join('\n');
}

function contextPrompt(ctx) {
  return [
    `广告需求：${ctx.brief}`,
    `广告主体：${ctx.product_subject}`,
    `目标时长：${ctx.target_duration} 秒`,
    `镜头数量：${ctx.shot_count ? `用户指定 ${ctx.shot_count} 镜` : '由用户剧情内容决定'}`,
    `画面比例：${ctx.output_ratio}`,
    `人物/主体模式：${ctx.cast_mode}`,
    ctx.expected_people ? `精确人数：${ctx.expected_people}（必须保持，不得用默认群体数量替代）` : '',
    `生产模式：${ctx.production_mode || 'auto'}（只控制当前任务的制作与 QA 策略，不是行业或场景模板）`,
    ctx.cast_mode === 'no_human'
      ? '角色设定：本任务选择无人物模式，不得强行加入真人、手部、背影或人形主体，除非用户需求另有明确要求。'
      : (ctx.cast_mode === 'animal'
        ? '角色设定：本任务为动物/宠物主体时，按用户需求建立动物主体一致性，不得强行改成人类角色。'
        : (ctx.characters.length ? `角色设定：${JSON.stringify(ctx.characters)}` : '角色设定：未指定，生成时如需要人物，必须生成当前任务专属的稳定正式姓名，name 不得写成占位名或“气质美女/客户顾问/展示者”这类描述。')),
    ctx.assets.length ? `素材：${JSON.stringify(ctx.assets)}` : '素材：无上传素材',
    ctx.forbidden.length ? `禁止项：${ctx.forbidden.join('、')}` : '禁止项：无',
    ctx.controlled_production?.enabled ? `高级设置：${JSON.stringify(ctx.controlled_production)}` : '高级设置：未启用',
    controlledProductionPrompt(ctx.controlled_production),
    ctx.person_asset ? `Locked real actor/person asset: ${JSON.stringify(ctx.person_asset)}` : '',
    ctx.cast_profiles?.length ? `Locked cast profiles: ${JSON.stringify(ctx.cast_profiles)}` : '',
    ctx.person_context?.person_notes?.length ? `Person context notes: ${ctx.person_context.person_notes.join('; ')}` : '',
    ctx.person_asset ? `真人/演员素材锁：${JSON.stringify(ctx.person_asset)}` : '',
    ctx.cast_profiles?.length ? `演员档案锁：${JSON.stringify(ctx.cast_profiles)}` : '',
    ctx.person_context?.person_notes?.length ? `人物上下文：${ctx.person_context.person_notes.join('；')}` : '',
    ctx.person_spec && Object.keys(ctx.person_spec).length ? `人物约束：${JSON.stringify(ctx.person_spec)}` : '',
    sceneAssetsPrompt(ctx.scene_assets),
    `视频分辨率：${ctx.video_resolution || '720p'}`,
  ].join('\n');
}

function contextConflicts(ctx = {}) {
  const conflicts = [];
  const forbidden = (Array.isArray(ctx.forbidden) ? ctx.forbidden : []).join('；');
  const negative = String(ctx.controlled_production?.negative_control?.text || '');
  const noPerson = /(?:不能|不要|禁止|不得)出现(?:任何)?(?:人物|真人|演员|人像|人类)|(?:完全)?无人物|无人出镜/.test(`${forbidden}；${negative}`);
  const personRequired = ['single', 'dual', 'multi', 'group'].includes(String(ctx.cast_mode || ''))
    || (Array.isArray(ctx.characters) && ctx.characters.length > 0)
    || !!ctx.person_asset
    || /(?:人物|真人|演员|老师|顾问|客户|用户|主持人|模特|主角|面对镜头|出镜)/.test(String(ctx.brief || ''));
  if (personRequired && noPerson) {
    conflicts.push('任务要求人物出镜，但全局禁止项同时要求不出现人物');
  }
  return conflicts;
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
  controlledProductionPrompt,
  cleanText,
  normalizeCharacters,
  normalizeCharacter,
  looksLikeDescriptorName,
  normalizeSceneSpec,
  normalizeSceneAssets,
  normalizeProductionMode,
  contextConflicts,
};
