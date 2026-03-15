'use strict';

// 从 URL 获取项目 ID：/editor.html?id=xxx
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
  // 确认登录状态
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
  } catch (e) {
    alert('加载失败: ' + e.message);
  }
}

// ——— 时间轴渲染 ———
function renderTimeline() {
  const order = editData.scenes_order || clips.map(c => c.scene_index);
  const timeline = document.getElementById('timeline');

  timeline.innerHTML = order.map((sceneIdx, position) => {
    const clip = clips.find(c => c.scene_index === sceneIdx);
    if (!clip) return '';
    const scene = scenes[sceneIdx] || {};
    const isDeleted = (editData.deleted_scenes || []).includes(sceneIdx);
    const trim = editData.scene_trims?.[sceneIdx];
    const dialogue = editData.dialogues?.find(d => d.scene_index === sceneIdx);
    const isSelected = selectedSceneIndex === sceneIdx;

    return `
      <div class="track-item${isSelected ? ' selected' : ''}${isDeleted ? ' deleted' : ''}"
        data-index="${position}" data-scene="${sceneIdx}"
        onclick="selectScene(${sceneIdx})"
        draggable="true"
        ondragstart="onDragStart(event,${position})"
        ondragover="onDragOver(event,${position})"
        ondrop="onDrop(event,${position})"
        ondragend="onDragEnd(event)">
        <div class="track-drag-handle">⠿</div>
        <div class="track-num">${position + 1}</div>
        <div class="track-thumb">
          <video src="${authUrl(`/api/projects/${projectId}/clips/${clip.id}/stream`)}" preload="metadata" muted
            onloadedmetadata="this.currentTime=1"></video>
        </div>
        <div class="track-body">
          <div class="track-title">${escHtml(scene.title || clip.scene_description || `场景 ${sceneIdx + 1}`)}</div>
          <div class="track-desc">${escHtml(scene.action || '')}</div>
          <div class="track-badges">
            <span class="track-badge">⏱ ${clip.duration || '?'}秒</span>
            ${trim ? `<span class="track-badge has-trim">✂ 已裁剪</span>` : ''}
            ${dialogue?.text ? `<span class="track-badge has-dialogue">💬 有字幕</span>` : ''}
            ${isDeleted ? `<span class="track-badge" style="border-color:var(--error);color:var(--error)">已删除</span>` : ''}
          </div>
        </div>
      </div>`;
  }).join('');
}

// ——— 场景选择 ———
function selectScene(sceneIdx) {
  selectedSceneIndex = sceneIdx;
  renderTimeline();

  const panel = document.getElementById('scene-panel');
  panel.style.display = 'block';

  const clip = clips.find(c => c.scene_index === sceneIdx);
  const scene = scenes[sceneIdx] || {};
  document.getElementById('scene-panel-title').textContent =
    scene.title || clip?.scene_description || `场景 ${sceneIdx + 1}`;

  // 填入裁剪数据
  const trim = editData.scene_trims?.[sceneIdx] || {};
  document.getElementById('trim-start').value = trim.start || '';
  document.getElementById('trim-end').value = trim.end || '';

  if (clip?.duration) {
    document.getElementById('clip-duration-hint').textContent = `原时长 ${clip.duration}秒`;
  }

  // 填入字幕数据
  const dialogue = editData.dialogues?.find(d => d.scene_index === sceneIdx) || {};
  document.getElementById('dialogue-text').value = dialogue.text || '';
  document.getElementById('dialogue-start').value = dialogue.start ?? 0;
  document.getElementById('dialogue-duration').value = dialogue.duration || 5;
  document.getElementById('dialogue-position').value = dialogue.position || 'bottom';
  document.getElementById('dialogue-fontsize').value = dialogue.font_size || 28;

  // 删除按钮状态
  const isDeleted = (editData.deleted_scenes || []).includes(sceneIdx);
  const btn = document.getElementById('btn-delete-scene');
  btn.textContent = isDeleted ? '恢复场景' : '删除场景';
  btn.className = isDeleted ? 'icon-btn' : 'icon-btn danger';
}

// ——— 删除/恢复场景 ———
function deleteSelectedScene() {
  if (selectedSceneIndex === null) return;
  const deleted = editData.deleted_scenes || [];
  const idx = deleted.indexOf(selectedSceneIndex);
  if (idx >= 0) {
    deleted.splice(idx, 1); // 恢复
  } else {
    deleted.push(selectedSceneIndex); // 删除
  }
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
  if (start === 0 && !end) {
    delete editData.scene_trims[selectedSceneIndex];
  } else {
    editData.scene_trims[selectedSceneIndex] = { start, end };
  }
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
      scene_index: selectedSceneIndex,
      text,
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

function onDragOver(e, toIndex) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  document.querySelectorAll('.track-item').forEach(el => el.classList.remove('drag-over'));
  e.currentTarget.classList.add('drag-over');
}

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
  document.querySelectorAll('.track-item').forEach(el => {
    el.classList.remove('dragging', 'drag-over');
  });
}

