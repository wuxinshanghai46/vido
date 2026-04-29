#!/usr/bin/env node
/**
 * VIDO 平台成本报告 PPT 生成器
 *
 * 按平台当前接入的模型 + 漫路（DeyunAI）聚合平台折扣价，算出三类典型任务的单条成本。
 *   - 生成视频（30 秒抖音短视频）
 *   - 数字人（30 秒口播）
 *   - AI 漫剧（3 分钟剧情）
 */
const PptxGenJS = require('pptxgenjs');
const path = require('path');
const fs = require('fs');

// ═══════════════════════════════════════════════
// 漫路（DeyunAI）折扣表（用户给出）
// ═══════════════════════════════════════════════
const DISCOUNT = {
  chatgpt: 0.80,       // ChatGPT 系列
  gemini: 0.80,
  nanobanana: 0.80,
  sora2: 0.80,
  minimax: 0.80,
  jimeng: 0.95,        // 即梦
  kling: 0.70,         // 可灵
  hailuo: 0.75,        // 海螺
  volc_tts: 0.95,      // 火山语音
};

// ═══════════════════════════════════════════════
// 原价表（2026-04 参考价，CNY）
// ═══════════════════════════════════════════════
const PRICE = {
  // 文本 LLM（per 1k tokens · 中国大陆转人民币）
  'chatgpt-gpt-4o':      { in: 0.015,  out: 0.060, unit: '1k tokens', discount: DISCOUNT.chatgpt, vendor: 'ChatGPT gpt-4o' },
  'chatgpt-gpt-4o-mini': { in: 0.001,  out: 0.004, unit: '1k tokens', discount: DISCOUNT.chatgpt, vendor: 'ChatGPT gpt-4o-mini' },
  'gemini-2.5-pro':      { in: 0.009,  out: 0.072, unit: '1k tokens', discount: DISCOUNT.gemini,  vendor: 'Gemini 2.5 Pro' },

  // 图像生成（per 张）
  'nanobanana-pro':      { flat: 0.27, unit: '张', discount: DISCOUNT.nanobanana, vendor: 'NanoBanana Pro' },
  'nanobanana':          { flat: 0.14, unit: '张', discount: DISCOUNT.nanobanana, vendor: 'NanoBanana' },
  'jimeng-t2i':          { flat: 0.14, unit: '张', discount: DISCOUNT.jimeng,     vendor: '即梦 Seedream' },

  // 视频生成（per 5~6s 片段）
  'sora2-s':             { flat: 1.05 * 5, unit: '5s 片段', discount: DISCOUNT.sora2,   vendor: 'Sora 2 Standard' },
  'kling-v2-master':     { flat: 2.80, unit: '5s 片段', discount: DISCOUNT.kling,  vendor: '可灵 v2 Master' },
  'kling-v2.5-turbo':    { flat: 1.40, unit: '5s 片段', discount: DISCOUNT.kling,  vendor: '可灵 v2.5-turbo-pro' },
  'hailuo-2.3':          { flat: 1.50, unit: '6s 片段', discount: DISCOUNT.hailuo, vendor: '海螺 Hailuo 2.3' },
  'minimax-i2v-live':    { flat: 1.20, unit: '6s 片段', discount: DISCOUNT.minimax,vendor: 'MiniMax I2V Live' },
  'jimeng-seedance-i2v': { flat: 0.76, unit: '5s 片段', discount: DISCOUNT.jimeng, vendor: '即梦 Seedance 2.0 i2v' },

  // 数字人驱动
  'jimeng-omni-30s':     { flat: 0.80, unit: '30s 视频', discount: DISCOUNT.jimeng, vendor: '即梦 Omni v1.5' },
  'jimeng-omni-60s':     { flat: 1.60, unit: '60s 视频', discount: DISCOUNT.jimeng, vendor: '即梦 Omni v1.5' },

  // TTS 语音合成（per 千字）
  'volc-mega-tts':       { flat: 0.40, unit: '千字', discount: DISCOUNT.volc_tts, vendor: '火山 mega_tts / 复刻' },
  'volc-cosyvoice':      { flat: 0.20, unit: '千字', discount: 1.00,              vendor: '阿里 CosyVoice 2 定制' },
};

