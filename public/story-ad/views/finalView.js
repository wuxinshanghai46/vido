import { emptyState, escapeHtml, mediaPreview, setButtonBusy, toast } from '../components/ui.js?v=20260831-production-v324';
import { bindMoreMedia, moreMediaButton } from './finalMediaPagination.js?v=20260831-production-v324';
import { bindGenerationModelPicker, loadGenerationModelPicker } from './generationModelPicker.js?v=20260831-production-v324';
import { request } from '../api.js?v=20260831-production-v324';
import { bindSoundDesign, soundDesignMarkup } from './finalSoundDesignView.js?v=20260831-production-v324';

function itemIndex(item = {}, index = 0) {
  const value = Number(item.shot_index ?? item.shotIndex ?? item.index);
  return Number.isFinite(value) ? (value === index ? index + 1 : value) : index + 1;
}

function mediaCard(item, index, kind) {
  const number = itemIndex(item, index);
  return `<article class="generation-card card">
    <div class="generation-media">${mediaPreview(item, { label: `${kind} ${number}`, width: 640, symbol: kind })}</div>
    <div class="generation-copy"><b>SH${String(number).padStart(2, '0')}</b><span>${escapeHtml(item.status || item.qa_status || '已生成')}</span></div>
  </article>`;
}

function finalVideoUrl(item = {}) {
  return item.video_url || item.videoUrl || item.url || '';
}

function finalVideoPlayer(item = {}, poster = '') {
  const url = finalVideoUrl(item);
  if (!url) return '<div class="media-placeholder final-video-empty"><span>成片文件尚未就绪</span></div>';
  return `<video class="final-video" src="${escapeHtml(url)}" poster="${escapeHtml(poster)}" controls preload="none" playsinline aria-label="最终成片">您的浏览器暂不支持视频播放。</video>`;
}

function preflightDialog(preflight = {}) {
  const cost = preflight.cost_plan || {};
  const blockers = Array.isArray(preflight.blockers) ? preflight.blockers : [];
  const shotCount = Array.isArray(preflight.shots) ? preflight.shots.length : 0;
  const complexityRequired = Number(preflight.execution_summary?.high_risk_unit_count || 0) > 0;
  return `<div class="modal-backdrop" data-preflight-modal>
    <section class="modal card" role="dialog" aria-modal="true" aria-labelledby="preflightTitle">
      <div class="card-head"><div><h2 id="preflightTitle">确认视频生成</h2><p>只有点击最终确认后才会提交视频模型。</p></div><button class="icon-btn" type="button" data-close-preflight>×</button></div>
      <div class="card-body">
        <div class="preflight-grid">
          <div><span>计划镜头</span><b>${shotCount}</b></div>
          <div><span>生成模式</span><b>${escapeHtml(preflight.mode || 'economy')}</b></div>
          <div><span>预计上限</span><b>${Number(cost.maximum_cost_rmb || 0).toFixed(2)} 元</b></div>
        </div>
        ${blockers.length ? `<div class="inline-error"><b>当前不能提交：</b>${blockers.map(item => escapeHtml(item.message || item)).join('；')}</div>` : ''}
        <label class="confirm-check"><input type="checkbox" data-cost-confirm> 我已核对镜头数量和费用上限，本次生成将产生实际调用。</label>
        ${complexityRequired ? '<label class="confirm-check"><input type="checkbox" data-complexity-confirm> 我已复核复杂镜头的动作、主体与运镜。</label>' : ''}
        <div class="form-actions"><button class="btn" type="button" data-close-preflight>取消</button><button class="btn primary" type="button" data-submit-video ${blockers.length ? 'disabled' : ''}>确认并开始生成</button></div>
      </div>
    </section>
  </div>`;
}

