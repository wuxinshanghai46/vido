import { request } from '../api.js?v=20260830-production-v305';
import { emptyState, escapeHtml, setButtonBusy, toast } from '../components/ui.js?v=20260830-production-v305';

export function soundDesignMarkup(soundDesign = {}) {
  const assets = new Map((soundDesign.assets || []).map(item => [item.asset_id, item]));
  const shots = soundDesign.shots || [];
  return `<section class="card generation-section sound-journey-section">
    <div class="card-head"><div><h2>场景声音设计</h2><p>${soundDesign.profiles?.length || 0} 个场景声音档案 · ${soundDesign.timeline?.length || 0} 条已绑定真实音频。用户自有素材不会作为独立素材对外分发。</p></div></div>
    <div class="card-body">
      ${shots.length ? `<div class="sound-library-toolbar"><label><span>开放音效库</span><input class="input" type="search" placeholder="例如：showroom ambience、footsteps、metal touch" data-sound-library-query></label><label><span>绑定镜头</span><select data-sound-library-shot>${shots.map(shot => `<option value="${shot.shot_index}">SH${String(shot.shot_index).padStart(2, '0')}</option>`).join('')}</select></label><label><span>声音类型</span><select data-sound-library-type><option value="room_tone">空间底噪</option><option value="ambient">环境声</option><option value="foley">拟音</option><option value="sfx">动作音效</option><option value="transition">转场音</option></select></label><button class="btn" type="button" data-search-sound-library>搜索 Openverse</button></div><p class="sound-license-note">只允许 CC0、PDM、CC BY；导入时服务端重新核验许可、来源与文件哈希，CC BY 自动进入署名清单。</p><div class="sound-library-results" data-sound-library-results></div>` : ''}
      ${shots.length ? `<div class="sound-journey-list">${shots.map((item, index) => {
        const rows = (soundDesign.timeline || []).filter(row => row.shot_id === item.shot_id);
        return `<article data-audio-track data-sound-shot="${item.shot_index}"><b>SH${String(item.shot_index || index + 1).padStart(2, '0')}</b><span>${escapeHtml(item.ambient_sound || '环境底噪待确认')}</span><span>${escapeHtml((item.sfx || []).join('、') || '动作音待确认')}</span><span>${rows.map(row => { const asset = assets.get(row.asset_id) || {}; return `<em data-license-state title="${escapeHtml(asset.file_sha256 || '')}">${escapeHtml(asset.name || row.track_type)} · ${escapeHtml(asset.license || '许可待核对')}</em>`; }).join('') || '<em>尚未绑定真实音频</em>'}</span><label><select data-sound-track-type><option value="room_tone">空间底噪</option><option value="ambient">环境声</option><option value="foley">拟音</option><option value="sfx">动作音效</option><option value="transition">转场音</option></select><input type="file" accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac" data-sound-file hidden><button class="btn small" type="button" data-upload-sound>上传并绑定</button></label></article>`;
      }).join('')}</div>` : emptyState({ title: '尚未形成逐镜声音方案', body: '先完成并确认人物场景分镜，系统会按场景和动作建立环境声、拟音、音效和音乐节点。' })}
    </div>
  </section>`;
}

export function bindSoundDesign(host, { bundle, store, refreshShell }) {
  host.querySelectorAll('[data-sound-shot]').forEach(row => {
    const input = row.querySelector('[data-sound-file]');
    row.querySelector('[data-upload-sound]')?.addEventListener('click', () => input?.click());
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
      resultsHost.innerHTML = (result.results || []).length ? result.results.map(item => `<article><div><b>${escapeHtml(item.name)}</b><small>${escapeHtml(item.creator)} · ${escapeHtml(String(item.license || '').toUpperCase())}</small></div><button class="btn small" type="button" data-import-openverse="${escapeHtml(item.id)}">导入并绑定</button></article>`).join('') : '<p>没有找到满足许可和下载安全规则的结果。</p>';
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