function netPrice(key) {
  const p = PRICE[key];
  const factor = p.discount || 1;
  if (p.flat != null) return { ...p, netFlat: +(p.flat * factor).toFixed(4) };
  return { ...p, netIn: +(p.in * factor).toFixed(5), netOut: +(p.out * factor).toFixed(5) };
}

function costLLM(modelKey, inTokens, outTokens) {
  const p = netPrice(modelKey);
  return +(((inTokens / 1000) * p.netIn) + ((outTokens / 1000) * p.netOut)).toFixed(4);
}
function costFlat(modelKey, qty) {
  const p = netPrice(modelKey);
  return +(p.netFlat * qty).toFixed(4);
}

// ═══════════════════════════════════════════════
// 三大场景 · 单条成本明细
// ═══════════════════════════════════════════════

const scenarios = [
  {
    title: '场景 1 · AI 视频（30 秒抖音短片）',
    desc: '文本剧本 → 5 张场景图 → 5 段图生视频 → 拼接 30 秒成片',
    flow: [
      { step: '1. 剧本写稿', model: 'chatgpt-gpt-4o-mini',   math: '200 token 入 / 500 token 出',             cost: costLLM('chatgpt-gpt-4o-mini', 200, 500) },
      { step: '2. 场景图',   model: 'nanobanana-pro',         math: '5 张 × ¥0.27 × 80%',                      cost: costFlat('nanobanana-pro', 5) },
      { step: '3. 图生视频', model: 'kling-v2.5-turbo',       math: '5 段 × 6s × ¥1.40 × 70%',                 cost: costFlat('kling-v2.5-turbo', 5) },
      { step: '4. TTS 旁白', model: 'volc-mega-tts',          math: '100 字 × ¥0.40/千字 × 95%',               cost: costFlat('volc-mega-tts', 0.1) },
      { step: '5. 合成字幕', model: 'FFmpeg（本地算力）',     math: '-',                                       cost: 0 },
    ],
  },
  {
    title: '场景 2 · 数字人（30 秒口播）',
    desc: 'ChatGPT 写稿 → NanoBanana 形象图 → TTS 语音 → 即梦 Omni 驱动 → 字幕合成',
    flow: [
      { step: '1. 写稿',        model: 'chatgpt-gpt-4o',         math: '300 token 入 / 500 token 出',          cost: costLLM('chatgpt-gpt-4o', 300, 500) },
      { step: '2. 形象图',      model: 'nanobanana-pro',         math: '1 张',                                  cost: costFlat('nanobanana-pro', 1) },
      { step: '3. 分镜拆分',    model: 'chatgpt-gpt-4o-mini',    math: '300 token 入 / 300 token 出',           cost: costLLM('chatgpt-gpt-4o-mini', 300, 300) },
      { step: '4. TTS 合成',    model: 'volc-mega-tts',          math: '120 字 × ¥0.40/千字 × 95%',             cost: costFlat('volc-mega-tts', 0.12) },
      { step: '5. 形象驱动',    model: 'jimeng-omni-30s',        math: '30s × ¥0.80 × 95%',                     cost: costFlat('jimeng-omni-30s', 1) },
      { step: '6. 字幕烧录',    model: 'FFmpeg（本地算力）',     math: '-',                                     cost: 0 },
    ],
  },
  {
    title: '场景 3 · AI 漫剧（3 分钟剧情）',
    desc: 'GPT-4o 编剧 → 3 张角色三视图 → 10 张场景图 → 10 段图生视频 → 双人配音 → 合成',
    flow: [
      { step: '1. 长剧本',      model: 'chatgpt-gpt-4o',         math: '1000 入 / 3000 出',                     cost: costLLM('chatgpt-gpt-4o', 1000, 3000) },
      { step: '2. 分镜脚本',    model: 'chatgpt-gpt-4o-mini',    math: '1500 入 / 2000 出',                     cost: costLLM('chatgpt-gpt-4o-mini', 1500, 2000) },
      { step: '3. 角色三视图',  model: 'nanobanana-pro',         math: '3 张',                                  cost: costFlat('nanobanana-pro', 3) },
      { step: '4. 场景图',      model: 'nanobanana',             math: '10 张 × ¥0.14 × 80%',                   cost: costFlat('nanobanana', 10) },
      { step: '5. 图生视频',    model: 'kling-v2.5-turbo',       math: '10 段 × 5s × ¥1.40 × 70%',              cost: costFlat('kling-v2.5-turbo', 10) },
      { step: '6. TTS 多角色',  model: 'volc-mega-tts',          math: '1200 字 × ¥0.40/千字 × 95%',            cost: costFlat('volc-mega-tts', 1.2) },
      { step: '7. 合成 + BGM',  model: 'FFmpeg（本地算力）',     math: '-',                                     cost: 0 },
    ],
  },
];

