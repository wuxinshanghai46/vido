import { request } from '../api.js?v=20260813-ui-v248';
import { normalizeSceneDossier, SCENE_VIEW_LABELS, SCENE_VIEW_ORDER } from './sceneDossierCard.js?v=20260813-ui-v248';

const WIDTH = 1800;
const HEIGHT = 2400;

function safeFilename(value = '') { return String(value || 'scene').replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'scene'; }
function originalUrl(asset = {}) { return String(asset.image_url || asset.imageUrl || asset.url || '').replace(/([?&])thumb=\d+(&|$)/, '$1').replace(/[?&]$/, ''); }

async function loadImage(asset, label) {
  const url = originalUrl(asset);
  if (!url) return null;
  let blob;
  try { blob = await request(url, { responseType: 'blob', timeoutMs: 120000 }); } catch (error) { throw new Error(`${label}原图读取失败：${error.message}`); }
  if (globalThis.createImageBitmap) return createImageBitmap(blob);
  const objectUrl = URL.createObjectURL(blob);
  const image = new Image();
  image.decoding = 'async';
  await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(new Error(`${label}原图解码失败`)); image.src = objectUrl; });
  setTimeout(() => URL.revokeObjectURL(objectUrl), 5000);
  return image;
}

function roundRect(ctx, x, y, width, height, radius = 18) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + width, y, x + width, y + height, r); ctx.arcTo(x + width, y + height, x, y + height, r); ctx.arcTo(x, y + height, x, y, r); ctx.arcTo(x, y, x + width, y, r); ctx.closePath();
}

function drawImageFit(ctx, image, x, y, width, height, fit = 'cover') {
  ctx.save(); roundRect(ctx, x, y, width, height, 18); ctx.clip(); ctx.fillStyle = '#102229'; ctx.fillRect(x, y, width, height);
  if (image) {
    const ratio = fit === 'contain' ? Math.min(width / image.width, height / image.height) : Math.max(width / image.width, height / image.height);
    const w = image.width * ratio; const h = image.height * ratio;
    ctx.drawImage(image, x + (width - w) / 2, y + (height - h) / 2, w, h);
  }
  ctx.restore(); ctx.strokeStyle = '#36545b'; ctx.lineWidth = 3; roundRect(ctx, x, y, width, height, 18); ctx.stroke();
}

