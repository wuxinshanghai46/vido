import { request } from '../api.js';
import { bindMediaLightbox, emptyState, escapeHtml, mediaPreview, setButtonBusy, toast } from '../components/ui.js?v=20260803-auto-completion-r30';
import { confirmDialog } from '../components/dialog.js';
import { openActorLibrary, openRealPersonFlow } from './assetCenterPersonSources.js?v=20260803-auto-completion-r30';
import { openAssetDrawer } from './assetCenterPlanningDetails.js?v=20260803-auto-completion-r30';

const GROUPS = [
  ['people', '人物'],
  ['animals', '动物'],
  ['products', '商品 / 展示主体'],
  ['logos', 'LOGO'],
  ['scenes', '场景与机位'],
];

const GENERATABLE = new Set(['people', 'animals']);

function groupLabel(group = '') {
  return GROUPS.find(([id]) => id === group)?.[1] || '资产';
}

function hasGeneratedMedia(item = {}) {
  return Boolean(item.dossier_sheet?.image_url
    || (Array.isArray(item.view_images) && item.view_images.length >= 4));
}

function personAssetState(item = {}) {
  if (item.dossier_sheet?.image_url) return 'complete_dossier';
  if (Array.isArray(item.view_images) && item.view_images.length) return 'legacy_views';
  return 'missing';
}

function subjectNeedsGeneration(item = {}, kind = '') {
  return kind === 'human'
    ? personAssetState(item) !== 'complete_dossier'
    : !hasGeneratedMedia(item);
}

function profileList(bundle = {}, key = '') {
  return (bundle.assets?.[key] || []).map(item => item.profile).filter(profile => profile?.id);
}

export function subjectGenerationPayload(bundle = {}, target = null, requestKey = '') {
  const people = bundle.assets?.people || [];
  const animals = bundle.assets?.animals || [];
  const castProfiles = profileList(bundle, 'people');
  const petProfiles = profileList(bundle, 'animals');
  const payload = {
    task_id: bundle.project?.id || '',
    brief: bundle.brief?.text || '',
    expected_people: castProfiles.length,
    expected_animals: petProfiles.length,
    cast_profiles: castProfiles,
    pet_profiles: petProfiles,
    request_key: requestKey,
    person_spec: {
      castMode: bundle.brief?.cast_mode || (castProfiles.length > 1 ? 'group' : (castProfiles.length ? 'single' : 'no_human')),
      expected_people: castProfiles.length,
      expected_animals: petProfiles.length,
    },
  };
  if (target) {
    const group = target.kind === 'animal' ? 'animals' : 'people';
    const source = group === 'animals' ? animals : people;
    const index = Math.max(0, source.findIndex(item => item.asset_id === target.asset_id || item.id === target.id));
    const selected = {
      kind: group === 'animals' ? 'pet' : 'human',
      id: target.subject_id || target.profile?.id || '',
      index,
    };
    const missing = [
      ...people.map((item, subjectIndex) => ({ item, kind: 'human', index: subjectIndex })),
      ...animals.map((item, subjectIndex) => ({ item, kind: 'pet', index: subjectIndex })),
    ].filter(entry => entry.kind === 'human'
      ? personAssetState(entry.item) === 'missing'
      : subjectNeedsGeneration(entry.item, entry.kind))
      .map(entry => ({ kind: entry.kind, id: entry.item.subject_id || entry.item.profile?.id || '', index: entry.index }));
    payload.subject_targets = [selected, ...missing].filter((entry, entryIndex, rows) => (
      entry.id && rows.findIndex(candidate => candidate.kind === entry.kind && candidate.id === entry.id && candidate.index === entry.index) === entryIndex
    ));
    payload.regenerate_selected = true;
  }
  return payload;
}

function generationValidation(payload = {}) {
  if (!payload.brief) return '请先在“目标与材料”填写广告目标。';
  if (!payload.expected_people && !payload.expected_animals) return '当前项目还没有人物或动物档案，请先完善主体资料。';
  if (payload.cast_profiles.length !== payload.expected_people) return `人物档案数量不完整：需要 ${payload.expected_people} 份。`;
  if (payload.pet_profiles.length !== payload.expected_animals) return `动物档案数量不完整：需要 ${payload.expected_animals} 份。`;
  for (const [index, profile] of payload.cast_profiles.entries()) {
    const missing = [['姓名', profile.displayName], ['角色', profile.roleName], ['外貌', profile.appearanceText], ['发型/妆造', profile.hairMakeupText]]
      .filter(([, value]) => !String(value || '').trim()).map(([label]) => label);
    if (missing.length) return `人物 ${index + 1} 缺少：${missing.join('、')}。`;
  }
  for (const [index, profile] of payload.pet_profiles.entries()) {
    if (!String(profile.type || '').trim() || !String(profile.appearance || '').trim()) return `动物 ${index + 1} 缺少类型或外观特征。`;
  }
  return '';
}

