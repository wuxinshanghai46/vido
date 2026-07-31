import { request } from '../api.js';
import { emptyState, escapeHtml, mediaPreview, setButtonBusy, toast } from '../components/ui.js';
import { confirmDialog } from '../components/dialog.js';

const GROUPS = [
  ['people', '人物'],
  ['animals', '动物'],
  ['products', '商品'],
  ['logos', 'LOGO'],
  ['scenes', '场景与机位'],
  ['props', '道具'],
];

const GENERATABLE = new Set(['people', 'animals']);

function groupLabel(group = '') {
  return GROUPS.find(([id]) => id === group)?.[1] || '资产';
}

function hasGeneratedMedia(item = {}) {
  return Boolean(item.dossier_sheet?.image_url
    || (Array.isArray(item.view_images) && item.view_images.length >= 4));
}

function profileList(bundle = {}, key = '') {
  return (bundle.assets?.[key] || []).map(item => item.profile).filter(profile => profile?.id);
}

/** 构造与主体生成服务完全一致的请求合同；target 只控制本次需要生成的主体。 */
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
    ].filter(entry => !hasGeneratedMedia(entry.item))
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
    const missing = [['姓名', profile.displayName], ['角色', profile.roleName], ['外貌', profile.appearanceText], ['服装', profile.wardrobeText], ['发型/妆造', profile.hairMakeupText]]
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
  const detail = [item.role, views ? `${views} 个视图` : '', item.revision ? `版本 ${item.revision}` : ''].filter(Boolean).join(' · ');
  const needsGeneration = GENERATABLE.has(group) && !hasGeneratedMedia(item);
  return `<article class="asset-card ${GENERATABLE.has(group) ? 'is-subject' : ''}">
    <button class="asset-card-preview" type="button" data-asset-group="${group}" data-asset-id="${escapeHtml(item.id)}" aria-label="查看${escapeHtml(item.name)}完整详情">
      ${mediaPreview(item, { label: item.name, width: 720, symbol: groupLabel(group) })}
      <span class="asset-card-copy">
        <span>${escapeHtml(item.status || '未确认')}</span>
        <b>${escapeHtml(item.name)}</b>
        <small>${escapeHtml(detail || '点击查看当前项目中的真实详情')}</small>
      </span>
    </button>
    <div class="asset-card-actions">
      <button class="btn small" type="button" data-asset-group="${group}" data-asset-id="${escapeHtml(item.id)}">查看${item.dossier_sheet?.image_url ? '完整档案' : '完整视图'}</button>
      ${needsGeneration ? `<button class="btn small primary" type="button" data-generate-asset="${escapeHtml(item.id)}" data-generate-group="${group}">生成${group === 'people' ? '该人物档案' : '该动物资产'}</button>` : ''}
    </div>
  </article>`;
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

