import { request } from '../api.js?v=20260901-production-v363';
import { emptyState, escapeHtml, setButtonBusy, toast } from '../components/ui.js?v=20260901-production-v363';
import { bindMediaLightbox } from './mediaLightbox.js?v=20260901-production-v363';
import { confirmDialog } from '../components/dialog.js?v=20260901-production-v363';
import { openActorLibrary, openRealPersonFlow } from './assetCenterPersonSources.js?v=20260901-production-v363';
import { ensureSubjectRecoveryReady, recoveryRequestKey } from './assetCenterBillingRetry.js?v=20260901-production-v363';
import { renderPersonLookTiles } from './assetCenterPersonLooks.js?v=20260901-production-v363';
import { mediaSection } from './assetCenterDossierSections.js?v=20260901-production-v363';
import { assetCardMedia } from './sceneDossierCard.js?v=20260901-production-v363';
import { assertSavedPerson, personAgeDisplay, personAssetState, personLookSummary } from './assetCenterPersonState.js?v=20260901-production-v363';
import { renderPersonEvolutionSummary } from './assetCenterPersonEvolution.js?v=20260901-production-v363';
import { createKeyedRequestGuard } from './assetCenterRequestGuard.js?v=20260901-production-v363';
import { checkpointRecoverySummary } from './assetCheckpointRecovery.js?v=20260901-production-v363';
import { bindGenerationModelPicker, loadGenerationModelPicker } from './generationModelPicker.js?v=20260901-production-v363';
if (typeof document !== 'undefined' && !document.getElementById('person-dossier-style')) {
  const style = document.createElement('link');
  style.id = 'person-dossier-style';
  style.rel = 'stylesheet';
  style.href = '/story-ad/person-dossier.css?v=20260901-production-v363';
  document.head.append(style);
}
const GROUPS = [['people', '人物'], ['animals', '动物'], ['products', '商品 / 展示主体'], ['logos', 'LOGO']];
const GENERATABLE = new Set(['people', 'animals']);
const loadAssetCenterStage = globalThis.__loadAssetCenterStage || (() => import('./assetCenterStageView.js?v=20260901-production-v363'));
function groupLabel(group = '') {
  return GROUPS.find(([id]) => id === group)?.[1] || '资产';
}
function hasGeneratedMedia(item = {}) {
  return Boolean(item.dossier_sheet?.image_url
    || (Array.isArray(item.view_images) && item.view_images.length >= 4));
}
export function materialReferenceState(item = {}) {
  const materialSurface = item.presentation?.mode === 'material_surface'
    || item.presentation?.standalone_generation_supported === false;
  const source = String(item.source || item.source_type || item.provenance?.source || '').toLowerCase();
  const generatedNeutral = materialSurface && (item.reference_only === true
    || source === 'new_story_ad_subject_reference_generator');
  const realSample = materialSurface && Boolean(item.image_url) && !generatedNeutral
    && (item.user_owned === true || item.ownership?.user_owned === true || /(?:^|_)(?:upload|uploaded|user_owned|user_reference)(?:_|$)/.test(source));
  const sourcePending = materialSurface && Boolean(item.image_url) && !generatedNeutral && !realSample;
  return {
    materialSurface, generatedNeutral, realSample, sourcePending,
    canContinue: materialSurface,
    message: !materialSurface ? '' : (realSample
      ? '已有真实材料样片，可用于核对材质外观。'
      : (generatedNeutral
        ? '已有中性参考图，可以继续；它不能替代真实样片，也不能证明专有纹理。'
        : (sourcePending
          ? '已有材料图片但来源待确认，可以继续；确认来源前不能证明专有纹理。'
          : '缺少真实材料样片，可以继续；但不能证明专有纹理、型号或真实触感。'))),
  };
}

