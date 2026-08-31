import { request } from '../api.js?v=20260831-production-v334';
import { escapeHtml, mediaPreview, setButtonBusy, toast } from '../components/ui.js?v=20260831-production-v334';

function assetModal(title = '') {
  const previouslyFocused = document.activeElement;
  const backdrop = document.createElement('div');
  backdrop.className = 'drawer-backdrop asset-modal-backdrop';
  const panel = document.createElement('section');
  panel.className = 'asset-source-modal';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-labelledby', 'asset-source-modal-title');
  panel.tabIndex = -1;
  panel.innerHTML = `<header><h2 id="asset-source-modal-title">${escapeHtml(title)}</h2><button class="icon-btn" type="button" data-close aria-label="关闭弹窗">×</button></header><div class="asset-source-modal-body" data-body></div>`;
  const onKeydown = (event) => {
    if (event.key === 'Escape') close();
  };
  const close = () => {
    document.removeEventListener('keydown', onKeydown);
    document.body.classList.remove('story-ad-modal-open');
    backdrop.remove(); panel.remove();
    previouslyFocused?.focus?.();
  };
  backdrop.addEventListener('click', close);
  panel.querySelector('[data-close]').addEventListener('click', close);
  document.body.classList.add('story-ad-modal-open');
  document.addEventListener('keydown', onKeydown);
  document.body.append(backdrop, panel);
  panel.focus();
  return { panel, body: panel.querySelector('[data-body]'), close };
}

function inlineJobProgress(production = {}) {
  const jobs = [production.provider_sync, production.dossier_job, production.candidate_job].filter(Boolean);
  const job = jobs.find(row => ['queued', 'running', 'cancelling'].includes(String(row.status || '').toLowerCase())) || jobs[0] || {};
  const progress = Math.max(0, Math.min(100, Number(job.progress || 0) || 0));
  const started = job.started_at || job.created_at || production.updated_at || '';
  return `<section class="inline-asset-progress" data-person-progress>
    <div><b>${escapeHtml(job.phase || '等待下一步')}</b><strong>${progress}%</strong></div>
    <div class="progress-track"><i style="width:${progress}%"></i></div>
    ${started ? `<small data-elapsed-started-at="${escapeHtml(started)}" data-elapsed-prefix="已耗时">已耗时 0分00秒</small>` : ''}
    ${job.error?.message ? `<p class="error-text">${escapeHtml(job.error.message)}</p>` : ''}
  </section>`;
}

async function waitForPersonJob(taskId, jobKey, onUpdate) {
  for (;;) {
    const data = await request(`/api/new-story-ad/tasks/${encodeURIComponent(taskId)}/person-production`);
    const production = data.production || {};
    onUpdate?.(production);
    const status = String(production[jobKey]?.status || '').toLowerCase();
    if (['completed', 'failed', 'cancelled'].includes(status)) return production;
    await new Promise(resolve => setTimeout(resolve, 1400));
  }
}

function actorLibraryProfile(actor = {}) {
  return actor.subject_profile || actor.metadata?.subject_profile || {};
}

function actorLibraryFilters(actor = {}) {
  const source = actor.character_library?.filters || {};
  const rawGender = String(source.gender || '').toLowerCase();
  return {
    gender: /female|woman|女/.test(rawGender) ? '女' : (/male|man|男/.test(rawGender) ? '男' : ''),
    age: String(source.age_band || ''), era: String(source.era || ''),
  };
}

function actorLibraryImage(url = '', label = '', className = '', options = {}) {
  return `<div class="${className}">${url
    ? mediaPreview({ image_url: url }, { label, width: options.width || 520, symbol: '人物素材', loading: options.loading, fetchPriority: options.fetchPriority })
    : '<div class="media-placeholder"><span>该项待补充</span></div>'}</div>`;
}

