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

/** 输出真实资产卡片。 */
function assetCard(item, group) {
  const views = Array.isArray(item.view_images) ? item.view_images.length : 0;
  const detail = [
    item.role,
    views ? `${views} 个视图` : '',
    item.revision ? `版本 ${item.revision}` : '',
  ].filter(Boolean).join(' · ');
  return `<button class="asset-card" type="button" data-asset-group="${group}" data-asset-id="${escapeHtml(item.id)}">
    ${mediaPreview(item, { label: item.name, width: 520, symbol: GROUPS.find(([id]) => id === group)?.[1] || '资产' })}
    <span class="asset-card-copy">
      <span>${escapeHtml(item.status || '未确认')}</span>
      <b>${escapeHtml(item.name)}</b>
      <small>${escapeHtml(detail || '点击查看当前项目中的真实详情')}</small>
    </span>
  </button>`;
}

/** 输出资产详情抽屉。 */
function openDrawer(host, item, group) {
  const views = Array.isArray(item.view_images) ? item.view_images : [];
  const zones = Array.isArray(item.zones) ? item.zones : [];
  const cameras = Array.isArray(item.cameras) ? item.cameras : [];
  const metadata = [
    ['资产类型', GROUPS.find(([id]) => id === group)?.[1] || group],
    ['当前状态', item.status || '未确认'],
    ['版本', item.revision || '—'],
    ['角色或用途', item.role || '—'],
    ['空间区域', zones.map(zone => zone.label).filter(Boolean).join('、') || '—'],
    ['机位', cameras.map(camera => camera.label).filter(Boolean).join('、') || '—'],
  ];
  const backdrop = document.createElement('div');
  backdrop.className = 'drawer-backdrop';
  const drawer = document.createElement('aside');
  drawer.className = 'drawer';
  drawer.innerHTML = `
    <header class="drawer-head"><div><small>${escapeHtml(GROUPS.find(([id]) => id === group)?.[1] || '资产详情')}</small><h2>${escapeHtml(item.name)}</h2></div><button class="icon-btn" type="button" data-close-drawer>×</button></header>
    <div class="drawer-content">
      ${mediaPreview(item, { label: item.name, width: 960, symbol: '资产' })}
      ${views.length ? `<div class="drawer-media-grid">${views.map(view => mediaPreview(view, { label: view.label || view.key, width: 480, symbol: view.label || '视图' })).join('')}</div>` : ''}
      <div class="meta-list">${metadata.map(([label, value]) => `<div class="meta-row"><span>${escapeHtml(label)}</span><b>${escapeHtml(value)}</b></div>`).join('')}</div>
    </div>`;
  const close = () => { backdrop.remove(); drawer.remove(); };
  backdrop.addEventListener('click', close);
  drawer.querySelector('[data-close-drawer]').addEventListener('click', close);
  document.body.append(backdrop, drawer);
}