export async function submitProductGeneration({ item = {}, bundle = {}, store = {}, confirmAction = confirmDialog, imageModel = '' } = {}) {
  const name = item?.name || bundle.brief?.product_subject || '';
  if (!name) return { submitted: false, reason: 'missing_name' };
  const standalone = item?.presentation?.standalone_generation_supported !== false;
  if (!standalone) {
    const accepted = await confirmAction('生成中性参考图会调用 1 次图片模型，可能产生费用。它只用于构图和展示理解，不能替代真实材料样片，也不能证明专有纹理。是否继续？', {
      title: `生成中性参考图：${name}`,
      confirmText: '确认生成 1 张',
    });
    if (!accepted) return { submitted: false, cancelled: true, standalone };
  }
  await store.runStage('product-assets', { product_name: name, description: item?.description || '', reference_only: !standalone, image_model: imageModel });
  return { submitted: true, standalone };
}
export function drawerCheckpointDetails(item = {}) {
  const failed = item.failed_checkpoint_units || [];
  if (!failed.length) return '';
  const missing = item.checkpoint_recovery_summary?.missing_units || [];
  return `<section class="drawer-checkpoint-details" data-drawer-checkpoint-details><h3>待平台核对</h3>${failed.map(unit => `<p><b>${escapeHtml(missing.find(row => row.key === unit.key)?.label || unit.unit || unit.key)}</b> · ${escapeHtml(unit.reason)}</p>`).join('')}</section>`;
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
    content_mode: bundle.brief?.content_mode || bundle.project?.content_mode || bundle.project?.request?.content_mode || '',
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
      id: target.profile?.id || target.subject_id || '',
      index,
    };
    payload.subject_targets = selected.id ? [selected] : [];
    payload.regenerate_selected = true;
    payload.resume_partial_checkpoint = target.partial_checkpoint === true;
    payload.person_change_kind = 'visual_dossier';
    if (group === 'people' && target.profile?.id) {
      payload.cast_profiles = payload.cast_profiles.map(profile => String(profile.id || '') === String(target.profile.id) ? { ...profile, ...target.profile } : profile);
    }
  } else {
    const pending = [
      ...people.map((item, index) => ({ item, kind: 'human', index })),
      ...animals.map((item, index) => ({ item, kind: 'pet', index })),
    ].filter(entry => entry.kind === 'human'
      ? subjectNeedsGeneration(entry.item, 'human')
      : subjectNeedsGeneration(entry.item, 'pet'));
    if (pending.length) {
      payload.subject_targets = pending.map(entry => ({
        kind: entry.kind,
        id: entry.item.profile?.id || entry.item.subject_id || '',
        index: entry.index,
      })).filter(entry => entry.id);
      payload.resume_partial_checkpoint = pending.some(entry => entry.item.partial_checkpoint === true);
      payload.regenerate_selected = !payload.resume_partial_checkpoint
        && pending.some(entry => entry.kind === 'human' && personAssetState(entry.item) !== 'missing');
      payload.person_change_kind = 'visual_dossier';
    }
  }
  return payload;
}
function generationValidation(payload = {}) {
  if (!payload.brief) return '请先在“目标与材料”填写广告目标。';
  if (!payload.expected_people && !payload.expected_animals) return '当前项目还没有人物或动物档案，请先完善主体资料。';
  if (payload.cast_profiles.length !== payload.expected_people) return `人物档案数量不完整：需要 ${payload.expected_people} 份。`;
  if (payload.pet_profiles.length !== payload.expected_animals) return `动物档案数量不完整：需要 ${payload.expected_animals} 份。`;
  return '';
}