// ——— 音乐 ———
let musicDuration = 0;
let musicTrimStart = 0;
let musicTrimEnd = 0;
let musicAudio = null;        // for preview playback
let musicPreviewPlaying = false;
let musicPreviewRAF = null;
let musicWaveformData = null;

function formatTime(sec) {
  if (!sec || !isFinite(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function getVideoDurationTotal() {
  // Sum clip durations minus trims
  let total = 0;
  const order = editData.scenes_order || clips.map(c => c.scene_index);
  const deleted = editData.deleted_scenes || [];
  order.forEach(idx => {
    if (deleted.includes(idx)) return;
    const clip = clips.find(c => c.scene_index === idx);
    if (!clip) return;
    let dur = clip.duration || 0;
    const trim = editData.scene_trims?.[idx];
    if (trim) {
      const s = trim.start || 0;
      const e = trim.end || dur;
      dur = Math.max(0, e - s);
    }
    total += dur;
  });
  return total;
}

function loadMusicUI() {
  const music = editData.music;
  if (music?.file_path) {
    document.getElementById('music-empty').style.display = 'none';
    document.getElementById('music-loaded').style.display = 'block';
    document.getElementById('music-name').textContent = music.original_name || '背景音乐';
    document.getElementById('music-volume').value = (music.volume || 0.5) * 100;
    document.getElementById('volume-val').textContent = Math.round((music.volume || 0.5) * 100) + '%';
    document.getElementById('music-loop').checked = music.loop !== false;

    // Load audio to get duration and init timeline
    initMusicAudio();
  } else {
    document.getElementById('music-empty').style.display = 'block';
    document.getElementById('music-loaded').style.display = 'none';
    cleanupMusicPreview();
  }

  // Update video duration reference
  const vidDur = getVideoDurationTotal();
  const vidRef = document.getElementById('video-total-duration');
  if (vidRef) vidRef.textContent = vidDur > 0 ? formatTime(vidDur) : '--';
}

function initMusicAudio() {
  if (musicAudio) { musicAudio.pause(); musicAudio = null; }

  musicAudio = new Audio(authUrl(`/api/editor/${projectId}/music-stream`));
  musicAudio.crossOrigin = 'anonymous';

  musicAudio.addEventListener('loadedmetadata', () => {
    musicDuration = musicAudio.duration;

    // Restore saved trim or default to full
    musicTrimStart = editData.music?.trim_start || 0;
    musicTrimEnd = editData.music?.trim_end || musicDuration;
    if (musicTrimEnd > musicDuration) musicTrimEnd = musicDuration;

    initMusicTimeline();
    updateTrimDisplay();

    // Decode waveform
    decodeWaveform();
  });

  musicAudio.addEventListener('ended', () => {
    stopMusicPreview();
  });
}

function decodeWaveform() {
  authFetch(`/api/editor/${projectId}/music-stream`)
    .then(r => r.arrayBuffer())
    .then(buf => {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      return audioCtx.decodeAudioData(buf);
    })
    .then(audioBuffer => {
      // Get channel data and reduce to drawable peaks
      const raw = audioBuffer.getChannelData(0);
      const canvas = document.getElementById('music-waveform');
      const samples = canvas.width;
      const blockSize = Math.floor(raw.length / samples);
      musicWaveformData = new Float32Array(samples);
      for (let i = 0; i < samples; i++) {
        let sum = 0;
        const start = i * blockSize;
        for (let j = 0; j < blockSize; j++) {
          sum += Math.abs(raw[start + j] || 0);
        }
        musicWaveformData[i] = sum / blockSize;
      }
      drawWaveform();
    })
    .catch(() => {
      // Fallback: draw a simple placeholder
      drawWaveformPlaceholder();
    });
}

function drawWaveform() {
  const canvas = document.getElementById('music-waveform');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  if (!musicWaveformData) { drawWaveformPlaceholder(); return; }

  // Normalize
  let max = 0;
  for (let i = 0; i < musicWaveformData.length; i++) {
    if (musicWaveformData[i] > max) max = musicWaveformData[i];
  }
  if (max === 0) max = 1;

  ctx.fillStyle = 'rgba(251,251,251,.15)';
  const barW = Math.max(1, w / musicWaveformData.length);
  for (let i = 0; i < musicWaveformData.length; i++) {
    const barH = (musicWaveformData[i] / max) * (h * 0.85);
    const x = i * barW;
    const y = (h - barH) / 2;
    ctx.fillRect(x, y, Math.max(1, barW - 0.5), barH);
  }
}

function drawWaveformPlaceholder() {
  const canvas = document.getElementById('music-waveform');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  // Draw simple sine-like pattern
  ctx.fillStyle = 'rgba(251,251,251,.1)';
  for (let i = 0; i < w; i += 2) {
    const barH = 5 + Math.abs(Math.sin(i * 0.05)) * (h * 0.5) + Math.random() * 4;
    ctx.fillRect(i, (h - barH) / 2, 1.5, barH);
  }
}

function initMusicTimeline() {
  const timeline = document.getElementById('music-timeline');
  const region = document.getElementById('music-trim-region');
  const handleLeft = document.getElementById('trim-handle-left');
  const handleRight = document.getElementById('trim-handle-right');

  if (!timeline || !region) return;

  updateTrimRegion();

  // Drag handling
  let dragging = null; // 'left', 'right', or null

  const getTimeFromX = (clientX) => {
    const rect = timeline.getBoundingClientRect();
    const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
    return (x / rect.width) * musicDuration;
  };

  handleLeft.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); dragging = 'left'; });
  handleRight.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); dragging = 'right'; });

  // Also support touch
  handleLeft.addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); dragging = 'left'; }, { passive: false });
  handleRight.addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); dragging = 'right'; }, { passive: false });

  const onMove = (clientX) => {
    if (!dragging) return;
    const t = getTimeFromX(clientX);
    if (dragging === 'left') {
      musicTrimStart = Math.max(0, Math.min(t, musicTrimEnd - 1));
    } else {
      musicTrimEnd = Math.min(musicDuration, Math.max(t, musicTrimStart + 1));
    }
    updateTrimRegion();
    updateTrimDisplay();
  };

  document.addEventListener('mousemove', (e) => { if (dragging) onMove(e.clientX); });
  document.addEventListener('touchmove', (e) => { if (dragging && e.touches[0]) onMove(e.touches[0].clientX); }, { passive: true });

  const onEnd = () => {
    if (dragging) {
      dragging = null;
      saveMusicTrim();
    }
  };
  document.addEventListener('mouseup', onEnd);
  document.addEventListener('touchend', onEnd);
}