function actorLibraryFeatured(actor = {}) {
  const library = actor.character_library || {};
  const profile = actorLibraryProfile(actor);
  const expressionRows = Array.isArray(library.expressions) ? library.expressions.slice(0, 6) : [];
  const bodyRows = Array.isArray(library.body_views) ? library.body_views.slice(0, 4) : [];
  const portrait = library.portrait_image_url || actor.cover_image_url || actor.image_url || '';
  const fullBody = library.full_body_image_url || bodyRows[0]?.image_url || actor.image_url || '';
  const dossier = library.dossier_image_url || actor.dossier_sheet?.image_url || '';
  const tags = [profile.roleName, actorLibraryFilters(actor).gender, actorLibraryFilters(actor).age, actorLibraryFilters(actor).era]
    .filter(Boolean);
  if (library.summary_only === true) {
    return `<section class="actor-library-featured is-loading" data-library-featured><header><div><h3>${escapeHtml(actor.name || profile.displayName || '人物角色')}</h3><div class="actor-library-tags">${tags.map(tag => `<span>${escapeHtml(tag)}</span>`).join('')}</div></div></header><div class="actor-library-summary-loading">${actorLibraryImage(portrait, `${actor.name || '人物'}头像`, 'is-portrait', { loading: 'eager', fetchPriority: 'high', width: 420 })}<div><b>人物头像已就绪</b><span>正在按需读取该人物的完整视角和表情档案…</span></div></div></section>`;
  }
  return `<section class="actor-library-featured" data-library-featured>
    <header><div><h3>${escapeHtml(actor.name || profile.displayName || '人物角色')}</h3><div class="actor-library-tags">${tags.map(tag => `<span>${escapeHtml(tag)}</span>`).join('')}</div></div></header>
    <div class="actor-library-featured-grid">
      ${actorLibraryImage(fullBody, `${actor.name || '人物'}全身标准图`, 'is-full-body', { loading: 'eager', fetchPriority: 'high', width: 620 })}
      ${actorLibraryImage(portrait, `${actor.name || '人物'}面部身份图`, 'is-portrait', { loading: 'eager', fetchPriority: 'high', width: 520 })}
      <div class="actor-library-expression-board">${expressionRows.length
        ? expressionRows.map((row, index) => actorLibraryImage(row.image_url, `${actor.name || '人物'}表情${index + 1}`, '')).join('')
        : bodyRows.map((row, index) => actorLibraryImage(row.image_url, `${actor.name || '人物'}视角${index + 1}`, '')).join('')}</div>
      ${actorLibraryImage(dossier || bodyRows[1]?.image_url || fullBody, `${actor.name || '人物'}完整制作档案`, 'is-dossier', { width: 900 })}
    </div>
    <footer><p>${escapeHtml(profile.appearanceText || actor.description || '已通过人物身份与跨视角一致性验证，可作为后续分镜和视频的人物参考。')}</p><button class="btn primary" type="button" data-apply-selected-actor>应用到当前项目</button></footer>
  </section>`;
}

function actorLibraryFilterPanel() {
  const rows = [
    ['gender', '性别', ['男', '女']],
    ['age', '年龄段', ['儿童', '少年', '青年', '中年', '老年']],
    ['era', '时代', ['古代', '近代', '现代', '未来']],
  ];
  return `<aside class="actor-library-filter-panel" data-library-filter-panel hidden><header><b>角色筛选</b><button type="button" data-clear-library-filters>清空筛选</button></header>${rows.map(([key, label, values]) => `<section><span>${label}</span><div>${values.map(value => `<button type="button" data-library-filter="${key}" data-filter-value="${value}">${value}</button>`).join('')}</div></section>`).join('')}</aside>`;
}

