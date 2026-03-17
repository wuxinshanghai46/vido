'use strict';

const projectId = new URLSearchParams(location.search).get('id');
if (!projectId) { location.href = '/'; }

let editData = {};
let clips = [];
let scenes = [];
let selectedSceneIndex = null;
let dragSrcIndex = null;
let saveTimer = null;

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

  // 计算总时长用于标尺
  let totalDur = 0;
  const clipDurations = [];
  order.forEach(sceneIdx => {
    const clip = clips.find(c => c.scene_index === sceneIdx);
    const dur = clip?.duration || 10;
    clipDurations.push(dur);
    totalDur += dur;
  });

  // 绘制标尺
  if (ruler) {
    let marks = '';
    let acc = 0;
    for (let t = 0; t <= totalDur; t += 5) {
      const pct = totalDur > 0 ? (t / totalDur * 100) : 0;
      marks += `<span class="ed-tl-mark" style="left:${pct}%">${formatTime(t)}</span>`;
    }
    ruler.innerHTML = marks;
  }

  // 渲染片段块
  timeline.innerHTML = order.map((sceneIdx, position) => {
    const clip = clips.find(c => c.scene_index === sceneIdx);
    if (!clip) return '';
    const scene = scenes[sceneIdx] || {};
    const isDeleted = (editData.deleted_scenes || []).includes(sceneIdx);
    const isSelected = selectedSceneIndex === sceneIdx;
    const dur = clip.duration || 10;
    const widthPct = totalDur > 0 ? (dur / totalDur * 100) : (100 / order.length);
    const dialogue = editData.dialogues?.find(d => d.scene_index === sceneIdx);

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
        <div class="ed-clip-inner">
          <div class="ed-clip-thumb">
            <video src="${authUrl(`/api/projects/${projectId}/clips/${clip.id}/stream`)}" preload="metadata" muted
              onloadedmetadata="this.currentTime=1"></video>
          </div>
          <div class="ed-clip-info">
            <span class="ed-clip-num">${position + 1}</span>
            <span class="ed-clip-title">${escHtml(scene.title || `场景${sceneIdx+1}`)}</span>
            <span class="ed-clip-dur">${dur}s</span>
          </div>
          ${dialogue?.text ? '<div class="ed-clip-sub">CC</div>' : ''}
          ${isDeleted ? '<div class="ed-clip-del">已删除</div>' : ''}
        </div>
      </div>`;
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
  if (video.paused) {
    video.play().catch(() => {});
    document.getElementById('ctrl-play').textContent = '⏸';
    document.getElementById('play-btn-icon').textContent = '⏸';
    document.getElementById('player-overlay').classList.add('hidden');
  } else {
    video.pause();
    document.getElementById('ctrl-play').textContent = '▶';
    document.getElementById('play-btn-icon').textContent = '▶';
    document.getElementById('player-overlay').classList.remove('hidden');
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

  document.getElementById('props-empty').style.display = 'none';
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

function escHtml(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

init();