function assetCard(item, group) {
  const views = Array.isArray(item.view_images) ? item.view_images.length : 0;
  const personState = group === 'people' ? personAssetState(item) : '';
  const sceneDetail = group === 'scenes' ? [
    item.reference_only ? '未绑定场景参考' : '',
    item.zones?.length ? `${item.zones.length} 个区域` : '',
    item.cameras?.length ? `${item.cameras.length} 个机位` : '',
    views ? `${views} 个视角` : '',
    item.candidate_count ? `${item.candidate_count} 选 1` : '',
    item.shot_refs?.length ? `用于 ${item.shot_refs.length} 个镜头` : '',
  ] : [];
  const productDetail = group === 'products' ? [
    item.presentation?.label,
    item.presentation?.scene_linked ? `关联 ${item.linked_scene_ids?.length || 0} 个场景` : '',
    item.image_url ? '已有独立素材' : '无独立商品图',
  ] : [];
  const detail = (group === 'scenes' ? sceneDetail : (group === 'products' ? productDetail : [
    personState === 'legacy_views' ? '仅历史四视图 · 尚未生成完整档案' : '',
    item.role,
    views ? `${views} 个视图` : '',
    item.revision ? `版本 ${item.revision}` : '',
  ]))
    .filter(Boolean).join(' · ');
  const needsGeneration = group === 'people'
    ? personState !== 'complete_dossier'
    : (GENERATABLE.has(group) && !hasGeneratedMedia(item));
  const needsProductVerification = group === 'products' && Boolean(item.image_url) && item.status !== 'verified';
  const sceneGenerated = group === 'scenes' && Boolean(item.layout?.image_url || item.view_images?.length || item.cameras?.some(camera => camera.image_url));
  return `<article class="asset-card ${GENERATABLE.has(group) ? 'is-subject' : ''} ${group === 'scenes' ? 'is-scene' : ''}">
    <button class="asset-card-preview" type="button" data-asset-group="${group}" data-asset-id="${escapeHtml(item.id)}" aria-label="查看${escapeHtml(item.name)}完整详情">
      ${mediaPreview(item, { label: item.name, width: 720, symbol: groupLabel(group) })}
      <span class="asset-card-copy">
        <span>${escapeHtml(personState === 'legacy_views' ? '历史四视图' : (personState === 'complete_dossier' ? '完整档案' : (item.status || '未确认')))}</span>
        <b>${escapeHtml(item.name)}</b>
        <small>${escapeHtml(detail || '点击查看当前项目中的真实详情')}</small>
      </span>
    </button>
    <div class="asset-card-actions">
      <button class="btn small" type="button" data-asset-group="${group}" data-asset-id="${escapeHtml(item.id)}">${personState === 'legacy_views' ? '查看参考档案' : `查看${item.dossier_sheet?.image_url ? '完整档案' : (group === 'scenes' ? '空间与机位' : '完整视图')}`}</button>
      ${needsGeneration ? `<button class="btn small primary ${personState === 'legacy_views' ? 'complete-dossier-action' : ''}" type="button" data-generate-asset="${escapeHtml(item.id)}" data-generate-group="${group}">生成${group === 'people' ? '完整人物档案' : '该动物资产'}</button>` : ''}
      ${group === 'people' && personState === 'complete_dossier' ? `<button class="btn small" type="button" data-generate-asset="${escapeHtml(item.id)}" data-generate-group="${group}">重生成高清服装与配饰档案</button>` : ''}
      ${group === 'people' && item.status === 'verified' && !item.provider_asset_id ? `<button class="btn small" type="button" data-sync-person-provider="${escapeHtml(item.id)}">同步 / 重试 Seedance 人物 ID</button>` : ''}
      ${group === 'products' ? `<button class="btn small" type="button" data-upload-product="${escapeHtml(item.id)}">${item.image_url ? '更换主体图片' : '上传主体图片'}</button><button class="btn small primary" type="button" data-generate-product="${escapeHtml(item.id)}">${item.presentation?.standalone_generation_supported ? 'AI 生成商品多视图' : 'AI 生成主体参考图'}</button>` : ''}
      ${group === 'scenes' ? `<button class="btn small ${sceneGenerated ? '' : 'primary'}" type="button" data-generate-scene="${escapeHtml(item.id)}">${sceneGenerated ? '重新生成场景与机位' : '生成场景与机位'}</button>` : ''}
      ${needsProductVerification ? `<button class="btn small primary" type="button" data-verify-product="${escapeHtml(item.id)}">验证商品素材</button>` : ''}
    </div>
  </article>`;
}

