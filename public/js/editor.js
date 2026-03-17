'use strict';

const projectId = new URLSearchParams(location.search).get('id');
if (!projectId) { location.href = '/'; }

let editData = {};
let clips = [];
let scenes = [];
let projectData = {};
let selectedSceneIndex = null;
let dragSrcIndex = null;
let saveTimer = null;
let timelineZoom = 100;
let totalTimelineDur = 0;
let undoStack = [];

// ——— 初始化 ———
async function init() {
  if (typeof requireAuth === 'function') {
    const ok = await requireAuth();
    if (!ok) return;
  }
  try {
    const res = await authFetch(`/api/editor/${projectId}`);
    const data = await res.json();
    if (!data.success) { alert('项目加载失败'); return; }
    const { project, clips: c, scenes: s, edit } = data.data;
    clips = c;
    scenes = s;
    editData = edit;
    projectData = project;
    document.getElementById('editor-project-title').textContent = project.title || '编辑器';
    document.title = `编辑 · ${project.title} - VIDO`;
    renderTimeline();
    loadMusicUI();
    // 自动播放第一个片段
    if (clips.length) playClipPreview(0);
  } catch (e) {
    alert('加载失败: ' + e.message);
  }
}

// ——— 时间轴渲染 ———
function renderTimeline() {
  const order = editData.scenes_order || clips.map(c => c.scene_index);
  const timeline = document.getElementById('timeline');
  const ruler = document.getElementById('tl-ruler');

  // 计算总时长
  totalTimelineDur = 0;
  order.forEach(sceneIdx => {
    const clip = clips.find(c => c.scene_index === sceneIdx);
    totalTimelineDur += clip?.duration || 10;
  });

  // 更新总时长显示
  const totalEl = document.getElementById('tb-total-time');
  if (totalEl) totalEl.textContent = formatTime(totalTimelineDur);

  // 绘制标尺
  if (ruler) {
    let marks = '';
    const step = totalTimelineDur > 60 ? 10 : 5;
    for (let t = 0; t <= totalTimelineDur; t += step) {
      const pct = totalTimelineDur > 0 ? (t / totalTimelineDur * 100) : 0;
      marks += `<span class="ed-tl-mark" style="left:${pct}%">${formatTime(t)}</span>`;
    }
    ruler.innerHTML = marks;
    // 点击标尺跳转
    ruler.onclick = (e) => {
      seekTimelinePlayhead(pxToPct(e.clientX));
    };
  }

  // 渲染片段块
  timeline.innerHTML = order.map((sceneIdx, position) => {
    const clip = clips.find(c => c.scene_index === sceneIdx);
    if (!clip) return '';
    const scene = scenes[sceneIdx] || {};
    const isDeleted = (editData.deleted_scenes || []).includes(sceneIdx);
    const isSelected = selectedSceneIndex === sceneIdx;
    const dur = clip.duration || 10;
    const widthPct = totalTimelineDur > 0 ? (dur / totalTimelineDur * 100) : (100 / order.length);
    const dialogue = editData.dialogues?.find(d => d.scene_index === sceneIdx);
    const trim = editData.scene_trims?.[sceneIdx];

    return `
      <div class="ed-clip${isSelected ? ' selected' : ''}${isDeleted ? ' deleted' : ''}"
        style="width:${widthPct}%"
        data-index="${position}" data-scene="${sceneIdx}"
        onclick="selectScene(${sceneIdx})"
        draggable="true"
        ondragstart="onDragStart(event,${position})"
        ondragover="onDragOver(event,${position})"
        ondrop="onDrop(event,${position})"
        ondragend="onDragEnd(event)">
        <div class="ed-clip-trim left" onmousedown="startClipTrim(event,${sceneIdx},'start')"></div>
        <div class="ed-clip-trim right" onmousedown="startClipTrim(event,${sceneIdx},'end')"></div>
        <div class="ed-clip-inner">
          <div class="ed-clip-thumb">
            <video src="${authUrl(`/api/projects/${projectId}/clips/${clip.id}/stream`)}" preload="metadata" muted
              onloadedmetadata="this.currentTime=1"></video>
          </div>
          <div class="ed-clip-info">
            <span class="ed-clip-num">${position + 1}</span>
            <span class="ed-clip-title">${escHtml(scene.title || `场景${sceneIdx+1}`)}</span>
            <span class="ed-clip-dur">${trim ? '✂' : ''}${dur}s</span>
          </div>
          ${dialogue?.text ? '<div class="ed-clip-sub">CC</div>' : ''}
          ${isDeleted ? '<div class="ed-clip-del">已删除</div>' : ''}
        </div>
      </div>`;
  }).join('');

  // 渲染音频轨（从原视频分离）
  renderAudioTrack();
  // 渲染音乐轨
  renderMusicTrack();
  // 渲染配音轨
  renderVoiceTrack();
  // 应用缩放
  applyZoom();
}

