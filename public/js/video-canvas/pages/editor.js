import { api, idempotencyKey } from '../core/api-client.js';
import { toast, escapeHtml, money } from '../core/page-shell.js';
import { VideoCanvasEditor } from '../graph/editor-adapter.js';
import { RevisionAutosave } from '../persistence/autosave.js';
import { nodeUi } from '../nodes/registry.js';

const params = new URLSearchParams(location.search);
let projectId = params.get('id') || '';
let bundle = null;
let catalog = {};
let models = { image: [], video: [] };
let editor;
let currentPlan = null;
let assets = [];

const title = document.getElementById('project-title');
const saveState = document.getElementById('save-state');
const property = document.getElementById('property-panel');
const autosave = new RevisionAutosave({ save: saveRevision, onState: text => { saveState.textContent = text; } });

await boot();

async function boot() {
  try {
    [catalog, assets, models] = await Promise.all([
      api('/catalog'),
      api('/artifacts?limit=300'),
      api('/models'),
    ]);
    if (!projectId) {
      bundle = await api('/projects', {
        method: 'POST',
        body: {
          name: '未命名视频项目',
          domainPack: params.get('pack') || 'blank',
          templateId: params.get('template') || undefined,
        },
      });
      projectId = bundle.project.id;
      history.replaceState({}, '', `/video-canvas/editor.html?id=${encodeURIComponent(projectId)}`);
    } else {
      bundle = await api(`/projects/${encodeURIComponent(projectId)}`);
    }
    title.value = bundle.project.name;
    mountEditor();
    renderLibrary();
    saveState.textContent = '已保存';
  } catch (error) {
    toast(error.message, 'error');
    saveState.textContent = '加载失败';
  }
}

function mountEditor() {
  editor = new VideoCanvasEditor({
    wrap: document.getElementById('canvas-wrap'),
    stage: document.getElementById('canvas-stage'),
    nodeLayer: document.getElementById('node-layer'),
    edgeLayer: document.getElementById('edge-layer'),
    catalog,
    onChange: () => autosave.schedule(),
    onSelect: renderProperties,
    onConnection: state => {
      const hint = document.getElementById('connection-hint');
      hint.hidden = !state;
      if (state?.error) {
        toast(state.error, 'error');
        editor.cancelConnection();
      } else if (state) {
        hint.textContent = '请选择目标输入端口 · Esc 取消';
      }
    },
  });
  editor.setGraph(bundle.revision.graph);
  document.getElementById('zoom-in').onclick = () => editor.setZoom(editor.zoom + 0.1);
  document.getElementById('zoom-out').onclick = () => editor.setZoom(editor.zoom - 0.1);
  document.getElementById('fit-button').onclick = () => editor.fit();
  document.getElementById('layout-button').onclick = () => editor.autoLayout();
}

function renderLibrary() {
  const groups = { input: '输入素材', generate: 'AI 生成', local: '本地处理', control: '流程控制' };
  const root = document.getElementById('node-library');
  root.innerHTML = Object.entries(groups).map(([key, label]) => `
    <section class="vc-node-group">
      <h3>${label}</h3>
      ${Object.entries(catalog).filter(([, manifest]) => manifest.category === key).map(([type, manifest]) => `
        <button class="vc-node-item" data-node-type="${type}">
          <i class="vc-node-icon">${nodeUi(type).icon}</i><span>${escapeHtml(manifest.label)}</span>
        </button>`).join('')}
    </section>`).join('');
  root.querySelectorAll('[data-node-type]').forEach(button => {
    button.onclick = () => editor.addNode(button.dataset.nodeType, defaults(button.dataset.nodeType));
  });
  document.getElementById('node-search').oninput = event => {
    root.querySelectorAll('.vc-node-item').forEach(item => {
      item.hidden = !item.textContent.toLowerCase().includes(event.target.value.toLowerCase());
    });
  };
}

