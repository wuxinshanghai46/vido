import { request } from '../api.js?v=20260811-ui-v157';
import { elapsedTimeTag, escapeHtml, setButtonBusy, toast } from '../components/ui.js?v=20260811-ui-v157';
import { confirmDialog, promptDialog } from '../components/dialog.js?v=20260811-ui-v157';
import { briefSettingsSummary } from './briefSettingsSummary.js?v=20260811-ui-v157';
import { worldSettingFields, worldSettingPayload } from './briefWorldSettings.js?v=20260811-ui-v157';
import { referenceProgress as renderReferenceProgress } from './referenceProgressCard.js?v=20260811-ui-v157';

const MATERIALS = [['reference', '参考视频', '上传视频或粘贴公开链接'], ['product', '商品 / 主体', '上传商品或服务主体图片']];
function formPayload(form) {
  const data = new FormData(form);
  const brief = String(data.get('brief') || '').trim();
  return {
    project_name: String(data.get('project_name') || '').trim(),
    brief,
    content: brief,
    content_mode: String(data.get('content_mode') || '').trim(),
    content_mode_source: 'user',
    product_subject: '',
    target_duration: Number(data.get('target_duration') || 30) || 30,
    output_ratio: String(data.get('output_ratio') || '9:16'),
    output_size: String(data.get('output_size') || 'standard'),
    video_resolution: String(data.get('video_resolution') || '1080p'),
    production_mode: String(data.get('production_mode') || 'auto'),
    world_setting: worldSettingPayload(data),
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
      <span><b>${escapeHtml(label)}</b><small>${ready[id] ? (id === 'reference' ? '已用于本次识别，可在左侧查看理解报告' : '已作为当前项目的补充材料') : escapeHtml(hint)}</small></span>
      <span class="material-actions">
        ${id === 'reference' ? '<button class="btn" type="button" data-reference-link>粘贴链接</button>' : ''}
        <button class="btn" type="button" data-material-upload="${id}">${isNew ? '创建并添加' : (ready[id] ? '更换' : '添加')}</button>
        ${id === 'reference' && ready[id] && !reference.client_pending ? '<button class="material-remove" type="button" data-reference-remove aria-label="移除参考视频" title="移除参考视频">×</button>' : ''}
      </span>
    </div>`).join('');
}
export function referenceProgress(reference = {}) { return renderReferenceProgress(reference); }

export function referenceActionState(reference = {}) {
  if (!reference.analysis_id) return { blocked: false, label: '保存目标并创建人物与场景方案' };
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
    if (hasDeepUnderstanding && !confirmed) return { blocked: true, label: '先确认上方参考理解' };
    return { blocked: false, label: '下一步：创建人物与场景方案' };
  }
  if (status === 'failed') return { blocked: true, label: '参考视频分析失败，请重试' };
  if (status === 'cancelled') return { blocked: true, label: '参考视频分析已停止，请更换' };
  if (status === 'completed') return { blocked: true, label: '分析结果不完整，请重试' };
  return { blocked: true, label: '等待参考视频分析完成' };
}

export function referenceNextStepDescription(reference = {}) {
  const action = referenceActionState(reference);
  if (!action.blocked) return '保存你的最新设置，并创建可编辑的人物、道具和场景方案；这里只建立方案，不生成图片或视频。';
  const status = String(reference.status || '').toLowerCase();
  if (status === 'completed' && reference.analysis_valid === true) return '先核对并确认上方参考理解；确认成功后会自动创建方案并进入资产中心。';
  if (status === 'failed' || status === 'cancelled' || status === 'completed') return '当前参考识别不可用于后续制作，请按上方提示重新识别或更换参考。';
  return '参考内容仍在分析，完成并确认理解结果后会自动继续。';
}

export function syncReferenceAction(button, reference = {}) {
  if (!button) return;
  const action = referenceActionState(reference);
  button.disabled = action.blocked;
  button.textContent = action.label;
}

export async function mount(host, context) {
  const { route, store, navigate } = context;
  const bundle = store.state.bundle || {};
  const brief = bundle.brief || {};
  const referenceAttached = Boolean(bundle.reference?.analysis_id);
  const benchmark = brief.benchmark_strategy || {};
  const worldProfile = brief.world_setting?.profiles?.[0] || {};
  const referenceAction = referenceActionState(bundle.reference || {});
  const referenceStepVisible = referenceAttached && !route.isNew;
  host.innerHTML = `
    <section class="view-head">
      <div><h1>先说清楚要做什么</h1><p>先选择广告或剧情，再填写内容目标；也可以添加参考视频并让系统读取内容。</p></div>
      ${!route.isNew ? '<span class="status-tag is-neutral">第 1 步 · 目标确认</span>' : ''}
    </section>
    <div class="guide"><b>操作方法</b>　①命名项目　②填写目标或添加参考视频　③分析完成后进行资产创建</div>
    ${referenceStepVisible && !referenceAction.blocked ? `<section class="card brief-reference-primary-action is-top-action" data-brief-inline-action aria-live="polite">
      <div class="brief-next-step-copy"><span class="status-tag is-info" data-brief-next-tag>下一步</span><div><h2>创建人物与场景方案</h2><p data-brief-next-description>${escapeHtml(referenceNextStepDescription(bundle.reference || {}))}</p></div></div>
      <button class="btn primary" type="submit" form="storyAdBriefForm" data-brief-submit>${escapeHtml(referenceAction.label)}</button>
    </section>` : ''}
    <div data-reference-progress-host>${referenceProgress(bundle.reference)}</div>
    <div data-brief-settings-anchor>
    <div class="two-column" data-brief-settings-layout>
      <div class="brief-main-column">
      <details class="card brief-settings" data-brief-settings ${referenceAttached ? '' : 'open'}>
        <summary class="brief-settings-summary"><span class="brief-settings-summary-content"><span><b>内容类型、目标与成片设置</b><small>${referenceAttached ? '已从参考内容填写，可随时展开修改；保存后以你的版本为准' : '请先选择广告或剧情，再填写内容目标；添加参考视频或链接后将自动折叠'}</small></span>${referenceAttached ? briefSettingsSummary(bundle) : ''}<span class="brief-settings-edit-hint"><span class="when-collapsed">展开修改</span><span class="when-expanded">收起设置</span></span></span><i aria-hidden="true"></i></summary>
        <form id="storyAdBriefForm" class="brief-form" data-brief-form>
          <div class="card-body form-grid">
          <label class="field full"><span>项目名称</span><input class="input" name="project_name" required maxlength="120" value="${escapeHtml(brief.project_name || bundle.project?.title || '')}" placeholder="请输入便于识别的项目名称"><small>由你命名，只用于项目识别，不限制最少字数；修改内容目标不会再自动改名。</small></label>
          <label class="field full"><span class="field-label-with-action"><span>内容目标 / 剧本需求</span>${referenceAttached ? '' : '<button class="btn small ai-action" type="button" data-ai-brief>AI 帮写</button>'}</span><textarea class="textarea brief-screenplay-input" name="brief" rows="12" placeholder="写清楚想表达的产品信息，或故事中的人物、地点和事件；AI 帮写后会按详细概述、出场人物、主要场景、剧情段落和结尾分段显示，仍可继续修改。">${escapeHtml(brief.text || '')}</textarea><small>${referenceAttached ? '这是参考内容提炼出的目标。你可以直接修改，保存后将以你的版本为准。' : '剧情和广告都会整理成正常剧本式结构；保留你写明的人物、场景、故事、商品与业务事实，不提前生成分镜。'}</small></label>
<section class="brief-config-section full" aria-labelledby="brief-world-settings-title">
<header class="brief-config-heading"><span class="brief-config-index">01</span><span><b id="brief-world-settings-title">内容与世界观</b><small>题材、时代与画面形态；时期、地区留空可识别。</small></span></header>
<div class="brief-config-grid">
<label class="field brief-setting-tile"><span>内容类型</span><select class="select" name="content_mode" required>
<option value="" ${brief.content_mode_source !== 'user' ? 'selected' : ''}>请选择</option>
<option value="commercial_subject" ${brief.content_mode_source === 'user' && brief.content_mode === 'commercial_subject' ? 'selected' : ''}>广告</option>
<option value="narrative_story" ${brief.content_mode_source === 'user' && brief.content_mode === 'narrative_story' ? 'selected' : ''}>剧情</option>
</select><small>广告识别商品或服务主体；剧情不创建商品主体。</small></label>
${worldSettingFields(worldProfile, escapeHtml)}
</div></section>
<section class="brief-config-section brief-output-section full" aria-labelledby="brief-output-settings-title">
<header class="brief-config-heading"><span class="brief-config-index">02</span><span><b id="brief-output-settings-title">成片规格</b><small>时长、画幅与清晰度。</small></span></header>
<div class="brief-output-grid">
<label class="field brief-output-field"><span>目标时长</span><select class="select" name="target_duration">
${[15, 30, 45, 60, 90, 120, 180, 240, 300, 360, 480, 600].map(value => `<option value="${value}" ${Number(brief.target_duration || 30) === value ? 'selected' : ''}>${({ 60: '1 分钟', 90: '1 分 30 秒', 120: '2 分钟', 180: '3 分钟', 240: '4 分钟', 300: '5 分钟', 360: '6 分钟', 480: '8 分钟', 600: '10 分钟' })[value] || `${value} 秒`}</option>`).join('')}
</select><small>决定节奏与建议镜头量</small></label>
<label class="field brief-output-field"><span>画面比例</span><select class="select" name="output_ratio">${['9:16', '16:9', '1:1'].map(value => `<option ${brief.output_ratio === value ? 'selected' : ''}>${value}</option>`).join('')}</select><small>竖屏、横屏或方形</small></label>
<label class="field brief-output-field"><span>视频分辨率</span><select class="select" name="video_resolution">${['1080p', '720p', '4K'].map(value => `<option ${brief.video_resolution === value ? 'selected' : ''}>${value}</option>`).join('')}</select><small>最终导出清晰度</small></label>
</div></section>
          <input type="hidden" name="benchmark_opening_hook" value="${escapeHtml(benchmark.opening_hook || '')}">
          <input type="hidden" name="benchmark_subject_introduction" value="${escapeHtml(benchmark.subject_introduction || '')}">
          <input type="hidden" name="benchmark_proof_sequence" value="${escapeHtml(benchmark.proof_sequence || '')}">
          <input type="hidden" name="benchmark_spectacle" value="${escapeHtml(benchmark.spectacle || '')}">
          <input type="hidden" name="benchmark_closing" value="${escapeHtml(benchmark.closing || '')}">
          <input type="hidden" name="benchmark_camera_language" value="${escapeHtml(benchmark.camera_language || '')}">
          <input type="hidden" name="benchmark_prompt_method" value="${escapeHtml(benchmark.prompt_method || '')}">
          <input type="hidden" name="benchmark_naturalness_review" value="${escapeHtml(benchmark.naturalness_review || '')}">
          ${referenceStepVisible ? '' : `<div class="field full form-actions"><button class="btn primary" type="submit" data-brief-submit ${!route.isNew && referenceAction.blocked ? 'disabled' : ''}>${route.isNew ? '创建项目' : referenceAction.label}</button></div>`}
          </div>
        </form>
      </details>
      </div>
      <aside class="card">
        <div class="card-head"><div><h2>启动材料</h2><p>这里只放决定项目起点的参考视频和商品。人物、场景、LOGO 在资产中心添加，故事和分镜到对应环节编辑。</p></div></div>
        <div class="card-body material-list">${materialRows(bundle, route.isNew)}</div>
      </aside>
    </div>
    </div>
    <div data-reference-understanding-host></div>
    ${MATERIALS.map(([id]) => `<input class="hidden-input" hidden type="file" data-material-file="${id}" ${id === 'reference' ? 'accept="video/mp4,video/quicktime,video/webm"' : (id === 'script' ? 'accept=".txt,.md,text/plain,text/markdown"' : 'accept="image/png,image/jpeg,image/webp"')}>`).join('')}`;
  const form = host.querySelector('[data-brief-form]');
  const briefSettingsAnchor = host.querySelector('[data-brief-settings-anchor]');
  const briefSettingsLayout = host.querySelector('[data-brief-settings-layout]');
  const restoreBriefSettingsLayout = () => briefSettingsAnchor
    && briefSettingsLayout
    && briefSettingsLayout.parentElement !== briefSettingsAnchor
    && briefSettingsAnchor.appendChild(briefSettingsLayout);
  let createdProjectId = route.isNew ? '' : bundle.project?.id;
  const dirtyFields = new Set();
  const understandingHost = host.querySelector('[data-reference-understanding-host]');
  let understandingController = null;
  let understandingLoadSequence = 0;
  let disposed = false;
  let lastReferenceAttached = referenceAttached;
  let lastReferenceStatus = String(bundle.reference?.status || '').toLowerCase();
  if (referenceAttached) host.querySelector('[data-brief-settings]')?.removeAttribute('open');
  let assetPlanTransitioning = false;
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
      restoreBriefSettingsLayout();
      return;
    }
    const module = await import('./referenceUnderstandingView.js?v=20260811-ui-v157');
    if (disposed || sequence !== understandingLoadSequence || !understandingHost) return;
    if (understandingController) understandingController.update(reference);
    else understandingController = module.mountReferenceUnderstanding(understandingHost, {
      reference,
      taskId: createdProjectId,
      store,
      briefSettingsNode: briefSettingsLayout,
      onConfirmed: async () => {
        const nextButton = host.querySelector('[data-brief-inline-action] [data-brief-submit]');
        const proceeded = await proceedToAssetPlan(nextButton);
        if (!proceeded) host.querySelector('[data-brief-inline-action]')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      },
    });
  }
  syncReferenceUnderstanding(bundle.reference || {}).catch(error => toast(error.message, 'danger'));
  form.addEventListener('input', event => { if (event.target?.name) dirtyFields.add(event.target.name); });
  form.addEventListener('change', event => { if (event.target?.name) dirtyFields.add(event.target.name); });

  function safeFormPayload() {
    const current = formPayload(form);
    if (route.isNew) return current;
    const latest = store.state.bundle?.brief || {};
    const authoritative = {
      project_name: latest.project_name || store.state.bundle?.project?.title || '',
      brief: latest.text || '',
      content: latest.text || '',
      product_subject: latest.product_subject || '',
      content_mode: latest.content_mode_source === 'user' ? (latest.content_mode || '') : '',
      content_mode_source: latest.content_mode_source || '',
      target_duration: Number(latest.target_duration || 30) || 30,
      output_ratio: latest.output_ratio || '9:16',
      output_size: latest.output_size || 'standard',
      video_resolution: latest.video_resolution || '1080p',
      production_mode: 'auto',
      benchmark_strategy: latest.benchmark_strategy || {},
      world_setting: latest.world_setting || null,
    };
    Object.keys(current).forEach(key => {
      if (dirtyFields.has(key) || (key === 'content' && dirtyFields.has('brief')) || (key === 'benchmark_strategy' && [...dirtyFields].some(name => name.startsWith('benchmark_')))) authoritative[key] = current[key];
    });
    if (dirtyFields.has('content_mode')) authoritative.content_mode_source = 'user';
    if (['world_family', 'world_fidelity', 'visual_medium', 'world_period', 'world_region'].some(name => dirtyFields.has(name))) authoritative.world_setting = current.world_setting;
    if (dirtyFields.has('brief') || dirtyFields.has('content_mode') || authoritative.content_mode === 'narrative_story') authoritative.product_subject = '';
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
      content_mode: latest.content_mode_source === 'user' ? (latest.content_mode || '') : '',
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
      world_family: latest.world_setting?.profiles?.[0]?.era_family || 'auto',
      world_fidelity: latest.world_setting?.profiles?.[0]?.fidelity_mode || 'contemporary_realism',
      visual_medium: latest.world_setting?.profiles?.[0]?.visual_medium || 'auto',
      world_period: latest.world_setting?.profiles?.[0]?.time_period || '',
      world_region: typeof latest.world_setting?.profiles?.[0]?.region === 'string' ? latest.world_setting.profiles[0].region : '',
    };
    Object.entries(values).forEach(([name, value]) => {
      if (dirtyFields.has(name)) return;
      const control = form.elements.namedItem(name);
      if (control && String(control.value) !== String(value)) control.value = value;
    });
    const nextReference = nextState.bundle?.reference || {};
    const nextReferenceAttached = Boolean(nextReference.analysis_id);
    const briefSettings = host.querySelector('[data-brief-settings]');
    const nextReferenceStatus = String(nextReference.status || '').toLowerCase();
    if (briefSettings && (nextReferenceAttached !== lastReferenceAttached || (nextReferenceAttached && nextReferenceStatus !== lastReferenceStatus))) briefSettings.open = !nextReferenceAttached;
    lastReferenceAttached = nextReferenceAttached; lastReferenceStatus = nextReferenceStatus;
    if (!route.isNew) {
      host.querySelectorAll('[data-brief-submit]').forEach(button => syncReferenceAction(button, nextReference));
      const description = host.querySelector('[data-brief-next-description]');
      if (description) description.textContent = referenceNextStepDescription(nextReference);
      const nextTag = host.querySelector('[data-brief-next-tag]');
      if (nextTag) {
        const action = referenceActionState(nextReference);
        nextTag.textContent = action.blocked ? '等待完成' : '下一步';
        nextTag.className = `status-tag ${action.blocked ? 'is-neutral' : 'is-info'}`;
        nextTag.dataset.briefNextTag = '';
      }
      const summaryValues = host.querySelector('[data-brief-settings-values]');
      if (summaryValues) summaryValues.outerHTML = briefSettingsSummary(nextState.bundle || {});
    }
    syncReferenceUnderstanding(nextReference).catch(error => toast(error.message, 'danger'));
  });

  host.querySelector('[data-ai-brief]')?.addEventListener('click', async event => {
    const button = event.currentTarget;
    const textarea = form.elements.namedItem('brief');
    try {
      if (store.state.bundle?.reference?.analysis_id) throw new Error('当前项目已经添加参考视频，请使用视频分析出的广告目标。');
      const payload = safeFormPayload();
      if (!payload.content_mode || payload.content_mode_source !== 'user') throw new Error('请先选择“广告”或“剧情”，再使用 AI 帮写。');
      const isStory = payload.content_mode === 'narrative_story';
      const idea = await promptDialog(isStory ? 'AI 帮写剧情内容' : 'AI 帮写广告内容', {
        message: isStory
          ? '写下人物、关系、地点、事件或想表达的主题，AI 会整理成详细剧情、出场人物、主要场景、剧情段落和结尾，不会加入商品卖点。'
          : '写下产品或服务、目标人群、核心价值和希望观众采取的行动，AI 会整理成广告剧情、出场人物或展示主体、主要场景、广告段落和传播收束。',
        inputLabel: isStory ? '你想写的剧情内容' : '你想写的广告内容',
        placeholder: isStory
          ? '例如：一对多年未见的姐妹在故乡竹海重逢，故事表达和解与重新出发。'
          : '例如：为东方香氛制作广告，面向年轻职场女性，突出自然气味与放松体验。',
        value: String(textarea?.value || '').trim(),
        confirmText: '生成内容',
        cancelText: '取消',
        requiredMessage: isStory ? '请先输入想写的剧情内容。' : '请先输入想写的广告内容。',
        multiline: true,
        rows: 6,
        maxLength: 3000,
      });
      if (idea === null) return;
      const currentPayload = safeFormPayload();
      if (currentPayload.content_mode !== payload.content_mode || currentPayload.content_mode_source !== 'user') throw new Error('内容类型已变化，请重新点击 AI 帮写。');
      const targetSnapshot = String(textarea?.value || '');
      setButtonBusy(button, true, 'AI 帮写中…', { elapsed: true });
      const data = await request('/api/new-story-ad/assist', {
        method: 'POST',
        body: {
          mode: 'brief_goal',
          task_id: createdProjectId || '',
          brief: idea,
          product_subject: '',
          content_mode: payload.content_mode,
          content_mode_source: 'user',
          target_duration: payload.target_duration,
          output_ratio: payload.output_ratio,
        },
        timeoutMs: 120000,
      });
      if (store.state.bundle?.reference?.analysis_id) throw new Error('AI 帮写期间已添加参考视频，本次结果没有覆盖视频分析内容。');
      if (String(textarea?.value || '') !== targetSnapshot) throw new Error('你在 AI 帮写期间修改了内容目标，本次结果没有覆盖你的新内容。');
      const assisted = String(data.brief || '').trim();
      if (!assisted) throw new Error(`AI 没有返回可用的${isStory ? '剧情内容' : '广告目标'}，请保留当前输入后重试。`);
      textarea.value = assisted;
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      toast(isStory ? 'AI 已按剧本结构整理剧情，原始人物、关系和场景事实均已保留。' : 'AI 已按剧本结构整理广告，原始产品与业务事实均已保留。', 'success');
    } catch (error) {
      toast(error.message, 'danger');
    } finally {
      setButtonBusy(button, false);
    }
  });

  async function ensureProject(button) {
    if (createdProjectId) return createdProjectId;
    const payload = safeFormPayload();
    if (!payload.project_name) throw new Error('请先填写项目名称。');
    if (!payload.content_mode || payload.content_mode_source !== 'user') throw new Error('请先选择“广告”或“剧情”。');
    setButtonBusy(button, true, '正在创建…');
    const project = await store.createProject(payload);
    createdProjectId = project.id;
    await store.loadBundle(createdProjectId, 'all');
    return createdProjectId;
  }

  async function proceedToAssetPlan(button) {
    if (assetPlanTransitioning) return false;
    try {
      const reference = store.state.bundle?.reference || {};
      const status = String(reference.status || '').toLowerCase();
      const actionState = referenceActionState(reference);
      if (actionState.blocked) {
        throw new Error(status === 'failed'
          ? '参考视频分析失败，请重新识别或更换视频后再创建方案。'
          : (status === 'completed' && reference.analysis_valid === true
            ? '请先核对并确认参考理解报告，再创建人物与场景方案。'
            : '参考视频仍在分析中，请等待完成后再创建方案。'));
      }
      const payload = safeFormPayload();
      if (!payload.content_mode || payload.content_mode_source !== 'user') throw new Error('请先选择“广告”或“剧情”。');
      assetPlanTransitioning = true;
      host.querySelectorAll('[data-brief-submit]').forEach(target => setButtonBusy(target, true, '正在创建方案…', { elapsed: true }));
      await store.updateRequest(payload);
      await store.runStage('scene-config');
      toast('人物与场景方案已提交，正在进入资产中心。视觉图片仍由你在资产中心确认后生成。', 'success');
      navigate(`/story-ad/projects/${encodeURIComponent(createdProjectId)}?view=assets`);
      return true;
    } catch (error) {
      toast(error.message, 'danger');
      return false;
    } finally {
      assetPlanTransitioning = false;
      host.querySelectorAll('[data-brief-submit]').forEach(target => {
        setButtonBusy(target, false);
        syncReferenceAction(target, store.state.bundle?.reference || {});
      });
    }
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    const button = event.submitter;
    if (route.isNew) {
      try {
        const taskId = await ensureProject(button);
        toast('项目已创建。', 'success');
        navigate(`/story-ad/projects/${encodeURIComponent(taskId)}?view=brief`, { replace: true });
      } catch (error) {
        setButtonBusy(button, false);
        toast(error.message, 'danger');
      }
      return;
    }
    await proceedToAssetPlan(button);
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
  let referenceRetryPending = false;
  const handleReferenceRetry = async event => {
    const button = event.target.closest('[data-reference-retry]');
    if (!button || referenceRetryPending || button.disabled) return;
    referenceRetryPending = true;
    setButtonBusy(button, true, '正在确认…');
    const currentReference = store.state.bundle?.reference || {};
    const batchProgress = currentReference.evidence_batch_progress || {};
    const completeEvidence = Number(batchProgress.total || 0) > 0 && Number(batchProgress.completed || 0) === Number(batchProgress.total || 0);
    const reusable = currentReference.visual_evidence_reusable === true || completeEvidence;
    const semanticReusable = store.state.bundle?.reference?.semantic_result_reusable === true;
    const completedInvalid = currentReference.status === 'completed' && currentReference.analysis_valid !== true;
    const partialEvidence = Number(batchProgress.completed || 0) > 0 && Number(batchProgress.completed || 0) < Number(batchProgress.total || 0);
    const retryMessage = completedInvalid
      ? (reusable
        ? '不需要更换或重新上传。系统会保留当前视频、撤下本次不合格结果，复用已校验的镜头证据并重新调用语义识别模型，可能产生新的模型费用。是否继续？'
        : '不需要更换或重新上传。系统会保留当前视频、撤下本次不合格结果，并重新调用视觉与语义识别模型，可能产生新的模型费用。是否继续？')
      : (semanticReusable
      ? '画面证据和语义整理结果都已完整保存，本次只重新校验场景与分镜映射，不再调用模型，是否继续？'
      : (reusable
        ? '当前逐帧镜头证据已经通过完整性校验，本次不会重读图片；系统会保留最佳语义候选，只补齐未通过的语义合同，可能产生缺项修复的模型费用。是否继续？'
        : (partialEvidence
          ? `已完成 ${batchProgress.completed}/${batchProgress.total} 批镜头证据，本次只调用视觉模型读取剩余 ${batchProgress.remaining || (batchProgress.total - batchProgress.completed)} 批，不会重跑已通过批次，可能产生剩余批次的模型费用。是否继续？`
          : '当前证据没有通过逐帧完整性校验，本次将重新检测镜头并调用视觉与语义模型，可能产生新的模型费用。是否继续？')));
    let confirmed = false;
    try {
      confirmed = await confirmDialog(retryMessage, {
        title: completedInvalid ? '重新识别当前视频' : (semanticReusable ? '重新校验参考视频' : (reusable ? '继续补齐语义结构' : '重新读取镜头证据')),
        confirmText: completedInvalid ? '确认重新识别' : (semanticReusable ? '确认重新校验' : (reusable ? '确认重新整理' : '确认重新分析')),
      });
    } catch (error) {
      referenceRetryPending = false;
      setButtonBusy(button, false);
      toast(error.message, 'danger');
      return;
    }
    if (!confirmed) {
      referenceRetryPending = false;
      setButtonBusy(button, false);
      return;
    }
    try {
      setButtonBusy(button, true, completedInvalid ? '正在重新识别…' : (semanticReusable ? '正在重新校验…' : (reusable ? '正在重新整理…' : '正在重新分析…')), { elapsed: true });
      await store.retryReferenceAnalysis();
      toast(completedInvalid ? '已保留当前视频并开始重新识别，无需重新上传。' : (semanticReusable ? '已复用现有结果开始重新校验，不会再次调用模型。' : (reusable ? '已复用完整镜头证据，只继续补齐语义结构。' : '已开始重新检测并分析镜头证据。')), 'success');
    } catch (error) {
      toast(error.message, 'danger');
      setButtonBusy(button, false);
    } finally {
      referenceRetryPending = false;
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