function renderAudioTrack() {
  const track = document.getElementById('audio-track');
  if (!track) return;
  const order = editData.scenes_order || clips.map(c => c.scene_index);
  const hasVoice = projectData.voice_enabled;

  // 每个片段对应一个音频块（从视频中分离出来的音频部分）
  track.innerHTML = order.map((sceneIdx, pos) => {
    const clip = clips.find(c => c.scene_index === sceneIdx);
    const dur = clip?.duration || 10;
    const widthPct = totalTimelineDur > 0 ? (dur / totalTimelineDur * 100) : (100 / order.length);
    const scene = scenes[sceneIdx] || {};
    const isDeleted = (editData.deleted_scenes || []).includes(sceneIdx);
    const hasDialogue = !!(scene.dialogue && scene.dialogue.trim());
    const isMuted = editData.muted_audio?.includes(sceneIdx);

    // 生成小波形条（伪波形）
    let waveBars = '';
    const barCount = Math.max(8, Math.floor(dur * 3));
    for (let i = 0; i < barCount; i++) {
      const h = hasDialogue ? (4 + Math.random() * 14) : (2 + Math.random() * 5);
      waveBars += `<div class="ed-audio-bar" style="height:${h}px"></div>`;
    }

    return `<div class="ed-orig-audio${hasDialogue ? ' has-audio' : ''}${isMuted ? ' muted' : ''}${isDeleted ? ' muted' : ''}"
      style="width:${widthPct}%" onclick="selectScene(${sceneIdx})" title="${hasDialogue ? escHtml(scene.dialogue.slice(0,30)) : '无音频'}">
      <div class="ed-audio-wave">${waveBars}</div>
    </div>`;
  }).join('');
}

function renderMusicTrack() {
  const track = document.getElementById('music-track');
  if (!track) return;
  const music = editData.music;
  if (!music?.file_path) {
    track.innerHTML = '<div style="flex:1;display:flex;align-items:center;justify-content:center;font-size:10px;color:rgba(255,255,255,.15);cursor:pointer" onclick="switchRightTab(\'audio\',null)">+ 添加背景音乐</div>';
    return;
  }
  const name = music.original_name || '背景音乐';
  track.innerHTML = `<div class="ed-audio-block" onclick="switchRightTab('audio',null)" style="flex:1">♫ ${escHtml(name)}</div>`;
}

function renderVoiceTrack() {
  const track = document.getElementById('voice-track');
  if (!track) return;
  const order = editData.scenes_order || clips.map(c => c.scene_index);
  const voiceovers = editData.voiceovers || [];

  if (!voiceovers.length) {
    track.innerHTML = '<div style="flex:1;display:flex;align-items:center;justify-content:center;font-size:10px;color:rgba(255,255,255,.2);cursor:pointer" onclick="switchRightTab(\'voice\',null)">+ 添加配音</div>';
    return;
  }

  track.innerHTML = order.map((sceneIdx, pos) => {
    const clip = clips.find(c => c.scene_index === sceneIdx);
    const dur = clip?.duration || 10;
    const widthPct = totalTimelineDur > 0 ? (dur / totalTimelineDur * 100) : (100 / order.length);
    const vo = voiceovers.find(v => v.scene_index === sceneIdx);
    if (!vo?.text) return `<div style="width:${widthPct}%"></div>`;
    const hasAudio = !!vo.audio_path;
    return `<div class="ed-voice-block${hasAudio ? ' has-audio' : ''}" style="width:${widthPct}%" onclick="selectScene(${sceneIdx});switchRightTab('voice',null)" title="${escHtml(vo.text)}">${hasAudio ? '🔊' : '🎙'} ${escHtml(vo.text.slice(0,15))}</div>`;
  }).join('');
}

// ——— 预览播放 ———
let currentPlayingClip = null;
let previewRAF = null;

function playClipPreview(sceneIdx) {
  const clip = clips.find(c => c.scene_index === sceneIdx);
  if (!clip) return;
  const video = document.getElementById('preview-video');
  const src = document.getElementById('preview-video-src');
  src.src = authUrl(`/api/projects/${projectId}/clips/${clip.id}/stream`);
  video.load();
  currentPlayingClip = sceneIdx;
  video.onloadedmetadata = () => {
    updateTimeDisplay();
  };
  video.ontimeupdate = () => { updateTimeDisplay(); };
  video.onended = () => {
    document.getElementById('ctrl-play').textContent = '▶';
    document.getElementById('play-btn-icon').textContent = '▶';
    document.getElementById('player-overlay').classList.remove('hidden');
  };
}

function togglePlay() {
  const video = document.getElementById('preview-video');
  const tbPlay = document.getElementById('tb-play');
  if (video.paused) {
    video.play().catch(() => {});
    document.getElementById('ctrl-play').textContent = '⏸';
    document.getElementById('play-btn-icon').textContent = '⏸';
    document.getElementById('player-overlay').classList.add('hidden');
    if (tbPlay) tbPlay.innerHTML = '<svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><rect x="3" y="2" width="3" height="10" rx="0.5"/><rect x="8" y="2" width="3" height="10" rx="0.5"/></svg>';
  } else {
    video.pause();
    document.getElementById('ctrl-play').textContent = '▶';
    document.getElementById('play-btn-icon').textContent = '▶';
    document.getElementById('player-overlay').classList.remove('hidden');
    if (tbPlay) tbPlay.innerHTML = '<svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><polygon points="3,1 12,7 3,13"/></svg>';
  }
}