function mediaSection(title, rows = [], className = '') {
  const items = Array.isArray(rows) ? rows.filter(item => item?.image_url) : [];
  if (!items.length) return '';
  const zoomGroup = `drawer-${String(title).replace(/[^a-z0-9\u4e00-\u9fff]+/ig, '-')}`;
  return `<section class="drawer-media-section"><div class="drawer-section-head"><h3>${escapeHtml(title)}</h3><span>${items.length}</span></div><div class="drawer-media-grid ${className}">${items.map(item => `<figure>${mediaPreview(item, { label: item.label || item.key, width: 720, symbol: item.label || '素材', zoomable: true, zoomGroup })}<figcaption>${escapeHtml(item.label || item.key || '素材')}</figcaption></figure>`).join('')}</div></section>`;
}

function profileDetails(item = {}, group = '') {
  const profile = item.profile || {};
  const rows = group === 'people' ? [
    ['身份 / 关系', profile.roleName || item.role],
    ['年龄范围', profile.age],
    ['外貌与气质', profile.appearanceText],
    ['服装 / 鞋 / 配饰', profile.wardrobeText],
    ['发型 / 妆造', profile.hairMakeupText],
    ['禁止项', profile.negativeText],
  ] : group === 'animals' ? [
    ['类型', profile.type], ['品种', profile.breed], ['外观特征', profile.appearance],
  ] : [];
  if (!rows.length) return '';
  return `<section class="drawer-profile"><h3>${group === 'people' ? '人物设定' : '动物设定'}</h3>${rows.filter(([, value]) => value).map(([label, value]) => `<div><span>${escapeHtml(label)}</span><p>${escapeHtml(value)}</p></div>`).join('')}</section>`;
}

function legacyDossierBoard(item = {}, views = []) {
  const profile = item.profile || {};
  const facts = [
    ['身份 / 关系', profile.roleName || item.role || '待补充'],
    ['年龄范围', profile.age || '待补充'],
    ['形象气质', profile.appearanceText || '沿用现有参考图中的人物形象'],
  ];
  const notes = [
    ['服装与配饰', profile.wardrobeText],
    ['发型与妆造', profile.hairMakeupText],
    ['一致性禁区', profile.negativeText],
  ].filter(([, value]) => value);
  return `<section class="reference-dossier-board" aria-label="${escapeHtml(item.name)}参考档案预览">
    <header><div><span>参考档案预览</span><h3>${escapeHtml(item.name)}</h3></div><p>由当前任务的历史参考图和人物设定整理，不冒充新生成档案。</p></header>
    <div class="reference-dossier-layout">
      <aside class="reference-dossier-facts">${facts.map(([label, value]) => `<div><span>${escapeHtml(label)}</span><p>${escapeHtml(value)}</p></div>`).join('')}</aside>
      <div class="reference-dossier-views">${views.slice(0, 4).map(view => `<figure>${mediaPreview(view, { label: view.label || view.key || item.name, width: 720, symbol: '人物参考', zoomable: true, zoomGroup: `legacy-${item.id || 'person'}` })}<figcaption>${escapeHtml(view.label || view.key || '人物视图')}</figcaption></figure>`).join('')}</div>
      <aside class="reference-dossier-notes">${notes.length ? notes.map(([label, value]) => `<div><span>${escapeHtml(label)}</span><p>${escapeHtml(value)}</p></div>`).join('') : '<div><span>设定说明</span><p>当前任务仅保留历史四视图，可在下方生成新版完整人物档案。</p></div>'}</aside>
    </div>
  </section>`;
}

