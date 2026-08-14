import { request } from '../api.js?v=20260814-reference-recovery-v39';
import { escapeHtml, mediaPreview, setButtonBusy, toast } from '../components/ui.js?v=20260814-reference-recovery-v39';
import { confirmDialog } from '../components/dialog.js?v=20260814-reference-recovery-v39';

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

export async function openActorLibrary({ store, context }) {
  const modal = assetModal('选择已有人物素材');
  modal.body.innerHTML = '<div class="loading-state">正在读取人物素材库…</div>';
  try {
    const data = await request('/api/assets?type=character&limit=120');
    const rows = Array.isArray(data.data) ? data.data : [];
    modal.body.innerHTML = rows.length ? `<div class="actor-library-grid">${rows.map((actor, index) => `<button type="button" data-actor-index="${index}">
      ${mediaPreview(actor, { label: actor.name || '已有人物', width: 420, symbol: '人物' })}
      <b>${escapeHtml(actor.name || `人物 ${index + 1}`)}</b><span>${escapeHtml(actor.production_usable_actor === false ? '待验证' : '可使用')}</span>
    </button>`).join('')}</div>` : '<div class="mini-empty">人物素材库中还没有可选人物。</div>';
    modal.body.querySelectorAll('[data-actor-index]').forEach(button => button.addEventListener('click', async () => {
      const actor = rows[Number(button.dataset.actorIndex)];
      if (!actor) return;
      setButtonBusy(button, true, '正在写入项目…', { elapsed: true });
      try {
        await store.attachMaterial('person', actor);
        if (actor.person_contract?.status === 'verified') await store.runStage('person-provider-sync');
        toast('已有人物已写入当前项目，Seedance 人物 ID 正在后台核对。', 'success');
        modal.close();
        await context.refreshShell();
      } catch (error) { toast(error.message, 'danger'); setButtonBusy(button, false); }
    }));
  } catch (error) {
    modal.body.innerHTML = `<div class="error-text">${escapeHtml(error.message)}</div>`;
  }
}

export function openRealPersonFlow({ context, taskId }) {
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
    if (!await confirmDialog('将先生成 2 张身份一致性候选用于人工选择；确认候选后，完整档案会按 4 个分类图集生成并拆分为 20 项视图。', { title: '确认启动真人 AI 补全', confirmText: '确认开始' })) return;
    setButtonBusy(button, true, '正在安全上传…', { elapsed: true });
    try {
      const upload = new FormData();
      upload.append('file', file); upload.append('kind', 'identity'); upload.append('rights_confirmed', 'true'); upload.append('adult_confirmed', 'true');
      const source = await request('/api/new-story-ad/real-person-sources', { method: 'POST', body: upload, timeoutMs: 120000 });
      const profile = Object.fromEntries(['displayName', 'roleName', 'appearanceText', 'wardrobeText', 'hairMakeupText'].map(key => [key, String(fd.get(key) || '')]));
      await request(`/api/new-story-ad/tasks/${encodeURIComponent(taskId)}/person-outfit-candidates`, { method: 'POST', body: { source_id: source.source.id, mode: profile.wardrobeText ? 'ai_outfit' : 'retain_original', wardrobe: profile.wardrobeText, person_profile: profile } });
      const renderCandidates = production => {
        const candidates = production.candidates || [];
        modal.body.innerHTML = `${inlineJobProgress(production)}${candidates.length ? `<div class="candidate-grid">${candidates.map(candidate => `<button type="button" data-candidate="${escapeHtml(candidate.id)}" ${candidate.selectable === false ? 'disabled' : ''}>${mediaPreview(candidate, { label: '身份候选', width: 520, symbol: '候选' })}<b>${candidate.selectable === false ? '一致性未通过' : '选择此人物身份'}</b></button>`).join('')}</div>` : '<p>AI 正在保持真人身份的前提下生成候选，请勿关闭页面。</p>'}`;
        modal.body.querySelectorAll('[data-candidate]').forEach(candidateButton => candidateButton.addEventListener('click', async () => {
          try {
            await request(`/api/new-story-ad/tasks/${encodeURIComponent(taskId)}/person-outfit-candidates/${encodeURIComponent(candidateButton.dataset.candidate)}/approve`, { method: 'POST' });
            if (!await confirmDialog('下一步生成完整人物档案：身体视角、身份细节、6种表情和6种动作。共 4 次图像模型调用，生成后仍需人工确认。', { title: '生成完整人物档案', confirmText: '确认生成' })) return;
            await request(`/api/new-story-ad/tasks/${encodeURIComponent(taskId)}/person-dossiers`, { method: 'POST' });
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