export async function openActorLibrary({ store, context }) {
  const modal = assetModal('选择已有人物素材');
  modal.body.innerHTML = '<div class="loading-state">正在读取人物素材库…</div>';
  try {
    const data = await request('/api/assets?type=character&character_library=1&view=summary&fast=1&limit=60');
    const rows = Array.isArray(data.data) ? data.data : [];
    const state = { selectedId: rows[0]?.id || '', filters: {}, details: new Map(), detailRequest: 0 };
    const loadSelectedDetail = async id => {
      if (!id || state.details.has(id)) return;
      const requestNo = ++state.detailRequest;
      try {
        const detail = await request(`/api/assets/${encodeURIComponent(id)}`);
        state.details.set(id, detail.data);
        if (state.selectedId === id && requestNo === state.detailRequest) render();
      } catch (error) {
        if (state.selectedId === id) toast(`人物完整档案读取失败：${error.message}`, 'danger');
      }
    };
    const render = () => {
      const visible = rows.filter(actor => Object.entries(state.filters).every(([key, value]) => !value || actorLibraryFilters(actor)[key] === value));
      if (!visible.some(actor => actor.id === state.selectedId)) state.selectedId = visible[0]?.id || '';
      const selectedSummary = rows.find(actor => actor.id === state.selectedId) || visible[0];
      const selected = state.details.get(selectedSummary?.id) || selectedSummary;
      modal.body.innerHTML = rows.length ? `<div class="actor-library-shell">
        ${selected ? actorLibraryFeatured(selected) : '<div class="mini-empty">当前筛选下没有人物。</div>'}
        <div class="actor-library-toolbar"><button class="btn" type="button" data-toggle-library-filters>角色筛选</button><span>只展示已通过人物身份与跨视角一致性验证的资产</span></div>
        ${actorLibraryFilterPanel()}
        <div class="actor-library-carousel">${visible.map((actor, index) => {
          const profile = actorLibraryProfile(actor); const portrait = actor.character_library?.portrait_image_url || actor.cover_image_url || actor.image_url;
          return `<button type="button" class="actor-library-card ${actor.id === state.selectedId ? 'is-selected' : ''}" data-actor-id="${escapeHtml(actor.id)}">
            ${actorLibraryImage(portrait, `${actor.name || '人物'}头像`, 'actor-library-card-image')}
            <b>${escapeHtml(actor.name || profile.displayName || `人物 ${index + 1}`)}</b><span>${escapeHtml(profile.roleName || '人物资产')}</span>
          </button>`;
        }).join('')}</div>
      </div>` : '<div class="mini-empty">人物素材库中还没有通过身份一致性验证的可用人物；历史测试演员不会再作为正式角色展示。</div>';
      modal.body.querySelector('[data-toggle-library-filters]')?.addEventListener('click', event => {
        const panel = modal.body.querySelector('[data-library-filter-panel]'); panel.hidden = !panel.hidden;
        event.currentTarget.classList.toggle('primary', !panel.hidden);
      });
      modal.body.querySelectorAll('[data-library-filter]').forEach(button => {
        const key = button.dataset.libraryFilter;
        button.classList.toggle('is-active', state.filters[key] === button.dataset.filterValue);
        button.addEventListener('click', () => { state.filters[key] = state.filters[key] === button.dataset.filterValue ? '' : button.dataset.filterValue; render(); });
      });
      modal.body.querySelector('[data-clear-library-filters]')?.addEventListener('click', () => { state.filters = {}; render(); });
      modal.body.querySelectorAll('[data-actor-id]').forEach(button => button.addEventListener('click', () => { state.selectedId = button.dataset.actorId; render(); loadSelectedDetail(state.selectedId); }));
      modal.body.querySelector('[data-apply-selected-actor]')?.addEventListener('click', async event => {
        const actor = state.details.get(state.selectedId) || rows.find(row => row.id === state.selectedId); if (!actor) return;
        const button = event.currentTarget; setButtonBusy(button, true, '正在写入项目…', { elapsed: true });
        try {
          await store.attachMaterial('person', actor);
          if (actor.person_contract?.status === 'verified') await store.runStage('person-provider-sync');
          toast('人物资产已写入当前项目，Seedance 人物 ID 正在后台核对。', 'success');
          modal.close(); await context.refreshShell();
        } catch (error) { toast(error.message, 'danger'); setButtonBusy(button, false); }
      });
    };
    render();
    loadSelectedDetail(state.selectedId);
  } catch (error) {
    modal.body.innerHTML = `<div class="error-text">${escapeHtml(error.message)}</div>`;
  }
}