function updateTimeDisplay() {
  const video = document.getElementById('preview-video');
  const cur = video.currentTime || 0;
  const dur = video.duration || 0;
  document.getElementById('player-time').textContent = `${formatTime(cur)} / ${formatTime(dur)}`;
  const fill = document.getElementById('progress-fill');
  if (fill && dur > 0) fill.style.width = (cur / dur * 100) + '%';
}

function seekTo(e) {
  const bar = document.getElementById('progress-bar');
  const rect = bar.getBoundingClientRect();
  const pct = (e.clientX - rect.left) / rect.width;
  const video = document.getElementById('preview-video');
  if (video.duration) video.currentTime = pct * video.duration;
}

// ——— 场景选择 ———
function selectScene(sceneIdx) {
  selectedSceneIndex = sceneIdx;
  renderTimeline();
  playClipPreview(sceneIdx);

  const panel = document.getElementById('scene-panel');
  panel.style.display = 'block';

  const clip = clips.find(c => c.scene_index === sceneIdx);
  const scene = scenes[sceneIdx] || {};
  document.getElementById('scene-panel-title').textContent =
    scene.title || clip?.scene_description || `场景 ${sceneIdx + 1}`;

  const trim = editData.scene_trims?.[sceneIdx] || {};
  document.getElementById('trim-start').value = trim.start || '';
  document.getElementById('trim-end').value = trim.end || '';
  if (clip?.duration) document.getElementById('clip-duration-hint').textContent = `原时长 ${clip.duration}秒`;

  const dialogue = editData.dialogues?.find(d => d.scene_index === sceneIdx) || {};
  document.getElementById('dialogue-text').value = dialogue.text || scene.dialogue || '';
  document.getElementById('dialogue-start').value = dialogue.start ?? 0;
  document.getElementById('dialogue-duration').value = dialogue.duration || 5;
  document.getElementById('dialogue-position').value = dialogue.position || 'bottom';
  document.getElementById('dialogue-fontsize').value = dialogue.font_size || 28;

  const isDeleted = (editData.deleted_scenes || []).includes(sceneIdx);
  const btn = document.getElementById('btn-delete-scene');
  btn.textContent = isDeleted ? '恢复' : '删除';
  btn.className = isDeleted ? 'ed-icon-btn' : 'ed-icon-btn danger';
}

// ——— 删除/恢复场景 ———
function deleteSelectedScene() {
  if (selectedSceneIndex === null) return;
  saveUndo();
  const deleted = editData.deleted_scenes || [];
  const idx = deleted.indexOf(selectedSceneIndex);
  if (idx >= 0) deleted.splice(idx, 1);
  else deleted.push(selectedSceneIndex);
  editData.deleted_scenes = deleted;
  renderTimeline();
  selectScene(selectedSceneIndex);
  scheduleSave();
}

// ——— 裁剪 ———
function saveTrim() {
  if (selectedSceneIndex === null) return;
  saveUndo();
  const start = parseFloat(document.getElementById('trim-start').value) || 0;
  const end = parseFloat(document.getElementById('trim-end').value) || null;
  if (!editData.scene_trims) editData.scene_trims = {};
  if (start === 0 && !end) delete editData.scene_trims[selectedSceneIndex];
  else editData.scene_trims[selectedSceneIndex] = { start, end };
  renderTimeline();
  scheduleSave();
}

// ——— 字幕 ———
function saveDialogue() {
  if (selectedSceneIndex === null) return;
  const text = document.getElementById('dialogue-text').value.trim();
  if (!editData.dialogues) editData.dialogues = [];
  const existIdx = editData.dialogues.findIndex(d => d.scene_index === selectedSceneIndex);
  if (!text) {
    if (existIdx >= 0) editData.dialogues.splice(existIdx, 1);
  } else {
    const entry = {
      scene_index: selectedSceneIndex, text,
      start: parseFloat(document.getElementById('dialogue-start').value) || 0,
      duration: parseFloat(document.getElementById('dialogue-duration').value) || 5,
      position: document.getElementById('dialogue-position').value,
      font_size: parseInt(document.getElementById('dialogue-fontsize').value) || 28
    };
    if (existIdx >= 0) editData.dialogues[existIdx] = entry;
    else editData.dialogues.push(entry);
  }
  renderTimeline();
  scheduleSave();
}

// ——— 拖拽排序 ———
function onDragStart(e, fromIndex) {
  dragSrcIndex = fromIndex;
  e.dataTransfer.effectAllowed = 'move';
  e.currentTarget.classList.add('dragging');
}
function onDragOver(e) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }
function onDrop(e, toIndex) {
  e.preventDefault();
  if (dragSrcIndex === null || dragSrcIndex === toIndex) return;
  const order = editData.scenes_order || clips.map(c => c.scene_index);
  const [moved] = order.splice(dragSrcIndex, 1);
  order.splice(toIndex, 0, moved);
  editData.scenes_order = order;
  renderTimeline();
  scheduleSave();
}
function onDragEnd(e) {
  dragSrcIndex = null;
  document.querySelectorAll('.ed-clip').forEach(el => el.classList.remove('dragging'));
}

