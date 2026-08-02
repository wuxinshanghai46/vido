'use strict';

const LABELS = {
  front: '正面', three_quarter: '四分之三侧面', side: '侧面', back: '背面', action: '动作姿态',
  face_front: '正面面部', face_three_quarter: '四分之三面部', face_profile: '侧面轮廓', hair_back: '背面发型',
  neutral: '自然平静', natural_smile: '自然微笑', focused: '专注', doubtful: '疑惑', surprised: '惊讶', relaxed_approved: '放松认可',
  neutral_stand: '自然站立', natural_walk: '自然行走', sit_and_rise: '坐下与起身', reach_and_hold: '伸手与持物', present_product: '展示主体', interact_with_prop: '道具互动',
  ear_neck_accessories: '耳饰、项链与领口穿戴', neckline_accessories: '项链、胸针与领口细节', wrist_wearables: '腕表、手链与手部穿戴', shoes: '鞋履细节',
  master: '主空间全景机位', reverse: '入口与反向机位', interaction: '人物互动机位', detail: '材质细节机位', layout: '空间俯视布局',
  overview: '空间总览', wide: '广角', medium: '中焦', 'mid-shot': '中景', 'close-up': '近景特写', macro: '微距', eye: '平视', low: '低机位', high: '高机位', landscape: '横向构图', portrait: '纵向构图',
};

const EVIDENCE = {
  'background wall geometry': '背景墙空间结构',
  'console table placement': '展台位置关系',
  'lighting design': '光线设计',
  'entry/exit zones': '人物出入口',
  'background wall texture': '背景墙纹理',
  'console table finish': '展台表面效果',
  'wall texture lighting variations': '墙面纹理的光影变化',
  'movement clearance': '人物行走空间',
  'surface topology variations': '表面肌理变化',
  'lighting gradients': '光线渐变',
};

const FRAMING = { overview: '空间总览', wide: '全景', medium: '中景', 'mid-shot': '中景', 'close-up': '近景特写' };
const LENS = { wide: '广角', medium: '中焦', macro: '微距', telephoto: '长焦', normal: '标准镜头' };
const HEIGHT = { low: '低机位', medium: '中等机位', eye: '平视机位', high: '高机位', overhead: '俯视机位' };

function clean(value = '', max = 260) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function canonical(value = '') {
  return clean(value, 120).toLowerCase().replace(/[\s/]+/g, '_');
}

function isGenericMachineLabel(label = '', key = '') {
  const value = clean(label, 160);
  if (!value) return true;
  if (canonical(value) === canonical(key)) return true;
  return /^[a-z0-9 _/.-]+$/i.test(value);
}

function labelFor(key = '', rawLabel = '', fallback = '素材') {
  const normalized = canonical(key);
  if (LABELS[normalized] && isGenericMachineLabel(rawLabel, key)) return LABELS[normalized];
  return clean(rawLabel, 160) || LABELS[normalized] || fallback;
}

function token(value = '') {
  const normalized = canonical(value);
  return LABELS[normalized] || clean(value, 160);
}

function evidence(value = '') {
  return clean(value, 500).split(/\s*,\s*/).filter(Boolean).map(item => EVIDENCE[item.toLowerCase()] || item).join('、');
}

function dossierItem(item = {}, fallback = '人物素材') {
  return { ...item, label: labelFor(item.key || item.kind, item.label, fallback) };
}

function sceneView(view = {}, index = 0) {
  return {
    ...view,
    label: labelFor(view.key, view.label, `场景视角 ${index + 1}`),
    framing: FRAMING[canonical(view.framing)] || token(view.framing),
    lens: LENS[canonical(view.lens)] || token(view.lens),
    orientation: token(view.orientation),
    intent: token(view.intent),
  };
}

function sceneCamera(camera = {}, index = 0) {
  const semanticKey = camera.view_id || camera.role || camera.id;
  return {
    ...camera,
    label: labelFor(semanticKey, camera.label, `机位 ${index + 1}`),
    role: token(camera.role),
    framing: FRAMING[canonical(camera.framing)] || token(camera.framing),
    lens: LENS[canonical(camera.lens)] || token(camera.lens),
    height: HEIGHT[canonical(camera.height)] || token(camera.height),
    orientation: token(camera.orientation),
    visible_evidence: evidence(camera.visible_evidence),
  };
}

module.exports = { LABELS, dossierItem, evidence, labelFor, sceneCamera, sceneView, token };