function writeLines(ctx, value, x, y, maxWidth, maxLines = 4, lineHeight = 34) {
  const chars = [...String(value || '')]; const lines = []; let line = '';
  for (const char of chars) {
    const next = line + char;
    if (ctx.measureText(next).width > maxWidth && line) { lines.push(line); line = char; if (lines.length >= maxLines) break; } else line = next;
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (lines.join('').length < chars.length && lines.length) lines[lines.length - 1] = `${lines[lines.length - 1].slice(0, -1)}…`;
  lines.forEach((row, index) => ctx.fillText(row, x, y + index * lineHeight));
}

function placeholder(ctx, label, x, y, width, height) {
  drawImageFit(ctx, null, x, y, width, height); ctx.fillStyle = '#789196'; ctx.font = '700 28px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(`${label} · 待补齐`, x + width / 2, y + height / 2); ctx.textAlign = 'left';
}

function paletteFromImage(image) {
  if (!image) return ['#183238', '#29494d', '#6a817f', '#a5b7ae', '#d9dfd5'];
  const sample = document.createElement('canvas'); sample.width = 5; sample.height = 1;
  const ctx = sample.getContext('2d', { willReadFrequently: true }); ctx.drawImage(image, 0, 0, 5, 1);
  const data = ctx.getImageData(0, 0, 5, 1).data; const colors = [];
  for (let index = 0; index < 5; index += 1) colors.push(`#${[data[index * 4], data[index * 4 + 1], data[index * 4 + 2]].map(value => value.toString(16).padStart(2, '0')).join('')}`);
  return colors;
}

export async function exportSceneDossierPng(item = {}, options = {}) {
  const dossier = normalizeSceneDossier(item); const images = {};
  for (const key of SCENE_VIEW_ORDER) images[key] = await loadImage(dossier.views[key], SCENE_VIEW_LABELS[key]);
  const canvas = document.createElement('canvas'); canvas.width = WIDTH; canvas.height = HEIGHT;
  const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('当前浏览器无法创建高清场景档案画布。');
  ctx.fillStyle = '#071418'; ctx.fillRect(0, 0, WIDTH, HEIGHT); ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#6ce5bd'; ctx.font = '700 28px sans-serif'; ctx.fillText('VIDO SCENE DOSSIER', 120, 110);
  ctx.fillStyle = '#f1f7f5'; ctx.font = '900 54px sans-serif'; ctx.fillText(String(item.name || '未命名场景').slice(0, 28), 120, 180);
  ctx.fillStyle = '#9ab0af'; ctx.font = '24px sans-serif'; writeLines(ctx, item.story_purpose || item.description || '当前场景未填写剧情用途', 120, 225, 1300, 2, 32);
  const panels = { master: [120, 270, 1560, 600, 'cover'], reverse: [120, 910, 500, 340, 'cover'], interaction: [650, 910, 500, 340, 'cover'], detail: [1180, 910, 500, 340, 'cover'], layout: [120, 1290, 990, 560, 'contain'] };
  for (const key of SCENE_VIEW_ORDER) { const [x, y, w, h, fit] = panels[key]; images[key] ? drawImageFit(ctx, images[key], x, y, w, h, fit) : placeholder(ctx, SCENE_VIEW_LABELS[key], x, y, w, h); ctx.fillStyle = '#071418dd'; ctx.fillRect(x + 18, y + 18, 190, 44); ctx.fillStyle = '#e5efed'; ctx.font = '700 22px sans-serif'; ctx.fillText(SCENE_VIEW_LABELS[key], x + 34, y + 49); }
  ctx.fillStyle = '#0d2025'; roundRect(ctx, 1150, 1290, 530, 560, 18); ctx.fill(); ctx.strokeStyle = '#28464d'; ctx.stroke();
  const spec = item.scene_spec || {}; ctx.fillStyle = '#f0f6f4'; ctx.font = '800 30px sans-serif'; ctx.fillText('场景视觉合同', 1190, 1350);
  const contracts = [['空间布局', spec.layout || spec.layoutText], ['材质与表面', spec.materials || spec.materialLightText], ['天气 / 时间 / 灯光', [spec.weather, spec.time, spec.light].filter(Boolean).join(' · ')], ['互动与路线', spec.interaction || spec.interactionText], ['禁止出现', spec.negative || spec.negativeText]];
  let cy = 1410; for (const [label, value] of contracts) { ctx.fillStyle = label === '禁止出现' ? '#ffb09f' : '#6ce5bd'; ctx.font = '700 19px sans-serif'; ctx.fillText(label, 1190, cy); ctx.fillStyle = '#d8e4e2'; ctx.font = '21px sans-serif'; writeLines(ctx, value || '待补齐', 1190, cy + 34, 450, 3, 29); cy += 98; }
  ctx.fillStyle = '#0d2025'; roundRect(ctx, 120, 1900, 1560, 350, 18); ctx.fill(); ctx.strokeStyle = '#28464d'; ctx.stroke();
  ctx.fillStyle = '#f0f6f4'; ctx.font = '800 27px sans-serif'; ctx.fillText('资产拆分与一致性证据', 165, 1960);
  const groups = (item.scene_card?.asset_groups || []).slice(0, 12).map(row => `${row.label}${row.detail ? `：${row.detail}` : ''}`).join(' · ') || '当前任务没有更多结构化资产拆分';
  ctx.fillStyle = '#d8e4e2'; ctx.font = '21px sans-serif'; writeLines(ctx, groups, 165, 2010, 690, 5, 31);
  const palette = paletteFromImage(images.master); ctx.fillStyle = '#6ce5bd'; ctx.font = '700 19px sans-serif'; ctx.fillText('主视原图确定性取样', 930, 2010);
  palette.forEach((color, index) => { ctx.fillStyle = color; roundRect(ctx, 930 + index * 130, 2040, 112, 48, 8); ctx.fill(); ctx.fillStyle = '#91a8a7'; ctx.font = '15px monospace'; ctx.fillText(color.toUpperCase(), 943 + index * 130, 2118); });
  ctx.fillStyle = '#d8e4e2'; ctx.font = '21px sans-serif'; writeLines(ctx, `一致性状态：${dossier.state} · ${dossier.completed}/${dossier.total} 个视图；用于 ${item.shot_refs?.length || 0} 个镜头；知识规则 ${item.knowledge_policy?.rule_ids?.join('、') || '沿用任务快照'}`, 930, 2170, 690, 3, 31);
  ctx.fillStyle = '#6d8588'; ctx.font = '18px sans-serif'; ctx.fillText(`只使用当前任务已有资产本地合成 · 模型调用 0 · revision ${item.revision || 1}`, 120, 2345);
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png')); if (!blob) throw new Error('浏览器没有生成有效的 PNG 文件。');
  if (options.download !== false) { const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `${safeFilename(item.name)}-scene-card-r${Number(item.revision || 1) || 1}.png`; document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
  Object.values(images).forEach(image => image?.close?.());
  return { blob, width: WIDTH, height: HEIGHT, palette, model_call_count: 0 };
}

export const SCENE_DOSSIER_EXPORT_SIZE = Object.freeze({ width: WIDTH, height: HEIGHT });