function openDrawer(item, group, { onGenerate } = {}) {
  const views = Array.isArray(item.view_images) ? item.view_images : [];
  const dossier = item.dossier_sheet?.image_url ? { image_url: item.dossier_sheet.image_url } : null;
  const zones = Array.isArray(item.zones) ? item.zones : [];
  const cameras = Array.isArray(item.cameras) ? item.cameras : [];
  const metadata = [
    ['资产类型', groupLabel(group)], ['当前状态', item.status || '未确认'], ['版本', item.revision || '—'],
    ['角色或用途', item.role || '—'], ['空间区域', zones.map(zone => zone.label).filter(Boolean).join('、') || '—'],
    ['机位', cameras.map(camera => camera.label).filter(Boolean).join('、') || '—'],
  ];
  const legacyLabel = group === 'people' && !dossier && views.length ? '<p class="drawer-history-note">历史四视图资产：原始图片会完整显示；该任务尚未生成新版人物档案板。</p>' : '';
  const backdrop = document.createElement('div');
  backdrop.className = 'drawer-backdrop';
  const drawer = document.createElement('aside');
  drawer.className = `drawer ${group === 'people' ? 'is-person-drawer' : ''}`;
  drawer.innerHTML = `
    <header class="drawer-head"><div><small>${escapeHtml(groupLabel(group))}</small><h2>${escapeHtml(item.name)}</h2></div><button class="icon-btn" type="button" data-close-drawer>×</button></header>
    <div class="drawer-content">
      ${dossier ? `<section class="dossier-hero"><div><span>完整人物档案</span><b>正面 / 侧面 / 背面 · 表情 · 服装 · 细节 · 动作</b></div>${mediaPreview(dossier, { label: `${item.name}完整人物档案`, width: 1600, symbol: '人物档案' })}</section>` : (!views.length ? mediaPreview(item, { label: item.name, width: 1200, symbol: groupLabel(group) }) : '')}
      ${legacyLabel}
      ${views.length ? `<section><h3>完整视图</h3><div class="drawer-media-grid ${group === 'people' || group === 'animals' ? 'is-portrait-grid' : ''}">${views.map(view => `<figure>${mediaPreview(view, { label: view.label || view.key, width: 720, symbol: view.label || '视图' })}<figcaption>${escapeHtml(view.label || view.key || '视图')}</figcaption></figure>`).join('')}</div></section>` : ''}
      ${profileDetails(item, group)}
      <div class="meta-list">${metadata.map(([label, value]) => `<div class="meta-row"><span>${escapeHtml(label)}</span><b>${escapeHtml(value)}</b></div>`).join('')}</div>
    </div>
    ${GENERATABLE.has(group) && !dossier ? `<footer class="drawer-actions"><span>${views.length ? '可保留旧四视图，并生成新版完整档案。' : '生成前会再次展示确认，不会自动调用模型。'}</span><button class="btn primary" type="button" data-drawer-generate>生成${group === 'people' ? '完整人物档案' : '动物资产'}</button></footer>` : ''}`;
  const close = () => { backdrop.remove(); drawer.remove(); };
  backdrop.addEventListener('click', close);
  drawer.querySelector('[data-close-drawer]').addEventListener('click', close);
  drawer.querySelector('[data-drawer-generate]')?.addEventListener('click', async event => {
    await onGenerate?.(item, group, event.currentTarget);
    close();
  });
  document.body.append(backdrop, drawer);
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

/** 挂载真实资产中心。 */
export async function mount(host, context) {
  const { store, bundle } = context;
  const assets = bundle?.assets || {};
  const total = GROUPS.reduce((sum, [key]) => sum + (assets[key]?.length || 0), 0);
  host.innerHTML = `
    <section class="view-head">
      <div><h1>资产中心</h1><p>人物、动物、商品、LOGO、场景和道具分别建档；人物默认展示完整档案，不再裁切全身图。</p></div>
      <div class="view-actions"><button class="btn" type="button" data-generate-subjects>生成人物 / 动物资产</button><button class="btn primary" type="button" data-build-scenes>建立场景规划</button></div>
    </section>
    <div class="guide">点击人物卡查看完整人物档案、四视图、设定和版本。生成操作只会在确认后提交。</div>
    <div class="tabs"><button class="tab active" type="button" data-asset-filter="all">全部 ${total}</button>${GROUPS.map(([key, label]) => `<button class="tab" type="button" data-asset-filter="${key}">${label} ${assets[key]?.length || 0}</button>`).join('')}</div>
    <input class="hidden-input" hidden type="file" accept="image/png,image/jpeg,image/webp" data-asset-upload-file>
    <div data-asset-sections>${renderSections(assets, total)}</div>`;

  const generate = async (target = null, group = '', button = null) => {
    const requestKey = `${bundle.project.id}:${target?.subject_id || 'all'}:${Date.now()}`;
    const payload = subjectGenerationPayload(bundle, target, requestKey);
    const validation = generationValidation(payload);
    if (validation) return toast(validation, 'warning');
    const selected = payload.subject_targets?.length || payload.expected_people + payload.expected_animals;
    if (!await confirmDialog(`本次将提交 ${selected} 个缺失或选中的主体生成。生成会调用图片模型；未选且已有四视图的主体会原样保留。`, {
      title: target ? `生成${target.name}的完整资产` : '生成人物 / 动物资产',
      confirmText: '确认开始生成',
    })) return;
    try {
      setButtonBusy(button, true, '正在生成完整档案…');
      await request('/api/new-story-ad/subject-assets', { method: 'POST', body: payload, timeoutMs: 2700000 });
      toast('人物或动物资产已生成完成。', 'success');
      await context.refreshShell();
    } catch (error) {
      toast(error.message, 'danger');
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
    if (item) openDrawer(item, group, { onGenerate: generate });
  };
  host.querySelectorAll('[data-asset-id]').forEach(button => button.addEventListener('click', () => showAsset(button)));
  host.querySelectorAll('[data-generate-asset]').forEach(button => button.addEventListener('click', event => {
    event.stopPropagation();
    const item = (assets[button.dataset.generateGroup] || []).find(asset => String(asset.id) === button.dataset.generateAsset);
    if (item) generate(item, button.dataset.generateGroup, button);
  }));

  let uploadGroup = '';
  const uploadInput = host.querySelector('[data-asset-upload-file]');
  const openUpload = group => { uploadGroup = group; uploadInput.click(); };
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
  host.querySelector('[data-build-scenes]').addEventListener('click', async event => {
    const button = event.currentTarget;
    try {
      setButtonBusy(button, true, '正在建立…');
      await store.runStage('scene-config');
      toast('场景规划已提交，请稍后查看状态。', 'success');
      await context.refreshShell();
    } catch (error) { toast(error.message, 'danger'); } finally { setButtonBusy(button, false); }
  });
}