function assetCard(item, group) {
  const views = Array.isArray(item.view_images) ? item.view_images.length : 0;
  const personState = group === 'people' ? personAssetState(item) : '';
  const personLooks = group === 'people' && Array.isArray(item.profile?.look_profiles) ? item.profile.look_profiles : [];
  const personLookTiles = group === 'people' ? renderPersonLookTiles(item) : '';
  const lookSummary = personLookSummary(personLooks);
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
    materialReferenceState(item).materialSurface
      ? materialReferenceState(item).message
      : (item.status === 'not_applicable'
        ? '随场景生成，不需要独立商品图'
        : (item.image_url ? '已有独立素材' : '无独立商品图')),
  ] : [];
  const detail = (group === 'scenes' ? sceneDetail : (group === 'products' ? productDetail : [
    item.partial_checkpoint ? `已保留 ${item.completed_checkpoint_units || 0} 个成功单元 · 档案待补齐` : '',
    personState === 'legacy_views' ? '仅历史四视图 · 尚未生成完整档案' : '',
    personState === 'look_upgrade_required' ? '造型已更新 · 视觉档案待同步' : '',
    personState === 'profile_upgrade_required' ? '人物文字设定已更新 · 档案待同步' : '',
    personState === 'medium_upgrade_required' ? '画面形态已更新 · 人物档案待同步' : '',
    lookSummary,
    item.role,
    views ? `${views} 个视图` : '',
    item.revision ? `版本 ${item.revision}` : '',
  ]))
    .filter(Boolean).join(' · ');
  const needsGeneration = group === 'people'
    ? personState !== 'complete_dossier'
    : (GENERATABLE.has(group) && !hasGeneratedMedia(item));
  const needsProductVerification = group === 'products' && Boolean(item.image_url) && item.status !== 'verified';
  const recovery = item.checkpoint_recovery_summary || {};
  const retryBlocked = group === 'people' && recovery.retry_blocked === true;
  const cardMedia = assetCardMedia(item, group);
  const materialReference = group === 'products' ? materialReferenceState(item) : {};
  return `<article class="asset-card ${GENERATABLE.has(group) ? 'is-subject' : ''} ${group === 'scenes' ? 'is-scene' : ''}">
    <div class="asset-card-preview">
      ${group === 'people'
        ? `<button class="asset-card-media asset-card-person-entry" type="button" data-history-safe data-asset-group="${group}" data-asset-id="${escapeHtml(item.id)}" aria-label="打开${escapeHtml(item.name)}完整人物档案">${cardMedia}</button>`
        : `<div class="asset-card-media">${cardMedia}</div>`}
      <button class="asset-card-copy" type="button" data-history-safe data-asset-group="${group}" data-asset-id="${escapeHtml(item.id)}" aria-label="查看${escapeHtml(item.name)}完整详情">
        <span>${escapeHtml(item.partial_checkpoint ? '部分资产已保留' : (group === 'products' && item.status === 'not_applicable' ? '随场景生成' : (personState === 'legacy_views' ? '历史四视图' : (personState === 'medium_upgrade_required' ? '画面形态已更新 · 待同步档案' : (personState === 'profile_upgrade_required' ? '人物设定已更新 · 待同步档案' : (personState === 'look_upgrade_required' ? `${personLooks.length}套造型 · 待同步档案` : (personState === 'upgrade_required' ? '旧版档案 · 待升级' : (personState === 'complete_dossier' ? `${Math.max(1, personLooks.length)}套造型 · 完整档案` : (personLooks.length ? `${personLooks.length}套造型` : (item.status || '未确认'))))))))))}</span>
        <b>${escapeHtml(item.name)}</b>
        <small>${escapeHtml(detail || '点击查看当前项目中的真实详情')}</small>
      </button>${group === 'people' ? renderPersonEvolutionSummary(item.profile || {}) : ''}${personLookTiles}
    </div>
    <div class="asset-card-actions">
      <button class="btn small" type="button" data-history-safe data-asset-group="${group}" data-asset-id="${escapeHtml(item.id)}">${group === 'people' ? '查看完整视图' : `查看${group === 'scenes' ? '完整场景档案' : '完整视图'}`}</button>
      ${group === 'people' && item.status === 'verified' && !item.provider_asset_id ? `<button class="btn small" type="button" data-history-safe data-sync-person-provider="${escapeHtml(item.id)}">同步 / 重试 Seedance 人物 ID</button>` : ''}
      ${group === 'products' ? `<button class="btn small" type="button" data-upload-product="${escapeHtml(item.id)}">${materialReference.materialSurface ? (materialReference.realSample ? '更换真实材料样片' : '上传真实材料样片') : (item.image_url ? '更换主体图片' : '上传主体图片')}</button>` : ''}
      ${group === 'products' && materialReference.materialSurface ? `<button class="btn small" type="button" data-generate-product-reference="${escapeHtml(item.id)}">${materialReference.generatedNeutral ? '重新生成中性参考图（1 张，可能计费）' : '生成中性参考图（1 张，可能计费）'}</button>` : ''}
      ${group === 'scenes' ? `<button class="btn small" type="button" data-edit-scene-world="${escapeHtml(item.id)}">查看 / 修改场景设定</button>` : ''}
      ${needsProductVerification ? `<button class="btn small primary" type="button" data-history-safe data-verify-product="${escapeHtml(item.id)}">验证商品素材</button>` : ''}
    </div>
  </article>`;
}