/** 挂载生成与成片页，所有付费调用均保留明确预检和用户确认。 */
export async function mount(host, context) {
  const { bundle, store } = context;
  const generation = bundle?.generation || {};
  const shots = bundle?.storyboard?.shots || [];
  const keyframes = Array.isArray(generation.keyframes) ? generation.keyframes : [];
  const clips = Array.isArray(generation.clips) ? generation.clips : [];
  const soundDesign = await request(`/api/story-ad/projects/${encodeURIComponent(bundle.project.id)}/sound-design`).catch(() => ({ shots: [], profiles: [], assets: [], timeline: [], ledger: [] }));
  const finalVideo = generation.final_video || (bundle?.project?.final_video_url ? {
    video_url: bundle.project.final_video_url,
    status: '已生成',
  } : null);
  const finalUrl = finalVideoUrl(finalVideo || {});
  const posterUrl = finalVideo?.poster_url || finalVideo?.thumbnail_url || keyframes.find(item => item.thumbnail_url || item.image_url || item.imageUrl)?.thumbnail_url || keyframes.find(item => item.image_url || item.imageUrl)?.image_url || keyframes.find(item => item.imageUrl)?.imageUrl || '';
  const downloadUrl = finalUrl ? `${finalUrl}${finalUrl.includes('?') ? '&' : '?'}download=1` : '';
  const mediaCatalog = generation.media_catalog || {};
  const keyframeTotal = Number(mediaCatalog.keyframes?.total || keyframes.length);
  const clipTotal = Number(mediaCatalog.clips?.total || clips.length);
  const keyframeModelPicker = await loadGenerationModelPicker(bundle.project.id, 'new_story_ad.keyframe', { label: '关键帧模型' });
  const videoModelPicker = await loadGenerationModelPicker(bundle.project.id, 'new_story_ad.video', { label: '视频模型' });
  host.innerHTML = `
    <section class="view-head">
      <div><h1>声音、视频与合成</h1><p>第 7 步统一完成彩色关键帧、配音、场景环境声、拟音、音效、视频片段和最终成片。</p></div>
      <div class="view-actions">
        ${keyframes.length ? `${videoModelPicker.html}<button class="btn" type="button" data-generate-video>生成视频</button>` : `${keyframeModelPicker.html}<button class="btn" type="button" data-generate-keyframes>生成关键帧</button>`}
        ${clips.length ? '<button class="btn" type="button" data-generate-tts>生成配音</button><button class="btn primary" type="button" data-compose>合成成片</button>' : ''}
      </div>
    </section>
    <div class="production-lanes" aria-label="生产轨道"><span data-production-lane><b>关键帧</b><small>${keyframes.length}/${shots.length}</small></span><span data-production-lane><b>声音</b><small>${soundDesign.timeline?.length || 0} 条素材</small></span><span data-production-lane><b>视频</b><small>${clips.length}/${shots.length}</small></span><span data-production-lane><b>合成</b><small>${finalVideo ? '已完成' : '待完成'}</small></span></div>
    <div class="guide">彩色关键帧必须消费第 6 步已确认的黑白分镜构图；视频和声音按 shot_id、character_id、scene_id 绑定，付费提交前仍需核对模型和费用。</div>
    ${finalVideo ? `<section class="card final-player">
      <div class="card-head"><div><h2>最终成片</h2><p>${escapeHtml(finalVideo.status || '已生成')} · 播放器保持源视频比例</p></div>${finalUrl ? `<a class="btn primary final-download" href="${escapeHtml(downloadUrl)}" download="${escapeHtml(finalVideo.filename || 'vido-final.mp4')}" aria-label="下载原始成片"><span aria-hidden="true">↓</span><span><b>下载原始成片</b><small>保留原始比例和清晰度</small></span></a>` : ''}</div>
      <div class="final-media">${finalVideoPlayer(finalVideo, posterUrl)}</div>
    </section>` : ''}
    ${soundDesignMarkup(soundDesign)}
    <details class="card generation-section generation-details">
      <summary class="card-head"><div><h2>关键帧</h2><p>已加载 ${keyframes.length}/${keyframeTotal} · 默认收起，点击展开</p></div><span class="details-chevron" aria-hidden="true">⌄</span></summary>
      <div class="card-body">${keyframes.length ? `<div class="generation-grid">${keyframes.map((item, index) => mediaCard(item, index, '关键帧')).join('')}</div>${moreMediaButton(mediaCatalog.keyframes, 'keyframes', '继续加载关键帧')}` : emptyState({
        title: '还没有关键帧',
        body: shots.length ? '确认镜头设计后，按当前分镜生成关键帧。' : '先完成镜头结构和镜头设计。',
        action: shots.length ? '生成关键帧' : '返回分镜台',
        actionId: shots.length ? 'generate-keyframes' : 'back-storyboard',
      })}</div>
    </details>
    <section class="card generation-section">
      <div class="card-head"><div><h2>视频片段</h2><p>已加载 ${clips.length}/${clipTotal}</p></div></div>
      <div class="card-body">${clips.length ? `<div class="generation-grid">${clips.map((item, index) => mediaCard(item, index, '视频')).join('')}</div>${moreMediaButton(mediaCatalog.clips, 'clips', '继续加载视频片段')}` : emptyState({
        title: '还没有视频片段',
        body: keyframes.length ? '先通过视频预检，再提交付费视频生成。' : '关键帧准备完成后才能进入视频生成。',
      })}</div>
    </section>
    <div data-modal-host></div>`;

  const selectedKeyframeModel = bindGenerationModelPicker(host, keyframeModelPicker);
  const selectedVideoModel = bindGenerationModelPicker(host, videoModelPicker);

  bindSoundDesign(host, { bundle, store, refreshShell: context.refreshShell });

  const run = async (button, path, pending, success) => {
    try {
      setButtonBusy(button, true, pending, { elapsed: true });
      await store.runStage(path, path === 'keyframes' ? { image_model: selectedKeyframeModel() } : undefined);
      toast(success, 'success');
      await context.refreshShell();
    } catch (error) {
      toast(error.message, 'danger');
    } finally {
      setButtonBusy(button, false);
    }
  };
  host.querySelectorAll('[data-generate-keyframes], [data-empty-action="generate-keyframes"]').forEach(button => button.addEventListener('click', event => run(event.currentTarget, 'keyframes', '正在提交…', '关键帧任务已提交。')));
  host.querySelector('[data-empty-action="back-storyboard"]')?.addEventListener('click', () => context.navigate(`/story-ad/projects/${encodeURIComponent(bundle.project.id)}?view=storyboard`));
  host.querySelector('[data-generate-tts]')?.addEventListener('click', event => run(event.currentTarget, 'tts', '正在提交…', '配音任务已提交。'));
  host.querySelector('[data-compose]')?.addEventListener('click', event => run(event.currentTarget, 'compose', '正在提交…', '成片合成任务已提交。'));
  bindMoreMedia(host, context);

  host.querySelector('[data-generate-video]')?.addEventListener('click', async event => {
    const button = event.currentTarget;
    try {
      setButtonBusy(button, true, '正在预检…');
      const videoModelRoute = selectedVideoModel();
      if (!videoModelRoute) throw new Error('请先选择本次视频生成模型');
      const preflight = await store.videoPreflight('economy', videoModelRoute);
      const complexityRequired = Number(preflight.execution_summary?.high_risk_unit_count || 0) > 0;
      const modalHost = host.querySelector('[data-modal-host]');
      modalHost.innerHTML = preflightDialog(preflight);
      const close = () => { modalHost.innerHTML = ''; };
      modalHost.querySelectorAll('[data-close-preflight]').forEach(item => item.addEventListener('click', close));
      modalHost.querySelector('[data-submit-video]')?.addEventListener('click', async submitEvent => {
        const submit = submitEvent.currentTarget;
        if (!modalHost.querySelector('[data-cost-confirm]')?.checked) {
          toast('请先确认镜头数量与费用上限。', 'warning');
          return;
        }
        if (complexityRequired && !modalHost.querySelector('[data-complexity-confirm]')?.checked) {
          toast('请先完成复杂镜头复核。', 'warning');
          return;
        }
        try {
          setButtonBusy(submit, true, '正在提交…', { elapsed: true });
          await store.startVideo(preflight, {
            complexity_review_confirmed: !complexityRequired || modalHost.querySelector('[data-complexity-confirm]')?.checked,
            video_model_route: videoModelRoute,
          });
          close();
          toast('视频生成任务已提交。', 'success');
          await context.refreshShell();
        } catch (error) {
          toast(error.message, 'danger');
          setButtonBusy(submit, false);
        }
      });
    } catch (error) {
      toast(error.message, 'danger');
    } finally {
      setButtonBusy(button, false);
    }
  });
}
