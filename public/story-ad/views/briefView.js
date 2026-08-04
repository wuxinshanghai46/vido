import { request } from '../api.js?v=20260804-reference-reanalysis-v12';
import { elapsedTimeTag, escapeHtml, setButtonBusy, toast } from '../components/ui.js?v=20260804-reference-reanalysis-v12';
import { confirmDialog, promptDialog } from '../components/dialog.js?v=20260804-reference-reanalysis-v12';

const MATERIALS = [
  ['reference', '参考视频', '上传视频或粘贴公开链接'],
  ['product', '商品 / 主体', '上传商品或服务主体图片'],
];

/** 从表单生成现有任务接口可以接受的请求。 */
function formPayload(form) {
  const data = new FormData(form);
  const brief = String(data.get('brief') || '').trim();
  return {
    project_name: String(data.get('project_name') || '').trim(),
    brief,
    content: brief,
    product_subject: String(data.get('product_subject') || '').trim(),
    target_duration: Number(data.get('target_duration') || 30) || 30,
    output_ratio: String(data.get('output_ratio') || '9:16'),
    output_size: String(data.get('output_size') || 'standard'),
    video_resolution: String(data.get('video_resolution') || '1080p'),
    production_mode: String(data.get('production_mode') || 'auto'),
    benchmark_strategy: {
      source: 'platform_competitor_learning',
      opening_hook: String(data.get('benchmark_opening_hook') || '').trim(),
      subject_introduction: String(data.get('benchmark_subject_introduction') || '').trim(),
      proof_sequence: String(data.get('benchmark_proof_sequence') || '').trim(),
      spectacle: String(data.get('benchmark_spectacle') || '').trim(),
      closing: String(data.get('benchmark_closing') || '').trim(),
      camera_language: String(data.get('benchmark_camera_language') || '').trim(),
      prompt_method: String(data.get('benchmark_prompt_method') || '').trim(),
      naturalness_review: String(data.get('benchmark_naturalness_review') || '').trim(),
      user_edited: true,
    },
  };
}

/** 输出真实材料当前状态。 */
function materialRows(bundle, isNew) {
  const reference = bundle?.reference || {};
  const assets = bundle?.assets || {};
  const ready = {
    reference: !!(reference.analysis_id || reference.filename || reference.url),
    product: !!assets.products?.some(item => item.image_url
      || item.dossier_sheet?.image_url
      || (Array.isArray(item.view_images) && item.view_images.some(view => view.image_url))),
    person: !!(assets.people?.length || assets.animals?.length),
    scene: !!(assets.scenes?.length || bundle?.materials?.roles?.includes('scene_reference')),
    logo: !!assets.logos?.length,
    script: !!bundle?.story?.blueprint,
  };
  return MATERIALS.map(([id, label, hint]) => `
    <div class="material-row ${ready[id] ? 'is-ready' : ''}" data-material-row="${id}">
      <span><b>${escapeHtml(label)}</b><small>${ready[id] ? '已连接当前项目内容' : escapeHtml(hint)}</small></span>
      <span class="material-actions">
        ${id === 'reference' ? '<button class="btn" type="button" data-reference-link>粘贴链接</button>' : ''}
        <button class="btn" type="button" data-material-upload="${id}">${isNew ? '创建并添加' : (ready[id] ? '更换' : '添加')}</button>
        ${id === 'reference' && ready[id] && !reference.client_pending ? '<button class="material-remove" type="button" data-reference-remove aria-label="移除参考视频" title="移除参考视频">×</button>' : ''}
      </span>
    </div>`).join('');
}

