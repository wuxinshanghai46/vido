import { request, uploadAsset, uploadReferenceVideo } from '../api.js';

/** 创建全模块唯一状态仓库。 */
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
    referenceTimer: null,
    referenceAnalysisId: '',
  };
  const listeners = new Set();
  const notify = () => listeners.forEach(listener => listener(state));
  const set = patch => { Object.assign(state, patch); notify(); };

  /** 加载真实任务列表和同响应统计。 */
  async function loadProjects(options = {}) {
    set({ loading: true, error: '' });
    try {
      const query = new URLSearchParams({ limit: String(options.limit || 50), page: String(options.page || 1) });
      if (options.status) query.set('status', options.status);
      const data = await request(`/api/story-ad/projects?${query}`);
      set({ projects: data.projects || [], stats: data.stats || {}, loading: false });
      return data;
    } catch (error) {
      set({ loading: false, error: error.message });
      throw error;
    }
  }

  /** 创建新任务，仍写入现有剧情广告任务存储。 */
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

  /** 加载统一 Project Bundle。 */
  async function loadBundle(taskId, sections = 'all') {
    set({ loading: true, error: '' });
    try {
      const data = await request(`/api/story-ad/projects/${encodeURIComponent(taskId)}/bundle?sections=${encodeURIComponent(sections)}`);
      set({ bundle: data.bundle, loading: false });
      syncProgressPolling();
      syncReferencePolling();
      return data.bundle;
    } catch (error) {
      set({ loading: false, error: error.message });
      throw error;
    }
  }

  /** 合并局部 bundle，避免切换视图重复下载未变化数据。 */
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

  /** 保存目标、格式和材料元数据。 */
  async function updateRequest(patch) {
    const taskId = state.bundle?.project?.id;
    if (!taskId) throw new Error('请先创建项目。');
    set({ saving: true, error: '' });
    try {
      const body = {
        ...(patch || {}),
        base_content_revision: state.bundle?.revisions?.content || 1,
        client_edit_seq: (state.bundle?.revisions?.client_edit_seq || 0) + 1,
      };
      await request(`/api/new-story-ad/tasks/${encodeURIComponent(taskId)}`, { method: 'PUT', body });
      const bundle = await loadBundle(taskId, 'summary,reference,assets');
      set({ saving: false });
      return bundle;
    } catch (error) {
      set({ saving: false, error: error.message });
      throw error;
    }
  }

  /** 执行现有文本、资产或媒体阶段。 */
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
      set({ saving: false });
      syncProgressPolling(true);
      return data;
    } catch (error) {
      set({ saving: false, error: error.message });
      throw error;
    }
  }

  /** 保存用户编辑后的剧情蓝图。 */
  async function saveBlueprint(blueprint) {
    const taskId = state.bundle?.project?.id;
    const data = await request(`/api/new-story-ad/tasks/${encodeURIComponent(taskId)}/blueprint`, {
      method: 'PUT',
      body: { blueprint },
    });
    await refreshSections('summary,story,shots');
    return data;
  }

  /** 保存用户编辑后的真实分镜。 */
  async function saveStoryboard(shots) {
    const taskId = state.bundle?.project?.id;
    const data = await request(`/api/new-story-ad/tasks/${encodeURIComponent(taskId)}/storyboard`, {
      method: 'PUT',
      body: { shots },
    });
    await refreshSections('summary,story,shots,media');
    return data;
  }

  /** 保存线稿草稿、确认或跳过状态。 */
  async function saveSketches(sketches) {
    const taskId = state.bundle?.project?.id;
    const data = await request(`/api/story-ad/projects/${encodeURIComponent(taskId)}/sketches`, {
      method: 'PUT',
      body: { sketches },
    });
    await refreshSections('summary,shots');
    return data;
  }

  /** 上传材料并返回现有资产对象。 */
  async function upload(file, role) {
    return uploadAsset(file, role);
  }

  /** 将单个上传结果按角色追加到现有任务，避免前端回写整份资产数组。 */
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

  /** 上传参考视频并开始分析。 */
  async function uploadReference(file) {
    const taskId = state.bundle?.project?.id || '';
    const created = await uploadReferenceVideo(file, taskId);
    const analysis = created.analysis || {};
    await bindReferenceAnalysis(analysis);
    if (analysis.id || analysis.analysis_id) {
      await request(`/api/new-story-ad/reference-video-analyses/${encodeURIComponent(analysis.id || analysis.analysis_id)}/start`, {
        method: 'POST',
        body: {},
      });
    }
    if (taskId) {
      await refreshSections('summary,reference');
      syncReferencePolling(true);
    }
    return analysis;
  }

  /** 创建参考链接分析记录。 */
  async function addReferenceLink(url) {
    const taskId = state.bundle?.project?.id || '';
    const data = await request('/api/new-story-ad/reference-video-links', {
      method: 'POST',
      body: { url, task_id: taskId, rights_confirmed: 'true' },
    });
    await bindReferenceAnalysis(data.analysis || {});
    if (taskId) {
      await refreshSections('summary,reference');
      syncReferencePolling(true);
    }
    return data.analysis;
  }

  /** 把参考分析记录压缩为现有 contextBuilder 的权威输入。 */
  function referenceTaskRecord(analysis = {}) {
    const result = analysis.result && typeof analysis.result === 'object' ? analysis.result : {};
    return {
      analysis_id: analysis.id || analysis.analysis_id || '',
      status: analysis.status || '',
      source: analysis.source || null,
      error: analysis.error || null,
      schema_version: Number(result.schema_version || analysis.schema_version || 3) || 3,
      analysis_scope: result.analysis_scope || analysis.analysis_scope || 'reference_content_and_creative_structure',
      generated_brief: result.generated_brief || analysis.generated_brief || '',
      source_facts: result.source_facts || analysis.source_facts || {},
      analysis_quality: result.analysis_quality || analysis.analysis_quality || {},
      story_outline: result.story_outline || analysis.story_outline || {},
      plot_beats: result.plot_beats || analysis.plot_beats || [],
      character_prompts: result.character_prompts || analysis.character_prompts || [],
      scene_prompts: result.scene_prompts || analysis.scene_prompts || [],
      camera_intents: result.camera_intents || analysis.camera_intents || [],
      character_actions: result.character_actions || analysis.character_actions || [],
      prompt_suggestions: result.prompt_suggestions || analysis.prompt_suggestions || {},
      scene_view_mapping: analysis.scene_view_mapping || null,
      identity_extraction_allowed: false,
    };
  }

  /** 将当前分析 ID 绑定到当前任务，禁止复用上一任务分析。 */
  async function bindReferenceAnalysis(analysis) {
    if (!analysis?.id && !analysis?.analysis_id) return;
    await updateRequest({ reference_video_analysis: referenceTaskRecord(analysis) });
  }

  /** 停止唯一参考分析轮询器。 */
  function stopReferencePolling() {
    if (state.referenceTimer) clearTimeout(state.referenceTimer);
    state.referenceTimer = null;
    state.referenceAnalysisId = '';
  }

  /** 轮询当前任务明确绑定的分析 ID，完成后一次性写回结构化结果。 */
  function syncReferencePolling(force = false) {
    const reference = state.bundle?.reference || {};
    const analysisId = reference.analysis_id || '';
    const active = ['importing', 'uploaded', 'queued', 'running', 'cancelling'].includes(String(reference.status || '').toLowerCase());
    if (!analysisId || (!active && !force)) return stopReferencePolling();
    if (state.referenceTimer && state.referenceAnalysisId === analysisId) return;
    stopReferencePolling();
    state.referenceAnalysisId = analysisId;
    const poll = async () => {
      if (state.referenceAnalysisId !== analysisId) return;
      try {
        const data = await request(`/api/new-story-ad/reference-video-analyses/${encodeURIComponent(analysisId)}`);
        const analysis = data.analysis || {};
        const terminal = ['completed', 'failed', 'cancelled'].includes(String(analysis.status || '').toLowerCase());
        if (terminal || analysis.status !== state.bundle?.reference?.status) await bindReferenceAnalysis(analysis);
        if (terminal) {
          stopReferencePolling();
          await refreshSections('summary,reference,assets');
          return;
        }
      } catch {}
      state.referenceTimer = setTimeout(poll, 2500);
    };
    state.referenceTimer = setTimeout(poll, 1200);
  }

  /** 离开现有任务或进入新建页时清空内存数据，禁止跨任务复用。 */
  function clearProject() {
    stopProgressPolling();
    stopReferencePolling();
    set({ bundle: null, saving: false, error: '' });
  }

  /** 读取付费视频预检结果。 */
  async function videoPreflight(mode = 'economy') {
    const taskId = state.bundle?.project?.id;
    const data = await request(`/api/new-story-ad/tasks/${encodeURIComponent(taskId)}/video/preflight?mode=${encodeURIComponent(mode)}`);
    return data.preflight;
  }

  /** 按用户确认的不可变方案提交视频生成。 */
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

  /** 停止唯一进度轮询器。 */
  function stopProgressPolling() {
    if (state.progressTimer) clearTimeout(state.progressTimer);
    state.progressTimer = null;
    state.progressTaskId = '';
  }

  /** 根据任务活动状态维护唯一进度轮询器。 */
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
        const since = state.bundle?.revisions?.content || '';
        const data = await request(`/api/new-story-ad/tasks/${encodeURIComponent(taskId)}/progress?since=${encodeURIComponent(since)}`);
        const project = { ...(state.bundle?.project || {}) };
        project.active_generation_id = data.task?.active_generation_id || data.active_generation_id || '';
        project.stage = data.task?.stage || data.stage || project.stage;
        const bundle = { ...(state.bundle || {}), project };
        set({ bundle });
        if (!project.active_generation_id && !['queued', 'running'].includes(String(data.status || ''))) {
          stopProgressPolling();
          await refreshSections('summary,story,shots,media');
          return;
        }
      } catch {}
      state.progressTimer = setTimeout(poll, 2500);
    };
    state.progressTimer = setTimeout(poll, 900);
  }

  return {
    state,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    loadProjects,
    createProject,
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
    videoPreflight,
    startVideo,
    clearProject,
    stopProgressPolling,
    stopReferencePolling,
  };
}