// ——— 音乐 ———
let musicDuration = 0, musicTrimStart = 0, musicTrimEnd = 0;
let musicAudio = null, musicPreviewPlaying = false, musicPreviewRAF = null, musicWaveformData = null;

function formatTime(sec) {
  if (!sec || !isFinite(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function loadMusicUI() {
  const music = editData.music;
  if (music?.file_path) {
    document.getElementById('music-empty').style.display = 'none';
    document.getElementById('music-loaded').style.display = 'block';
    document.getElementById('music-name').textContent = music.original_name || '背景音乐';
    document.getElementById('music-volume').value = (music.volume || 0.5) * 100;
    document.getElementById('volume-val').textContent = Math.round((music.volume || 0.5) * 100) + '%';
    initMusicAudio();
  } else {
    document.getElementById('music-empty').style.display = 'block';
    document.getElementById('music-loaded').style.display = 'none';
    cleanupMusicPreview();
  }
}

function initMusicAudio() {
  if (musicAudio) { musicAudio.pause(); musicAudio = null; }
  musicAudio = new Audio(authUrl(`/api/editor/${projectId}/music-stream`));
  musicAudio.crossOrigin = 'anonymous';
  musicAudio.addEventListener('loadedmetadata', () => {
    musicDuration = musicAudio.duration;
    musicTrimStart = editData.music?.trim_start || 0;
    musicTrimEnd = editData.music?.trim_end || musicDuration;
    if (musicTrimEnd > musicDuration) musicTrimEnd = musicDuration;
    initMusicTimeline();
    updateTrimDisplay();
    decodeWaveform();
  });
  musicAudio.addEventListener('ended', () => stopMusicPreview());
}

function decodeWaveform() {
  authFetch(`/api/editor/${projectId}/music-stream`)
    .then(r => r.arrayBuffer())
    .then(buf => new (window.AudioContext || window.webkitAudioContext)().decodeAudioData(buf))
    .then(audioBuffer => {
      const raw = audioBuffer.getChannelData(0);
      const canvas = document.getElementById('music-waveform');
      const samples = canvas.width;
      const blockSize = Math.floor(raw.length / samples);
      musicWaveformData = new Float32Array(samples);
      for (let i = 0; i < samples; i++) {
        let sum = 0;
        for (let j = 0; j < blockSize; j++) sum += Math.abs(raw[i * blockSize + j] || 0);
        musicWaveformData[i] = sum / blockSize;
      }
      drawWaveform();
    }).catch(() => drawWaveformPlaceholder());
}

function drawWaveform() {
  const canvas = document.getElementById('music-waveform');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!musicWaveformData) { drawWaveformPlaceholder(); return; }
  let max = 0;
  for (const v of musicWaveformData) if (v > max) max = v;
  if (max === 0) max = 1;
  ctx.fillStyle = 'rgba(251,251,251,.15)';
  const barW = Math.max(1, canvas.width / musicWaveformData.length);
  for (let i = 0; i < musicWaveformData.length; i++) {
    const h = (musicWaveformData[i] / max) * (canvas.height * 0.85);
    ctx.fillRect(i * barW, (canvas.height - h) / 2, Math.max(1, barW - 0.5), h);
  }
}

function drawWaveformPlaceholder() {
  const canvas = document.getElementById('music-waveform');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = 'rgba(251,251,251,.1)';
  for (let i = 0; i < canvas.width; i += 2) {
    const h = 5 + Math.abs(Math.sin(i * 0.05)) * (canvas.height * 0.5) + Math.random() * 4;
    ctx.fillRect(i, (canvas.height - h) / 2, 1.5, h);
  }
}

function initMusicTimeline() {
  const timeline = document.getElementById('music-timeline');
  const handleLeft = document.getElementById('trim-handle-left');
  const handleRight = document.getElementById('trim-handle-right');
  if (!timeline) return;
  updateTrimRegion();
  let dragging = null;
  const getT = (cx) => {
    const r = timeline.getBoundingClientRect();
    return Math.max(0, Math.min((cx - r.left) / r.width, 1)) * musicDuration;
  };
  handleLeft.onmousedown = (e) => { e.preventDefault(); dragging = 'left'; };
  handleRight.onmousedown = (e) => { e.preventDefault(); dragging = 'right'; };
  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const t = getT(e.clientX);
    if (dragging === 'left') musicTrimStart = Math.max(0, Math.min(t, musicTrimEnd - 1));
    else musicTrimEnd = Math.min(musicDuration, Math.max(t, musicTrimStart + 1));
    updateTrimRegion();
    updateTrimDisplay();
  });
  document.addEventListener('mouseup', () => { if (dragging) { dragging = null; saveMusicTrim(); } });
}

function updateTrimRegion() {
  const region = document.getElementById('music-trim-region');
  if (!region || !musicDuration) return;
  region.style.left = (musicTrimStart / musicDuration * 100) + '%';
  region.style.width = ((musicTrimEnd - musicTrimStart) / musicDuration * 100) + '%';
}

function updateTrimDisplay() {
  const el = document.getElementById('music-trim-range');
  if (el) el.textContent = `${formatTime(musicTrimStart)} - ${formatTime(musicTrimEnd)}`;
}

