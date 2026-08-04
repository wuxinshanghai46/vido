const VERTEX_SHADER = `
attribute vec2 a_position;
varying vec2 v_position;
void main() {
  v_position = a_position;
  gl_Position = vec4(a_position, 0.0, 1.0);
}`;

const FRAGMENT_SHADER = `
precision mediump float;
varying vec2 v_position;
uniform sampler2D u_panorama;
uniform float u_aspect;
uniform float u_fov;
uniform float u_yaw;
uniform float u_pitch;
const float PI = 3.141592653589793;
void main() {
  float scale = tan(u_fov * 0.5);
  vec3 ray = normalize(vec3(v_position.x * u_aspect * scale, v_position.y * scale, -1.0));
  float cp = cos(u_pitch);
  float sp = sin(u_pitch);
  ray = vec3(ray.x, ray.y * cp - ray.z * sp, ray.y * sp + ray.z * cp);
  float cy = cos(u_yaw);
  float sy = sin(u_yaw);
  ray = vec3(ray.x * cy - ray.z * sy, ray.y, ray.x * sy + ray.z * cy);
  vec2 uv = vec2(atan(ray.x, -ray.z) / (2.0 * PI) + 0.5, 0.5 - asin(clamp(ray.y, -1.0, 1.0)) / PI);
  gl_FragColor = texture2D(u_panorama, uv);
}`;