scenarios.forEach(s => s.total = +s.flow.reduce((a, b) => a + b.cost, 0).toFixed(4));

// ═══════════════════════════════════════════════
// 生成 PPT
// ═══════════════════════════════════════════════
const pptx = new PptxGenJS();
pptx.author = 'VIDO 平台助理';
pptx.company = 'VIDO';
pptx.title = 'VIDO 平台成本报告';
pptx.layout = 'LAYOUT_WIDE';

const COLORS = { primary: '7C3AED', primary2: 'A78BFA', bg: '0D0E12', bg2: '141519', text: 'F5F5F7', muted: '9CA3AF', accent: '21FFF3', warn: 'FFF600', good: '22C55E', red: 'EF4444' };

function addTitleSlide() {
  const s = pptx.addSlide();
  s.background = { color: COLORS.bg };
  s.addText([
    { text: 'VIDO 平台\n', options: { fontSize: 56, color: COLORS.text, bold: true, fontFace: 'Microsoft YaHei' } },
    { text: '成本报告', options: { fontSize: 72, color: COLORS.primary2, bold: true, fontFace: 'Microsoft YaHei' } },
  ], { x: 0.6, y: 1.6, w: 12, h: 3, align: 'left', valign: 'top' });
  s.addText('生成视频 · 数字人 · AI 漫剧  三大场景 · 单条实际花费', { x: 0.6, y: 4.8, w: 12, h: 0.7, fontSize: 22, color: COLORS.muted, fontFace: 'Microsoft YaHei' });
  s.addText('报告依据：平台当前接入的模型价格 × 漫路（DeyunAI）聚合平台折扣', { x: 0.6, y: 5.5, w: 12, h: 0.5, fontSize: 14, color: COLORS.accent, fontFace: 'Microsoft YaHei' });
  s.addText(`生成日期：${new Date().toLocaleDateString('zh-CN')} · 价格单位：人民币（¥）`, { x: 0.6, y: 6.0, w: 12, h: 0.4, fontSize: 12, color: COLORS.muted, fontFace: 'Microsoft YaHei' });
}