function saveMusicTrim() {
  if (!editData.music) return;
  editData.music.trim_start = Math.round(musicTrimStart * 100) / 100;
  editData.music.trim_end = Math.round(musicTrimEnd * 100) / 100;
  scheduleSave();
}

function toggleMusicPreview() {
  musicPreviewPlaying ? stopMusicPreview() : startMusicPreview();
}

function startMusicPreview() {
  if (!musicAudio || !musicDuration) return;
  musicAudio.currentTime = musicTrimStart;
  musicAudio.volume = parseInt(document.getElementById('music-volume').value) / 100;
  musicAudio.play().catch(() => {});
  musicPreviewPlaying = true;
  const btn = document.getElementById('music-preview-btn');
  if (btn) { btn.textContent = '⏸ 停止'; }
  const playhead = document.getElementById('music-playhead');
  if (playhead) playhead.style.display = 'block';
  const tick = () => {
    if (!musicPreviewPlaying) return;
    if (musicAudio.currentTime >= musicTrimEnd) { stopMusicPreview(); return; }
    if (playhead && musicDuration) playhead.style.left = (musicAudio.currentTime / musicDuration * 100) + '%';
    musicPreviewRAF = requestAnimationFrame(tick);
  };
  musicPreviewRAF = requestAnimationFrame(tick);
}

function stopMusicPreview() {
  if (musicAudio) musicAudio.pause();
  musicPreviewPlaying = false;
  if (musicPreviewRAF) { cancelAnimationFrame(musicPreviewRAF); musicPreviewRAF = null; }
  const btn = document.getElementById('music-preview-btn');
  if (btn) btn.textContent = '▶ 试听';
  const ph = document.getElementById('music-playhead');
  if (ph) ph.style.display = 'none';
}

function cleanupMusicPreview() {
  stopMusicPreview();
  musicDuration = 0; musicTrimStart = 0; musicTrimEnd = 0; musicWaveformData = null;
  if (musicAudio) { musicAudio.pause(); musicAudio = null; }
}

async function uploadMusic(input) {
  const file = input.files[0];
  if (!file) return;
  const fd = new FormData();
  fd.append('music', file);
  fd.append('volume', '0.5');
  setSaveStatus('上传中...');
  try {
    const res = await authFetch(`/api/editor/${projectId}/music`, { method: 'POST', body: fd });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);
    editData.music = data.data.music;
    loadMusicUI();
    setSaveStatus('已保存', true);
  } catch (e) { alert('上传失败: ' + e.message); setSaveStatus(''); }
}

async function removeMusic() {
  if (!confirm('确认删除背景音乐？')) return;
  cleanupMusicPreview();
  await authFetch(`/api/editor/${projectId}/music`, { method: 'DELETE' });
  editData.music = null;
  loadMusicUI();
}

// ——— 保存 ———
function scheduleSave() {
  setSaveStatus('待保存...');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveEdit, 800);
}

async function saveEdit() {
  setSaveStatus('保存中...');
  try {
    if (editData.music) {
      editData.music.volume = parseInt(document.getElementById('music-volume').value) / 100;
      editData.music.loop = document.getElementById('music-loop')?.checked ?? true;
      if (musicDuration > 0) {
        editData.music.trim_start = Math.round(musicTrimStart * 100) / 100;
        editData.music.trim_end = Math.round(musicTrimEnd * 100) / 100;
      }
    }
    const res = await authFetch(`/api/editor/${projectId}`, { method: 'PUT', body: JSON.stringify(editData) });
    const data = await res.json();
    if (data.success) { editData = data.data; setSaveStatus('已保存', true); }
  } catch { setSaveStatus('保存失败'); }
}

function setSaveStatus(msg, ok = false) {
  const el = document.getElementById('save-status');
  el.textContent = msg;
  el.className = 'save-status' + (ok ? ' saved' : '');
}

// ——— 渲染 ———
let renderSSE = null;

async function startRender() {
  await saveEdit();
  document.getElementById('render-panel').style.display = 'block';
  document.getElementById('render-result').style.display = 'none';
  document.getElementById('render-log').innerHTML = '';
  const btn = document.getElementById('btn-render');
  btn.disabled = true; btn.textContent = '渲染中...';
  addRenderLog('开始渲染...');
  if (renderSSE) renderSSE.close();
  renderSSE = new EventSource(authUrl(`/api/editor/${projectId}/render/progress`));
  renderSSE.onmessage = (e) => {
    const d = JSON.parse(e.data);
    if (d.step === 'connected') return;
    addRenderLog(d.message || d.step, d.step === 'error' ? 'error' : d.step === 'done' ? 'success' : '');
    if (d.step === 'done') {
      renderSSE.close();
      btn.disabled = false; btn.textContent = '渲染导出';
      document.getElementById('render-result').style.display = 'block';
      document.getElementById('render-download').href = authUrl(`/api/editor/${projectId}/download-render`);
      addRenderLog('已保存到「已剪辑」项目列表', 'success');
    }
    if (d.step === 'error') { renderSSE.close(); btn.disabled = false; btn.textContent = '渲染导出'; }
  };
  authFetch(`/api/editor/${projectId}/render`, { method: 'POST' }).catch(e => addRenderLog(e.message, 'error'));
}