function shader(gl, type, source) {
  const value = gl.createShader(type);
  gl.shaderSource(value, source);
  gl.compileShader(value);
  if (!gl.getShaderParameter(value, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(value) || '全景渲染器编译失败';
    gl.deleteShader(value);
    throw new Error(message);
  }
  return value;
}

function panoramaUrl(source, host) {
  const width = Math.min(2560, Math.max(1280, Math.ceil((host.clientWidth || 960) * Math.min(2, devicePixelRatio || 1))));
  return window.VidoMediaDelivery?.previewUrl?.(source, width, 'webp') || source;
}

function flatFallback(host, source, label, reason) {
  host.replaceChildren();
  host.dataset.viewerEngine = 'panorama-flat-fallback';
  const panel = document.createElement('div');
  panel.className = 'panorama-flat-fallback';
  const image = document.createElement('img');
  image.alt = `${label || '当前场景'}全景平面预览`;
  image.src = panoramaUrl(source, host);
  image.decoding = 'async';
  const copy = document.createElement('div');
  copy.innerHTML = '<b>当前设备无法启动球形全景</b><span></span>';
  copy.querySelector('span').textContent = `${reason || 'WebGL 不可用'}，已降级为平面图查看，不代表真实360°环视。`;
  panel.append(image, copy);
  host.append(panel);
  return { reset() {}, dispose() { image.removeAttribute('src'); host.replaceChildren(); } };
}

/** 按需挂载 3DoF 等距柱状全景；不引入 Three.js，避免全景查看阻塞资产中心。 */
export function mountPanoramaViewer({ host, source, label = '场景360°全景' } = {}) {
  if (!host || !source) throw new Error('没有可查看的全景资产');
  host.replaceChildren();
  const canvas = document.createElement('canvas');
  canvas.className = 'panorama-webgl-canvas';
  canvas.tabIndex = 0;
  canvas.setAttribute('role', 'application');
  canvas.setAttribute('aria-label', `${label}；拖动环视，滚轮缩放，方向键调整视角`);
  const gl = canvas.getContext('webgl', { alpha: false, antialias: true, powerPreference: 'low-power' });
  if (!gl) return flatFallback(host, source, label, 'WebGL 初始化失败');

  host.dataset.viewerEngine = 'equirectangular-webgl-3dof';
  const controls = document.createElement('div');
  controls.className = 'panorama-viewer-controls';
  controls.innerHTML = '<span data-panorama-status aria-live="polite">正在加载全景预览…</span><div><button type="button" data-panorama-reset>重置</button><button type="button" data-panorama-fullscreen>全屏</button></div>';
  host.append(canvas, controls);

  let program;
  let buffer;
  let texture;
  try {
    const vertex = shader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
    const fragment = shader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
    program = gl.createProgram();
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || '全景渲染器链接失败');
    buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    texture = gl.createTexture();
  } catch (error) {
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return flatFallback(host, source, label, error.message);
  }

  const state = { yaw: 0, pitch: 0, fov: 70 * Math.PI / 180, dragging: false, x: 0, y: 0, ready: false, disposed: false };
  let fallbackController = null;
  const status = controls.querySelector('[data-panorama-status]');
  const render = () => {
    if (!state.ready || state.disposed) return;
    const ratio = Math.min(2, devicePixelRatio || 1);
    const width = Math.max(2, Math.round(host.clientWidth * ratio));
    const height = Math.max(2, Math.round(host.clientHeight * ratio));
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    gl.viewport(0, 0, width, height);
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    const position = gl.getAttribLocation(program, 'a_position');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    gl.uniform1f(gl.getUniformLocation(program, 'u_aspect'), width / height);
    gl.uniform1f(gl.getUniformLocation(program, 'u_fov'), state.fov);
    gl.uniform1f(gl.getUniformLocation(program, 'u_yaw'), state.yaw);
    gl.uniform1f(gl.getUniformLocation(program, 'u_pitch'), state.pitch);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(gl.getUniformLocation(program, 'u_panorama'), 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  };
  const reset = () => { state.yaw = 0; state.pitch = 0; state.fov = 70 * Math.PI / 180; render(); canvas.focus(); };
  const pointerDown = event => { state.dragging = true; state.x = event.clientX; state.y = event.clientY; canvas.setPointerCapture?.(event.pointerId); canvas.focus(); };
  const pointerMove = event => {
    if (!state.dragging) return;
    state.yaw -= (event.clientX - state.x) * .005;
    state.pitch = Math.max(-1.45, Math.min(1.45, state.pitch + (event.clientY - state.y) * .004));
    state.x = event.clientX; state.y = event.clientY; render();
  };
  const pointerUp = event => { state.dragging = false; canvas.releasePointerCapture?.(event.pointerId); };
  const wheel = event => { event.preventDefault(); state.fov = Math.max(.42, Math.min(1.75, state.fov + Math.sign(event.deltaY) * .08)); render(); };
  const keydown = event => {
    const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '=', '-', '_', '0', 'f', 'F'];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    if (event.key === 'ArrowLeft') state.yaw += .08;
    if (event.key === 'ArrowRight') state.yaw -= .08;
    if (event.key === 'ArrowUp') state.pitch = Math.min(1.45, state.pitch + .06);
    if (event.key === 'ArrowDown') state.pitch = Math.max(-1.45, state.pitch - .06);
    if (['+', '='].includes(event.key)) state.fov = Math.max(.42, state.fov - .08);
    if (['-', '_'].includes(event.key)) state.fov = Math.min(1.75, state.fov + .08);
    if (event.key === '0') return reset();
    if (event.key.toLowerCase() === 'f') controls.querySelector('[data-panorama-fullscreen]').click();
    render();
  };
  const fullscreen = async () => {
    try {
      if (document.fullscreenElement === host) await document.exitFullscreen();
      else await host.requestFullscreen?.();
    } catch { status.textContent = '当前浏览器不允许全屏，仍可继续拖动查看。'; }
  };
  const fullscreenChange = () => { controls.querySelector('[data-panorama-fullscreen]').textContent = document.fullscreenElement === host ? '退出全屏' : '全屏'; render(); };
  canvas.addEventListener('pointerdown', pointerDown);
  canvas.addEventListener('pointermove', pointerMove);
  canvas.addEventListener('pointerup', pointerUp);
  canvas.addEventListener('pointercancel', pointerUp);
  canvas.addEventListener('wheel', wheel, { passive: false });
  canvas.addEventListener('keydown', keydown);
  controls.querySelector('[data-panorama-reset]').addEventListener('click', reset);
  controls.querySelector('[data-panorama-fullscreen]').addEventListener('click', fullscreen);
  document.addEventListener('fullscreenchange', fullscreenChange);
  const observer = new ResizeObserver(render);
  observer.observe(host);

  const image = new Image();
  image.decoding = 'async';
  image.onload = () => {
    if (state.disposed) return;
    const ratio = image.naturalWidth / Math.max(1, image.naturalHeight);
    if (Math.abs(ratio - 2) > .08) {
      fallbackController = flatFallback(host, source, label, `资产尺寸比为 ${ratio.toFixed(2)}:1，不是2:1等距柱状全景`);
      return;
    }
    try {
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    } catch (error) {
      fallbackController = flatFallback(host, source, label, error.message || '全景纹理无法加载');
      return;
    }
    state.ready = true;
    status.textContent = '3DoF原地环视 · 拖动查看 · 滚轮缩放';
    render();
  };
  image.onerror = () => { fallbackController = flatFallback(host, source, label, '全景纹理加载失败'); };
  const textureUrl = panoramaUrl(source, host);
  try { if (new URL(textureUrl, location.href).origin !== location.origin) image.crossOrigin = 'anonymous'; } catch {}
  image.src = textureUrl;

  const dispose = () => {
    if (state.disposed) return;
    state.disposed = true;
    fallbackController?.dispose?.();
    observer.disconnect();
    image.onload = null; image.onerror = null; image.src = '';
    canvas.removeEventListener('pointerdown', pointerDown);
    canvas.removeEventListener('pointermove', pointerMove);
    canvas.removeEventListener('pointerup', pointerUp);
    canvas.removeEventListener('pointercancel', pointerUp);
    canvas.removeEventListener('wheel', wheel);
    canvas.removeEventListener('keydown', keydown);
    document.removeEventListener('fullscreenchange', fullscreenChange);
    if (document.fullscreenElement === host) document.exitFullscreen?.()?.catch?.(() => {});
    gl.deleteTexture(texture); gl.deleteBuffer(buffer); gl.deleteProgram(program);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    host.replaceChildren();
  };
  return { reset, dispose };
}