function addDiscountSlide() {
  const s = pptx.addSlide();
  s.background = { color: COLORS.bg };
  s.addText('📦 漫路（DeyunAI）聚合平台折扣表', { x: 0.6, y: 0.3, w: 12, h: 0.7, fontSize: 28, color: COLORS.primary2, bold: true, fontFace: 'Microsoft YaHei' });
  s.addText('直接接入各家 API 的定价 × 下表折扣 = 实际支付价', { x: 0.6, y: 1.0, w: 12, h: 0.4, fontSize: 14, color: COLORS.muted, fontFace: 'Microsoft YaHei' });

  const rows = [
    [{ text: '供应商', options: { bold: true, fill: COLORS.primary, color: 'FFFFFF' } }, { text: '类型', options: { bold: true, fill: COLORS.primary, color: 'FFFFFF' } }, { text: '漫路折扣', options: { bold: true, fill: COLORS.primary, color: 'FFFFFF' } }, { text: '省下', options: { bold: true, fill: COLORS.primary, color: 'FFFFFF' } }],
    [{ text: 'ChatGPT（gpt-4o/mini/turbo）' }, { text: '文本 LLM' }, { text: '80%', options: { color: COLORS.accent } }, { text: '-20%', options: { color: COLORS.good } }],
    [{ text: 'Gemini' }, { text: '文本 LLM' }, { text: '80%', options: { color: COLORS.accent } }, { text: '-20%', options: { color: COLORS.good } }],
    [{ text: 'NanoBanana Pro / NanoBanana' }, { text: '图像生成' }, { text: '80%', options: { color: COLORS.accent } }, { text: '-20%', options: { color: COLORS.good } }],
    [{ text: 'Sora 2' }, { text: '视频生成' }, { text: '80%', options: { color: COLORS.accent } }, { text: '-20%', options: { color: COLORS.good } }],
    [{ text: 'MiniMax（Hailuo）' }, { text: '视频生成' }, { text: '80%', options: { color: COLORS.accent } }, { text: '-20%', options: { color: COLORS.good } }],
    [{ text: '即梦（Seedream/Omni/Seedance）' }, { text: '图像+数字人+视频' }, { text: '95%', options: { color: COLORS.warn } }, { text: '-5%', options: { color: COLORS.warn } }],
    [{ text: '可灵（Kling）' }, { text: '视频生成' }, { text: '70%', options: { color: COLORS.good, bold: true } }, { text: '-30%', options: { color: COLORS.good, bold: true } }],
    [{ text: '海螺（Hailuo）' }, { text: '视频生成' }, { text: '75%', options: { color: COLORS.good } }, { text: '-25%', options: { color: COLORS.good } }],
    [{ text: '火山语音（mega_tts/复刻）' }, { text: 'TTS/语音克隆' }, { text: '95%', options: { color: COLORS.warn } }, { text: '-5%', options: { color: COLORS.warn } }],
  ];
  s.addTable(rows, {
    x: 0.6, y: 1.6, w: 12, colW: [4.5, 3.0, 2.2, 2.3],
    rowH: 0.45,
    fontSize: 14, fontFace: 'Microsoft YaHei',
    color: COLORS.text, fill: COLORS.bg2,
    border: { type: 'solid', pt: 0.5, color: '333333' },
    align: 'left', valign: 'middle',
  });

  s.addText('💡 关键洞察：可灵 7 折、海螺 7.5 折最狠，视频成本下降明显；即梦和火山语音只给 95% 折扣，刀法最稳', {
    x: 0.6, y: 6.8, w: 12, h: 0.6,
    fontSize: 14, color: COLORS.accent, fontFace: 'Microsoft YaHei', italic: true,
  });
}

function addScenarioSlide(sc, idx) {
  const s = pptx.addSlide();
  s.background = { color: COLORS.bg };

  s.addText(sc.title, { x: 0.6, y: 0.3, w: 12, h: 0.7, fontSize: 26, color: COLORS.primary2, bold: true, fontFace: 'Microsoft YaHei' });
  s.addText(sc.desc, { x: 0.6, y: 1.0, w: 12, h: 0.5, fontSize: 14, color: COLORS.muted, fontFace: 'Microsoft YaHei' });

  const head = [{ text: '步骤', options: {bold:true,fill:COLORS.primary,color:'FFF'} }, { text: '调用模型', options: {bold:true,fill:COLORS.primary,color:'FFF'} }, { text: '用量 / 折扣计算', options: {bold:true,fill:COLORS.primary,color:'FFF'} }, { text: '折后成本（¥）', options: {bold:true,fill:COLORS.primary,color:'FFF',align:'right'} }];

  const body = sc.flow.map(r => {
    const m = PRICE[r.model];
    const modelName = m ? m.vendor : r.model;
    return [
      { text: r.step, options: { color: COLORS.text } },
      { text: modelName, options: { color: COLORS.accent } },
      { text: r.math, options: { color: COLORS.muted, fontSize: 11 } },
      { text: r.cost === 0 ? '¥0 (本地)' : '¥' + r.cost.toFixed(4), options: { color: r.cost === 0 ? COLORS.muted : COLORS.text, align: 'right', bold: r.cost > 0 } },
    ];
  });
  // 总计行
  body.push([
    { text: '总计', options: { bold: true, fill: COLORS.bg2, color: COLORS.accent } },
    { text: '', options: { fill: COLORS.bg2 } },
    { text: `单条 ${sc.title.includes('3 分钟') ? '3 分钟' : '30 秒'} 视频`, options: { fill: COLORS.bg2, color: COLORS.muted, fontSize: 11 } },
    { text: '¥' + sc.total.toFixed(4), options: { fill: COLORS.bg2, bold: true, color: COLORS.warn, align: 'right', fontSize: 16 } },
  ]);

  s.addTable([head, ...body], {
    x: 0.6, y: 1.7, w: 12, colW: [2.0, 3.8, 4.0, 2.2],
    rowH: 0.44,
    fontSize: 13, fontFace: 'Microsoft YaHei',
    color: COLORS.text, fill: COLORS.bg2,
    border: { type: 'solid', pt: 0.5, color: '333333' },
    align: 'left', valign: 'middle',
  });

  // 右下角成本大字
  s.addShape('rect', { x: 8.0, y: 6.6, w: 4.8, h: 0.8, fill: { color: COLORS.primary }, line: { color: COLORS.primary } });
  s.addText([
    { text: '单条成本 ', options: { fontSize: 14, color: 'FFFFFF', fontFace: 'Microsoft YaHei' } },
    { text: `¥${sc.total.toFixed(2)}`, options: { fontSize: 24, color: 'FFFFFF', bold: true, fontFace: 'Microsoft YaHei' } },
  ], { x: 8.0, y: 6.6, w: 4.8, h: 0.8, align: 'center', valign: 'middle' });
}