/** 挂载真实资产中心。 */
export async function mount(host, context) {
  const { store, bundle } = context;
  const assets = bundle?.assets || {};
  const total = GROUPS.reduce((sum, [key]) => sum + (assets[key]?.length || 0), 0);
  host.innerHTML = `
    <section class="view-head">
      <div><h1>资产中心</h1><p>人物、动物、商品、LOGO、场景和道具分别建档；组合关系不把多主体压成一张图片。</p></div>
      <div class="view-actions">
        <button class="btn" type="button" data-generate-subjects>生成人物 / 动物资产</button>
        <button class="btn primary" type="button" data-build-scenes>建立场景规划</button>
      </div>
    </section>
    <div class="guide">点击资产卡查看完整视图、版本与使用状态。所有内容均来自当前任务；没有数据时保持空状态。</div>
    <div class="tabs">
      <button class="tab active" type="button" data-asset-filter="all">全部 ${total}</button>
      ${GROUPS.map(([key, label]) => `<button class="tab" type="button" data-asset-filter="${key}">${label} ${assets[key]?.length || 0}</button>`).join('')}
    </div>
    <input class="hidden-input" hidden type="file" accept="image/png,image/jpeg,image/webp" data-asset-upload-file>
    <div data-asset-sections>
      ${GROUPS.map(([key, label]) => {
        const rows = assets[key] || [];
        return `<section class="asset-section" data-asset-section="${key}">
          <div class="section-title"><h2>${escapeHtml(label)}</h2><span>${rows.length}</span><button class="btn small" type="button" data-add-asset="${key}">＋ 添加${escapeHtml(label)}</button></div>
          ${rows.length ? `<div class="asset-grid">${rows.map(item => assetCard(item, key)).join('')}</div>` : emptyState({
            title: `尚未建立${label}`,
            body: '可以上传已有参考，或使用当前项目需求生成后再确认。',
            action: `添加${label}`,
            actionId: key,
          })}
        </section>`;
      }).join('')}
    </div>`;

  host.querySelectorAll('[data-asset-filter]').forEach(button => {
    button.addEventListener('click', () => {
      host.querySelectorAll('[data-asset-filter]').forEach(item => item.classList.toggle('active', item === button));
      host.querySelectorAll('[data-asset-section]').forEach(section => {
        section.hidden = button.dataset.assetFilter !== 'all' && section.dataset.assetSection !== button.dataset.assetFilter;
      });
    });
  });

  host.querySelectorAll('[data-asset-id]').forEach(button => {
    button.addEventListener('click', () => {
      const group = button.dataset.assetGroup;
      const item = (assets[group] || []).find(asset => String(asset.id) === button.dataset.assetId);
      if (item) openDrawer(host, item, group);
    });
  });

  let uploadGroup = '';
  const uploadInput = host.querySelector('[data-asset-upload-file]');
  const openUpload = group => {
    uploadGroup = group;
    uploadInput.click();
  };
  host.querySelectorAll('[data-add-asset]').forEach(button => button.addEventListener('click', () => openUpload(button.dataset.addAsset)));
  host.querySelectorAll('[data-empty-action]').forEach(button => button.addEventListener('click', () => openUpload(button.dataset.emptyAction)));

  uploadInput.addEventListener('change', async () => {
    const file = uploadInput.files?.[0];
    if (!file || !uploadGroup) return;
    try {
      const roleMap = {
        people: 'person_reference',
        animals: 'animal_reference',
        products: 'product_reference',
        logos: 'brand_logo',
        scenes: 'scene_reference',
        props: 'prop_reference',
      };
      const uploaded = await store.upload(file, roleMap[uploadGroup] || 'asset');
      const asset = uploaded.asset || uploaded.data;
      const materialRoles = {
        people: 'person',
        animals: 'animal',
        products: 'product',
        logos: 'logo',
        scenes: 'scene',
        props: 'prop',
      };
      await store.attachMaterial(materialRoles[uploadGroup], asset, { authorized: uploadGroup === 'logos' });
      toast('资产已添加到当前项目。', 'success');
      await context.refreshShell();
    } catch (error) {
      toast(error.message, 'danger');
    } finally {
      uploadInput.value = '';
    }
  });

  host.querySelector('[data-generate-subjects]').addEventListener('click', async event => {
    const button = event.currentTarget;
    const brief = bundle?.brief || {};
    if (!brief.text) return toast('请先在“目标与材料”填写广告目标。', 'warning');
    if (!await confirmDialog('将根据当前人物数量和需求生成身份资产。', {
      title: '生成人物 / 动物资产',
      confirmText: '确认开始',
    })) return;
    try {
      setButtonBusy(button, true, '正在提交…');
      await request('/api/new-story-ad/subject-assets', {
        method: 'POST',
        body: {
          task_id: bundle.project.id,
          brief: brief.text,
          expected_people: brief.expected_people || 0,
          expected_animals: brief.expected_animals || 0,
          person_spec: {
            castMode: brief.cast_mode || 'auto',
            expected_people: brief.expected_people || 0,
            expected_animals: brief.expected_animals || 0,
          },
        },
        timeoutMs: 60000,
      });
      toast('人物或动物资产任务已完成。', 'success');
      await context.refreshShell();
    } catch (error) {
      toast(error.message, 'danger');
    } finally {
      setButtonBusy(button, false);
    }
  });

  host.querySelector('[data-build-scenes]').addEventListener('click', async event => {
    const button = event.currentTarget;
    try {
      setButtonBusy(button, true, '正在建立…');
      await store.runStage('scene-config');
      toast('场景规划已提交，请稍后查看状态。', 'success');
      await context.refreshShell();
    } catch (error) {
      toast(error.message, 'danger');
    } finally {
      setButtonBusy(button, false);
    }
  });
}