export function openRealPersonFlow({ context, taskId, imageModel = () => '' }) {
  const modal = assetModal('上传真人并由 AI 补全人物档案');
  modal.body.innerHTML = `<div class="source-explainer"><b>不是只上传一张人物图</b><p>系统会先锁定授权真人身份，再补全正/侧/背面、表情、服装细节和动作类别；人工确认后保存人物 ID，并同步到 Seedance 人物资产库。</p></div>
    <form class="real-person-source-form" data-real-person-form>
      <label><span>授权真人正面照</span><input name="file" type="file" accept="image/png,image/jpeg,image/webp" required></label>
      <div class="form-grid two"><label><span>人物名称</span><input name="displayName" required></label><label><span>身份 / 关系</span><input name="roleName" placeholder="如：母亲、设计师、顾客" required></label></div>
      <label><span>外貌、气质与年龄</span><textarea name="appearanceText" rows="2" placeholder="请在正文写明实际年龄；其他外貌信息可简写，AI 会在保持真人身份的前提下补全"></textarea></label>
      <label><span>服装与配饰</span><textarea name="wardrobeText" rows="2" placeholder="留空时保留原穿搭"></textarea></label>
      <label><span>发型 / 妆造</span><textarea name="hairMakeupText" rows="2"></textarea></label>
      <label class="check-row"><input name="rights" type="checkbox" required> 我确认已获得该真人的肖像与商业使用授权</label>
      <label class="check-row"><input name="adult" type="checkbox" required> 我确认该真人已年满 18 周岁</label>
      <button class="btn primary" type="submit">上传并生成身份候选</button>
    </form>`;
  modal.body.querySelector('[data-real-person-form]').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    const fd = new FormData(form);
    const file = fd.get('file');
    if (!(file instanceof File) || !file.size) return toast('请选择真人照片。', 'warning');
    setButtonBusy(button, true, '正在安全上传…', { elapsed: true });
    try {
      const upload = new FormData();
      upload.append('file', file); upload.append('kind', 'identity'); upload.append('rights_confirmed', 'true'); upload.append('adult_confirmed', 'true');
      const source = await request('/api/new-story-ad/real-person-sources', { method: 'POST', body: upload, timeoutMs: 120000 });
      const profile = Object.fromEntries(['displayName', 'roleName', 'appearanceText', 'wardrobeText', 'hairMakeupText'].map(key => [key, String(fd.get(key) || '')]));
      await request(`/api/new-story-ad/tasks/${encodeURIComponent(taskId)}/person-outfit-candidates`, { method: 'POST', body: { source_id: source.source.id, mode: profile.wardrobeText ? 'ai_outfit' : 'retain_original', wardrobe: profile.wardrobeText, person_profile: profile, image_model: imageModel() } });
      const renderCandidates = production => {
        const candidates = production.candidates || [];
        modal.body.innerHTML = `${inlineJobProgress(production)}${candidates.length ? `<div class="candidate-grid">${candidates.map(candidate => `<button type="button" data-candidate="${escapeHtml(candidate.id)}" ${candidate.selectable === false ? 'disabled' : ''}>${mediaPreview(candidate, { label: '身份候选', width: 520, symbol: '候选' })}<b>${candidate.selectable === false ? '一致性未通过' : '选择此人物身份'}</b></button>`).join('')}</div>` : '<p>AI 正在保持真人身份的前提下生成候选，请勿关闭页面。</p>'}`;
        modal.body.querySelectorAll('[data-candidate]').forEach(candidateButton => candidateButton.addEventListener('click', async () => {
          try {
            await request(`/api/new-story-ad/tasks/${encodeURIComponent(taskId)}/person-outfit-candidates/${encodeURIComponent(candidateButton.dataset.candidate)}/approve`, { method: 'POST' });
            await request(`/api/new-story-ad/tasks/${encodeURIComponent(taskId)}/person-dossiers`, { method: 'POST', body: { image_model: imageModel() } });
            const completed = await waitForPersonJob(taskId, 'dossier_job', current => { modal.body.innerHTML = `${inlineJobProgress(current)}<p>正在补全人物视角、表情、细节与动作类别…</p>`; });
            if (completed.dossier_job?.status !== 'completed' || !completed.dossier) throw new Error(completed.dossier_job?.error?.message || '完整人物档案生成失败');
            modal.body.innerHTML = `${inlineJobProgress(completed)}${mediaPreview(completed.dossier.sheet || {}, { label: '完整人物档案', width: 1400, symbol: '人物档案' })}<div class="modal-actions"><button class="btn primary" type="button" data-approve-dossier>确认档案并同步 Seedance</button></div>`;
            modal.body.querySelector('[data-approve-dossier]').addEventListener('click', async approveEvent => {
              const approveButton = approveEvent.currentTarget;
              setButtonBusy(approveButton, true, '正在保存人物 ID 并同步 Seedance…', { elapsed: true });
              try {
                const result = await request(`/api/new-story-ad/tasks/${encodeURIComponent(taskId)}/person-dossiers/approve`, { method: 'POST', body: {}, timeoutMs: 900000 });
                if (result.provider_sync?.status === 'failed') toast('人物档案已保存；Seedance 人物 ID 同步失败，可在人物卡中单独重试。', 'warning');
                else toast('真人完整档案、人物 ID 与 Seedance 厂商人物 ID 已保存。', 'success');
                modal.close(); await context.refreshShell();
              } catch (error) { toast(error.message, 'danger'); setButtonBusy(approveButton, false); }
            });
          } catch (error) { toast(error.message, 'danger'); }
        }));
      };
      const production = await waitForPersonJob(taskId, 'candidate_job', renderCandidates);
      renderCandidates(production);
    } catch (error) { toast(error.message, 'danger'); setButtonBusy(button, false); }
  });
}