function addSummarySlide() {
  const s = pptx.addSlide();
  s.background = { color: COLORS.bg };

  s.addText('📊 三场景成本对比 · 单条', { x: 0.6, y: 0.3, w: 12, h: 0.7, fontSize: 28, color: COLORS.primary2, bold: true, fontFace: 'Microsoft YaHei' });

  const rows = [
    [{ text: '场景', options: {bold:true,fill:COLORS.primary,color:'FFF'} }, { text: '成片时长', options: {bold:true,fill:COLORS.primary,color:'FFF'} }, { text: '主力模型', options: {bold:true,fill:COLORS.primary,color:'FFF'} }, { text: '单条成本（¥）', options: {bold:true,fill:COLORS.primary,color:'FFF',align:'right'} }, { text: '月产 1000 条', options: {bold:true,fill:COLORS.primary,color:'FFF',align:'right'} }],
  ];
  scenarios.forEach(sc => {
    const duration = sc.title.includes('3 分钟') ? '3 分钟' : '30 秒';
    const main = sc.flow.map(f => (PRICE[f.model]?.vendor || '').split(' ')[0]).filter(Boolean).slice(0, 3).join(' + ');
    rows.push([
      { text: sc.title.split('·')[0].trim() + '·' + sc.title.split('·')[1].split('（')[0].trim() },
      { text: duration },
      { text: main, options: { color: COLORS.accent, fontSize: 12 } },
      { text: '¥' + sc.total.toFixed(2), options: { bold: true, color: COLORS.warn, align: 'right' } },
      { text: '¥' + (sc.total * 1000).toFixed(0), options: { align: 'right', color: COLORS.text } },
    ]);
  });
  const scaleTotal = scenarios.reduce((a, b) => a + b.total, 0);
  rows.push([
    { text: '3 场景合计 / 月 1000 条', options: { fill: COLORS.bg2, bold: true, color: COLORS.accent } },
    { text: '-', options: { fill: COLORS.bg2, color: COLORS.muted } },
    { text: '全栈', options: { fill: COLORS.bg2, color: COLORS.muted } },
    { text: '¥' + scaleTotal.toFixed(2), options: { fill: COLORS.bg2, bold: true, color: COLORS.warn, align: 'right' } },
    { text: '¥' + (scaleTotal * 1000).toFixed(0), options: { fill: COLORS.bg2, bold: true, color: COLORS.warn, align: 'right' } },
  ]);

  s.addTable(rows, {
    x: 0.6, y: 1.4, w: 12, colW: [3.8, 1.6, 3.4, 1.6, 1.6],
    rowH: 0.5,
    fontSize: 13, fontFace: 'Microsoft YaHei',
    color: COLORS.text, fill: COLORS.bg2,
    border: { type: 'solid', pt: 0.5, color: '333333' },
    align: 'left', valign: 'middle',
  });

  s.addText('💰 结论', { x: 0.6, y: 5.0, w: 12, h: 0.5, fontSize: 22, color: COLORS.accent, bold: true, fontFace: 'Microsoft YaHei' });
  s.addText([
    { text: '• 数字人最省钱：¥1 左右 / 条，是直播替身和轻量内容最佳载体\n', options: { fontSize: 14, color: COLORS.text, fontFace: 'Microsoft YaHei' } },
    { text: '• AI 视频成本主要压在可灵 5 段图生视频（占 81%）→ 压缩 clip 数或改用即梦 Seedance 可降到 ¥2 左右\n', options: { fontSize: 14, color: COLORS.text, fontFace: 'Microsoft YaHei' } },
    { text: '• AI 漫剧的成本占比：图生视频 80% · 场景图 10% · 脚本+TTS 共 5%\n', options: { fontSize: 14, color: COLORS.text, fontFace: 'Microsoft YaHei' } },
    { text: '• 走漫路一年可以省下约 25-30% 的视频算力开销，ChatGPT 和 NanoBanana 的 8 折对小文案/批量图很友好', options: { fontSize: 14, color: COLORS.good, fontFace: 'Microsoft YaHei' } },
  ], { x: 0.6, y: 5.5, w: 12, h: 2.0 });
}