function addRenderLog(msg, type = '') {
  const log = document.getElementById('render-log');
  const el = document.createElement('div');
  el.className = 'ed-log-entry ' + type;
  el.innerHTML = `<span style="opacity:.5;font-size:10px">${new Date().toLocaleTimeString('zh-CN')}</span> ${escHtml(msg)}`;
  log.appendChild(el);
  log.scrollTop = log.scrollHeight;
}

function previewRender() {
  document.getElementById('modal-title').textContent = '成品预览';
  const v = document.getElementById('modal-video');
  document.getElementById('modal-video-src').src = authUrl(`/api/editor/${projectId}/stream-render`);
  v.load(); v.play().catch(() => {});
  document.getElementById('video-modal').classList.add('open');
}

function closePreviewModal() {
  const v = document.getElementById('modal-video');
  v.pause(); document.getElementById('modal-video-src').src = ''; v.load();
  document.getElementById('video-modal').classList.remove('open');
}

// ——— 播放头 ———
const LANE_LABEL_W = 32;

function getPlayheadPx(pct) {
  // 计算播放头在 timeline-area 中的 left (px)
  const wrap = document.getElementById('tl-tracks-wrap');
  if (!wrap) return LANE_LABEL_W;
  const trackWidth = wrap.scrollWidth - LANE_LABEL_W; // 轨道内容区域宽度
  const scrollLeft = wrap.scrollLeft;
  return LANE_LABEL_W + (pct / 100) * trackWidth - scrollLeft;
}

function updatePlayhead() {
  if (playheadDragging) return; // 拖拽中不自动更新
  const video = document.getElementById('preview-video');
  if (!video || !video.duration) return;
  const cur = video.currentTime || 0;
  const order = editData.scenes_order || clips.map(c => c.scene_index);
  let offset = 0;
  for (const idx of order) {
    if (idx === currentPlayingClip) break;
    const c = clips.find(c => c.scene_index === idx);
    offset += c?.duration || 10;
  }
  const globalTime = offset + cur;
  const pct = totalTimelineDur > 0 ? (globalTime / totalTimelineDur * 100) : 0;

  const ph = document.getElementById('tl-playhead');
  if (ph) ph.style.left = getPlayheadPx(pct) + 'px';

  const tbTime = document.getElementById('tb-current-time');
  if (tbTime) tbTime.textContent = formatTime(globalTime);
}

function seekTimelinePlayhead(pct) {
  const targetTime = pct * totalTimelineDur;
  // 找到对应片段
  const order = editData.scenes_order || clips.map(c => c.scene_index);
  let acc = 0;
  for (const idx of order) {
    const c = clips.find(c => c.scene_index === idx);
    const dur = c?.duration || 10;
    if (acc + dur >= targetTime) {
      selectScene(idx);
      const video = document.getElementById('preview-video');
      video.onloadeddata = () => {
        video.currentTime = Math.max(0, targetTime - acc);
        video.onloadeddata = null;
      };
      return;
    }
    acc += dur;
  }
}

// ——— 前后片段 ———
function prevClip() {
  const order = editData.scenes_order || clips.map(c => c.scene_index);
  const curIdx = order.indexOf(selectedSceneIndex);
  if (curIdx > 0) selectScene(order[curIdx - 1]);
}

function nextClip() {
  const order = editData.scenes_order || clips.map(c => c.scene_index);
  const curIdx = order.indexOf(selectedSceneIndex);
  if (curIdx < order.length - 1) selectScene(order[curIdx + 1]);
}

// ——— 分割（在当前播放位置标记裁剪终点） ———
function splitClipAtPlayhead() {
  if (selectedSceneIndex === null) return;
  const video = document.getElementById('preview-video');
  if (!video || !video.currentTime) return;
  const t = Math.round(video.currentTime * 10) / 10;
  document.getElementById('trim-end').value = t;
  saveTrim();
}

// ——— 片段裁剪拖拽 ———
let trimDragState = null;

function startClipTrim(e, sceneIdx, side) {
  e.preventDefault();
  e.stopPropagation();
  const clip = clips.find(c => c.scene_index === sceneIdx);
  if (!clip) return;
  selectScene(sceneIdx);
  trimDragState = { sceneIdx, side, startX: e.clientX, origDur: clip.duration || 10 };
  document.addEventListener('mousemove', onClipTrimMove);
  document.addEventListener('mouseup', onClipTrimEnd);
}

function onClipTrimMove(e) {
  if (!trimDragState) return;
  const { sceneIdx, side, startX, origDur } = trimDragState;
  const timeline = document.getElementById('timeline');
  const pxPerSec = timeline.clientWidth / totalTimelineDur;
  const delta = (e.clientX - startX) / pxPerSec;

  if (!editData.scene_trims) editData.scene_trims = {};
  const trim = editData.scene_trims[sceneIdx] || { start: 0, end: origDur };

  if (side === 'start') {
    trim.start = Math.max(0, Math.min(Math.round((trim.start + delta) * 10) / 10, (trim.end || origDur) - 0.5));
  } else {
    trim.end = Math.max((trim.start || 0) + 0.5, Math.min(Math.round(((trim.end || origDur) + delta) * 10) / 10, origDur));
  }
  editData.scene_trims[sceneIdx] = trim;
  trimDragState.startX = e.clientX;

  document.getElementById('trim-start').value = trim.start || '';
  document.getElementById('trim-end').value = trim.end || '';
}

