import { request, uploadAsset, uploadReferenceVideo } from '../api.js?v=20260810-a-v153';
import { beginReferenceReplacement, beginReferenceRetry, referenceSyncInterrupted, replacementCurrent, removeProjectReference, restoreReferenceReplacement, restoreReferenceRetry } from './referenceReplacementState.js?v=20260810-a-v153';
import { loadProjectList } from './projectListStore.js?v=20260810-a-v153';

export function createProjectStore() {
  const state = {
    projects: [],
    stats: {},
    bundle: null,
    loading: false,
    saving: false,
    error: '',
    progressTimer: null,
    progressTaskId: '',
    progressRevision: '',
    generationCompletionSeq: 0,
    referenceTimer: null,
    referenceAnalysisId: '',
    referenceReplacementSeq: 0,
  };
  const listeners = new Set();
  const notify = () => listeners.forEach(listener => listener(state));
  const set = patch => { Object.assign(state, patch); notify(); };

  async function loadProjects(options = {}) {
    return loadProjectList({ request, set }, options);
  }

  async function createProject(payload) {
    set({ saving: true, error: '' });
    try {
      const data = await request('/api/story-ad/projects', { method: 'POST', body: payload });
      set({ saving: false });
      return data.project;
    } catch (error) {
      set({ saving: false, error: error.message });
      throw error;
    }
  }

  async function deleteProject(taskId) {
    const data = await request(`/api/new-story-ad/tasks/${encodeURIComponent(taskId)}`, { method: 'DELETE' });
    await loadProjects();
    return data;
  }

  async function loadBundle(taskId, sections = 'all') {
    set({ loading: true, error: '' });
    try {
      if (state.bundle?.project?.id && state.bundle.project.id !== taskId) state.progressRevision = '';
      const data = await request(`/api/story-ad/projects/${encodeURIComponent(taskId)}/bundle?sections=${encodeURIComponent(sections)}`);
      set({ bundle: data.bundle, loading: false });
      await hydrateReferenceFailure();
      syncProgressPolling();
      syncReferencePolling();
      return data.bundle;
    } catch (error) {
      set({ loading: false, error: error.message });
      throw error;
    }
  }

  async function refreshSections(sections) {
    const taskId = state.bundle?.project?.id;
    if (!taskId) return null;
    const data = await request(`/api/story-ad/projects/${encodeURIComponent(taskId)}/bundle?sections=${encodeURIComponent(sections)}`);
    const current = state.bundle || {};
    const next = {
      ...current,
      ...data.bundle,
      project: { ...(current.project || {}), ...(data.bundle.project || {}) },
      navigation: { ...(current.navigation || {}), ...(data.bundle.navigation || {}) },
      revisions: { ...(current.revisions || {}), ...(data.bundle.revisions || {}) },
    };
    set({ bundle: next });
    return next;
  }

  function applyMutationResult(data = {}) {
    const current = state.bundle;
    if (!current) return null;
    const task = data.task && typeof data.task === 'object' ? data.task : {};
    const context = data.context && typeof data.context === 'object' ? data.context : null;
    const contentRevision = Math.max(1, Number(data.content_revision || task.content_revision || current.revisions?.content || 1) || 1);
    const clientEditSeq = Math.max(0, Number(data.acknowledged_client_edit_seq || task.latest_client_edit_seq || current.revisions?.client_edit_seq || 0) || 0);
    const next = {
      ...current,
      project: {
        ...(current.project || {}),
        ...task,
        id: task.id || current.project?.id,
      },
      revisions: {
        ...(current.revisions || {}),
        content: contentRevision,
        client_edit_seq: clientEditSeq,
        snapshot_id: task.current_snapshot_id || current.revisions?.snapshot_id || '',
      },
    };
    if (context) {
      next.brief = {
        ...(current.brief || {}),
        project_name: context.project_name || task.title || current.brief?.project_name || '',
        text: context.brief ?? current.brief?.text,
        product_subject: context.product_subject ?? current.brief?.product_subject,
        target_duration: context.target_duration ?? context.duration ?? current.brief?.target_duration,
        output_ratio: context.output_ratio ?? current.brief?.output_ratio,
        output_size: context.output_size ?? current.brief?.output_size,
        video_resolution: context.video_resolution ?? current.brief?.video_resolution,
        cast_mode: context.cast_mode ?? current.brief?.cast_mode,
        expected_people: context.expected_people ?? current.brief?.expected_people,
        expected_animals: context.expected_animals ?? current.brief?.expected_animals,
        brief_source: context.brief_source ?? current.brief?.brief_source,
        asset_setup_confirmed: context.asset_setup_confirmed === true,
        shot_design_confirmed: context.shot_design_confirmed === true,
        creative_direction: context.creative_direction ?? current.brief?.creative_direction,
        world_setting: context.world_setting ?? current.brief?.world_setting,
      };
    }
    if (data.blueprint) next.story = { ...(current.story || {}), blueprint: data.blueprint, reference_draft: null, status: 'ready' };
    if (Array.isArray(data.shots)) next.storyboard = {
      ...(current.storyboard || {}),
      shots: data.shots,
      reference_draft: [],
      source: 'saved_storyboard',
    };
    if (task.active_generation_id) next.generation = { ...(current.generation || {}), progress: task.generation_progress || null };
    set({ bundle: next });
    return next;
  }

  async function updateRequest(patch, options = {}) {
    const taskId = state.bundle?.project?.id;
    if (!taskId) throw new Error('请先创建项目。');
    set({ saving: true, error: '' });
    try {
      const body = {
        ...(patch || {}),
        base_content_revision: state.bundle?.revisions?.content || 1,
        client_edit_seq: (state.bundle?.revisions?.client_edit_seq || 0) + 1,
      };
      const data = await request(`/api/new-story-ad/tasks/${encodeURIComponent(taskId)}`, { method: 'PUT', body, timeoutMs: 120000 });
      applyMutationResult(data);
      // refreshSections merges into the existing complete bundle.  It updates
      // navigation without dropping story/shots and avoids a large all-section
      // response on every workflow transition.
      const bundle = await refreshSections(options.refreshSections || 'summary');
      set({ saving: false });
      return bundle;
    } catch (error) {
      set({ saving: false, error: error.message });
      throw error;
    }
  }
  async function runStage(path, body = {}) {
    const taskId = state.bundle?.project?.id;
    if (!taskId) throw new Error('请先创建项目。');
    set({ saving: true, error: '' });
    try {
      const data = await request(`/api/new-story-ad/tasks/${encodeURIComponent(taskId)}/${path}`, {
        method: 'POST',
        body,
        timeoutMs: 60000,
      });
      if (data.accepted === false) { const error = new Error(`项目已有“${data.job?.stage || state.bundle?.project?.active_stage || '当前'}”任务在运行，本次没有重复提交模型调用。`); Object.assign(error, { code: 'GENERATION_ALREADY_RUNNING', active_generation_id: data.job?.generation_id || data.job?.id || '' }); throw error; }
      applyMutationResult(data);
      state.progressRevision = '';
      if (path === 'scene-config') await refreshSections('summary,assets');
      set({ saving: false });
      syncProgressPolling(true);
      return data;
    } catch (error) {
      set({ saving: false, error: error.message });
      throw error;
    }
  }

  async function saveBlueprint(blueprint) {
    const taskId = state.bundle?.project?.id;
    const data = await request(`/api/new-story-ad/tasks/${encodeURIComponent(taskId)}/blueprint`, {
      method: 'PUT',
      body: { blueprint, expected_content_revision: state.bundle?.revisions?.content || 1 },
      timeoutMs: 120000,
    });
    applyMutationResult(data);
    await refreshSections('summary');
    return data;
  }

  async function saveStoryboard(shots) {
    const taskId = state.bundle?.project?.id;
    const data = await request(`/api/new-story-ad/tasks/${encodeURIComponent(taskId)}/storyboard`, {
      method: 'PUT',
      body: { shots, expected_content_revision: state.bundle?.revisions?.content || 1 },
      timeoutMs: 120000,
    });
    applyMutationResult(data);
    await refreshSections('summary');
    return data;
  }

  async function saveSketches(sketches) {
    const taskId = state.bundle?.project?.id;
    const data = await request(`/api/story-ad/projects/${encodeURIComponent(taskId)}/sketches`, {
      method: 'PUT',
      body: { sketches },
    });
    await refreshSections('summary,shots');
    return data;
  }

  async function upload(file, role) {
    return uploadAsset(file, role);
  }

  async function attachMaterial(role, asset, options = {}) {
    const taskId = state.bundle?.project?.id;
    if (!taskId) throw new Error('请先创建项目。');
    const data = await request(`/api/story-ad/projects/${encodeURIComponent(taskId)}/materials`, {
      method: 'POST',
      body: { role, asset, authorized: options.authorized === true },
    });
    await loadBundle(taskId, 'all');
    return data;
  }

  async function uploadReference(file) {
    const taskId = state.bundle?.project?.id || '';
    const replacement = beginReferenceReplacement(state, set, stopReferencePolling, { filename: file?.name || '新参考视频', status: 'uploading', phase: '正在创建新的上传任务' });
    try {
      const created = await uploadReferenceVideo(file, taskId);
      if (!replacementCurrent(state, replacement)) return created.analysis || {};
      let analysis = created.analysis || {};
      applyReferenceLiveState(analysis);
      if (!created.task_bound) await bindReferenceAnalysis(analysis);
      if (analysis.id || analysis.analysis_id) {
        const started = await request(`/api/new-story-ad/reference-video-analyses/${encodeURIComponent(analysis.id || analysis.analysis_id)}/start`, {
          method: 'POST',
          body: {},
        });
        analysis = started.analysis || analysis;
        applyReferenceLiveState(analysis);
        await bindReferenceAnalysis(analysis);
      }
      if (taskId) {
        await refreshSections('summary,reference');
        syncReferencePolling(true);
      }
      return analysis;
    } catch (error) {
      restoreReferenceReplacement(state, set, replacement);
      throw error;
    }
  }

  async function addReferenceLink(url) {
    const taskId = state.bundle?.project?.id || '';
    const replacement = beginReferenceReplacement(state, set, stopReferencePolling, { filename: '新参考链接', status: 'importing', phase: '正在创建新的链接读取任务' });
    try {
      const data = await request('/api/new-story-ad/reference-video-links', {
        method: 'POST',
        body: { url, task_id: taskId, rights_confirmed: 'true' },
        timeoutMs: 120000,
      });
      if (!replacementCurrent(state, replacement)) return data.analysis;
      applyReferenceLiveState(data.analysis || {});
      if (!data.task_bound) await bindReferenceAnalysis(data.analysis || {});
      if (taskId) {
        await refreshSections('summary,reference');
        syncReferencePolling(true);
      }
      return data.analysis;
    } catch (error) {
      restoreReferenceReplacement(state, set, replacement);
      throw error;
    }
  }

  async function retryReferenceAnalysis() {
    const analysisId = state.bundle?.reference?.analysis_id || '';
    if (!analysisId) throw new Error('当前没有可重新整理的参考视频。');
    const previousReference = beginReferenceRetry(state, set);
    try {
      const data = await request(`/api/new-story-ad/reference-video-analyses/${encodeURIComponent(analysisId)}/reanalyze`, {
        method: 'POST',
        body: {},
      });
      const analysis = data.analysis || {};
      applyReferenceLiveState(analysis);
      syncReferencePolling(true);
      set({ saving: false });
      return analysis;
    } catch (error) {
      restoreReferenceRetry(state, set, previousReference, error);
      throw error;
    }
  }

  function referenceTaskRecord(analysis = {}) {
    const result = analysis.result && typeof analysis.result === 'object' ? analysis.result : {};
    return {
      analysis_id: analysis.id || analysis.analysis_id || '',
      status: analysis.status || '',
      progress: Math.max(0, Math.min(100, Number(analysis.progress || 0) || 0)),
      phase: String(analysis.phase || '').trim(),
      created_at: analysis.created_at || '',
      started_at: analysis.started_at || '',
      updated_at: analysis.updated_at || '',
      completed_at: analysis.completed_at || '',
      failed_at: analysis.failed_at || '',
      cancelled_at: analysis.cancelled_at || '',
      checkpoints: Array.isArray(analysis.checkpoints) ? analysis.checkpoints.slice(-12) : [],
      source: analysis.source || null,
      error: analysis.error || null,
      visual_evidence_reusable: analysis.visual_evidence_reusable === true,
      semantic_result_reusable: analysis.semantic_result_reusable === true,
      evidence_batch_progress: analysis.evidence_batch_progress && typeof analysis.evidence_batch_progress === 'object' ? analysis.evidence_batch_progress : { total: 0, completed: 0, remaining: 0, failed: 0 },
      semantic_contract_progress: analysis.semantic_contract_progress && typeof analysis.semantic_contract_progress === 'object' ? analysis.semantic_contract_progress : null,
      schema_version: Number(result.schema_version || analysis.schema_version || 3) || 3,
      analysis_scope: result.analysis_scope || analysis.analysis_scope || 'reference_content_and_creative_structure',
      generated_brief: result.generated_brief || analysis.generated_brief || '',
      summary: result.summary || analysis.summary || '',
      source_facts: result.source_facts || analysis.source_facts || {},
      analysis_quality: result.analysis_quality || analysis.analysis_quality || {},
      story_outline: result.story_outline || analysis.story_outline || {},
      plot_beats: result.plot_beats || analysis.plot_beats || [],
      reference_understanding: result.reference_understanding || analysis.reference_understanding || null,
      character_prompts: result.character_prompts || analysis.character_prompts || [],
      animal_prompts: result.animal_prompts || analysis.animal_prompts || [],
      scene_prompts: result.scene_prompts || analysis.scene_prompts || [],
      shot_breakdown: result.shot_breakdown || analysis.shot_breakdown || [],
      camera_intents: result.camera_intents || analysis.camera_intents || [],
      character_actions: result.character_actions || analysis.character_actions || [],
      animal_actions: result.animal_actions || analysis.animal_actions || [],
      prompt_suggestions: result.prompt_suggestions || analysis.prompt_suggestions || {},
      scene_view_mapping: analysis.scene_view_mapping || null,
      identity_extraction_allowed: false,
    };
  }

  function applyReferenceLiveState(analysis = {}) {
    if (!state.bundle) return;
    const live = referenceTaskRecord(analysis);
    set({
      bundle: {
        ...state.bundle,
        reference: {
          ...(state.bundle.reference || {}),
          analysis_id: live.analysis_id || state.bundle.reference?.analysis_id || '',
          status: live.status || state.bundle.reference?.status || '',
          progress: live.progress,
          phase: live.phase,
          started_at: live.started_at || state.bundle.reference?.started_at || '',
          updated_at: live.updated_at || state.bundle.reference?.updated_at || '',
          completed_at: live.completed_at,
          failed_at: live.failed_at,
          cancelled_at: live.cancelled_at,
          checkpoints: live.checkpoints,
          error: live.error && typeof live.error === 'object'
            ? (live.error.message || live.error.code || '')
            : (live.error || ''),
          retry_after_ms: Math.max(0, Number(live.error?.retry_after_ms || 0) || 0),
          visual_evidence_reusable: live.visual_evidence_reusable === true,
          semantic_result_reusable: live.semantic_result_reusable === true,
          evidence_batch_progress: live.evidence_batch_progress,
          semantic_contract_progress: live.semantic_contract_progress,
          generated_brief: live.generated_brief,
          source_facts: live.source_facts,
          analysis_valid: live.analysis_quality?.valid === true,
          analysis_quality: live.analysis_quality,
          story_outline: live.story_outline,
          plot_beats: live.plot_beats,
          reference_understanding: live.reference_understanding,
          character_prompts: live.character_prompts,
          animal_prompts: live.animal_prompts,
          scene_prompts: live.scene_prompts,
          shot_breakdown: live.shot_breakdown,
          camera_intents: live.camera_intents,
          character_actions: live.character_actions,
          sync_interrupted: false,
          sync_interrupted_at: '',
          last_known_status: '',
        },
      },
    });
  }

  async function hydrateReferenceFailure() {
    const reference = state.bundle?.reference || {};
    if (!reference.analysis_id || String(reference.status || '').toLowerCase() !== 'failed') return;
    try {
      const data = await request(`/api/new-story-ad/reference-video-analyses/${encodeURIComponent(reference.analysis_id)}`);
      if (state.bundle?.reference?.analysis_id !== reference.analysis_id) return;
      applyReferenceLiveState(data.analysis || {});
    } catch {}
  }

  async function bindReferenceAnalysis(analysis) {
    if (!analysis?.id && !analysis?.analysis_id) return;
    const record = referenceTaskRecord(analysis);
    const currentBrief = state.bundle?.brief || {};
    const completedAndValid = record.status === 'completed' && record.analysis_quality?.valid === true;
    // The generated brief is the complete, evidence-grounded hand-off.  A
    // one-line logline is useful for cards, but must never replace the full
    // story understanding at the first workflow step.
    const derivedBrief = String(record.generated_brief || record.summary || record.story_outline?.logline || '').trim();
    const derivedProduct = String(record.source_facts?.product_or_service || '').trim();
    const currentBriefText = String(currentBrief.text || '').trim();
    const canRefreshReferenceBrief = !currentBriefText
      || ['', 'reference_analysis'].includes(String(currentBrief.brief_source || '').trim());
    const currentProduct = String(currentBrief.product_subject || '').trim();
    const canRefreshReferenceProduct = !currentProduct
      || ['当前广告主体', '广告主体', '当前产品', '商品主体', '产品主体'].includes(currentProduct);
    await updateRequest({
      reference_video_analysis: record,
      ...(completedAndValid && derivedBrief && canRefreshReferenceBrief
        ? { brief: derivedBrief, content: derivedBrief, brief_source: 'reference_analysis' }
        : {}),
      ...(completedAndValid && canRefreshReferenceProduct && derivedProduct
        ? { product_subject: derivedProduct }
        : {}),
    });
  }

  function stopReferencePolling() {
    if (state.referenceTimer) clearTimeout(state.referenceTimer);
    state.referenceTimer = null;
    state.referenceAnalysisId = '';
  }

  function syncReferencePolling(force = false) {
    const reference = state.bundle?.reference || {};
    const analysisId = reference.analysis_id || '';
    const status = String(reference.status || '').toLowerCase();
    const active = ['importing', 'uploaded', 'queued', 'running', 'cancelling', 'sync_interrupted'].includes(status);
    if (!analysisId || (!active && !force)) return stopReferencePolling();
    if (state.referenceTimer && state.referenceAnalysisId === analysisId) return;
    stopReferencePolling();
    state.referenceAnalysisId = analysisId;
    const poll = async () => {
      if (state.referenceAnalysisId !== analysisId) return;
      let terminal = false;
      try {
        const data = await request(`/api/new-story-ad/reference-video-analyses/${encodeURIComponent(analysisId)}`);
        if (state.referenceAnalysisId !== analysisId) return;
        let analysis = data.analysis || {};
        if (String(analysis.status || '').toLowerCase() === 'uploaded') {
          const started = await request(`/api/new-story-ad/reference-video-analyses/${encodeURIComponent(analysisId)}/start`, {
            method: 'POST',
            body: {},
          });
          if (state.referenceAnalysisId !== analysisId) return;
          analysis = started.analysis || analysis;
        }
        terminal = ['completed', 'failed', 'cancelled'].includes(String(analysis.status || '').toLowerCase());
        applyReferenceLiveState(analysis);
        // Terminal projection belongs to the server. Stop polling first, then
        // refresh the server-owned workspace once.
        if (terminal) stopReferencePolling();
        if (terminal) {
          await refreshSections('all');
          return;
        }
      } catch (error) {
        if (!terminal && state.referenceAnalysisId !== analysisId) return;
        const currentReference = state.bundle?.reference || {};
        const interruptedAt = currentReference.sync_interrupted_at || new Date().toISOString();
        set({
          error: error.message,
          bundle: state.bundle ? {
            ...state.bundle,
            reference: referenceSyncInterrupted(currentReference, error, interruptedAt),
          } : state.bundle,
        });
        if (terminal) return;
      }
      if (state.referenceAnalysisId !== analysisId) return;
      state.referenceTimer = setTimeout(poll, 2500);
    };
    state.referenceTimer = setTimeout(poll, 1200);
  }

  function clearProject() {
    stopProgressPolling();
    stopReferencePolling();
    set({ bundle: null, saving: false, error: '', progressRevision: '' });
  }

  async function videoPreflight(mode = 'economy') {
    const taskId = state.bundle?.project?.id;
    const data = await request(`/api/new-story-ad/tasks/${encodeURIComponent(taskId)}/video/preflight?mode=${encodeURIComponent(mode)}`);
    return data.preflight;
  }

  async function startVideo(preflight, options = {}) {
    const cost = preflight?.cost_plan || {};
    return runStage('video', {
      video_generation_mode: preflight?.mode || 'economy',
      video_preflight_fingerprint: preflight?.fingerprint || '',
      cost_plan_fingerprint: cost.fingerprint || '',
      confirmed_cost_limit_rmb: Number(cost.maximum_cost_rmb || 0),
      complexity_review_confirmed: options.complexity_review_confirmed === true,
      visual_only: options.visual_only === true,
    });
  }

  function stopProgressPolling() {
    if (state.progressTimer) clearTimeout(state.progressTimer);
    state.progressTimer = null;
    state.progressTaskId = '';
  }

  function syncProgressPolling(force = false) {
    const taskId = state.bundle?.project?.id || '';
    const active = force || !!state.bundle?.project?.active_generation_id;
    if (!taskId || !active) return stopProgressPolling();
    if (state.progressTimer && state.progressTaskId === taskId) return;
    stopProgressPolling();
    state.progressTaskId = taskId;
    const poll = async () => {
      if (state.progressTaskId !== taskId) return;
      try {
        const since = state.progressRevision || '';
        const data = await request(`/api/new-story-ad/tasks/${encodeURIComponent(taskId)}/progress?since=${encodeURIComponent(since)}`);
        state.progressRevision = String(data.revision || state.progressRevision || '');
        const progressTask = data.task || {};
        const project = {
          ...(state.bundle?.project || {}),
          status: progressTask.status || state.bundle?.project?.status || '',
          stage: progressTask.stage || state.bundle?.project?.stage || '',
          active_stage: progressTask.active_stage || '',
          active_generation_id: progressTask.active_generation_id || '',
          generation_queued_at: progressTask.generation_queued_at || state.bundle?.project?.generation_queued_at || '',
          generation_started_at: progressTask.generation_started_at || state.bundle?.project?.generation_started_at || '',
          generation_finished_at: progressTask.generation_finished_at || state.bundle?.project?.generation_finished_at || '',
          generation_progress: progressTask.generation_progress || null,
          error: progressTask.error || '',
          error_code: progressTask.error_code || '',
          retryable: progressTask.retryable === true,
        };
        const generation = {
          ...(state.bundle?.generation || {}),
          progress: progressTask.generation_progress || null,
        };
        const bundle = { ...(state.bundle || {}), project, generation };
        set({ bundle, progressRevision: state.progressRevision });
        if (!project.active_generation_id && !['queued', 'running', 'processing'].includes(String(project.status || '').toLowerCase())) {
          stopProgressPolling();
          await refreshSections('summary,assets,story,shots,media');
          set({ generationCompletionSeq: state.generationCompletionSeq + 1 });
          return;
        }
      } catch {}
      state.progressTimer = setTimeout(poll, 2500);
    };
    state.progressTimer = setTimeout(poll, 900);
  }

  async function cancelGeneration(generationId = '') {
    const taskId = state.bundle?.project?.id;
    if (!taskId) throw new Error('当前没有可停止的项目。');
    const data = await request(`/api/new-story-ad/tasks/${encodeURIComponent(taskId)}/cancel`, {
      method: 'POST',
      body: { generation_id: generationId || state.bundle?.project?.active_generation_id || '' },
    });
    stopProgressPolling();
    await refreshSections('summary,assets,story,shots,media');
    set({ generationCompletionSeq: state.generationCompletionSeq + 1 });
    return data;
  }

  return {
    state,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    loadProjects,
    createProject,
    deleteProject,
    loadBundle,
    refreshSections,
    updateRequest,
    runStage,
    saveBlueprint,
    saveStoryboard,
    saveSketches,
    upload,
    attachMaterial,
    uploadReference,
    addReferenceLink,
    retryReferenceAnalysis,
    removeReference: () => removeProjectReference({ state, set, request, stopPolling: stopReferencePolling, applyMutationResult }),
    videoPreflight,
    startVideo,
    cancelGeneration,
    clearProject,
    syncProgressPolling,
    stopProgressPolling,
    stopReferencePolling,
  };
}