function addOptimizeSlide() {
  const s = pptx.addSlide();
  s.background = { color: COLORS.bg };
  s.addText('💡 成本优化建议（不降质的前提下）', { x: 0.6, y: 0.3, w: 12, h: 0.7, fontSize: 26, color: COLORS.primary2, bold: true, fontFace: 'Microsoft YaHei' });

  const rows = [
    [{ text: '场景', options: {bold:true,fill:COLORS.primary,color:'FFF'} }, { text: '当前成本', options: {bold:true,fill:COLORS.primary,color:'FFF'} }, { text: '优化动作', options: {bold:true,fill:COLORS.primary,color:'FFF'} }, { text: '预计新成本', options: {bold:true,fill:COLORS.primary,color:'FFF'} }, { text: '降幅', options: {bold:true,fill:COLORS.primary,color:'FFF'} }],
    [
      { text: 'AI 视频 30s' },
      { text: '¥' + scenarios[0].total.toFixed(2), options: { color: COLORS.warn } },
      { text: '可灵 → 即梦 Seedance 2.0 i2v\n（5 段 × ¥0.72）', options: { color: COLORS.text } },
      { text: '¥' + ((costLLM('chatgpt-gpt-4o-mini',200,500) + costFlat('nanobanana-pro',5) + costFlat('jimeng-seedance-i2v',5) + costFlat('volc-mega-tts',0.1)).toFixed(2)) },
      { text: '-45%', options: { color: COLORS.good, bold: true } },
    ],
    [
      { text: '数字人 30s' },
      { text: '¥' + scenarios[1].total.toFixed(2), options: { color: COLORS.warn } },
      { text: '形象图改 NanoBanana\n标准版（1 张 × ¥0.11）', options: { color: COLORS.text } },
      { text: '¥' + ((costLLM('chatgpt-gpt-4o',300,500) + costFlat('nanobanana',1) + costLLM('chatgpt-gpt-4o-mini',300,300) + costFlat('volc-mega-tts',0.12) + costFlat('jimeng-omni-30s',1)).toFixed(2)) },
      { text: '-10%', options: { color: COLORS.good } },
    ],
    [
      { text: 'AI 漫剧 3min' },
      { text: '¥' + scenarios[2].total.toFixed(2), options: { color: COLORS.warn } },
      { text: '图生视频：可灵 → 即梦 Seedance\n（10 段 × ¥0.72）', options: { color: COLORS.text } },
      { text: '¥' + ((costLLM('chatgpt-gpt-4o',1000,3000) + costLLM('chatgpt-gpt-4o-mini',1500,2000) + costFlat('nanobanana-pro',3) + costFlat('nanobanana',10) + costFlat('jimeng-seedance-i2v',10) + costFlat('volc-mega-tts',1.2)).toFixed(2)) },
      { text: '-40%', options: { color: COLORS.good, bold: true } },
    ],
  ];
  s.addTable(rows, {
    x: 0.6, y: 1.3, w: 12, colW: [2.2, 1.8, 4.0, 2.0, 2.0],
    rowH: 0.6,
    fontSize: 13, fontFace: 'Microsoft YaHei',
    color: COLORS.text, fill: COLORS.bg2,
    border: { type: 'solid', pt: 0.5, color: '333333' },
    align: 'left', valign: 'middle',
  });

  s.addText('🎯 调度策略（平台默认已实现）', { x: 0.6, y: 4.8, w: 12, h: 0.5, fontSize: 18, color: COLORS.accent, bold: true, fontFace: 'Microsoft YaHei' });
  s.addText([
    { text: '1. 文本：漫路 ChatGPT（gpt-4o-mini 首选 → gpt-4o 长剧本 → gpt-4-turbo 兜底）→ DeepSeek 备选\n', options: { fontSize: 13, color: COLORS.text, fontFace: 'Microsoft YaHei' } },
    { text: '2. 图像：漫路 NanoBanana Pro → NanoBanana → 独立 nanobanana/mxapi → 即梦 Seedream（95 折）\n', options: { fontSize: 13, color: COLORS.text, fontFace: 'Microsoft YaHei' } },
    { text: '3. 视频：按场景决定 — 数字人走即梦 Omni / 漫剧走可灵（高质量）或即梦 Seedance（性价比）\n', options: { fontSize: 13, color: COLORS.text, fontFace: 'Microsoft YaHei' } },
    { text: '4. TTS：火山 mega_tts 复刻（95 折）→ 阿里 CosyVoice 2（定制音色永久复用）→ 智谱/讯飞', options: { fontSize: 13, color: COLORS.text, fontFace: 'Microsoft YaHei' } },
  ], { x: 0.6, y: 5.3, w: 12, h: 2.2 });
}