function updateTrimRegion() {
  const timeline = document.getElementById('music-timeline');
  const region = document.getElementById('music-trim-region');
  if (!timeline || !region || !musicDuration) return;

  const w = timeline.clientWidth;
  const leftPct = (musicTrimStart / musicDuration) * 100;
  const widthPct = ((musicTrimEnd - musicTrimStart) / musicDuration) * 100;

  region.style.left = leftPct + '%';
  region.style.width = widthPct + '%';
}

function updateTrimDisplay() {
  const rangeEl = document.getElementById('music-trim-range');
  const durEl = document.getElementById('music-trim-duration');
  if (rangeEl) rangeEl.textContent = `${formatTime(musicTrimStart)} - ${formatTime(musicTrimEnd)}`;
  if (durEl) durEl.textContent = `选中 ${formatTime(musicTrimEnd - musicTrimStart)} / 总 ${formatTime(musicDuration)}`;
}

function saveMusicTrim() {
  if (!editData.music) return;
  editData.music.trim_start = Math.round(musicTrimStart * 100) / 100;
  editData.music.trim_end = Math.round(musicTrimEnd * 100) / 100;
  scheduleSave();
}

function resetMusicTrim() {
  if (!musicDuration) return;
  musicTrimStart = 0;
  musicTrimEnd = musicDuration;
  updateTrimRegion();
  updateTrimDisplay();
  saveMusicTrim();
}

function toggleMusicPreview() {
  if (musicPreviewPlaying) {
    stopMusicPreview();
  } else {
    startMusicPreview();
  }
}

function startMusicPreview() {
  if (!musicAudio || !musicDuration) return;
  musicAudio.currentTime = musicTrimStart;
  musicAudio.volume = parseInt(document.getElementById('music-volume').value) / 100;
  musicAudio.play().catch(() => {});
  musicPreviewPlaying = true;

  const btn = document.getElementById('music-preview-btn');
  if (btn) { btn.textContent = '\u23F8 停止'; btn.classList.add('playing'); }

  const playhead = document.getElementById('music-playhead');
  if (playhead) playhead.style.display = 'block';

  // Animate playhead
  const tick = () => {
    if (!musicPreviewPlaying) return;
    if (musicAudio.currentTime >= musicTrimEnd) {
      stopMusicPreview();
      return;
    }
    // Update playhead position
    if (playhead && musicDuration) {
      const pct = (musicAudio.currentTime / musicDuration) * 100;
      playhead.style.left = pct + '%';
    }
    musicPreviewRAF = requestAnimationFrame(tick);
  };
  musicPreviewRAF = requestAnimationFrame(tick);
}

