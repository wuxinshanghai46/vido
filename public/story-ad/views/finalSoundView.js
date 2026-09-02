import { request } from '../api.js?v=20260902-production-v398';
import { bindSoundDesign, soundDesignMarkup } from './finalSoundDesignView.js?v=20260902-production-v398';

export async function mount(host, context) {
  const { bundle, store } = context;
  const soundDesign = await request(`/api/story-ad/projects/${encodeURIComponent(bundle.project.id)}/sound-design`)
    .catch(() => ({ shots: [], profiles: [], assets: [], timeline: [], ledger: [], production: {} }));
  const approved = soundDesign.production?.approved === true;
  host.innerHTML = `
    <section class="view-head post-production-head">
      <div><span class="stage-kicker">第 6 步</span><h1>声音</h1><p>先完成旁白和人物对白试听；只有出镜对白需要口型同步，背景音乐与场景音效按剧情需要选用。</p></div>
      <div class="view-actions">${approved ? '<button class="btn primary" type="button" data-next-compose>进入视频与合成</button>' : '<button class="btn primary" type="button" data-confirm-audio>确认声音并进入视频与合成</button>'}</div>
    </section>
    <div class="post-stage-summary"><span class="is-current"><b>1</b><em>声音</em><small>${approved ? '已确认' : '试听确认中'}</small></span><span><b>2</b><em>视频与合成</em><small>声音确认后进入</small></span><span><b>3</b><em>成片剪辑</em><small>初版成片生成后出现</small></span></div>
    ${soundDesignMarkup(soundDesign)}`;
  bindSoundDesign(host, { bundle, store, soundDesign, refreshShell: context.refreshShell, navigate: context.navigate });
  host.querySelector('[data-next-compose]')?.addEventListener('click', () => {
    context.navigate(`/story-ad/projects/${encodeURIComponent(bundle.project.id)}?view=compose`);
  });
}
