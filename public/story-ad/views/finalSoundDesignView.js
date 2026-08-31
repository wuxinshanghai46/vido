import { request } from '../api.js?v=20260831-production-v340';
import { emptyState, escapeHtml, setButtonBusy, toast } from '../components/ui.js?v=20260831-production-v340';

const TRACK_TYPES = [['room_tone', '空间底噪'], ['ambient', '环境声'], ['foley', '拟音'], ['sfx', '动作音效'], ['transition', '转场音']];
function trackOptions(selected = 'room_tone') {
  return TRACK_TYPES.map(([value, label]) => `<option value="${value}" ${value === selected ? 'selected' : ''}>${label}</option>`).join('');
}

export function soundDesignMarkup(soundDesign = {}) {
  const assets = new Map((soundDesign.assets || []).map(item => [item.asset_id, item]));
  const shots = soundDesign.shots || [];
  return `<section class="card generation-section sound-journey-section">
    <div class="card-head"><div><h2>场景声音设计</h2><p>系统已按每个镜头默认选择声音类型和搜索词；你只需试听推荐声音，也可以搜索其他声音或上传自己的素材。</p></div></div>
    <div class="card-body">
      ${shots.length ? `<div class="guide sound-selection-guide"><b>怎么操作：</b>点击镜头右侧“试听推荐”，试听后点“使用这个声音”即可绑定；不满意时修改上方搜索词，或直接上传自己的声音。</div><div class="sound-library-toolbar"><label><span>系统建议 / 搜索其他声音</span><input class="input" type="search" value="${escapeHtml(shots[0].recommended_query || '')}" placeholder="例如：showroom ambience、footsteps、metal touch" data-sound-library-query></label><label><span>绑定镜头</span><select data-sound-library-shot>${shots.map(shot => `<option value="${shot.shot_index}">SH${String(shot.shot_index).padStart(2, '0')}</option>`).join('')}</select></label><label><span>声音类型</span><select data-sound-library-type>${trackOptions(shots[0].recommended_track_type)}</select></label><button class="btn" type="button" data-search-sound-library>试听 / 搜索</button></div><p class="sound-license-note">试听不会产生导入或绑定；只有点击“使用这个声音”后，系统才会核验许可并绑定。仅接受 CC0、PDM、CC BY。</p><div class="sound-library-results" data-sound-library-results></div>` : ''}
      ${shots.length ? `<div class="sound-journey-list">${shots.map((item, index) => {
        const rows = (soundDesign.timeline || []).filter(row => row.shot_id === item.shot_id);
        return `<article data-audio-track data-sound-shot="${item.shot_index}"><b>SH${String(item.shot_index || index + 1).padStart(2, '0')}</b><span>${escapeHtml(item.ambient_sound || '环境底噪待确认')}</span><span>${escapeHtml((item.sfx || []).join('、') || '动作音待确认')}</span><span>${rows.map(row => { const asset = assets.get(row.asset_id) || {}; return `<em data-license-state title="${escapeHtml(asset.file_sha256 || '')}">${escapeHtml(asset.name || row.track_type)} · ${escapeHtml(asset.license || '许可待核对')}</em>`; }).join('') || '<em>尚未绑定真实音频</em>'}</span><label><select data-sound-track-type>${trackOptions(item.recommended_track_type)}</select><button class="btn small" type="button" data-preview-sound data-sound-query="${escapeHtml(item.recommended_query || '')}">试听推荐</button><input type="file" accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac" data-sound-file hidden><button class="btn small" type="button" data-upload-sound>上传自己的</button></label></article>`;
      }).join('')}</div>` : emptyState({ title: '尚未形成逐镜声音方案', body: '先完成并确认人物场景分镜，系统会按场景和动作建立环境声、拟音、音效和音乐节点。' })}
    </div>
  </section>`;
}