function defaults(type) {
  const base = {};
  for (const [key, , kind] of nodeUi(type).fields) {
    if (kind.endsWith('-model')) continue;
    base[key] = kind === 'number' ? (key === 'duration' ? 5 : key === 'views' ? 1 : 0) : kind === 'ratio' ? '16:9' : '';
  }
  return base;
}

async function renderProperties(node) {
  if (!node) {
    property.innerHTML = '<div class="vc-property-empty">选择一个节点查看和编辑属性</div>';
    return;
  }
  const ui = nodeUi(node.type);
  property.innerHTML = `
    <div class="vc-field"><label>节点名称</label><input class="vc-input" data-label value="${escapeHtml(node.label || catalog[node.type]?.label)}"></div>
    ${ui.fields.map(fieldHtml).join('')}
    ${node.config?.migrationNeedsReview ? `<div class="vc-alert warning">旧画布迁移项待确认：${escapeHtml((node.config.migrationReviewReasons || []).join('、'))}</div>` : ''}
    <div class="vc-property-actions"><button class="vc-button danger" data-delete>删除节点</button></div>`;
  property.querySelector('[data-label]').oninput = event => editor.updateNode(node.id, { label: event.target.value });
  property.querySelector('[data-delete]').onclick = () => editor.removeNode(node.id);
  property.querySelectorAll('[data-config]').forEach(input => {
    input.oninput = () => {
      const current = editor.node(node.id);
      const value = input.type === 'number' ? Number(input.value) : input.value;
      const config = { ...current.config, [input.dataset.config]: value };
      if (config.migrationNeedsReview) {
        delete config.migrationNeedsReview;
        delete config.migrationReviewReasons;
      }
      editor.updateNode(node.id, { config });
    };
  });
  property.querySelectorAll('[data-model-kind]').forEach(input => {
    input.onchange = () => {
      const current = editor.node(node.id);
      const [provider = '', model = ''] = input.value.split('::');
      const config = { ...current.config, provider, model };
      delete config.migrationNeedsReview;
      delete config.migrationReviewReasons;
      editor.updateNode(node.id, { config });
    };
  });
}

function fieldHtml([key, label, kind]) {
  const value = editor.node(editor.selected)?.config?.[key] ?? '';
  if (kind.endsWith('-model')) return modelField(label, kind.split('-')[0]);
  if (kind === 'textarea') return `<div class="vc-field" style="margin-top:12px"><label>${label}</label><textarea class="vc-textarea" data-config="${key}">${escapeHtml(value)}</textarea></div>`;
  if (kind.startsWith('artifact-')) {
    const target = kind.split('-')[1];
    return `<div class="vc-field" style="margin-top:12px"><label>${label}</label><select class="vc-select" data-config="${key}"><option value="">请选择素材</option>${assets.filter(item => item.kind === target).map(item => `<option value="${item.id}" ${item.id === value ? 'selected' : ''}>${escapeHtml(item.metadata?.originalName || item.id)}</option>`).join('')}</select></div>`;
  }
  if (kind === 'ratio') return selectField(key, label, value, ['16:9', '9:16', '1:1', '4:3']);
  if (kind === 'position') return selectField(key, label, value, ['bottom', 'center', 'top']);
  if (kind === 'branch') return selectField(key, label, value, ['yes', 'no']);
  return `<div class="vc-field" style="margin-top:12px"><label>${label}</label><input class="vc-input" ${kind === 'number' ? 'type="number" step="0.1"' : ''} data-config="${key}" value="${escapeHtml(value)}"></div>`;
}