function onClipTrimEnd() {
  if (trimDragState) {
    trimDragState = null;
    renderTimeline();
    scheduleSave();
  }
  document.removeEventListener('mousemove', onClipTrimMove);
  document.removeEventListener('mouseup', onClipTrimEnd);
}

// ——— 撤销 ———
function saveUndo() {
  undoStack.push(JSON.stringify(editData));
  if (undoStack.length > 20) undoStack.shift();
}

function undoAction() {
  if (!undoStack.length) return;
  editData = JSON.parse(undoStack.pop());
  renderTimeline();
  if (selectedSceneIndex !== null) selectScene(selectedSceneIndex);
  scheduleSave();
}

// ——— 时间轴缩放 ———
function zoomTimeline(dir) {
  timelineZoom = Math.max(50, Math.min(400, timelineZoom + dir * 25));
  const el = document.getElementById('tb-zoom-level');
  if (el) el.textContent = timelineZoom + '%';
  applyZoom();
}

function applyZoom() {
  const w = timelineZoom + '%';
  const lanes = document.getElementById('tl-lanes');
  if (lanes) lanes.style.minWidth = w;
  const ruler = document.getElementById('tl-ruler');
  if (ruler) {
    // ruler 需要留出 lane-label 宽度
    ruler.style.width = `calc(${w} - 32px)`;
  }
}

// ——— 时间轴拖拽平移 + 滚轮缩放 ———
function initTimelinePan() {
  const wrap = document.getElementById('tl-tracks-wrap');
  const ruler = document.getElementById('tl-ruler');
  if (!wrap) return;
  let isPanning = false, startX = 0, startScroll = 0;

  // 拖拽平移
  wrap.addEventListener('mousedown', (e) => {
    if (e.target.closest('.ed-clip-trim') || playheadDragging) return;
    isPanning = true;
    startX = e.clientX;
    startScroll = wrap.scrollLeft;
    wrap.classList.add('dragging');
  });
  document.addEventListener('mousemove', (e) => {
    if (!isPanning) return;
    wrap.scrollLeft = startScroll - (e.clientX - startX);
  });
  document.addEventListener('mouseup', () => {
    if (isPanning) { isPanning = false; wrap.classList.remove('dragging'); }
  });

  // 滚轮：Ctrl缩放，普通横滚
  wrap.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      zoomTimeline(e.deltaY < 0 ? 1 : -1);
    } else {
      wrap.scrollLeft += (e.deltaY || e.deltaX);
    }
  }, { passive: false });

  // wrap scroll → 同步标尺
  wrap.addEventListener('scroll', () => {
    if (ruler) ruler.scrollLeft = wrap.scrollLeft;
  });
}

// ——— 键盘快捷键 ———
document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
  if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
  if (e.code === 'ArrowLeft') { e.preventDefault(); prevClip(); }
  if (e.code === 'ArrowRight') { e.preventDefault(); nextClip(); }
  if (e.code === 'Delete' || e.code === 'Backspace') { e.preventDefault(); deleteSelectedScene(); }
  if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') { e.preventDefault(); undoAction(); }
});