/** 首屏只展示参考分析状态；结构化内容继续按制作环节渐进展示。 */
export function referenceProgress(reference = {}) {
  if (!reference.analysis_id) return '';
  const status = String(reference.status || '').toLowerCase();
  const active = ['uploading', 'importing', 'uploaded', 'queued', 'running', 'cancelling'].includes(status);
  const completed = status === 'completed';
  const completedInvalid = completed && reference.analysis_valid !== true;
  const failed = status === 'failed';
  const cancelled = status === 'cancelled';
  const labels = {
    uploading: '正在上传参考视频',
    importing: '正在读取参考链接',
    uploaded: '视频已就绪，等待分析',
    queued: '已进入分析队列',
    running: '正在分析参考视频',
    cancelling: '正在停止分析',
    completed: completedInvalid ? '镜头读取完成，深度识别未通过' : '参考视频分析完成',
    failed: '参考视频分析失败',
    cancelled: '参考视频分析已取消',
  };
  const numeric = Math.max(0, Math.min(100, Number(reference.progress || 0) || 0));
  const percent = completed ? 100 : numeric;
  const phase = completedInvalid
    ? '深度识别未通过质量校验，旧结果已停止使用'
    : String(reference.phase || labels[status] || '等待分析').trim();
  const tone = failed || completedInvalid ? 'is-failed' : (completed ? 'is-completed' : (cancelled ? 'is-cancelled' : 'is-active'));
  const hasDeepReport = !!(
    Object.keys(reference.reference_understanding?.story_bible || reference.reference_understanding?.story_summary || reference.story_bible || {}).length
    || (reference.reference_understanding?.story_events || reference.reference_understanding?.causal_chain || reference.story_events)?.length
    || (reference.reference_understanding?.character_arcs || reference.reference_understanding?.characters || reference.character_arcs)?.length
    || (reference.reference_understanding?.scene_narratives || reference.reference_understanding?.scenes || reference.scene_narratives)?.length
  );
  const baseNote = completed
    ? (completedInvalid
      ? '本次深度识别没有通过质量校验，旧结果不会进入后续制作。原视频已保留，可直接重新识别，无需更换或重新上传。'
      : (hasDeepReport
      ? '深度理解报告已就绪。请核对故事、人物、场景、品牌、镜头与声音证据；确认前不会进入后续资产创建。'
      : '广告目标已自动填入；故事、人物/动物、场景、分镜和机位已分配到后续对应环节。'))
    : (failed
      ? (reference.error || '本次分析没有完成，请更换参考视频或重新尝试。')
      : (cancelled
        ? '分析已经停止，当前未完成的结果不会进入后续制作环节。'
        : '正在后台读取和理解视频；完成后会自动填写广告目标，并把其他结果分配到对应制作环节。'));
  const batchProgress = reference.evidence_batch_progress && typeof reference.evidence_batch_progress === 'object'
    ? reference.evidence_batch_progress
    : {};
  const batchTotal = Math.max(0, Number(batchProgress.total || 0) || 0);
  const batchCompleted = Math.max(0, Math.min(batchTotal, Number(batchProgress.completed || 0) || 0));
  const partialEvidence = failed && batchTotal > 0 && batchCompleted > 0 && batchCompleted < batchTotal;
  const retryMinutes = Math.ceil(Math.max(0, Number(reference.retry_after_ms || 0) || 0) / 60000);
  const note = [
    baseNote,
    partialEvidence ? `已完成 ${batchCompleted}/${batchTotal} 批，重试只会继续读取剩余 ${batchTotal - batchCompleted} 批。` : '',
    failed && retryMinutes > 0 ? `备用模型正在限流保护中，建议约 ${retryMinutes} 分钟后继续。` : '',
  ].filter(Boolean).join(' ');
  const retry = (failed || cancelled || completedInvalid) && reference.client_pending !== true
    ? `<button class="btn" type="button" data-reference-retry>${completedInvalid || cancelled ? '重新识别当前视频' : (reference.semantic_result_reusable === true ? '复用现有结果重新校验' : (reference.visual_evidence_reusable === true ? '复用完整证据重新整理' : (partialEvidence ? `继续读取缺失镜头（${batchCompleted}/${batchTotal} 批）` : '重新读取镜头证据')))}</button>`
    : '';
  const finishedAt = reference.completed_at || reference.failed_at || reference.cancelled_at || reference.updated_at || '';
  return `<section class="reference-progress-card ${tone}" aria-live="polite">
    <div class="reference-progress-head">
      <span><b>${escapeHtml(labels[status] || '参考视频状态')}</b><small>${escapeHtml(reference.filename || '当前参考视频')}</small></span>
      <span class="reference-progress-stats">${elapsedTimeTag({ startedAt: reference.started_at, finishedAt, active })}<strong>${percent}%</strong></span>
    </div>
    <div class="reference-progress-phase"><span class="reference-progress-pulse" aria-hidden="true"></span>${escapeHtml(phase)}</div>
    <div class="reference-progress-track" role="progressbar" aria-label="参考视频分析进度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}"><i style="width:${percent}%"></i></div>
    <div class="reference-progress-foot"><p>${escapeHtml(note)}</p>${retry}</div>
  </section>`;
}