export function bindSoundDesign(host, { bundle, store, refreshShell }) {
  host.querySelectorAll('[data-sound-shot]').forEach(row => {
    const input = row.querySelector('[data-sound-file]');
    row.querySelector('[data-upload-sound]')?.addEventListener('click', () => input?.click());
    row.querySelector('[data-preview-sound]')?.addEventListener('click', () => {
      const query = host.querySelector('[data-sound-library-query]');
      const shot = host.querySelector('[data-sound-library-shot]');
      const type = host.querySelector('[data-sound-library-type]');
      if (query) query.value = row.querySelector('[data-preview-sound]').dataset.soundQuery || '';
      if (shot) shot.value = row.dataset.soundShot;
      if (type) type.value = row.querySelector('[data-sound-track-type]')?.value || 'room_tone';
      host.querySelector('[data-search-sound-library]')?.click();
      host.querySelector('[data-sound-library-results]')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
    input?.addEventListener('change', async event => {
      const file = event.target.files?.[0]; if (!file) return;
      const button = row.querySelector('[data-upload-sound]');
      try {
        setButtonBusy(button, true, '上传中…');
        const uploaded = await store.upload(file, 'sound_effect');
        await request(`/api/story-ad/projects/${encodeURIComponent(bundle.project.id)}/sound-assets`, { method: 'POST', body: { asset: uploaded.asset || uploaded.data, shot_index: Number(row.dataset.soundShot), track_type: row.querySelector('[data-sound-track-type]')?.value || 'sfx' } });
        toast('音频已绑定到当前镜头，并写入许可与文件哈希账本。', 'success');
        await refreshShell();
      } catch (error) { toast(error.message, 'danger'); } finally { setButtonBusy(button, false); }
    });
  });
  host.querySelector('[data-search-sound-library]')?.addEventListener('click', async event => {
    const query = host.querySelector('[data-sound-library-query]')?.value?.trim();
    if (!query) return toast('请先输入要查找的环境声或音效。', 'warning');
    const resultsHost = host.querySelector('[data-sound-library-results]');
    try {
      setButtonBusy(event.currentTarget, true, '搜索中…');
      const result = await request(`/api/story-ad/projects/${encodeURIComponent(bundle.project.id)}/sound-library?q=${encodeURIComponent(query)}`);
      resultsHost.innerHTML = (result.results || []).length ? result.results.map((item, index) => `<article class="${index === 0 ? 'is-recommended' : ''}"><div><b>${escapeHtml(item.name)}${index === 0 ? '<span class="sound-recommended-tag">系统推荐</span>' : ''}</b><small>${escapeHtml(item.creator)} · ${escapeHtml(String(item.license || '').toUpperCase())}</small></div><audio controls preload="none" src="${escapeHtml(item.audio_url || '')}"></audio><button class="btn small" type="button" data-import-openverse="${escapeHtml(item.id)}">使用这个声音</button></article>`).join('') : '<p>没有找到满足许可和下载安全规则的结果，可修改搜索词或上传自己的声音。</p>';
      resultsHost.querySelectorAll('[data-import-openverse]').forEach(button => button.addEventListener('click', async importEvent => {
        try {
          setButtonBusy(importEvent.currentTarget, true, '导入中…');
          await request(`/api/story-ad/projects/${encodeURIComponent(bundle.project.id)}/sound-assets/openverse`, { method: 'POST', body: { openverse_id: importEvent.currentTarget.dataset.importOpenverse, shot_index: Number(host.querySelector('[data-sound-library-shot]')?.value || 1), track_type: host.querySelector('[data-sound-library-type]')?.value || 'sfx' } });
          toast('开放音频已核验许可、下载并绑定到镜头。', 'success');
          await refreshShell();
        } catch (error) { toast(error.message, 'danger'); } finally { setButtonBusy(importEvent.currentTarget, false); }
      }));
    } catch (error) { toast(error.message, 'danger'); } finally { setButtonBusy(event.currentTarget, false); }
  });
}