// ——— 播放头持续更新 ———
function startPlayheadLoop() {
  const tick = () => {
    updatePlayhead();
    const video = document.getElementById('preview-video');
    if (video && !video.paused) {
      updateTimeDisplay();
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

// ——— 播放头拖拽 ———
let playheadDragging = false;

function pxToPct(clientX) {
  // 从鼠标 clientX 计算时间轴百分比 (0~1)
  const wrap = document.getElementById('tl-tracks-wrap');
  const area = document.getElementById('timeline-area');
  if (!wrap || !area) return 0;
  const areaRect = area.getBoundingClientRect();
  const trackWidth = wrap.scrollWidth - LANE_LABEL_W;
  const x = clientX - areaRect.left - LANE_LABEL_W + wrap.scrollLeft;
  return Math.max(0, Math.min(1, x / trackWidth));
}

function startPlayheadDrag(e) {
  e.preventDefault();
  e.stopPropagation();
  playheadDragging = true;
  document.addEventListener('mousemove', onPlayheadDrag);
  document.addEventListener('mouseup', endPlayheadDrag);
}

function onPlayheadDrag(e) {
  if (!playheadDragging) return;
  const pct = pxToPct(e.clientX);
  const ph = document.getElementById('tl-playhead');
  if (ph) ph.style.left = getPlayheadPx(pct * 100) + 'px';
  const tbTime = document.getElementById('tb-current-time');
  if (tbTime) tbTime.textContent = formatTime(pct * totalTimelineDur);
}

function endPlayheadDrag(e) {
  if (!playheadDragging) return;
  playheadDragging = false;
  document.removeEventListener('mousemove', onPlayheadDrag);
  document.removeEventListener('mouseup', endPlayheadDrag);
  seekTimelinePlayhead(pxToPct(e.clientX));
}

// ——— 右侧面板 Tab 切换 ———
function switchRightTab(tab, btn) {
  document.querySelectorAll('.ed-rtab').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  else {
    document.querySelectorAll('.ed-rtab').forEach(b => {
      if (b.textContent.trim() === {clip:'片段',subtitle:'字幕',audio:'音频',voice:'配音'}[tab]) b.classList.add('active');
    });
  }
  ['clip','subtitle','audio','voice'].forEach(t => {
    const panel = document.getElementById('rtab-' + t);
    if (panel) panel.style.display = t === tab ? '' : 'none';
  });
}

// ——— 字幕颜色 ———
let subtitleColor = 'white';

function pickSubtitleColor(btn, color) {
  subtitleColor = color;
  document.querySelectorAll('.ed-color-opt').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  saveDialogue();
}

// ——— 配音/TTS ———
function saveVoiceover() {
  if (selectedSceneIndex === null) return;
  if (!editData.voiceovers) editData.voiceovers = [];
  const text = document.getElementById('voice-text').value.trim();
  const existIdx = editData.voiceovers.findIndex(v => v.scene_index === selectedSceneIndex);
  if (!text) {
    if (existIdx >= 0) editData.voiceovers.splice(existIdx, 1);
  } else {
    const entry = {
      scene_index: selectedSceneIndex,
      text,
      voice_id: document.getElementById('voice-id').value || '',
      speed: parseFloat(document.getElementById('voice-speed').value) || 1.0,
      volume: parseInt(document.getElementById('voice-volume').value) / 100,
      audio_path: existIdx >= 0 ? editData.voiceovers[existIdx].audio_path : null
    };
    if (existIdx >= 0) editData.voiceovers[existIdx] = entry;
    else editData.voiceovers.push(entry);
  }
  renderVoiceTrack();
  scheduleSave();
}

async function generateVoiceover() {
  if (selectedSceneIndex === null) return;
  const text = document.getElementById('voice-text').value.trim();
  if (!text) { document.getElementById('voice-status').textContent = '请输入配音文本'; return; }
  const btn = document.getElementById('btn-gen-voice');
  btn.disabled = true; btn.textContent = '生成中...';
  document.getElementById('voice-status').textContent = '正在生成语音...';
  try {
    const voiceId = document.getElementById('voice-id').value || '';
    const speed = parseFloat(document.getElementById('voice-speed').value) || 1.0;
    const res = await authFetch('/api/story/preview-voice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ voice_id: voiceId, text, speed })
    });
    const data = await res.json();
    if (data.success && data.audio_url) {
      // 保存配音音频路径
      if (!editData.voiceovers) editData.voiceovers = [];
      const existIdx = editData.voiceovers.findIndex(v => v.scene_index === selectedSceneIndex);
      const entry = {
        scene_index: selectedSceneIndex, text,
        voice_id: voiceId, speed,
        volume: parseInt(document.getElementById('voice-volume').value) / 100,
        audio_url: data.audio_url,
        audio_path: data.audio_url
      };
      if (existIdx >= 0) editData.voiceovers[existIdx] = entry;
      else editData.voiceovers.push(entry);
      renderVoiceTrack();
      scheduleSave();
      document.getElementById('voice-status').innerHTML = '<span style="color:var(--success)">配音已生成</span>';
      // 播放预览
      new Audio(data.audio_url).play().catch(() => {});
    } else {
      document.getElementById('voice-status').innerHTML = `<span style="color:var(--error)">${data.error || '生成失败'}</span>`;
    }
  } catch (e) {
    document.getElementById('voice-status').innerHTML = `<span style="color:var(--error)">${e.message}</span>`;
  } finally {
    btn.disabled = false; btn.textContent = '生成配音';
  }
}

// 加载音色列表
async function loadVoiceOptions() {
  try {
    const res = await authFetch('/api/story/voices');
    const data = await res.json();
    if (data.success) {
      const sel = document.getElementById('voice-id');
      (data.data || []).forEach(v => {
        const opt = document.createElement('option');
        opt.value = v.id;
        opt.textContent = `${v.name} (${v.provider})`;
        sel.appendChild(opt);
      });
    }
  } catch {}
}

// 更新 selectScene 填充配音数据
const _origSelectScene = selectScene;
selectScene = function(sceneIdx) {
  _origSelectScene(sceneIdx);
  // 填充配音数据
  const vo = (editData.voiceovers || []).find(v => v.scene_index === sceneIdx) || {};
  const vtEl = document.getElementById('voice-text');
  if (vtEl) vtEl.value = vo.text || '';
  const viEl = document.getElementById('voice-id');
  if (viEl) viEl.value = vo.voice_id || '';
  const vsEl = document.getElementById('voice-speed');
  if (vsEl) { vsEl.value = vo.speed || 1.0; document.getElementById('voice-speed-val').textContent = (vo.speed || 1.0).toFixed(1) + 'x'; }
  const vvEl = document.getElementById('voice-volume');
  if (vvEl) { vvEl.value = (vo.volume || 0.8) * 100; document.getElementById('voice-volume-val').textContent = Math.round((vo.volume || 0.8) * 100) + '%'; }
  document.getElementById('voice-status').textContent = vo.audio_path ? '已有配音' : '';
};

function escHtml(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

startPlayheadLoop();
loadVoiceOptions();
init();
setTimeout(initTimelinePan, 100);