/** 统一目标页主操作对参考分析状态的判定，避免进度卡和按钮各自维护一套状态。 */
export function referenceActionState(reference = {}) {
  if (!reference.analysis_id) return { blocked: false, label: '进行资产创建' };
  const status = String(reference.status || '').toLowerCase();
  if (status === 'completed' && reference.analysis_valid === true) {
    const understanding = reference.reference_understanding && typeof reference.reference_understanding === 'object'
      ? { ...reference, ...reference.reference_understanding }
      : reference;
    const hasDeepUnderstanding = !!(
      Object.keys(understanding.story_bible || {}).length
      || Object.keys(understanding.story_summary || {}).length
      || understanding.story_events?.length
      || understanding.causal_chain?.length
      || understanding.character_arcs?.length
      || understanding.characters?.length
      || understanding.scene_narratives?.length
      || understanding.scenes?.length
      || Object.keys(understanding.brand_role || {}).length
      || understanding.audio_visual_alignment?.length
      || understanding.inferences?.length
      || understanding.unknowns?.length
    );
    const confirmation = understanding.reference_understanding_confirmation || understanding.understanding_confirmation || understanding.confirmation || {};
    const confirmed = understanding.understanding_confirmed === true
      || understanding.authoritative_input_confirmed === true
      || confirmation.confirmed === true
      || ['confirmed', 'authoritative_input'].includes(String(confirmation.status || confirmation.confirmation || '').toLowerCase());
    if (hasDeepUnderstanding && !confirmed) return { blocked: true, label: '请先确认参考理解报告' };
    return { blocked: false, label: '进行资产创建' };
  }
  if (status === 'failed') return { blocked: true, label: '参考视频分析失败，请重试' };
  if (status === 'cancelled') return { blocked: true, label: '参考视频分析已停止，请更换' };
  if (status === 'completed') return { blocked: true, label: '分析结果不完整，请重试' };
  return { blocked: true, label: '等待参考视频分析完成' };
}

export function syncReferenceAction(button, reference = {}) {
  if (!button) return;
  const action = referenceActionState(reference);
  button.disabled = action.blocked;
  button.textContent = action.label;
}

