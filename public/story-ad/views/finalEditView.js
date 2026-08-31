import { request } from '../api.js?v=20260831-production-v349';
import { escapeHtml, setButtonBusy, toast } from '../components/ui.js?v=20260831-production-v349';

function videoUrl(item = {}) { return item.video_url || item.videoUrl || item.url || ''; }

function timelineRow(clip, index, edit = {}) {
  const shotIndex = Number(clip.shot_index || clip.shotIndex || index + 1);
  return `<article class="edit-shot-row" data-timeline-row data-shot-index="${shotIndex}">
    <header><b>SH${String(shotIndex).padStart(2, '0')}</b><span>${escapeHtml(clip.status || '视频已生成')}</span></header>
    <div class="edit-control-group"><label><span>裁掉开头</span><input type="number" min="0" step="0.1" value="${Number(edit.trim_start_sec || 0)}" data-trim-start><small>秒</small></label><label><span>裁掉结尾</span><input type="number" min="0" step="0.1" value="${Number(edit.trim_end_sec || 0)}" data-trim-end><small>秒</small></label><label><span>播放速度</span><input type="number" min="0.5" max="2" step="0.05" value="${Number(edit.speed || 1)}" data-clip-speed><small>倍</small></label></div>
    <div class="edit-control-group"><label class="range-field"><span>原声音量</span><input type="range" min="0" max="1" step="0.05" value="${Number(edit.clip_volume ?? 1)}" data-clip-volume></label><label class="check-field"><input type="checkbox" ${edit.muted ? 'checked' : ''} data-clip-muted><span>静音原声</span></label><label><span>连接下一镜</span><select data-transition-type>${[['hard_cut','硬切'],['cut_on_action','动作切'],['match_cut','匹配切'],['dissolve','叠化'],['fade','淡入淡出']].map(([value, label]) => `<option value="${value}" ${edit.transition_type === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label><label><span>转场时长</span><input type="number" min="0" max="2" step="0.05" value="${Number(edit.transition_duration_sec ?? 0.35)}" data-transition-duration><small>秒</small></label></div>
  </article>`;
}

function timelineItems(host) {
  return [...host.querySelectorAll('[data-timeline-row]')].map(row => ({
    shot_index: Number(row.dataset.shotIndex),
    trim_start_sec: Number(row.querySelector('[data-trim-start]')?.value || 0),
    trim_end_sec: Number(row.querySelector('[data-trim-end]')?.value || 0),
    speed: Number(row.querySelector('[data-clip-speed]')?.value || 1),
    clip_volume: Number(row.querySelector('[data-clip-volume]')?.value ?? 1),
    muted: row.querySelector('[data-clip-muted]')?.checked === true,
    transition_type: row.querySelector('[data-transition-type]')?.value || 'hard_cut',
    transition_duration_sec: Number(row.querySelector('[data-transition-duration]')?.value || 0),
  }));
}

/** 第 8 步只在初版成片存在后挂载，编辑结果通过重新合成生成新成片。 */
export async function mount(host, context) {
  const { bundle, store } = context;
  const generation = bundle?.generation || {};
  const finalVideo = generation.final_video || (bundle?.project?.final_video_url ? { video_url: bundle.project.final_video_url } : null);
  const clips = Array.isArray(generation.clips) ? generation.clips : [];
  if (!finalVideo || !videoUrl(finalVideo)) {
    context.navigate(`/story-ad/projects/${encodeURIComponent(bundle.project.id)}?view=compose`, { replace: true });
    return;
  }
  const timeline = await request(`/api/story-ad/projects/${encodeURIComponent(bundle.project.id)}/timeline`).catch(() => ({ items: [] }));
  const poster = finalVideo.poster_url || finalVideo.thumbnail_url || '';
  const downloadUrl = `${videoUrl(finalVideo)}${videoUrl(finalVideo).includes('?') ? '&' : '?'}download=1`;
  host.innerHTML = `
    <section class="view-head post-production-head"><div><span class="stage-kicker">第 8 步</span><h1>成片剪辑</h1><p>先观看已合成视频，再按镜头调整节奏、原声和转场。保存后重新合成，不会修改分镜或前序内容。</p></div><div class="view-actions"><a class="btn" href="${escapeHtml(downloadUrl)}" download="${escapeHtml(finalVideo.filename || 'vido-final.mp4')}">下载当前成片</a>${clips.length ? '<button class="btn primary" type="button" data-apply-edit>应用剪辑并重新合成</button>' : ''}</div></section>
    <div class="post-stage-summary"><span class="is-complete"><b>✓</b><em>声音</em><small>已确认</small></span><span class="is-complete"><b>✓</b><em>视频与合成</em><small>初版成片已完成</small></span><span class="is-current"><b>3</b><em>成片剪辑</em><small>当前阶段</small></span></div>
    <section class="card final-player"><div class="card-head"><div><h2>当前成片</h2><p>以当前版本为基准调整；重新合成成功后播放器会更新。</p></div></div><div class="final-media"><video class="final-video" src="${escapeHtml(videoUrl(finalVideo))}" poster="${escapeHtml(poster)}" controls preload="none" playsinline aria-label="当前成片">您的浏览器暂不支持视频播放。</video></div></section>
    <section class="card generation-section edit-timeline-card"><div class="card-head"><div><h2>镜头时间线</h2><p>逐镜调整裁剪、速度、原声和连接下一镜的转场。</p></div>${clips.length ? '<button class="btn" type="button" data-save-timeline>仅保存剪辑方案</button>' : ''}</div><div class="card-body"><div class="edit-timeline-list">${clips.length ? clips.map((clip, index) => timelineRow(clip, index, timeline.items?.find(item => Number(item.shot_index) === Number(clip.shot_index || index + 1)) || timeline.items?.[index] || {})).join('') : '<div class="empty-inline">当前成片缺少可编辑的逐镜来源，仍可观看或下载，但不能重新剪辑。</div>'}</div></div></section>`;

  const saveTimeline = async button => {
    setButtonBusy(button, true, '保存中…');
    try { await request(`/api/story-ad/projects/${encodeURIComponent(bundle.project.id)}/timeline`, { method: 'PUT', body: { items: timelineItems(host) } }); return true; } catch (error) { toast(error.message, 'danger'); return false; } finally { setButtonBusy(button, false); }
  };
  host.querySelector('[data-save-timeline]')?.addEventListener('click', async event => { if (await saveTimeline(event.currentTarget)) toast('剪辑方案已保存，当前成片尚未改变。', 'success'); });
  host.querySelector('[data-apply-edit]')?.addEventListener('click', async event => {
    const button = event.currentTarget;
    if (!await saveTimeline(button)) return;
    try { setButtonBusy(button, true, '正在重新合成…', { elapsed: true }); await store.runStage('compose'); toast('剪辑版成片合成任务已提交。', 'success'); await context.refreshShell(); } catch (error) { toast(error.message, 'danger'); } finally { setButtonBusy(button, false); }
  });
}