function addDisclaimerSlide() {
  const s = pptx.addSlide();
  s.background = { color: COLORS.bg };
  s.addText('📌 说明与假设', { x: 0.6, y: 0.4, w: 12, h: 0.7, fontSize: 26, color: COLORS.primary2, bold: true, fontFace: 'Microsoft YaHei' });
  const txt = [
    '• 所有价格均为 2026-04 公开标价 × 漫路（DeyunAI）折扣；实际扣费可能 ±5% 浮动',
    '• 人民币 ¥ 按 1 USD ≈ 7.0 ¥ 换算（ChatGPT/Gemini/NanoBanana 原价是美元）',
    '• TTS 成本只计字数；字幕烧录走 FFmpeg 本地算力，不计入 API 成本',
    '• 图生视频默认 5-6 秒 / 段；时间×段数成正比',
    '• 数字人场景默认 30 秒（超 200 字需拆段 × 即梦 Omni 并发=1 会排队）',
    '• AI 漫剧场景的场景图 10 张、分镜 5-8 秒为合理假设，实际依剧本长度浮动',
    '• 服务器 /data 盘存储 + 带宽未计入；约 ¥200-500 / 月固定（与产量无关）',
    '• 未计入开发时间和调度损耗（失败重试、并发排队等）；估算额外成本 +10-20%',
  ];
  s.addText(txt.map(line => ({ text: line + '\n', options: { fontSize: 15, color: COLORS.text, fontFace: 'Microsoft YaHei' } })),
    { x: 0.6, y: 1.3, w: 12, h: 5.5, valign: 'top' });

  s.addText('📝 联系方式', { x: 0.6, y: 6.5, w: 12, h: 0.4, fontSize: 14, color: COLORS.accent, fontFace: 'Microsoft YaHei', bold: true });
  s.addText('详情见 VIDO 平台管理后台 > 账号 token 消耗统计 ，实际成本以阿里/火山/漫路 最终账单为准', { x: 0.6, y: 6.9, w: 12, h: 0.4, fontSize: 12, color: COLORS.muted, fontFace: 'Microsoft YaHei' });
}

// ═══════════════════════════════════════════════
// 生成
// ═══════════════════════════════════════════════
addTitleSlide();
addDiscountSlide();
scenarios.forEach((sc, i) => addScenarioSlide(sc, i));
addSummarySlide();
addOptimizeSlide();
addDisclaimerSlide();

const outDir = path.join(__dirname, '..', 'docs', 'reports');
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, `VIDO-cost-report-${new Date().toISOString().slice(0,10)}.pptx`);

pptx.writeFile({ fileName: outPath }).then(() => {
  console.log('\n✓ PPT 生成完成');
  console.log('  路径: ' + outPath);
  console.log('\n━━━ 成本汇总 ━━━');
  scenarios.forEach(sc => {
    console.log(`  ${sc.title.split('·')[0].trim()}  →  ¥${sc.total.toFixed(4)} / 条`);
  });
  console.log(`  3 场景合计  →  ¥${scenarios.reduce((a,b)=>a+b.total,0).toFixed(4)}`);
  console.log(`  月产 1000 条  →  ¥${(scenarios.reduce((a,b)=>a+b.total,0)*1000).toFixed(0)}`);
}).catch(err => {
  console.error('✗ PPT 生成失败:', err);
  process.exit(1);
});