/** 挂载目标与材料页。 */
export async function mount(host, context) {
  const { route, store, navigate } = context;
  const bundle = store.state.bundle || {};
  const brief = bundle.brief || {};
  const referenceAttached = Boolean(bundle.reference?.analysis_id);
  const benchmark = brief.benchmark_strategy || {};
  const referenceAction = referenceActionState(bundle.reference || {});
  host.innerHTML = `
    <section class="view-head">
      <div><h1>先说清楚要做什么</h1><p>命名项目后，可以自己填写广告目标，也可以直接添加参考视频并让系统读取内容。</p></div>
      ${!route.isNew ? '<span class="status-tag is-neutral">第 1 步 · 目标确认</span>' : ''}
    </section>
    <div class="guide"><b>操作方法</b>　①命名项目　②填写目标或添加参考视频　③分析完成后进行资产创建</div>
    <div data-reference-progress-host>${referenceProgress(bundle.reference)}</div>
    <div class="two-column">
      <form class="card brief-form" data-brief-form>
        <div class="card-head"><div><h2>这支剧情广告要讲什么？</h2><p>可以手动填写；选择参考视频时，这里会自动采用分析出的广告内容。</p></div></div>
        <div class="card-body form-grid">
          <label class="field full"><span>项目名称</span><input class="input" name="project_name" required maxlength="120" value="${escapeHtml(brief.project_name || bundle.project?.title || '')}" placeholder="请输入便于识别的项目名称"><small>由你命名，只用于项目识别，不限制最少字数；修改广告目标不会再自动改名。</small></label>
          <label class="field full"><span class="field-label-with-action"><span>广告目标</span>${referenceAttached ? '' : '<button class="btn small ai-action" type="button" data-ai-brief>AI 帮写</button>'}</span><textarea class="textarea" name="brief" rows="7" placeholder="先输入一句广告想法，再点击 AI 帮写；添加参考视频时也可以留空。">${escapeHtml(brief.text || '')}</textarea><small>${referenceAttached ? '分析完成后这里只显示提炼出的广告目标，其他内容会进入对应制作环节。' : 'AI 只丰富广告目标，不会提前生成人物、场景、故事、分镜或机位；生成后仍可继续修改。'}</small></label>
          <label class="field"><span>产品或主题</span><input class="input" name="product_subject" value="${escapeHtml(brief.product_subject || '')}" placeholder="没有商品也可以留空"></label>
          <label class="field"><span>目标时长</span><select class="select" name="target_duration">
            ${[15, 30, 45, 60].map(value => `<option value="${value}" ${Number(brief.target_duration || 30) === value ? 'selected' : ''}>${value} 秒</option>`).join('')}
          </select></label>
          <label class="field"><span>画面比例</span><select class="select" name="output_ratio">
            ${['9:16', '16:9', '1:1'].map(value => `<option ${brief.output_ratio === value ? 'selected' : ''}>${value}</option>`).join('')}
          </select></label>
          <label class="field"><span>视频分辨率</span><select class="select" name="video_resolution">
            ${['1080p', '720p', '4K'].map(value => `<option ${brief.video_resolution === value ? 'selected' : ''}>${value}</option>`).join('')}
          </select></label>
          <input type="hidden" name="benchmark_opening_hook" value="${escapeHtml(benchmark.opening_hook || '')}">
          <input type="hidden" name="benchmark_subject_introduction" value="${escapeHtml(benchmark.subject_introduction || '')}">
          <input type="hidden" name="benchmark_proof_sequence" value="${escapeHtml(benchmark.proof_sequence || '')}">
          <input type="hidden" name="benchmark_spectacle" value="${escapeHtml(benchmark.spectacle || '')}">
          <input type="hidden" name="benchmark_closing" value="${escapeHtml(benchmark.closing || '')}">
          <input type="hidden" name="benchmark_camera_language" value="${escapeHtml(benchmark.camera_language || '')}">
          <input type="hidden" name="benchmark_prompt_method" value="${escapeHtml(benchmark.prompt_method || '')}">
          <input type="hidden" name="benchmark_naturalness_review" value="${escapeHtml(benchmark.naturalness_review || '')}">
          <div class="field full form-actions"><button class="btn primary" type="submit" data-brief-submit ${!route.isNew && referenceAction.blocked ? 'disabled' : ''}>${route.isNew ? '创建项目' : referenceAction.label}</button></div>
        </div>
      </form>
      <aside class="card">
        <div class="card-head"><div><h2>启动材料</h2><p>这里只放决定项目起点的参考视频和商品。人物、场景、LOGO 在资产中心添加，故事和分镜到对应环节编辑。</p></div></div>
        <div class="card-body material-list">${materialRows(bundle, route.isNew)}</div>
      </aside>
    </div>
    <div data-reference-understanding-host></div>
    ${MATERIALS.map(([id]) => `<input class="hidden-input" hidden type="file" data-material-file="${id}" ${id === 'reference' ? 'accept="video/mp4,video/quicktime,video/webm"' : (id === 'script' ? 'accept=".txt,.md,text/plain,text/markdown"' : 'accept="image/png,image/jpeg,image/webp"')}>`).join('')}`;

  const form = host.querySelector('[data-brief-form]');
  let createdProjectId = route.isNew ? '' : bundle.project?.id;
  const dirtyFields = new Set();
  const understandingHost = host.querySelector('[data-reference-understanding-host]');
  let understandingController = null;
  let understandingLoadSequence = 0;
  let disposed = false;

  /** 深度报告按需加载；未附加参考或分析未完成时不下载报告代码与样式。 */
  async function syncReferenceUnderstanding(reference = {}) {
    const sequence = ++understandingLoadSequence;
    const nested = reference.reference_understanding && typeof reference.reference_understanding === 'object'
      ? { ...reference, ...reference.reference_understanding }
      : reference;
    const hasReport = String(reference.status || '').toLowerCase() === 'completed' && !!(
      Object.keys(nested.story_bible || {}).length
      || Object.keys(nested.story_summary || {}).length
      || nested.story_events?.length
      || nested.causal_chain?.length
      || nested.character_arcs?.length
      || nested.characters?.length
      || nested.scene_narratives?.length
      || nested.scenes?.length
      || Object.keys(nested.brand_role || {}).length
      || nested.audio_visual_alignment?.length
      || nested.inferences?.length
      || nested.unknowns?.length
    );
    if (!hasReport) {
      understandingController?.destroy();
      understandingController = null;
      if (understandingHost) understandingHost.innerHTML = '';
      return;
    }
    const module = await import('./referenceUnderstandingView.js?v=20260804-reference-reanalysis-v12');
    if (disposed || sequence !== understandingLoadSequence || !understandingHost) return;
    if (understandingController) understandingController.update(reference);
    else understandingController = module.mountReferenceUnderstanding(understandingHost, {
      reference,
      taskId: createdProjectId,
      store,
    });
  }

  syncReferenceUnderstanding(bundle.reference || {}).catch(error => toast(error.message, 'danger'));
  form.addEventListener('input', event => { if (event.target?.name) dirtyFields.add(event.target.name); });
  form.addEventListener('change', event => { if (event.target?.name) dirtyFields.add(event.target.name); });

  /** 未经本次页面主动编辑的字段始终使用 Store 最新值，防止分析完成后旧 DOM 覆盖识别结果。 */
  function safeFormPayload() {
    const current = formPayload(form);
    if (route.isNew) return current;
    const latest = store.state.bundle?.brief || {};
    const authoritative = {
      project_name: latest.project_name || store.state.bundle?.project?.title || '',
      brief: latest.text || '',
      content: latest.text || '',
      product_subject: latest.product_subject || '',
      target_duration: Number(latest.target_duration || 30) || 30,
      output_ratio: latest.output_ratio || '9:16',
      output_size: latest.output_size || 'standard',
      video_resolution: latest.video_resolution || '1080p',
      production_mode: 'auto',
      benchmark_strategy: latest.benchmark_strategy || {},
    };
    Object.keys(current).forEach(key => {
      if (dirtyFields.has(key) || (key === 'content' && dirtyFields.has('brief')) || (key === 'benchmark_strategy' && [...dirtyFields].some(name => name.startsWith('benchmark_')))) authoritative[key] = current[key];
    });
    authoritative.brief_source = dirtyFields.has('brief') ? 'user' : (latest.brief_source || '');
    return authoritative;
  }

  const unsubscribeProgress = store.subscribe(nextState => {
    const progressHost = host.querySelector('[data-reference-progress-host]');
    if (progressHost) progressHost.innerHTML = referenceProgress(nextState.bundle?.reference || {});
    const latest = nextState.bundle?.brief || {};
    const values = {
      project_name: latest.project_name || nextState.bundle?.project?.title || '',
      brief: latest.text || '',
      product_subject: latest.product_subject || '',
      target_duration: String(Number(latest.target_duration || 30) || 30),
      output_ratio: latest.output_ratio || '9:16',
      video_resolution: latest.video_resolution || '1080p',
      benchmark_opening_hook: latest.benchmark_strategy?.opening_hook || '',
      benchmark_subject_introduction: latest.benchmark_strategy?.subject_introduction || '',
      benchmark_proof_sequence: latest.benchmark_strategy?.proof_sequence || '',
      benchmark_spectacle: latest.benchmark_strategy?.spectacle || '',
      benchmark_closing: latest.benchmark_strategy?.closing || '',
      benchmark_camera_language: latest.benchmark_strategy?.camera_language || '',
      benchmark_prompt_method: latest.benchmark_strategy?.prompt_method || '',
      benchmark_naturalness_review: latest.benchmark_strategy?.naturalness_review || '',
    };
    Object.entries(values).forEach(([name, value]) => {
      if (dirtyFields.has(name)) return;
      const control = form.elements.namedItem(name);
      if (control && String(control.value) !== String(value)) control.value = value;
    });
    if (!route.isNew) {
      syncReferenceAction(form.querySelector('[data-brief-submit]'), nextState.bundle?.reference || {});
    }
    syncReferenceUnderstanding(nextState.bundle?.reference || {}).catch(error => toast(error.message, 'danger'));
  });

  host.querySelector('[data-ai-brief]')?.addEventListener('click', async event => {
    const button = event.currentTarget;
    const textarea = form.elements.namedItem('brief');
    const idea = String(textarea?.value || '').trim();
    try {
      if (!idea) throw new Error('请先输入一句广告想法，再让 AI 帮你丰富。');
      if (store.state.bundle?.reference?.analysis_id) throw new Error('当前项目已经添加参考视频，请使用视频分析出的广告目标。');
      const payload = safeFormPayload();
      setButtonBusy(button, true, 'AI 帮写中…', { elapsed: true });
      const data = await request('/api/new-story-ad/assist', {
        method: 'POST',
        body: {
          mode: 'brief_goal',
          task_id: createdProjectId || '',
          brief: idea,
          product_subject: payload.product_subject,
          target_duration: payload.target_duration,
          output_ratio: payload.output_ratio,
        },
        timeoutMs: 120000,
      });
      if (store.state.bundle?.reference?.analysis_id) throw new Error('AI 帮写期间已添加参考视频，本次结果没有覆盖视频分析内容。');
      if (String(textarea?.value || '').trim() !== idea) throw new Error('你在 AI 帮写期间修改了广告目标，本次结果没有覆盖你的新内容。');
      const assisted = String(data.brief || '').trim();
      if (!assisted) throw new Error('AI 没有返回可用的广告目标，请保留当前想法后重试。');
      textarea.value = assisted;
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      toast('AI 已丰富广告目标；确认或修改后再进行资产创建。', 'success');
    } catch (error) {
      toast(error.message, 'danger');
    } finally {
      setButtonBusy(button, false);
    }
  });

  /** 新建模式下先建立真实任务，后续材料全部绑定该任务。 */
  async function ensureProject(button) {
    if (createdProjectId) return createdProjectId;
    const payload = safeFormPayload();
    if (!payload.project_name) throw new Error('请先填写项目名称。');
    setButtonBusy(button, true, '正在创建…');
    const project = await store.createProject(payload);
    createdProjectId = project.id;
    await store.loadBundle(createdProjectId, 'all');
    return createdProjectId;
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    const button = event.submitter;
    try {
      if (route.isNew) {
        const taskId = await ensureProject(button);
        toast('项目已创建。', 'success');
        navigate(`/story-ad/projects/${encodeURIComponent(taskId)}?view=brief`, { replace: true });
      } else {
        const reference = store.state.bundle?.reference || {};
        const status = String(reference.status || '').toLowerCase();
        const actionState = referenceActionState(reference);
        if (actionState.blocked) {
          throw new Error(status === 'failed'
            ? '参考视频分析失败，请重新识别或更换视频后再创建资产。'
            : (status === 'completed' && reference.analysis_valid === true
              ? '请先核对并确认参考理解报告，再进行资产创建。'
              : '参考视频仍在分析中，请等待完成后再创建资产。'));
        }
        setButtonBusy(button, true, '正在保存并创建资产…', { elapsed: true });
        await store.updateRequest(safeFormPayload());
        await store.runStage('scene-config');
        toast('已按当前目标和参考识别结果开始创建资产方案。', 'success');
        navigate(`/story-ad/projects/${encodeURIComponent(createdProjectId)}?view=assets`);
      }
    } catch (error) {
      setButtonBusy(button, false);
      toast(error.message, 'danger');
    }
  });

  host.querySelectorAll('[data-material-upload]').forEach(button => {
    button.addEventListener('click', () => host.querySelector(`[data-material-file="${button.dataset.materialUpload}"]`)?.click());
  });

  host.querySelectorAll('[data-material-file]').forEach(input => {
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      const role = input.dataset.materialFile;
      const button = host.querySelector(`[data-material-upload="${role}"]`);
      try {
        if (role === 'reference' && !await confirmDialog('请确认你拥有该视频的分析与使用权。确认后开始上传和分析。', {
          title: '参考视频授权确认',
          confirmText: '确认并开始分析',
        })) {
          input.value = '';
          return;
        }
        const taskId = await ensureProject(button);
        if (role === 'reference') {
          setButtonBusy(button, true, '上传视频…');
          await store.uploadReference(file);
        } else {
          setButtonBusy(button, true, '上传中…');
          const uploaded = await store.upload(file, role === 'logo' ? 'brand_logo' : `${role}_reference`);
          const asset = uploaded.asset || uploaded.data;
          await store.attachMaterial(role, asset, { authorized: role === 'logo' });
        }
        toast('材料已添加到当前项目。', 'success');
        if (route.isNew) navigate(`/story-ad/projects/${encodeURIComponent(taskId)}?view=brief`, { replace: true });
        else {
          await store.loadBundle(taskId, 'all');
          await context.refreshShell();
        }
      } catch (error) {
        toast(error.message, 'danger');
      } finally {
        setButtonBusy(button, false);
        input.value = '';
      }
    });
  });

  host.querySelector('[data-reference-link]')?.addEventListener('click', async event => {
    const url = await promptDialog('添加参考链接', {
      message: '粘贴无需登录即可访问的公开视频链接。',
      inputLabel: '参考视频链接',
      placeholder: 'https://',
      confirmText: '继续',
    });
    if (!url) return;
    if (!await confirmDialog('请确认你拥有该链接视频的分析与使用权。确认后开始读取。', {
      title: '参考视频授权确认',
      confirmText: '确认并开始读取',
    })) return;
    const button = event.currentTarget;
    try {
      const taskId = await ensureProject(button);
      setButtonBusy(button, true, '正在添加…');
      await store.addReferenceLink(url);
      toast('参考链接已添加，分析将在后台进行。', 'success');
      if (route.isNew) navigate(`/story-ad/projects/${encodeURIComponent(taskId)}?view=brief`, { replace: true });
      else await context.refreshShell();
    } catch (error) {
      toast(error.message, 'danger');
    } finally {
      setButtonBusy(button, false);
    }
  });
  host.querySelector('[data-reference-remove]')?.addEventListener('click', async event => {
    const button = event.currentTarget;
    const confirmed = await confirmDialog('移除后将解除当前项目的参考视频，停止仍在进行的分析，并清理仅由该参考生成的资产方案、剧情和分镜草稿；已完成的参考分析记录会同时删除，无法恢复。你手动填写的广告目标和材料会保留，如需再次使用请重新上传视频或粘贴链接。', {
      title: '移除参考视频',
      confirmText: '确认移除',
    });
    if (!confirmed) return;
    try {
      setButtonBusy(button, true, '…');
      await store.removeReference();
      toast('参考视频已移除，现在可以手动填写或使用 AI 帮写广告目标。', 'success');
      await context.refreshShell();
    } catch (error) {
      toast(error.message, 'danger');
      setButtonBusy(button, false);
    }
  });
  const handleReferenceRetry = async event => {
    const button = event.target.closest('[data-reference-retry]');
    if (!button) return;
    const currentReference = store.state.bundle?.reference || {};
    const reusable = currentReference.visual_evidence_reusable === true;
    const semanticReusable = store.state.bundle?.reference?.semantic_result_reusable === true;
    const batchProgress = currentReference.evidence_batch_progress || {};
    const completedInvalid = currentReference.status === 'completed' && currentReference.analysis_valid !== true;
    const partialEvidence = Number(batchProgress.completed || 0) > 0
      && Number(batchProgress.completed || 0) < Number(batchProgress.total || 0);
    const retryMessage = completedInvalid
      ? (reusable
        ? '不需要更换或重新上传。系统会保留当前视频、撤下本次不合格结果，复用已校验的镜头证据并重新调用语义识别模型，可能产生新的模型费用。是否继续？'
        : '不需要更换或重新上传。系统会保留当前视频、撤下本次不合格结果，并重新调用视觉与语义识别模型，可能产生新的模型费用。是否继续？')
      : (semanticReusable
      ? '画面证据和语义整理结果都已完整保存，本次只重新校验场景与分镜映射，不再调用模型，是否继续？'
      : (reusable
        ? '当前逐帧镜头证据已经通过完整性校验，本次会复用镜头证据并重新调用语义识别模型，可能产生新的模型费用。是否继续？'
        : (partialEvidence
          ? `已完成 ${batchProgress.completed}/${batchProgress.total} 批镜头证据，本次只调用视觉模型读取剩余 ${batchProgress.remaining || (batchProgress.total - batchProgress.completed)} 批，不会重跑已通过批次，可能产生剩余批次的模型费用。是否继续？`
          : '当前证据没有通过逐帧完整性校验，本次将重新检测镜头并调用视觉与语义模型，可能产生新的模型费用。是否继续？')));
    const confirmed = await confirmDialog(retryMessage, {
      title: completedInvalid ? '重新识别当前视频' : (semanticReusable ? '重新校验参考视频' : (reusable ? '重新整理参考视频' : '重新读取镜头证据')),
      confirmText: completedInvalid ? '确认重新识别' : (semanticReusable ? '确认重新校验' : (reusable ? '确认重新整理' : '确认重新分析')),
    });
    if (!confirmed) return;
    try {
      setButtonBusy(button, true, completedInvalid ? '正在重新识别…' : (semanticReusable ? '正在重新校验…' : (reusable ? '正在重新整理…' : '正在重新分析…')), { elapsed: true });
      await store.retryReferenceAnalysis();
      toast(completedInvalid ? '已保留当前视频并开始重新识别，无需重新上传。' : (semanticReusable ? '已复用现有结果开始重新校验，不会再次调用模型。' : (reusable ? '已复用完整镜头证据开始重新整理。' : '已开始重新检测并分析镜头证据。')), 'success');
    } catch (error) {
      toast(error.message, 'danger');
      setButtonBusy(button, false);
    }
  };
  host.addEventListener('click', handleReferenceRetry);
  return () => {
    disposed = true;
    understandingLoadSequence += 1;
    understandingController?.destroy();
    unsubscribeProgress();
    host.removeEventListener('click', handleReferenceRetry);
  };
}