function modelField(label, kind) {
  const node = editor.node(editor.selected);
  const selected = `${node.config?.provider || ''}::${node.config?.model || ''}`;
  const options = models[kind] || [];
  return `<div class="vc-field" style="margin-top:12px"><label>${label}</label><select class="vc-select" data-model-kind="${kind}"><option value="">请选择已启用模型</option>${options.map(item => {
    const value = `${item.providerId}::${item.modelId}`;
    return `<option value="${escapeHtml(value)}" ${value === selected ? 'selected' : ''}>${escapeHtml(item.providerName)} · ${escapeHtml(item.modelName)}</option>`;
  }).join('')}</select>${options.length ? '' : '<small>暂无可用模型，请先到 AI 配置启用供应商和模型</small>'}</div>`;
}

function selectField(key, label, value, options) {
  return `<div class="vc-field" style="margin-top:12px"><label>${label}</label><select class="vc-select" data-config="${key}">${options.map(item => `<option value="${item}" ${item === String(value) ? 'selected' : ''}>${item}</option>`).join('')}</select></div>`;
}

async function saveRevision() {
  if (!bundle || !editor) return;
  bundle = await api(`/projects/${projectId}/revisions`, {
    method: 'POST',
    body: { baseRevisionId: bundle.revision.id, graph: editor.getGraph() },
  });
}

document.getElementById('save-button').onclick = () => autosave.flush().catch(error => toast(error.message, 'error'));
title.onchange = async () => {
  try {
    bundle.project = await api(`/projects/${projectId}`, { method: 'PATCH', body: { name: title.value } });
    toast('项目名称已保存', 'success');
  } catch (error) {
    toast(error.message, 'error');
  }
};

document.getElementById('run-button').onclick = async () => {
  try {
    await autosave.flush();
    currentPlan = await api(`/projects/${projectId}/plan`, { method: 'POST', body: { revisionId: bundle.revision.id } });
    showPlan(currentPlan);
  } catch (error) {
    toast(error.errors?.length ? error.errors.map(item => item.message).join('；') : error.message, 'error');
  }
};

function showPlan(plan) {
  const modal = document.getElementById('plan-modal');
  document.getElementById('plan-content').innerHTML = `
    <div class="vc-plan-list">${plan.items.map(item => `<div class="vc-plan-row"><span><b>${escapeHtml(catalog[item.nodeType]?.label || item.nodeType)}</b><small>${item.action === 'reuse' ? '复用成功结果' : '执行节点'}</small></span><b>${money(item.estimatedCost)}</b></div>`).join('')}</div>
    <div class="vc-plan-total"><span>${plan.paidNodeCount} 个付费节点 · ${plan.reusedNodeCount} 个复用</span><span>${money(plan.estimatedCostMax)}</span></div>
    ${plan.paidNodeCount ? '<p style="color:var(--vc-warning);font-size:12px">确认后只执行本计划；画布变化会要求重新确认。付费节点失败不会自动重试。</p>' : '<p style="color:var(--vc-success);font-size:12px">本次计划不产生外部模型费用。</p>'}`;
  modal.hidden = false;
}

document.querySelectorAll('[data-close-plan]').forEach(button => {
  button.onclick = () => { document.getElementById('plan-modal').hidden = true; };
});

document.getElementById('confirm-run').onclick = async () => {
  if (!currentPlan) return;
  const button = document.getElementById('confirm-run');
  button.disabled = true;
  try {
    const result = await api('/runs', {
      method: 'POST',
      body: {
        projectId,
        revisionId: bundle.revision.id,
        planFingerprint: currentPlan.planFingerprint,
        requestedNodeIds: currentPlan.requestedNodeIds,
        confirmPaid: currentPlan.paidNodeCount > 0,
        confirmedCostLimit: currentPlan.estimatedCostMax,
        idempotencyKey: idempotencyKey('run'),
      },
    });
    const run = result.run || result.data?.run;
    location.href = `/video-canvas/run.html?id=${encodeURIComponent(run.id)}`;
  } catch (error) {
    toast(error.message, 'error');
    button.disabled = false;
  }
};

document.getElementById('template-button').onclick = () => { location.href = '/video-canvas/templates.html'; };