function profileDetails(item = {}, group = '') {
  const profile = item.profile || {};
  const looks = Array.isArray(profile.look_profiles) ? profile.look_profiles : [];
  const rows = group === 'people' ? [
    ['身份 / 关系', profile.roleName || item.role],
    ['年龄', personAgeDisplay(profile)],
    ['原创族裔外貌设定', profile.ethnicity || profile.ethnic_appearance],
    ['外貌与气质', profile.appearanceText],
    ['表演与动作', profile.performanceText],
    ['跨镜一致性', profile.continuityText],
    ...(looks.length ? looks.map((look, index) => [`造型 ${index + 1} · ${look.name || '未命名'}`, `${(look.scene_names || look.scene_ids || []).join('、') || '未限定场景'}｜${look.wardrobeText || ''}`]) : [['服装 / 鞋 / 配饰', profile.wardrobeText]]),
    ['发型 / 妆造', profile.hairMakeupText],
    ['禁止项', profile.negativeText],
  ] : group === 'animals' ? [
    ['类型', profile.type], ['品种', profile.breed], ['外观特征', profile.appearance],
  ] : [];
  if (!rows.length) return '';
  return `<section class="drawer-profile"><h3>${group === 'people' ? '人物设定' : '动物设定'}</h3>${rows.filter(([, value]) => value).map(([label, value]) => `<div><span>${escapeHtml(label)}</span><p>${escapeHtml(value)}</p></div>`).join('')}</section>`;
}

function knowledgePolicyTrace(item = {}) {
  const policy = item.knowledge_policy || item.knowledgePolicy || {};
  const ruleIds = Array.isArray(policy.rule_ids) ? policy.rule_ids : [], generation = String(policy.generation_fingerprint || policy.prompt_policy_fingerprint || '').trim(), qa = String(policy.qa_fingerprint || policy.qa_policy_fingerprint || '').trim();
  if (!generation && !qa && !ruleIds.length) return '';
  const short = value => value ? `${value.slice(0, 12)}…` : '—'; return `<details class="raw-view-details knowledge-policy-trace"><summary>本资产使用的知识规则</summary><div class="meta-list"><div class="meta-row"><span>匹配规则</span><b>${ruleIds.length}</b></div><div class="meta-row"><span>生成规则指纹</span><b title="${escapeHtml(generation)}">${escapeHtml(short(generation))}</b></div><div class="meta-row"><span>质检规则指纹</span><b title="${escapeHtml(qa)}">${escapeHtml(short(qa))}</b></div></div><p class="drawer-section-note">这里只显示规则追踪信息，不加载知识库正文，也不会增加模型调用。</p></details>`;
}
let planningDetailsPromise; let personFormPromise; async function openDrawer(item, group, handlers = {}) {
  planningDetailsPromise ||= import('./assetCenterPlanningDetails.js?v=20260901-production-v363');
  personFormPromise ||= import('./assetCenterPersonForm.js?v=20260901-production-v363');
  const [planningDetails, personForm] = await Promise.all([planningDetailsPromise, personFormPromise]);
  return planningDetails.openAssetDrawer(item, group, handlers, {
    groupLabel: groupLabel(group), generatable: GENERATABLE.has(group),
    mediaSection, profileDetails, checkpointDetails: drawerCheckpointDetails, knowledgePolicyTrace, personEditForm: personForm.personEditForm,
  });
}