function stopMusicPreview() {
  if (musicAudio) { musicAudio.pause(); }
  musicPreviewPlaying = false;
  if (musicPreviewRAF) { cancelAnimationFrame(musicPreviewRAF); musicPreviewRAF = null; }

  const btn = document.getElementById('music-preview-btn');
  if (btn) { btn.innerHTML = '&#9654; 试听'; btn.classList.remove('playing'); }

  const playhead = document.getElementById('music-playhead');
  if (playhead) playhead.style.display = 'none';
}

function cleanupMusicPreview() {
  stopMusicPreview();
  musicDuration = 0;
  musicTrimStart = 0;
  musicTrimEnd = 0;
  musicWaveformData = null;
  if (musicAudio) { musicAudio.pause(); musicAudio = null; }
}

async function uploadMusic(input) {
  const file = input.files[0];
  if (!file) return;

  const formData = new FormData();
  formData.append('music', file);
  formData.append('volume', '0.5');

  setSaveStatus('上传中...');
  try {
    const res = await authFetch(`/api/editor/${projectId}/music`, { method: 'POST', body: formData });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);
    editData.music = data.data.music;
    loadMusicUI();
    setSaveStatus('已保存', true);
  } catch (e) {
    alert('上传失败: ' + e.message);
    setSaveStatus('');
  }
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
    // 同步音乐设置
    if (editData.music) {
      editData.music.volume = parseInt(document.getElementById('music-volume').value) / 100;
      editData.music.loop = document.getElementById('music-loop').checked;
      if (musicDuration > 0) {
        editData.music.trim_start = Math.round(musicTrimStart * 100) / 100;
        editData.music.trim_end = Math.round(musicTrimEnd * 100) / 100;
      }
    }
    const res = await authFetch(`/api/editor/${projectId}`, {
      method: 'PUT',
      body: JSON.stringify(editData)
    });
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
  btn.disabled = true;
  btn.innerHTML = '<span>⟳</span> 渲染中...';

  addRenderLog('开始渲染...');

  if (renderSSE) renderSSE.close();
  renderSSE = new EventSource(authUrl(`/api/editor/${projectId}/render/progress`));
  renderSSE.onmessage = (e) => {
    const data = JSON.parse(e.data);
    if (data.step === 'connected') return;
    const isError = data.step === 'error';
    const isDone = data.step === 'done';
    addRenderLog(data.message || data.step, isError ? 'error' : isDone ? 'success' : '');

    if (isDone) {
      renderSSE.close();
      btn.disabled = false;
      btn.innerHTML = '<span>⚡</span> 渲染导出';
      document.getElementById('render-result').style.display = 'block';
      document.getElementById('render-download').href = authUrl(`/api/editor/${projectId}/download-render`);
    }
    if (isError) {
      renderSSE.close();
      btn.disabled = false;
      btn.innerHTML = '<span>⚡</span> 渲染导出';
    }
  };

  // 发起渲染
  authFetch(`/api/editor/${projectId}/render`, { method: 'POST' }).catch(e => addRenderLog(e.message, 'error'));
}

function addRenderLog(msg, type = '') {
  const log = document.getElementById('render-log');
  const el = document.createElement('div');
  el.className = 'render-log-entry ' + type;
  el.innerHTML = `<span class="time">${new Date().toLocaleTimeString('zh-CN')}</span><span class="msg">${escHtml(msg)}</span>`;
  log.appendChild(el);
  log.scrollTop = log.scrollHeight;
}

function previewRender() {
  openVideoPreview(authUrl(`/api/editor/${projectId}/stream-render`), '成品预览');
}

// ——— 视频预览 ———
function openVideoPreview(src, title) {
  document.getElementById('modal-title').textContent = title || '预览';
  const video = document.getElementById('modal-video');
  document.getElementById('modal-video-src').src = src;
  video.load();
  video.play().catch(() => {});
  document.getElementById('video-modal').classList.add('open');
}

function closePreview() {
  const video = document.getElementById('modal-video');
  video.pause();
  document.getElementById('modal-video-src').src = '';
  video.load();
  document.getElementById('video-modal').classList.remove('open');
}

// ——— 工具 ———
function escHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

init();
