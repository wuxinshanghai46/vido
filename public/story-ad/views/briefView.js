import { request } from '../api.js?v=20260824-production-v201y';
import { elapsedTimeTag, escapeHtml, setButtonBusy, toast } from '../components/ui.js?v=20260824-production-v201y';
import { confirmDialog, promptDialog } from '../components/dialog.js?v=20260824-production-v201y';
import { briefSettingsSummary } from './briefSettingsSummary.js?v=20260824-production-v201y';
import { worldSettingFields } from './briefWorldSettings.js?v=20260824-production-v201y';
import { bindNarrativeRecognitionLayout } from './briefNarrativeRecognition.js?v=20260824-production-v201y';
import { referenceProgress as renderReferenceProgress } from './referenceProgressCard.js?v=20260824-production-v201y';
import { assertBriefReadback } from './briefTextContract.js?v=20260824-production-v201y';
import { confirmContentModeMigration } from './briefContentModeMigration.js?v=20260824-production-v201y';
import { BRIEF_MATERIALS } from './briefMaterials.js?v=20260824-production-v201y';
import { bindAdvancedReferenceControls, renderAdvancedReferenceControls } from './briefAdvancedConfig.js?v=20260824-production-v201y';
import { bindBriefDialogueWorkflow, briefDialogueMarkup, referenceNextStepDescription } from './briefDialoguePanel.js?v=20260824-production-v201y';
import { syncReferenceDialogueStatus } from './briefReferenceDialogueState.js?v=20260824-production-v201y';
import { referenceActionState, syncReferenceAction } from './briefReferenceActionState.js?v=20260824-production-v201y';
import { bindBriefViewport, briefDialogueAssist } from './briefDialogueRuntime.js?v=20260824-production-v201y';
import { bindBriefSettingsModal } from './briefSettingsModal.js?v=20260824-production-v201y';
import { formPayload } from './briefFormPayload.js?v=20260824-production-v201y';
import { bindBriefReferenceRecovery } from './briefReferenceRecovery.js?v=20260824-production-v201y';
export function referenceProgress(reference = {}) { return renderReferenceProgress(reference); }

