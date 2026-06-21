#!/usr/bin/env node
const fs = require('fs');

const BASE = process.env.VIDO_BASE_URL || 'http://127.0.0.1:3007';
const LOGIN_FILE = process.env.VIDO_LOGIN_FILE || 'outputs/login.json';
const BACKGROUND_URL = process.env.VIDO_SMOKE_BG_URL
  || `${BASE}/public/jimeng-assets/strict_space_guide_84682525-f6e7-45f6-acbc-7895d7ec25b2_bg_plate.jpg`;
const VOICE_ID = process.env.VIDO_SMOKE_VOICE_ID || 'longxiaochun';
const GUIDE_GENDER = process.env.VIDO_SMOKE_GUIDE_GENDER === 'male' ? 'male' : 'female';
const MAX_WAIT_MS = Number(process.env.VIDO_SMOKE_MAX_WAIT_MS || 18 * 60 * 1000);

const TEXT = process.env.VIDO_SMOKE_TEXT
  || '欢迎来到我们的智能展厅。这套解决方案可以把品牌介绍、产品亮点和空间展示融合在一个连续镜头里，让客户更直观地理解价值。';

function now() {
  return new Date().toTimeString().slice(0, 8);
}

async function api(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok) {
    const err = new Error(data.error || data.message || `HTTP ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

async function main() {
  const login = JSON.parse(fs.readFileSync(LOGIN_FILE, 'utf8'));
  console.log(`[${now()}] login`);
  const auth = await api('/api/auth/login', {
    method: 'POST',
    body: { username: login.username, password: login.password },
  });
  const token = auth.data?.access_token || auth.access_token || auth.token;
  if (!token) throw new Error('login did not return access token');

  const keyframePayload = {
    background_url: BACKGROUND_URL,
    text: TEXT,
    title: '默认流程广告数字人 smoke',
    scene_prompt: '现代品牌展厅，右侧有展示墙和产品信息区，空间干净明亮，适合导览讲解',
    duration_sec: 10,
    segments: [{
      title: '单镜头展墙讲解',
      text: TEXT,
      voiceover: TEXT,
      start: 0,
      end: 10,
      duration: 10,
      role: 'showroom_guide',
    }],
    guide_gender: GUIDE_GENDER,
    ad_mode: 'showroom_guide',
    generation_mode: 'showroom_guide_strict',
    strict_mode: true,
    ad_style: 'luxury_soft',
    shot_count: 1,
    aspect_ratio: '16:9',
    aspectRatio: '16:9',
    output_size: 'standard',
    outputSize: 'standard',
    resolution: '1280x720',
  };

  console.log(`[${now()}] keyframe request`);
  const keyframe = await api('/api/dh/spaces/keyframes', {
    method: 'POST',
    token,
    body: keyframePayload,
  });
  console.log(`[${now()}] keyframe response`, JSON.stringify({
    success: keyframe.success,
    strict: keyframe.strict,
    code: keyframe.code,
    keyframe_id: keyframe.keyframe_id,
    reference_mode: keyframe.keyframes?.[0]?.reference_mode,
    qa_pass: keyframe.keyframes?.[0]?.qa?.pass,
    image_url: keyframe.keyframes?.[0]?.image_url,
  }, null, 2));

  if (!keyframe.success || !keyframe.keyframe_id) {
    console.log(`[${now()}] keyframe failed detail`, JSON.stringify(keyframe, null, 2).slice(0, 3000));
    process.exitCode = 2;
    return;
  }

  const generatePayload = {
    ...keyframePayload,
    voice_id: VOICE_ID,
    scene: 'auto',
    camera: 'auto',
    camera_prompt: '一镜到底展厅导览：缓慢向前推进，轻微横向视差，镜头跟随讲解员手势从人物过渡到展示墙，再回到人物推荐',
    speech_segments: keyframePayload.segments,
    keyframes: keyframe.keyframes || [],
    keyframe_id: keyframe.keyframe_id,
    generation_mode: 'showroom_guide_tracks',
    strict_mode: false,
    subtitle: { show: true, style: 'popup', smartEmphasis: true },
  };

  console.log(`[${now()}] generate request`);
  const submitted = await api('/api/dh/spaces/generate', {
    method: 'POST',
    token,
    body: generatePayload,
  });
  console.log(`[${now()}] generate response`, JSON.stringify(submitted, null, 2));
  if (!submitted.success || !submitted.taskId) {
    process.exitCode = 3;
    return;
  }

  const started = Date.now();
  let lastStage = '';
  while (Date.now() - started < MAX_WAIT_MS) {
    await new Promise(r => setTimeout(r, 15000));
    const status = await api(`/api/dh/spaces/${encodeURIComponent(submitted.taskId)}`, { token });
    const task = status.task || {};
    const stage = `${task.status || ''}/${task.stage || ''}/${task.progress || 0}`;
    if (stage !== lastStage) {
      lastStage = stage;
      console.log(`[${now()}] task`, JSON.stringify({
        id: task.id || submitted.taskId,
        status: task.status,
        stage: task.stage,
        progress: task.progress,
        message: task.message,
        error: task.error,
        video_url: task.video_url || task.videoUrl,
        actual_provider: task.actual_provider,
        actual_model: task.actual_model,
      }, null, 2));
    }
    if (task.status === 'done') {
      console.log(`[${now()}] smoke done`);
      return;
    }
    if (task.status === 'error') {
      console.log(`[${now()}] smoke error detail`, JSON.stringify(task, null, 2).slice(0, 5000));
      process.exitCode = 4;
      return;
    }
  }
  console.log(`[${now()}] smoke timeout after ${Math.round(MAX_WAIT_MS / 1000)}s`);
  process.exitCode = 5;
}

main().catch(err => {
  console.error(`[${now()}] fatal`, err.message);
  if (err.data) console.error(JSON.stringify(err.data, null, 2).slice(0, 5000));
  process.exit(1);
});