function dossierDetails(item = {}) {
  const sections = [
    mediaSection('人物分类档案', item.category_atlases),
    mediaSection('身份与形象视图', item.identity_views, 'is-portrait-grid'),
    mediaSection('表情记录', item.expressions, 'is-portrait-grid'),
    mediaSection('剧情动作姿态', item.base_actions, 'is-portrait-grid'),
  ].join('');
  return sections ? `<details class="raw-view-details dossier-atomic-details"><summary>查看单图素材（点击任意图片放大）</summary>${sections}</details>` : '';
}


function personEditForm(item = {}) {
  const profile = item.profile || {};
  const field = (name, label, value, textarea = false) => `<label><span>${label}</span>${textarea
    ? `<textarea name="${name}" rows="3">${escapeHtml(value || '')}</textarea>`
    : `<input name="${name}" value="${escapeHtml(value || '')}">`}</label>`;
  return `<details class="person-edit-panel"><summary>修改人物信息</summary><form data-person-edit>
    <div class="form-grid two">${field('displayName', '人物名称', profile.displayName)}${field('roleName', '身份 / 关系', profile.roleName || item.role)}${field('age', '年龄范围', profile.age)}</div>
    ${field('appearanceText', '外貌与气质', profile.appearanceText, true)}
    ${field('wardrobeText', '服装 / 鞋 / 配饰（可留空或只写明确要求）', profile.wardrobeText, true)}
    <p class="form-hint">生成前会保留你写下的每个要求，并只自动补齐缺少的服装组成、鞋履、配饰、配色和面料。</p>
    ${field('hairMakeupText', '发型 / 妆造', profile.hairMakeupText, true)}
    ${field('negativeText', '禁止项', profile.negativeText, true)}
    <button class="btn primary" type="submit">保存人物信息</button>
  </form></details>`;
}

function openDrawer(item, group, handlers = {}) {
  return openAssetDrawer(item, group, handlers, {
    groupLabel: groupLabel(group), generatable: GENERATABLE.has(group),
    mediaSection, profileDetails, legacyDossierBoard, dossierDetails, personEditForm,
  });
}

function renderSections(assets = {}, total = 0) {
  if (!total) return `<div class="asset-total-empty">${emptyState({
    title: '当前项目还没有可用资产',
    body: '先完善人物或动物档案，也可以上传已有的商品、LOGO、场景和道具参考。',
    action: '添加人物', actionId: 'people',
  })}</div>`;
  const missing = GROUPS.filter(([key]) => !(assets[key] || []).length).map(([, label]) => label);
  return `${missing.length ? `<div class="asset-missing-strip"><span>尚未建立</span><b>${missing.map(escapeHtml).join('、')}</b><small>可通过上方分类进入后添加</small></div>` : ''}
    ${GROUPS.map(([key, label]) => {
      const rows = assets[key] || [];
      return `<section class="asset-section" data-asset-section="${key}" ${rows.length ? '' : 'hidden'}>
        <div class="section-title"><h2>${escapeHtml(label)}</h2><span>${rows.length}</span><button class="btn small" type="button" data-add-asset="${key}">+ 添加${escapeHtml(label)}</button></div>
        <div data-section-body>${rows.length ? `<div class="asset-grid">${rows.map(item => assetCard(item, key)).join('')}</div>` : emptyState({ title: `尚未建立${label}`, body: '可以上传已有参考，或先完善该主体档案。', action: `添加${label}`, actionId: key })}</div>
      </section>`;
    }).join('')}`;
}