export async function mount(host, context) {
  const { route, store, navigate } = context;
  const bundle = store.state.bundle || {};
  const brief = bundle.brief || {};
  const outputLabel = brief.content_mode === 'commercial_subject' ? '广告脚本' : '剧情与对白';
  const referenceAttached = Boolean(bundle.reference?.analysis_id);
  const benchmark = brief.benchmark_strategy || {};
  const worldProfile = brief.world_setting?.profiles?.[0] || {};
  const referenceAction = referenceActionState(bundle.reference || {}, brief.content_mode);
  const referenceStepVisible = referenceAttached && !route.isNew;
  const showReferenceStepGuidance = referenceStepVisible && bundle.navigation?.steps?.brief?.completed !== true;
  host.innerHTML = `
    ${briefDialogueMarkup(bundle, route, {
      referenceProgressMarkup: showReferenceStepGuidance ? referenceProgress(bundle.reference) : '',
    })}
    ${showReferenceStepGuidance && !referenceAction.blocked ? `<section class="card brief-reference-primary-action is-top-action" data-brief-inline-action aria-live="polite">
      <div class="brief-next-step-copy"><span class="status-tag is-info" data-brief-next-tag>下一步</span><div><h2>生成${escapeHtml(outputLabel)}</h2><p data-brief-next-description>${escapeHtml(referenceNextStepDescription(bundle.reference || {}, referenceAction, brief.content_mode))}</p></div></div>
      <button class="btn primary" type="submit" form="storyAdBriefForm" data-brief-submit>${escapeHtml(referenceAction.label)}</button>
    </section>` : ''}
    <div data-brief-settings-anchor>
    <dialog class="brief-settings-modal" data-brief-settings-modal aria-labelledby="brief-settings-modal-title">
      <div class="brief-settings-dialog" data-brief-settings-layout>
        <header class="brief-settings-dialog-head"><div><small>项目确认单</small><h2 id="brief-settings-modal-title">手动编辑全部设置</h2><p>这里与对话使用同一份项目数据；修改会立即同步到确认单，确认设想时统一保存。</p></div><button class="btn" type="button" data-brief-settings-close aria-label="关闭手动设置">关闭</button></header>
        <div class="brief-settings-dialog-scroll">
        ${referenceAttached ? briefSettingsSummary(bundle) : ''}
        <form id="storyAdBriefForm" class="brief-form" data-brief-form>
          <div class="card-body form-grid">
<section class="brief-config-section full" aria-labelledby="brief-basic-settings-title">
<header class="brief-config-heading"><span class="brief-config-index">01</span><span><b id="brief-basic-settings-title">基础信息</b><small>必须先明确内容类型，再填写目标。内容类型不会由 AI 擅自切换。</small></span></header>
<div class="brief-basic-grid">
          <label class="field full"><span>项目名称</span><input class="input" name="project_name" required maxlength="120" value="${escapeHtml(brief.project_name || bundle.project?.title || '')}" placeholder="请输入便于识别的项目名称"><small>由你命名，只用于项目识别，不限制最少字数；修改内容目标不会再自动改名。</small></label>
          <label class="field brief-setting-tile brief-content-mode-field"><span>内容类型 <em>必须选择</em></span><select class="select" name="content_mode" required>
<option value="" ${brief.content_mode_source !== 'user' ? 'selected' : ''}>请选择广告或剧情</option>
<option value="commercial_subject" ${brief.content_mode_source === 'user' && brief.content_mode === 'commercial_subject' ? 'selected' : ''}>广告</option>
<option value="narrative_story" ${brief.content_mode_source === 'user' && brief.content_mode === 'narrative_story' ? 'selected' : ''}>剧情</option>
</select><small>广告会识别商品或服务主体；剧情不创建商品主体。参考视频可以辅助识别内容，但不会替你修改这里的选择。</small></label>
          <label class="field full"><span class="field-label-with-action"><span>内容目标 / 剧本需求</span>${referenceAttached ? '' : '<button class="btn small ai-action" type="button" data-ai-brief>AI 帮写</button>'}</span><textarea class="textarea brief-screenplay-input" name="brief" rows="12" placeholder="写清楚想表达的产品信息，或故事中的人物、地点和事件；AI 帮写后会按详细概述、出场人物、主要场景、剧情段落和结尾分段显示，仍可继续修改。">${escapeHtml(brief.text || '')}</textarea><small>${referenceAttached ? '这是参考内容提炼出的目标。你可以直接修改，保存后将以你的版本为准。' : '剧情和广告都会整理成正常剧本式结构；保留你写明的人物、场景、故事、商品与业务事实，不提前生成分镜。'}</small></label>
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
<section class="brief-config-section full" aria-labelledby="brief-optional-settings-title">
<header class="brief-config-heading"><span class="brief-config-index">03</span><span><b id="brief-optional-settings-title">参考材料与识别信息</b><small>这些是可选精调项，不是创建项目的必经步骤。</small></span></header>
${renderAdvancedReferenceControls(bundle, route.isNew)}
<div class="brief-side-world-grid">${worldSettingFields(worldProfile, escapeHtml, { formId: 'storyAdBriefForm' })}</div>
</section>
          <input type="hidden" name="benchmark_opening_hook" value="${escapeHtml(benchmark.opening_hook || '')}">
          <input type="hidden" name="benchmark_subject_introduction" value="${escapeHtml(benchmark.subject_introduction || '')}">
          <input type="hidden" name="benchmark_proof_sequence" value="${escapeHtml(benchmark.proof_sequence || '')}">
          <input type="hidden" name="benchmark_spectacle" value="${escapeHtml(benchmark.spectacle || '')}">
          <input type="hidden" name="benchmark_closing" value="${escapeHtml(benchmark.closing || '')}">
          <input type="hidden" name="benchmark_camera_language" value="${escapeHtml(benchmark.camera_language || '')}">
          <input type="hidden" name="benchmark_prompt_method" value="${escapeHtml(benchmark.prompt_method || '')}">
          <input type="hidden" name="benchmark_naturalness_review" value="${escapeHtml(benchmark.naturalness_review || '')}">
          <input type="hidden" name="creative_brief_confirmed" value="${brief.brief_intake?.creative_brief_confirmed === true ? 'true' : 'false'}">
          <input type="hidden" name="specifications_confirmed" value="${brief.brief_intake?.specifications_confirmed === true ? 'true' : 'false'}">
          <input type="hidden" name="reference_decision" value="${referenceAttached ? 'attached' : escapeHtml(brief.brief_intake?.reference_decision || '')}">
          <input type="hidden" name="completed_dialogue_topics" value="${escapeHtml((brief.brief_intake?.completed_dialogue_topics || []).join(','))}">
          <input type="hidden" name="active_dialogue_topic" value="${escapeHtml(brief.brief_intake?.active_dialogue_topic || '')}">
          <input type="hidden" name="dialogue_history" value="${escapeHtml(JSON.stringify(brief.brief_intake?.dialogue_history || []))}">
          <input type="hidden" name="cast_intent" value="${escapeHtml(JSON.stringify(brief.brief_intake?.cast_intent || {}))}">
          ${referenceStepVisible ? '' : `<div class="field full form-actions"><button class="btn primary" type="submit" data-brief-submit ${!route.isNew && referenceAction.blocked ? 'disabled' : ''}>${route.isNew ? '保存项目设想' : referenceAction.label}</button></div>`}
          </div>
        </form>
        </div>
        <footer class="brief-settings-dialog-foot"><button class="btn primary" type="button" data-brief-settings-close>完成设置</button></footer>
      </div>
    </dialog>
    </div>
    <div data-reference-understanding-host></div>
    ${BRIEF_MATERIALS.map(([id]) => `<input class="hidden-input" hidden type="file" data-material-file="${id}" ${id === 'reference' ? 'accept="video/mp4,video/quicktime,video/webm"' : 'accept="image/png,image/jpeg,image/webp"'}>`).join('')}`;
  const cleanupBriefViewport = bindBriefViewport(host);
  const form = host.querySelector('[data-brief-form]');
  bindAdvancedReferenceControls(host);
  const briefSettingsLayout = host.querySelector('[data-brief-settings-layout]');
  const briefSettingsModalController = bindBriefSettingsModal(host);
  let createdProjectId = route.isNew ? '' : bundle.project?.id;
  const dirtyFields = new Set();
  const syncScreenplayLayout = bindNarrativeRecognitionLayout({ form });
  const understandingHost = host.querySelector('[data-reference-understanding-host]');
  let understandingController = null;
  let understandingLoadSequence = 0;
  let disposed = false;
  let lastReferenceAttached = referenceAttached;
  let lastReferenceStatus = String(bundle.reference?.status || '').toLowerCase();
  let assetPlanTransitioning = false;
  let dialogueCleanup = () => {};
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
    const module = await import('./referenceUnderstandingView.js?v=20260824-production-v201y');
    if (disposed || sequence !== understandingLoadSequence || !understandingHost) return;
    if (understandingController) understandingController.update(reference);
    else understandingController = module.mountReferenceUnderstanding(understandingHost, {
      reference,
      taskId: createdProjectId,
      store,
      onConfirmed: async () => {
        const nextButton = host.querySelector('[data-brief-inline-action] [data-brief-submit]');
        const proceeded = await proceedToPlot(nextButton);
        if (!proceeded) host.querySelector('[data-brief-inline-action]')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      },
    });
  }
  syncReferenceUnderstanding(bundle.reference || {}).catch(error => toast(error.message, 'danger'));
  briefSettingsLayout.addEventListener('input', event => { if (event.target?.name) dirtyFields.add(event.target.name); if (event.target?.name === 'brief') syncScreenplayLayout(); });
  briefSettingsLayout.addEventListener('change', event => { if (event.target?.name) dirtyFields.add(event.target.name); });
  function safeFormPayload() { const current = formPayload(form);
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
      creative_brief_confirmed: latest.brief_intake?.creative_brief_confirmed === true ? 'true' : 'false',
      specifications_confirmed: latest.brief_intake?.specifications_confirmed === true ? 'true' : 'false',
      reference_decision: latest.brief_intake?.reference_decision || '',
      completed_dialogue_topics: (latest.brief_intake?.completed_dialogue_topics || []).join(','),
      active_dialogue_topic: latest.brief_intake?.active_dialogue_topic || '',
      dialogue_history: JSON.stringify(latest.brief_intake?.dialogue_history || []),
      cast_intent: JSON.stringify(latest.brief_intake?.cast_intent || {}),
      production_mode: 'auto',
      brief_intake: latest.brief_intake || { creative_brief_confirmed: false, specifications_confirmed: false, reference_decision: '' },
      benchmark_strategy: latest.benchmark_strategy || {},
      world_setting: latest.world_setting || null,
    };
    Object.keys(current).forEach(key => {
      if (dirtyFields.has(key) || (key === 'content' && dirtyFields.has('brief')) || (key === 'benchmark_strategy' && [...dirtyFields].some(name => name.startsWith('benchmark_')))) authoritative[key] = current[key];
    });
    if (dirtyFields.has('content_mode')) authoritative.content_mode_source = 'user';
    if (['world_family', 'world_fidelity', 'visual_medium', 'world_period', 'world_region'].some(name => dirtyFields.has(name))) authoritative.world_setting = current.world_setting;
    if (dirtyFields.has('brief') || dirtyFields.has('content_mode') || authoritative.content_mode === 'narrative_story') authoritative.product_subject = '';
    authoritative.brief_intake = current.brief_intake;
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
    syncReferenceDialogueStatus(host, nextReference);
    dialogueCleanup.updateReference?.(nextReference);
    const nextReferenceAttached = Boolean(nextReference.analysis_id);
    const nextReferenceStatus = String(nextReference.status || '').toLowerCase();
    if (briefSettingsModalController.modal?.open && (nextReferenceAttached !== lastReferenceAttached || (nextReferenceAttached && nextReferenceStatus !== lastReferenceStatus))) briefSettingsModalController.close();
    lastReferenceAttached = nextReferenceAttached; lastReferenceStatus = nextReferenceStatus;
    if (!route.isNew) {
      const nextMode = nextState.bundle?.brief?.content_mode || '';
      const action = referenceActionState(nextReference, nextMode);
      host.querySelectorAll('[data-brief-submit]').forEach(button => syncReferenceAction(button, nextReference, nextMode));
      const description = host.querySelector('[data-brief-next-description]');
      if (description) description.textContent = referenceNextStepDescription(nextReference, action, nextMode);
      const nextTag = host.querySelector('[data-brief-next-tag]');
      if (nextTag) {
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
    await store.loadBundle(createdProjectId, 'summary,reference');
    dirtyFields.clear();
    return createdProjectId;
  }

  async function proceedToPlot(button) {
    if (assetPlanTransitioning) return false;
    assetPlanTransitioning = true;
    host.querySelectorAll('[data-brief-submit]').forEach(target => setButtonBusy(target, true, '正在检查并保存…'));
    try {
      const reference = store.state.bundle?.reference || {};
      const status = String(reference.status || '').toLowerCase();
      const actionState = referenceActionState(reference, store.state.bundle?.brief?.content_mode || '');
      if (actionState.blocked) {
        throw new Error(status === 'failed'
          ? '参考视频分析失败，请重新识别或更换视频后再创建方案。'
          : (status === 'completed' && reference.analysis_valid === true
            ? '请先核对并确认参考理解报告，再创建人物与场景方案。'
            : '参考视频仍在分析中，请等待完成后再创建方案。'));
      }
      const payload = safeFormPayload();
      if (!payload.content_mode || payload.content_mode_source !== 'user') throw new Error('请先选择“广告”或“剧情”。');
      const migration = await confirmContentModeMigration(String(store.state.bundle?.brief?.content_mode || '').trim(), payload.content_mode);
      if (migration.cancelled) return false;
      if (migration.confirmed) payload.content_mode_change_confirmed = true;
      const commercial = payload.content_mode === 'commercial_subject';
      host.querySelectorAll('[data-brief-submit], [data-dialogue-confirm]').forEach(target => setButtonBusy(target, true, commercial ? '正在生成广告脚本…' : '正在生成剧情…', { elapsed: true }));
      if (dirtyFields.size) {
        const savedBundle = await store.updateRequest(payload, { refreshSections: 'summary' });
        assertBriefReadback(payload.brief, savedBundle?.brief?.text || '');
        dirtyFields.clear();
      }
      const contentRevision = Math.max(1, Number(store.state.bundle?.revisions?.content || 1) || 1);
      await store.runStage('blueprint', {
        expected_content_revision: contentRevision,
        idempotency_key: `${createdProjectId}:blueprint:brief-confirm:r${contentRevision}`,
      });
      navigate(`/story-ad/projects/${encodeURIComponent(createdProjectId)}?view=plot`);
      toast(commercial ? '广告脚本已提交生成。确认脚本后，系统才会继续提取制作主体与场景。' : '详细剧情与对白已提交生成。确认剧情后，系统才会继续提取人物与场景。', 'success');
      return true;
    } catch (error) {
      if (error?.code === 'GENERATION_ALREADY_RUNNING' && createdProjectId) {
        navigate(`/story-ad/projects/${encodeURIComponent(createdProjectId)}?view=plot`);
        const mode = String(store.state.bundle?.brief?.content_mode || '');
        toast(mode === 'commercial_subject' ? '广告脚本生成已提交，本次没有重复调用模型。' : '剧情生成已提交，本次没有重复调用模型。', 'success');
        return true;
      }
      toast(error.message, 'danger');
      return false;
    } finally {
      assetPlanTransitioning = false;
      host.querySelectorAll('[data-brief-submit]').forEach(target => {
        setButtonBusy(target, false);
        syncReferenceAction(target, store.state.bundle?.reference || {}, store.state.bundle?.brief?.content_mode || '');
      });
      host.querySelectorAll('[data-dialogue-confirm]').forEach(target => {
        setButtonBusy(target, false);
        target.textContent = store.state.bundle?.brief?.content_mode === 'commercial_subject' ? '确认设想，生成广告脚本' : '确认设想，生成剧情与对白';
      });
    }
  }

  async function handleReferenceLink(button, { onStart, providedUrl = '' } = {}) {
    const url = String(providedUrl || '').trim() || await promptDialog('添加参考链接', {
      message: '粘贴无需登录即可访问的公开视频链接。',
      inputLabel: '参考视频链接',
      placeholder: 'https://',
      confirmText: '继续',
    });
    if (!url) return { cancelled: true };
    if (!await confirmDialog('请确认你拥有该链接视频的分析与使用权。确认后开始读取。', {
      title: '参考视频授权确认',
      confirmText: '确认并开始读取',
    })) return { cancelled: true };
    onStart?.(url);
    try {
      const taskId = await ensureProject(button);
      setButtonBusy(button, true, '正在添加…');
      const analysis = await store.addReferenceLink(url);
      toast('参考链接已添加，读取与分析进度已显示在对话中。', 'success');
      if (route.isNew) navigate(`/story-ad/projects/${encodeURIComponent(taskId)}?view=brief`, { replace: true });
      else await context.refreshShell();
      return { taskId, analysis };
    } catch (error) {
      const requestId = String(error?.data?.request_id || '').trim();
      syncReferenceDialogueStatus(host, {
        analysis_id: 'request-failed',
        status: 'failed',
        error: `${error.message}${requestId ? `（请求编号：${requestId}）` : ''}`,
      });
      toast(error.message, 'danger');
      throw error;
    } finally {
      setButtonBusy(button, false);
    }
  }

  dialogueCleanup = bindBriefDialogueWorkflow(host, {
    form,
    referenceState: bundle.reference || {},
    referenceAttached,
    requireUserInitiation: route.isNew,
    onAssist: briefDialogueAssist(() => createdProjectId),
    onDialogueState: async () => {
      if (route.isNew || !createdProjectId) return;
      const save = async () => {
        await store.updateRequest(safeFormPayload(), { refreshSections: 'summary,reference' });
        dirtyFields.clear();
      };
      try {
        await save();
      } catch (error) {
        if (error?.code === 'CONTENT_REVISION_CONFLICT' || error?.status === 409) {
          await store.refreshSections('summary,reference');
          await save();
          return;
        }
        toast(`对话进度保存失败：${error.message}`, 'danger');
      }
    },
    onReference: () => host.querySelector('[data-material-upload="reference"]')?.click(),
    onReferenceLink: callbacks => handleReferenceLink(host.querySelector('[data-reference-link]'), callbacks),
    ensureProject,
    proceed: proceedToPlot,
    onProfessional: briefSettingsModalController.open,
    onError: (error, button) => { setButtonBusy(button, false); toast(error.message, 'danger'); },
  });

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
    await proceedToPlot(button);
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
    try { await handleReferenceLink(event.currentTarget); } catch {}
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
  const cleanupReferenceRecovery = bindBriefReferenceRecovery(host, { store, context });
  return () => {
    disposed = true;
    cleanupReferenceRecovery();
    cleanupBriefViewport();
    understandingLoadSequence += 1;
    understandingController?.destroy();
    briefSettingsModalController.destroy();
    dialogueCleanup();
    unsubscribeProgress();
  };
}
