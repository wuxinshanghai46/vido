import { emptyState, escapeHtml, mediaPreview, setButtonBusy, toast } from '../components/ui.js?v=20260826-production-v231c';
import { bindMoreMedia, moreMediaButton } from './finalMediaPagination.js?v=20260826-production-v231c';

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
  const soundJourney = Array.isArray(generation.sound_journey) ? generation.sound_journey : [];
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
  host.innerHTML = `
    <section class="view-head">
      <div><h1>镜头、声音与成片</h1><p>第 6 步统一查看正式镜头、场景声、动作音、配音、音乐、视频片段和最终成片。</p></div>
      <div class="view-actions">
        ${keyframes.length ? '<button class="btn" type="button" data-generate-video>生成视频</button>' : '<button class="btn" type="button" data-generate-keyframes>生成关键帧</button>'}
        ${clips.length ? '<button class="btn" type="button" data-generate-tts>生成配音</button><button class="btn primary" type="button" data-compose>合成成片</button>' : ''}
      </div>
    </section>
    <div class="guide">关键帧和视频都使用当前项目的版本化分镜与资产；视频提交前必须再次核对镜头和费用。</div>
    ${finalVideo ? `<section class="card final-player">
      <div class="card-head"><div><h2>最终成片</h2><p>${escapeHtml(finalVideo.status || '已生成')} · 播放器保持源视频比例</p></div>${finalUrl ? `<a class="btn primary final-download" href="${escapeHtml(downloadUrl)}" download="${escapeHtml(finalVideo.filename || 'vido-final.mp4')}" aria-label="下载原始成片"><span aria-hidden="true">↓</span><span><b>下载原始成片</b><small>保留原始比例和清晰度</small></span></a>` : ''}</div>
      <div class="final-media">${finalVideoPlayer(finalVideo, posterUrl)}</div>
    </section>` : ''}
    <section class="card generation-section sound-journey-section">
      <div class="card-head"><div><h2>场景声音设计</h2><p>${soundJourney.length}/${shots.length || 0} 个镜头已有声音方案；根据场景背景分别匹配，不统一套用。</p></div></div>
      <div class="card-body">${soundJourney.length ? `<div class="sound-journey-list">${soundJourney.map((item, index) => `<article><b>SH${String(item.shot_index || index + 1).padStart(2, '0')}</b><span>${escapeHtml(item.ambient || '环境底噪待确认')}</span><span>${escapeHtml((item.sfx || []).join('、') || '动作音待确认')}</span><span>${escapeHtml(item.music || '音乐情绪待确认')}</span><span>${escapeHtml(item.transition || '声音桥待确认')}</span></article>`).join('')}</div>` : emptyState({ title: '尚未形成逐镜声音方案', body: '保存第 5 步分镜后，系统会按竹林、雪夜、集市、道路等不同背景建立环境音、动作音、音乐和声音桥。' })}</div>
    </section>
    <details class="card generation-section generation-details">
      <summary class="card-head"><div><h2>关键帧</h2><p>已加载 ${keyframes.length}/${keyframeTotal} · 默认收起，点击展开</p></div><span class="details-chevron" aria-hidden="true">⌄</span></summary>
      <div class="card-body">${keyframes.length ? `<div class="generation-grid">${keyframes.map((item, index) => mediaCard(item, index, '关键帧')).join('')}</div>${moreMediaButton(mediaCatalog.keyframes, 'keyframes', '继续加载关键帧')}` : emptyState({
        title: '还没有关键帧',
        body: shots.length ? '确认镜头设计后，按当前分镜生成关键帧。' : '先完成文字分镜和镜头设计。',
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

  const run = async (button, path, pending, success) => {
    try {
      setButtonBusy(button, true, pending, { elapsed: true });
      await store.runStage(path);
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
      const preflight = await store.videoPreflight('economy');
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