export async function mount(host, context) {
  const { store, bundle } = context;
  const assets = bundle?.assets || {};
  const total = GROUPS.reduce((sum, [key]) => sum + (assets[key]?.length || 0), 0);
  const assetPlanReady = bundle?.navigation?.steps?.brief?.completed === true;
  host.innerHTML = `
    <section class="view-head">
      <div><h1>资产中心</h1><p>人物、动物、展示主体、LOGO、场景与机位分别建档；材料墙、展台等空间成果不再冒充独立商品。</p></div>
      <div class="view-actions asset-primary-actions"><button class="btn" type="button" data-select-person>选择已有人物素材</button><button class="btn" type="button" data-upload-real-person>上传真人素材</button><button class="btn" type="button" data-generate-subjects>AI 生成人物 / 动物</button><button class="btn" type="button" data-generate-product-main>${assets.products?.[0]?.presentation?.standalone_generation_supported ? 'AI 生成独立商品' : '添加 / 生成展示主体'}</button><button class="btn primary" type="button" data-build-scenes>建立场景规划</button></div>
    </section>
    <div class="guide">点击人物卡查看完整人物档案、四视图、设定和版本。生成操作只会在确认后提交。</div>
    <div class="tabs"><button class="tab active" type="button" data-asset-filter="all">全部 ${total}</button>${GROUPS.map(([key, label]) => `<button class="tab" type="button" data-asset-filter="${key}">${label} ${assets[key]?.length || 0}</button>`).join('')}</div>
    <input class="hidden-input" hidden type="file" accept="image/png,image/jpeg,image/webp" data-asset-upload-file>
    <div data-asset-sections>${renderSections(assets, total)}</div>
    <section class="step-completion-card ${assetPlanReady ? 'is-ready' : ''}">
      <div><b>${assetPlanReady ? '资产方案已建立' : '正在建立资产方案'}</b><span>${assetPlanReady ? '请核对人物、动物、商品与场景是否符合参考视频；确认后，当前方案会成为剧情室的权威输入。' : '资产规划完成前不会开放剧情室，页面会在后台任务完成后自动更新。'}</span></div>
      <button class="btn primary" type="button" data-confirm-assets ${assetPlanReady ? '' : 'disabled'}>确认资产方案，进入剧情室</button>
    </section>`;

  const generationKeys = new Map();
  const generate = async (target = null, group = '', button = null) => {
    const intent = target?.subject_id || 'all';
    const requestKey = generationKeys.get(intent) || `${bundle.project.id}:${intent}:${globalThis.crypto?.randomUUID?.() || Date.now()}`;
    generationKeys.set(intent, requestKey);
    const payload = subjectGenerationPayload(bundle, target, requestKey);
    const validation = generationValidation(payload);
    if (validation) { toast(validation, 'warning'); return false; }
    const selected = payload.subject_targets?.length || payload.expected_people + payload.expected_animals;
    if (!await confirmDialog(`本次将提交 ${selected} 个缺失或选中的主体生成。系统会先保留用户设定并自动补齐缺少的服装、鞋履、配饰、配色和面料，再调用图片模型；未选且已有四视图的主体会原样保留。`, {
      title: target ? `生成${target.name}的完整资产` : '生成人物 / 动物资产',
      confirmText: '确认开始生成',
    })) return false;
    try {
      setButtonBusy(button, true, '正在生成完整档案…', { elapsed: true });
      await store.runStage('subject-assets', payload);
      toast('人物或动物资产生成已提交，页面顶部会持续显示阶段、百分比和耗时。', 'success');
      generationKeys.delete(intent);
      return true;
    } catch (error) {
      toast(error.message, 'danger');
      return false;
    } finally {
      setButtonBusy(button, false);
    }
  };

  const generateProduct = async (item = null, button = null) => {
    const name = item?.name || bundle.brief?.product_subject || '';
    if (!name) return toast('请先在目标与材料中填写商品或广告主体。', 'warning');
    const standalone = item?.presentation?.standalone_generation_supported !== false;
    const body = standalone
      ? `将为“${name}”生成正面、三分之四、侧面和细节视图。完成后仍需进行商品一致性验证。`
      : `将为“${name}”生成一张可复用的展示主体参考图，用于后续场景、分镜和关键帧锁定。它不会伪装成独立商品四视图。`;
    if (!await confirmDialog(body, { title: standalone ? 'AI 生成商品资产' : 'AI 生成展示主体参考图', confirmText: '确认生成' })) return false;
    try {
      setButtonBusy(button, true, '正在提交商品生成…', { elapsed: true });
      await store.runStage('product-assets', { product_name: name, description: item?.description || '', reference_only: !standalone });
      toast(`${standalone ? '商品资产' : '展示主体参考图'}生成已提交，进度和耗时将在页面顶部显示。`, 'success');
      return true;
    } catch (error) { toast(error.message, 'danger'); return false; } finally { setButtonBusy(button, false); }
  };

  const generateScene = async (item, button = null) => {
    const sceneGenerated = Boolean(item.layout?.image_url || item.view_images?.length || item.cameras?.some(camera => camera.image_url));
    const prompt = sceneGenerated
      ? `“${item.name}”已有空间母版和机位。系统会保留用户填写的场景设定，只补齐缺少的布局关系、材质、光线、互动点和行动路线；重新生成会建立新版本，并使不兼容的旧结果按依赖关系失效。`
      : `将先保留用户填写的场景设定并自动补齐布局关系、材质、光线、互动点和行动路线，再生成“${item.name}”的空间母版、场景视角和机位图。`;
    if (!await confirmDialog(prompt, { title: sceneGenerated ? '重新生成场景与机位' : '生成场景与机位', confirmText: sceneGenerated ? '确认重新生成' : '确认生成' })) return false;
    try {
      setButtonBusy(button, true, '正在提交场景生成…', { elapsed: true });
      await store.runStage('scene-assets', { space_id: item.id, scene_id: item.id, name: item.name, regenerate: sceneGenerated });
      toast(`${sceneGenerated ? '场景与机位重新生成' : '场景与机位生成'}已提交，进度和耗时将在页面顶部显示。`, 'success');
      return true;
    } catch (error) { toast(error.message, 'danger'); return false; } finally { setButtonBusy(button, false); }
  };

  const savePerson = async (item, values, button = null) => {
    const profiles = (assets.people || []).map(row => row.profile || {}).map(profile => (
      String(profile.id || '') === String(item.profile?.id || '') ? { ...profile, ...values } : profile
    ));
    try {
      setButtonBusy(button, true, '正在保存…', { elapsed: true });
      await store.updateRequest({ cast_profiles: profiles });
      toast('人物信息已保存；下次生成会使用最新设定。', 'success');
      return true;
    } catch (error) { toast(error.message, 'danger'); return false; } finally { setButtonBusy(button, false); }
  };

  const saveProduct = async (item, values, button = null) => {
    try {
      setButtonBusy(button, true, '正在保存…', { elapsed: true });
      await store.updateRequest({
        product_subject: String(values.product_subject || '').trim(),
        product_presentation: {
          ...(item.presentation || {}),
          mode: String(values.mode || '').trim(),
          description: String(values.description || '').trim(),
          source: 'user_edit',
        },
      });
      toast('展示主体已保存；后续场景、剧情和分镜会使用最新设置。', 'success');
      return true;
    } catch (error) { toast(error.message, 'danger'); return false; } finally { setButtonBusy(button, false); }
  };

  const saveScene = async (item, values, button = null) => {
    const sourcePlan = bundle.asset_editor?.scene_plan || { scene_mode: 'single', spaces: [] };
    const plan = JSON.parse(JSON.stringify(sourcePlan));
    const index = (plan.spaces || []).findIndex(space => String(space.id || space.space_id || space.scene_id) === String(item.id));
    if (index < 0) return toast('当前场景不在权威场景计划中，已停止保存，避免覆盖其他场景。', 'danger');
    const current = plan.spaces[index];
    const currentSpec = current.scene_spec || current.sceneSpec || {};
    const cameraSource = item.camera_plan?.length ? item.camera_plan : (item.cameras || []);
    plan.spaces[index] = {
      ...current,
      name: String(values.name || '').trim(),
      description: String(values.description || '').trim(),
      story_purpose: String(values.story_purpose || '').trim(),
      scene_spec: {
        ...currentSpec,
        layoutText: String(values.layout || '').trim(),
        materialLightText: String(values.materials || '').trim(),
        interactionText: String(values.interaction || '').trim(),
        negativeText: String(values.negative || '').trim(),
        cameraPlan: cameraSource.map((camera, cameraIndex) => ({
          ...camera,
          movement: String(values[`camera_movement_${cameraIndex}`] || camera.movement || '').trim(),
        })),
      },
    };
    try {
      setButtonBusy(button, true, '正在保存…', { elapsed: true });
      await store.updateRequest({ scene_plan: plan, changed_domains: ['scene'] });
      toast('场景与机位预案已保存；不兼容的旧场景和下游结果已按版本规则处理。', 'success');
      return true;
    } catch (error) { toast(error.message, 'danger'); return false; } finally { setButtonBusy(button, false); }
  };

  const generateProp = async (owner, prop, button = null, referenceFile = null) => {
    const input = { ...prop };
    if (!String(input.name || '').trim() || !String(input.description || '').trim()) return toast('请填写道具名称和外观描述。', 'warning');
    if (!await confirmDialog(`道具“${input.name}”会绑定到人物“${owner.name}”，生成身份视图和必要状态图。`, { title: '生成人物随身道具', confirmText: '确认生成' })) return false;
    try {
      setButtonBusy(button, true, '正在提交道具生成…', { elapsed: true });
      if (referenceFile instanceof File && referenceFile.size) {
        const uploaded = await store.upload(referenceFile, 'prop_reference');
        const media = uploaded.asset || uploaded.data || {};
        input.reference_image_url = media.image_url || media.url || media.file_url || '';
      }
      await store.runStage('prop-assets', {
        ...input,
        id: input.id || `prop_${Date.now()}`,
        owner_id: owner.subject_id || owner.profile?.id || owner.id,
        type: input.type || 'handheld', quantity: Number(input.quantity || 1) || 1,
      });
      toast('人物随身道具生成已提交，进度和耗时将在页面顶部显示。', 'success');
      return true;
    } catch (error) { toast(error.message, 'danger'); return false; } finally { setButtonBusy(button, false); }
  };

  const verifyProduct = async (item, button = null) => {
    if (!item?.image_url) {
      toast('请先添加商品图片素材。', 'warning');
      return false;
    }
    if (!await confirmDialog('商品验证会调用一次视觉审核模型，检查外观、形状、颜色和材质一致性；确认后才会提交。', {
      title: `验证商品素材：${item.name || '当前商品'}`,
      confirmText: '确认开始验证',
    })) return false;
    try {
      setButtonBusy(button, true, '正在验证…', { elapsed: true });
      const data = await request(`/api/new-story-ad/tasks/${encodeURIComponent(bundle.project.id)}/product-verify`, {
        method: 'POST',
        body: {},
        timeoutMs: 360000,
      });
      const status = data.product_contract?.status || '';
      if (status !== 'verified') {
        toast(status === 'rejected' ? '商品素材未通过一致性验证，请查看原因或更换图片。' : '商品验证暂未完成，请稍后重试。', 'warning');
        await context.refreshShell();
        return false;
      }
      toast('商品素材已通过一致性验证。', 'success');
      await context.refreshShell();
      return true;
    } catch (error) {
      toast(error.message, 'danger');
      return false;
    } finally {
      setButtonBusy(button, false);
    }
  };

  host.querySelectorAll('[data-asset-filter]').forEach(button => button.addEventListener('click', () => {
    const filter = button.dataset.assetFilter;
    host.querySelectorAll('[data-asset-filter]').forEach(item => item.classList.toggle('active', item === button));
    host.querySelector('.asset-missing-strip')?.toggleAttribute('hidden', filter !== 'all');
    host.querySelectorAll('[data-asset-section]').forEach(section => {
      const rows = assets[section.dataset.assetSection] || [];
      section.hidden = filter === 'all' ? !rows.length : section.dataset.assetSection !== filter;
    });
  }));

  const showAsset = button => {
    const group = button.dataset.assetGroup;
    const item = (assets[group] || []).find(asset => String(asset.id) === button.dataset.assetId);
    if (item) openDrawer(item, group, { onGenerate: generate, onVerifyProduct: verifyProduct, onSavePerson: savePerson, onSaveProduct: saveProduct, onSaveScene: saveScene, onGenerateScene: generateScene, onGenerateProp: generateProp, onGenerateProduct: generateProduct, onUploadProduct: () => openUpload('products') });
  };
  host.querySelectorAll('[data-asset-id]').forEach(button => button.addEventListener('click', () => showAsset(button)));
  host.querySelectorAll('[data-generate-asset]').forEach(button => button.addEventListener('click', event => {
    event.stopPropagation();
    const item = (assets[button.dataset.generateGroup] || []).find(asset => String(asset.id) === button.dataset.generateAsset);
    if (item) generate(item, button.dataset.generateGroup, button);
  }));
  host.querySelectorAll('[data-verify-product]').forEach(button => button.addEventListener('click', event => {
    event.stopPropagation();
    const item = (assets.products || []).find(asset => String(asset.id) === button.dataset.verifyProduct);
    if (item) verifyProduct(item, button);
  }));
  host.querySelectorAll('[data-generate-product]').forEach(button => button.addEventListener('click', event => {
    event.stopPropagation();
    const item = (assets.products || []).find(asset => String(asset.id) === button.dataset.generateProduct);
    generateProduct(item, button);
  }));
  host.querySelectorAll('[data-upload-product]').forEach(button => button.addEventListener('click', event => {
    event.stopPropagation();
    openUpload('products');
  }));
  host.querySelectorAll('[data-generate-scene]').forEach(button => button.addEventListener('click', event => {
    event.stopPropagation();
    const item = (assets.scenes || []).find(asset => String(asset.id) === button.dataset.generateScene);
    if (item) generateScene(item, button);
  }));
  host.querySelectorAll('[data-sync-person-provider]').forEach(button => button.addEventListener('click', async event => {
    event.stopPropagation();
    try {
      setButtonBusy(button, true, '正在提交同步…', { elapsed: true });
      await store.runStage('person-provider-sync');
      toast('Seedance 人物 ID 同步已提交；失败时可继续从该按钮单独重试，不会重新生成人物。', 'success');
    } catch (error) { toast(error.message, 'danger'); } finally { setButtonBusy(button, false); }
  }));

  let uploadGroup = '';
  const uploadInput = host.querySelector('[data-asset-upload-file]');
  const openUpload = group => {
    if (group === 'people') { openRealPersonFlow({ context, taskId: bundle.project.id }); return; }
    uploadGroup = group;
    uploadInput.click();
  };
  host.querySelectorAll('[data-add-asset]').forEach(button => button.addEventListener('click', () => openUpload(button.dataset.addAsset)));
  host.querySelectorAll('[data-empty-action]').forEach(button => button.addEventListener('click', () => openUpload(button.dataset.emptyAction)));
  uploadInput.addEventListener('change', async () => {
    const file = uploadInput.files?.[0];
    if (!file || !uploadGroup) return;
    try {
      const roleMap = { people: 'person_reference', animals: 'animal_reference', products: 'product_reference', logos: 'brand_logo', scenes: 'scene_reference', props: 'prop_reference' };
      const uploaded = await store.upload(file, roleMap[uploadGroup] || 'asset');
      const asset = uploaded.asset || uploaded.data;
      const materialRoles = { people: 'person', animals: 'animal', products: 'product', logos: 'logo', scenes: 'scene', props: 'prop' };
      await store.attachMaterial(materialRoles[uploadGroup], asset, { authorized: uploadGroup === 'logos' });
      toast('资产已添加到当前项目。', 'success');
      await context.refreshShell();
    } catch (error) { toast(error.message, 'danger'); } finally { uploadInput.value = ''; }
  });

  host.querySelector('[data-generate-subjects]').addEventListener('click', event => generate(null, '', event.currentTarget));
  host.querySelector('[data-select-person]').addEventListener('click', () => openActorLibrary({ store, context, taskId: bundle.project.id }));
  host.querySelector('[data-upload-real-person]').addEventListener('click', () => openRealPersonFlow({ context, taskId: bundle.project.id }));
  host.querySelector('[data-generate-product-main]').addEventListener('click', event => {
    const item = (assets.products || [])[0] || null;
    if (item && !item.presentation?.standalone_generation_supported) {
      openDrawer(item, 'products', { onGenerate: generate, onVerifyProduct: verifyProduct, onSavePerson: savePerson, onSaveProduct: saveProduct, onSaveScene: saveScene, onGenerateScene: generateScene, onGenerateProp: generateProp, onGenerateProduct: generateProduct, onUploadProduct: () => openUpload('products') });
      return;
    }
    generateProduct(item, event.currentTarget);
  });
  host.querySelector('[data-build-scenes]').addEventListener('click', async event => {
    const button = event.currentTarget;
    try {
      setButtonBusy(button, true, '正在建立…', { elapsed: true });
      await store.runStage('scene-config');
      toast('场景规划已提交，请稍后查看状态。', 'success');
      await context.refreshShell();
    } catch (error) { toast(error.message, 'danger'); } finally { setButtonBusy(button, false); }
  });
  host.querySelector('[data-confirm-assets]')?.addEventListener('click', async event => {
    const button = event.currentTarget;
    try {
      setButtonBusy(button, true, '正在确认…');
      await store.updateRequest({ asset_setup_confirmed: true });
      toast('资产方案已确认，剧情室将使用当前人物、动物、商品和场景。', 'success');
      context.navigate(`/story-ad/projects/${encodeURIComponent(bundle.project.id)}?view=plot`);
    } catch (error) {
      toast(error.message, 'danger');
      setButtonBusy(button, false);
    }
  });
}