function renderSections(assets = {}, total = 0, contentMode = '', groups = GROUPS, productDisabled = '') {
  const allEmpty = !total ? `<div class="asset-total-empty">${emptyState({
    title: '当前项目还没有可用资产', body: contentMode === 'narrative_story' ? '先完善剧情所需的人物、动物或场景。' : '先完善人物、动物或商品素材。',
    action: '添加人物', actionId: 'people',
  })}</div>` : '';
  return allEmpty + groups.map(([key, label]) => {
      const rows = assets[key] || [];
      return `<section class="asset-section" id="asset-section-${key}" data-asset-section="${key}" ${rows.length ? '' : 'hidden'}>
        <div class="section-title"><h2>${escapeHtml(label)}</h2><span>${rows.length}</span><button class="btn small" type="button" data-add-asset="${key}">+ ${key === 'products' ? '上传商品/展示主体素材' : `添加${escapeHtml(label)}`}</button></div>
        <div data-section-body>${rows.length ? `<div class="asset-grid">${rows.map(item => assetCard(item, key)).join('')}</div>` : emptyState({ title: `尚未建立${label}`, body: '可以上传已有参考，或先完善该主体档案。', action: `添加${label}`, actionId: key })}</div>
      </section>`;
    }).join('');
}

export async function mount(host, context) {
  const { store, bundle } = context;
  const { assetPlanStageView } = await loadAssetCenterStage();
  const historicalReadOnly = context.historicalReadOnly === true;
  const assets = bundle?.assets || {};
  const contentMode = bundle.project?.content_mode || bundle.brief?.content_mode || '';
  const narrative = contentMode === 'narrative_story';
  const assetGroups = narrative ? GROUPS.filter(([key]) => !['products', 'logos'].includes(key)) : GROUPS;
  let assistModulePromise;
  const runAssist = async (kind, ...args) => (await (assistModulePromise ||= import('./assetCenterAssist.js?v=20260901-production-v363'))).createAssetAssistHandlers(bundle)[kind](...args);
  const assistScene = (...args) => runAssist('assistScene', ...args);
  const total = assetGroups.reduce((sum, [key]) => sum + (assets[key]?.length || 0), 0);
  const planEligibility = bundle?.navigation?.asset_plan_eligibility || {};
  const personPlanEligibility = planEligibility.person
    ? { ...planEligibility, ...planEligibility.person, release_migration: planEligibility.release_migration }
    : planEligibility;
  const assetPlanReady = personPlanEligibility.eligible === true;
  const generationActive = !!bundle?.project?.active_generation_id;
  const productionGraph = bundle?.outputs?.production_graph_v1 || bundle?.production_graph || null;
  const generationDisabled = generationActive ? 'disabled' : '';
  const contractDisabled = assetPlanReady ? '' : 'disabled title="请先更新当前人物方案"';
  const missingSubjectCount = (assets.people || []).filter(item => subjectNeedsGeneration(item, 'human')).length
    + (assets.animals || []).filter(item => subjectNeedsGeneration(item, 'animal')).length;
  const recoverySummary = checkpointRecoverySummary([...(assets.people || []), ...(assets.animals || [])]);
  const checkpointRecovery = { ...recoverySummary, missing_units: recoverySummary.missing };
  const personModelPicker = await loadGenerationModelPicker(bundle.project.id, 'new_story_ad.person_sheet', { label: '人物模型' });
  const productModelPicker = await loadGenerationModelPicker(bundle.project.id, 'new_story_ad.product_asset', { label: '商品模型' });
  host.innerHTML = `
    <section class="view-head">
      <div><h1>资产中心</h1><p>${narrative ? '人物、动物、场景与机位独立建档。' : '人物、动物、商品/展示主体、LOGO、场景与机位独立建档。'}</p></div>
      <div class="view-actions asset-primary-actions">${personModelPicker.html}${productModelPicker.html}<button class="btn" type="button" data-select-person ${generationDisabled}>选择已有人物素材</button><button class="btn" type="button" data-upload-real-person ${generationDisabled}>上传真人素材</button></div>
    </section>
    ${assetPlanStageView({ assetPlanReady, recoveryActive: false, eligibility: personPlanEligibility, generationActive, missingSubjectCount, productionGraph, counts: { people: assets.people?.length, animals: assets.animals?.length, scenes: assets.scenes?.length }, project: bundle.project || {}, isAdmin: bundle.permissions?.can_view_errors === true })}
    <div class="tabs"><button class="tab active" type="button" data-history-safe data-asset-filter="all">全部 ${total}</button>${assetGroups.map(([key, label]) => `<button class="tab" type="button" data-history-safe data-asset-filter="${key}">${label} ${assets[key]?.length || 0}</button>`).join('')}</div>
    <input class="hidden-input" hidden type="file" accept="image/png,image/jpeg,image/webp" data-asset-upload-file>
    <div data-asset-sections>${renderSections(assets, total, contentMode, assetGroups, generationActive ? generationDisabled : contractDisabled)}</div>`;

  bindMediaLightbox(host);
  const selectedPersonModel = bindGenerationModelPicker(host, personModelPicker);
  const selectedProductModel = bindGenerationModelPicker(host, productModelPicker);

  const subjectRequests = createKeyedRequestGuard();
  const generate = async (target = null, group = '', button = null) => {
    const selectedRecovery = target?.checkpoint_recovery_summary || checkpointRecovery;
    const reviewState = selectedRecovery?.billing_review_state || 'pending';
    if (selectedRecovery?.retry_blocked === true && reviewState !== 'unverifiable') {
      toast('缺失人物单元存在供应商提交或计费未知状态，已停止重试，避免重复付费。', 'warning');
      return false;
    }
    const intent = target?.subject_id || 'all';
    const recoveryKey = recoveryRequestKey(bundle, selectedRecovery, intent);
    return subjectRequests.run(intent, recoveryKey, async requestKey => {
      const payload = subjectGenerationPayload(bundle, target, requestKey);
      payload.image_model = selectedPersonModel();
      const validation = generationValidation(payload);
      if (validation) { toast(validation, 'warning'); return false; }
      setButtonBusy(button, true, '正在准备…');
      try {
        if (!target && checkpointRecovery?.missing?.length
          && !await ensureSubjectRecoveryReady({ bundle, generationPayload: payload, button, host })) return false;
        const selected = payload.subject_targets?.length || payload.expected_people + payload.expected_animals;
        const regeneratingCompletePerson = selected === 1 && group === 'people' && personAssetState(target || {}) === 'complete_dossier';
        setButtonBusy(button, true, regeneratingCompletePerson ? '正在重生成完整档案…' : '正在生成完整档案…', { elapsed: true });
        await store.runStage('person-plan', payload);
        toast(regeneratingCompletePerson ? '人物视觉档案重生成已提交；剧情、文字故事板和场景分配会继续保留。' : '人物或动物资产生成已提交，页面顶部会持续显示阶段、百分比和耗时。', 'success');
        return true;
      } catch (error) {
        toast(error.message, 'danger');
        return false;
      } finally {
        setButtonBusy(button, false);
      }
    }, () => { toast('相同人物生成操作正在确认或提交，请勿重复点击。', 'warning'); return false; });
  };

  const generateProduct = async (item = null, button = null) => {
    const name = item?.name || bundle.brief?.product_subject || '';
    if (!name) return toast('请先在目标与材料中填写商品或广告主体。', 'warning');
    try {
      const standalone = item?.presentation?.standalone_generation_supported !== false;
      if (!standalone) setButtonBusy(button, true, '等待确认…');
      const result = await submitProductGeneration({ item, bundle, store, imageModel: selectedProductModel() });
      if (!result.submitted) return false;
      setButtonBusy(button, true, '正在提交商品生成…', { elapsed: true });
      toast(`${result.standalone ? '商品资产' : '中性参考图'}生成已提交，进度和耗时将在页面顶部显示。`, 'success');
      return true;
    } catch (error) { toast(error.message, 'danger'); return false; } finally { setButtonBusy(button, false); }
  };

  const savePerson = async (item, values, button = null) => {
    const normalizedValues = {
      ...(item.profile || {}),
      generation_prompt: String(values.generation_prompt || '').trim(),
      generation_prompt_source: 'user',
      generation_settings: {
        ...(item.profile?.generation_settings || {}),
        ...(values.generation_settings || {}),
        count: 1,
      },
    };
    const userFields = ['generation_prompt', 'generation_settings']; normalizedValues.field_authority = { ...(item.profile?.field_authority || {}), generation_prompt: 'user', generation_settings: 'user' }; normalizedValues.user_edited_fields = [...new Set([...(item.profile?.user_edited_fields || []), ...userFields])];
    const profiles = (assets.people || []).map(row => row.profile || {}).map(profile => (
      String(profile.id || '') === String(item.profile?.id || '') ? { ...profile, ...normalizedValues } : profile
    ));
    const receipt = await store.updateRequest({ cast_profiles: profiles }, { refreshSections: 'summary,assets', returnMutationResult: true });
    const savedProfile = assertSavedPerson(receipt.bundle, item, normalizedValues, receipt.mutation);
    item.profile = savedProfile;
    return savedProfile;
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
    host.querySelectorAll('[data-asset-section]').forEach(section => {
      const rows = assets[section.dataset.assetSection] || [];
      section.hidden = filter === 'all' ? !rows.length : section.dataset.assetSection !== filter;
    });
  }));

  const showAsset = button => {
    const group = button.dataset.assetGroup;
    const item = (assets[group] || []).find(asset => String(asset.id) === button.dataset.assetId);
    if (item) openDrawer(item, group, { readOnly: historicalReadOnly, generationActive, onGenerate: generate, onGenerateScene: generateScene, onGenerateProduct: generateProduct, onVerifyProduct: verifyProduct, onSavePerson: savePerson, onSaveProduct: saveProduct, onSaveScene: saveScene, onAssistScene: assistScene, onUploadProduct: () => openUpload('products'), returnFocus: button });
  };
  host.querySelectorAll('[data-asset-id]').forEach(button => button.addEventListener('click', () => showAsset(button)));
  host.querySelectorAll('[data-verify-product]').forEach(button => button.addEventListener('click', event => {
    event.stopPropagation();
    const item = (assets.products || []).find(asset => String(asset.id) === button.dataset.verifyProduct);
    if (item) verifyProduct(item, button);
  }));
  host.querySelectorAll('[data-upload-product]').forEach(button => button.addEventListener('click', event => {
    event.stopPropagation();
    openUpload('products');
  }));
  host.querySelectorAll('[data-generate-product-reference]').forEach(button => button.addEventListener('click', event => {
    event.stopPropagation();
    const item = (assets.products || []).find(asset => String(asset.id) === button.dataset.generateProductReference);
    if (item) generateProduct(item, button);
  }));
  host.querySelectorAll('[data-edit-scene-world]').forEach(button => button.addEventListener('click', event => {
    event.stopPropagation();
    const item = (assets.scenes || []).find(asset => String(asset.id) === button.dataset.editSceneWorld);
    if (item) openDrawer(item, 'scenes', { readOnly: historicalReadOnly, onSaveScene: saveScene, onAssistScene: assistScene, returnFocus: button });
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
    if (group === 'people') { openRealPersonFlow({ context, taskId: bundle.project.id, imageModel: selectedPersonModel }); return; }
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

  host.querySelector('[data-select-person]').addEventListener('click', () => openActorLibrary({ store, context, taskId: bundle.project.id }));
  host.querySelector('[data-upload-real-person]').addEventListener('click', () => openRealPersonFlow({ context, taskId: bundle.project.id, imageModel: selectedPersonModel }));
  host.querySelector('[data-generate-subject-assets]')?.addEventListener('click', event => generate(null, '', event.currentTarget));
  host.querySelectorAll('[data-confirm-assets]').forEach(confirmButton => confirmButton.addEventListener('click', async event => {
    const button = event.currentTarget;
    try {
      setButtonBusy(button, true, '正在确认…');
      await store.updateRequest({ asset_setup_confirmed: true }, { skipRefresh: true });
      toast('资产方案已确认，场景与分镜将使用当前人物、动物、商品和地点规划。', 'success');
      context.navigate(`/story-ad/projects/${encodeURIComponent(bundle.project.id)}?view=scene`);
    } catch (error) {
      toast(error.message, 'danger');
      setButtonBusy(button, false);
    }
  }));
}
