import { request } from '../api.js?v=20260814-reference-recovery-v36';
import { escapeHtml, setButtonBusy, toast } from '../components/ui.js?v=20260814-reference-recovery-v36';
import { confirmDialog } from '../components/dialog.js?v=20260814-reference-recovery-v36';

const STYLE_ID = 'story-ad-reference-understanding-style';
const MAX_ITEMS = 120;
const MAX_EVIDENCE_BADGES = 8;

const TAB_DEFINITIONS = [
  ['overview', '故事全貌'],
  ['timeline', '时间线'],
  ['characters', '人物与关系'],
  ['scenes', '场景'],
  ['brand', '商品与品牌'],
  ['camera', '镜头与运镜'],
  ['audio', '旁白、字幕与声音'],
];

const STORY_FIELDS = [
  ['narrative_mode', '叙事类型'],
  ['narrative_mode_reason', '类型判断依据'],
  ['logline', '一句话故事'],
  ['short_synopsis', '故事简介'],
  ['full_synopsis', '完整故事介绍'],
  ['theme', '主题'],
  ['central_conflict', '核心冲突'],
  ['trigger', '触发事件'],
  ['turning_point', '关键转折'],
  ['climax', '高潮'],
  ['resolution', '结果'],
  ['brand_function', '品牌 / 产品职责'],
  ['cta', '行动号召'],
];

function list(value) {
  return Array.isArray(value) ? value.slice(0, MAX_ITEMS) : [];
}

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function firstText(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return '';
}

function claimText(value) {
  if (Array.isArray(value)) return value.map(claimText).filter(Boolean).join('；');
  if (typeof value === 'string' || typeof value === 'number') return String(value).trim();
  const item = object(value);
  return firstText(item.value, item.text, item.description, item.summary, item.content, item.claim, item.question, item.name, item.title);
}

function understanding(reference = {}) {
  const nested = object(reference.reference_understanding || reference.understanding);
  if (!Object.keys(nested).length) return reference;
  return {
    ...reference,
    ...nested,
    story_bible: nested.story_bible || nested.story_summary,
    story_events: nested.story_events || nested.causal_chain,
    character_arcs: nested.character_arcs || nested.characters,
    scene_narratives: nested.scene_narratives || nested.scenes,
    audio_visual_alignment: nested.audio_visual_alignment || nested.audio_visual?.alignments,
  };
}

export function hasReferenceUnderstanding(reference = {}) {
  const data = understanding(reference);
  return Object.keys(object(data.story_bible)).length > 0
    || list(data.story_events).length > 0
    || list(data.character_arcs).length > 0
    || list(data.scene_narratives).length > 0
    || Object.keys(object(data.brand_role)).length > 0
    || list(data.audio_visual_alignment).length > 0
    || list(data.inferences).length > 0
    || list(data.unknowns).length > 0;
}

export function isReferenceUnderstandingConfirmed(reference = {}) {
  const data = understanding(reference);
  const confirmation = object(data.reference_understanding_confirmation || data.understanding_confirmation || data.confirmation);
  return data.understanding_confirmed === true
    || data.authoritative_input_confirmed === true
    || confirmation.confirmed === true
    || ['confirmed', 'authoritative_input'].includes(String(confirmation.status || confirmation.confirmation || '').toLowerCase());
}

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const link = document.createElement('link');
  link.id = STYLE_ID;
  link.rel = 'stylesheet';
  link.href = '/story-ad/reference-understanding.css?v=20260814-reference-recovery-v36';
  document.head.appendChild(link);
}

function timeValue(value) {
  if (Array.isArray(value)) return timeValue(value[0]);
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, value);
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (/^\d+(?:\.\d+)?$/.test(raw)) return Number(raw);
  const parts = raw.split(':').map(Number);
  if (parts.some(part => !Number.isFinite(part))) return null;
  if (parts.length === 2) return Math.max(0, parts[0] * 60 + parts[1]);
  if (parts.length === 3) return Math.max(0, parts[0] * 3600 + parts[1] * 60 + parts[2]);
  return null;
}

function formatTime(value) {
  const seconds = timeValue(value);
  if (seconds === null) return '';
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds - minutes * 60;
  return `${String(minutes).padStart(2, '0')}:${remainder.toFixed(remainder % 1 ? 1 : 0).padStart(2, '0')}`;
}

function claimKind(value, fallback = 'fact') {
  const item = object(value);
  const raw = String(item.epistemic_status || item.claim_type || item.fact_status || item.certainty || item.status || fallback).toLowerCase();
  if (/infer|推断|assum/.test(raw)) return 'inference';
  if (/unknown|unconfirm|待确认|未知/.test(raw)) return 'unknown';
  if (/correct|user|用户修正/.test(raw)) return 'corrected';
  return fallback;
}

function kindLabel(kind) {
  return { fact: '可见事实', inference: '合理推断', unknown: '尚未确认', corrected: '用户已修正' }[kind] || '可见事实';
}

function statusBadge(value, fallback = 'fact') {
  const kind = claimKind(value, fallback);
  return `<span class="reference-claim-status is-${kind}">${kindLabel(kind)}</span>`;
}

function evidenceRefs(value) {
  const item = object(value);
  return list(item.evidence_refs || item.evidence || item.references);
}

function evidenceButtons(refs, fallbackTime = null) {
  return list(refs).slice(0, MAX_EVIDENCE_BADGES).map((entry, index) => {
    const item = object(entry);
    const label = firstText(item.label, item.id, item.ref, typeof entry === 'string' ? entry : '', `证据 ${index + 1}`);
    const seconds = timeValue(item.time ?? item.timestamp ?? item.start ?? item.range ?? fallbackTime);
    if (seconds === null) return `<span class="reference-evidence-tag">${escapeHtml(label)}</span>`;
    return `<button class="reference-evidence-tag is-seekable" type="button" data-reference-seek="${seconds}" title="跳转到 ${escapeHtml(formatTime(seconds))}">${escapeHtml(label)} · ${escapeHtml(formatTime(seconds))}</button>`;
  }).join('');
}

function emptyState(message) {
  return `<div class="reference-understanding-empty">${escapeHtml(message)}</div>`;
}

function claimCard(label, value, fallbackKind = 'fact') {
  const text = claimText(value);
  if (!text) return '';
  const refs = evidenceRefs(value);
  return `<article class="reference-claim-card">
    <header><b>${escapeHtml(label)}</b>${statusBadge(value, fallbackKind)}</header>
    <p>${escapeHtml(text)}</p>
    ${refs.length ? `<div class="reference-evidence-list">${evidenceButtons(refs)}</div>` : ''}
  </article>`;
}

function renderOverview(data) {
  const bible = object(data.story_bible);
  const narrativeMode = {
    narrative_story: '剧情叙事',
    showcase_montage: '展示型蒙太奇（没有传统冲突剧情）',
    unclassified: '尚未完成类型判断',
  }[String(bible.narrative_mode || '')] || bible.narrative_mode;
  const primary = STORY_FIELDS.map(([key, label]) => claimCard(label, key === 'narrative_mode' ? narrativeMode : bible[key])).filter(Boolean).join('');
  const inferences = list(data.inferences).map((item, index) => claimCard(`推断 ${index + 1}`, item, 'inference')).join('');
  const unknowns = list(data.unknowns).map((item, index) => claimCard(`待确认 ${index + 1}`, item, 'unknown')).join('');
  return `${primary || emptyState('尚未形成完整故事说明。')}
    ${inferences ? `<section class="reference-understanding-section"><h4>系统推断</h4><div class="reference-claim-grid">${inferences}</div></section>` : ''}
    ${unknowns ? `<section class="reference-understanding-section"><h4>需要确认</h4><div class="reference-claim-grid">${unknowns}</div></section>` : ''}`;
}

function eventRange(event) {
  const item = object(event);
  const range = item.range || item.time_range || [item.start, item.end];
  return Array.isArray(range) ? range : [item.start ?? item.timestamp, item.end];
}

function renderTimeline(data) {
  const events = list(data.story_events);
  if (!events.length) return emptyState('尚未形成可核对的故事时间线。');
  return `<ol class="reference-timeline">${events.map((event, index) => {
    const item = object(event);
    const range = eventRange(item);
    const start = timeValue(range[0]);
    const end = timeValue(range[1]);
    const timeLabel = start === null ? `事件 ${index + 1}` : `${formatTime(start)}${end !== null ? `–${formatTime(end)}` : ''}`;
    const title = firstText(item.title, item.subject, `事件 ${index + 1}`);
    const parts = [
      ['动作', item.action],
      ['动机', item.motivation],
      ['结果', item.result],
      ['前因', item.caused_by],
      ['后续', item.leads_to],
    ].filter(([, value]) => claimText(value));
    return `<li>
      <button type="button" class="reference-timeline-time ${start !== null ? 'is-seekable' : ''}" ${start !== null ? `data-reference-seek="${start}"` : 'disabled'}>${escapeHtml(timeLabel)}</button>
      <article><header><b>${escapeHtml(title)}</b>${statusBadge(item)}</header>
        ${parts.map(([label, value]) => `<p><strong>${escapeHtml(label)}</strong>${escapeHtml(claimText(value))}</p>`).join('')}
        ${evidenceRefs(item).length ? `<div class="reference-evidence-list">${evidenceButtons(evidenceRefs(item), start)}</div>` : ''}
      </article>
    </li>`;
  }).join('')}</ol>`;
}

function renderCharacters(data) {
  const arcs = list(data.character_arcs);
  if (!arcs.length) return emptyState('没有识别到需要进入故事的人物关系或人物弧光。');
  return `<div class="reference-entity-grid">${arcs.map((arc, index) => {
    const item = object(arc);
    const title = firstText(item.name, item.character_name, item.character_id, `人物 ${index + 1}`);
    const fields = [
      ['角色', item.role], ['叙事职责', item.narrative_function], ['与其他人物的关系', item.relationship_to_others || item.relationships],
      ['初始状态', item.initial_state], ['目标', item.goal], ['阻碍', item.obstacle],
      ['关键决定', item.key_decision], ['最终状态', item.final_state], ['情绪变化', item.emotional_arc],
    ];
    return `<article class="reference-entity-card"><header><h4>${escapeHtml(title)}</h4>${statusBadge(item)}</header>${fields.map(([label, value]) => {
      const text = Array.isArray(value) ? value.map(claimText).filter(Boolean).join('；') : claimText(value);
      return text ? `<p><b>${escapeHtml(label)}</b><span>${escapeHtml(text)}</span></p>` : '';
    }).join('')}</article>`;
  }).join('')}</div>`;
}

function renderScenes(data) {
  const scenes = list(data.scene_narratives);
  if (!scenes.length) return emptyState('尚未形成带叙事作用的场景说明。');
  return `<div class="reference-entity-grid">${scenes.map((scene, index) => {
    const item = object(scene);
    const title = firstText(item.name, item.scene_name, item.scene_id, `场景 ${index + 1}`);
    const fields = [
      ['环境', item.environment || item.description], ['场景事件', item.events || item.event || item.action],
      ['叙事作用', item.narrative_function || item.story_function], ['进入方式', item.entry || item.transition_in || item.entry_transition],
      ['离开方式', item.exit || item.transition_out || item.exit_transition], ['状态变化', item.state_change],
    ];
    return `<article class="reference-entity-card"><header><h4>${escapeHtml(title)}</h4>${statusBadge(item)}</header>${fields.map(([label, value]) => claimText(value) ? `<p><b>${escapeHtml(label)}</b><span>${escapeHtml(claimText(value))}</span></p>` : '').join('')}${evidenceRefs(item).length ? `<div class="reference-evidence-list">${evidenceButtons(evidenceRefs(item), eventRange(item)[0])}</div>` : ''}</article>`;
  }).join('')}</div>`;
}

function renderBrand(data) {
  const role = object(data.brand_role);
  const fields = [
    ['商品 / 品牌', role.name || role.subject], ['故事职责', role.story_function || role.function],
    ['参与方式', role.participation || role.mechanism], ['可见变化', role.visible_change || role.proof],
    ['出现时机', role.timing], ['行动号召', role.cta],
  ];
  const cards = fields.map(([label, value]) => claimCard(label, value)).filter(Boolean).join('');
  return cards || emptyState('参考内容没有明确的商品或品牌叙事职责。');
}

function renderCamera(data) {
  const items = list(data.camera_intents?.length ? data.camera_intents : (data.shot_breakdown || data.camera_language));
  if (!items.length) return emptyState('尚未形成镜头语言与叙事目的说明。');
  return `<div class="reference-entity-grid">${items.map((entry, index) => {
    const item = typeof entry === 'string' ? { description: entry } : object(entry);
    const title = firstText(item.title, item.shot_name, item.shot_id, `镜头 ${index + 1}`);
    const description = firstText(item.description, item.camera, item.movement, item.intent, item.visual);
    const purpose = firstText(item.narrative_purpose, item.story_function, item.reason, item.emotional_effect);
    const range = eventRange(item);
    return `<article class="reference-entity-card"><header><h4>${escapeHtml(title)}</h4>${statusBadge(item)}</header>${description ? `<p><b>镜头与运镜</b><span>${escapeHtml(description)}</span></p>` : ''}${purpose ? `<p><b>叙事目的</b><span>${escapeHtml(purpose)}</span></p>` : ''}${evidenceRefs(item).length ? `<div class="reference-evidence-list">${evidenceButtons(evidenceRefs(item), range[0])}</div>` : ''}</article>`;
  }).join('')}</div>`;
}

function renderAudio(data) {
  const rows = list(data.audio_visual_alignment);
  if (!rows.length) return emptyState('没有可展示的旁白、字幕与画面对齐记录。');
  return `<div class="reference-audio-list">${rows.map((entry, index) => {
    const item = object(entry);
    const range = eventRange(item);
    const start = timeValue(range[0]);
    const spoken = firstText(item.transcript, item.dialogue, item.voiceover, item.spoken_text, item.audio, item.text);
    const visual = firstText(item.visual, item.image, item.on_screen_action, item.scene);
    const functionText = firstText(item.function, item.narrative_function, item.purpose);
    return `<article><header>${start !== null ? `<button type="button" data-reference-seek="${start}">${escapeHtml(formatTime(start))}</button>` : `<span>段落 ${index + 1}</span>`}${statusBadge(item)}</header>${spoken ? `<p><b>声音 / 文字</b>${escapeHtml(spoken)}</p>` : ''}${visual ? `<p><b>同期画面</b>${escapeHtml(visual)}</p>` : ''}${functionText ? `<p><b>叙事作用</b>${escapeHtml(functionText)}</p>` : ''}</article>`;
  }).join('')}</div>`;
}

function renderTab(data, tab) {
  if (tab === 'timeline') return renderTimeline(data);
  if (tab === 'characters') return renderCharacters(data);
  if (tab === 'scenes') return renderScenes(data);
  if (tab === 'brand') return renderBrand(data);
  if (tab === 'camera') return renderCamera(data);
  if (tab === 'audio') return renderAudio(data);
  return renderOverview(data);
}

function editorField(path, label, value, options = {}) {
  const rows = Math.max(2, Number(options.rows || 3) || 3);
  const normalized = Array.isArray(value) ? value.map(claimText).filter(Boolean).join('\n') : claimText(value);
  if (options.select === 'narrative_mode') {
    return `<label class="reference-editor-field"><span>${escapeHtml(label)}</span><select class="select" data-reference-edit-path="${escapeHtml(path)}">${[
      ['narrative_story', '剧情叙事'], ['showcase_montage', '展示蒙太奇'], ['unclassified', '暂未分类'],
    ].map(([id, text]) => `<option value="${id}" ${normalized === id ? 'selected' : ''}>${text}</option>`).join('')}</select></label>`;
  }
  return `<label class="reference-editor-field ${options.full ? 'is-full' : ''}"><span>${escapeHtml(label)}${options.required ? '<em>必填</em>' : ''}</span><textarea class="textarea" rows="${rows}" data-reference-edit-path="${escapeHtml(path)}">${escapeHtml(normalized)}</textarea>${options.list ? '<small>每行一项</small>' : ''}</label>`;
}

function editorGroup(title, fields, note = '') {
  return `<section class="reference-editor-group"><h4>${escapeHtml(title)}</h4>${note ? `<p>${escapeHtml(note)}</p>` : ''}<div class="reference-editor-grid">${fields.join('')}</div></section>`;
}

function renderEditor(reference, tab) {
  const nested = object(reference.reference_understanding || reference.understanding);
  if (tab === 'overview') {
    const story = object(nested.story_summary);
    const fields = STORY_FIELDS.map(([key, label]) => editorField(
      `reference_understanding.story_summary.${key}`,
      label,
      story[key],
      { full: ['short_synopsis', 'full_synopsis'].includes(key), rows: key === 'full_synopsis' ? 8 : 3, required: ['logline', 'full_synopsis'].includes(key), select: key === 'narrative_mode' ? 'narrative_mode' : '' },
    ));
    const inferences = list(nested.inferences).flatMap((item, index) => {
      const row = object(item);
      return Object.keys(row).length ? [
        editorField(`reference_understanding.inferences.${index}.claim`, `推断 ${index + 1}`, row.claim, { full: true }),
        editorField(`reference_understanding.inferences.${index}.reason`, '推断依据', row.reason, { full: true }),
      ] : [];
    });
    const unknowns = list(nested.unknowns).flatMap((item, index) => {
      const row = object(item);
      return Object.keys(row).length ? [editorField(`reference_understanding.unknowns.${index}.question`, `待确认 ${index + 1}`, row.question || row.claim, { full: true })] : [];
    });
    return editorGroup('故事全貌', fields, '这里修改的是识别后的参考内容，不会重新调用模型。')
      + (inferences.length ? editorGroup('推断', inferences) : '')
      + (unknowns.length ? editorGroup('待确认', unknowns) : '');
  }
  if (tab === 'timeline') return list(nested.causal_chain).map((item, index) => {
    const row = object(item);
    return editorGroup(`事件 ${index + 1}`, [
      editorField(`reference_understanding.causal_chain.${index}.subject`, '主体', row.subject),
      editorField(`reference_understanding.causal_chain.${index}.action`, '动作', row.action, { required: true }),
      editorField(`reference_understanding.causal_chain.${index}.motivation`, '动机', row.motivation),
      editorField(`reference_understanding.causal_chain.${index}.result`, '结果', row.result),
    ]);
  }).join('') || emptyState('没有可编辑的时间线事件。');
  if (tab === 'characters') return list(nested.characters).map((item, index) => {
    const row = object(item);
    return editorGroup(firstText(row.name, row.character_name, row.character_id, `人物 ${index + 1}`), [
      editorField(`reference_understanding.characters.${index}.role`, '角色', row.role, { required: true }),
      editorField(`reference_understanding.characters.${index}.narrative_function`, '叙事职责', row.narrative_function),
      editorField(`reference_understanding.characters.${index}.relationships`, '人物关系', row.relationships, { list: true }),
      editorField(`reference_understanding.characters.${index}.initial_state`, '初始状态', row.initial_state),
      editorField(`reference_understanding.characters.${index}.goal`, '目标', row.goal),
      editorField(`reference_understanding.characters.${index}.obstacle`, '阻碍', row.obstacle),
      editorField(`reference_understanding.characters.${index}.key_decision`, '关键决定', row.key_decision),
      editorField(`reference_understanding.characters.${index}.final_state`, '最终状态', row.final_state),
      editorField(`reference_understanding.characters.${index}.emotional_arc`, '情绪变化', row.emotional_arc, { list: true, full: true }),
    ]);
  }).join('') || emptyState('没有可编辑的人物内容。');
  if (tab === 'scenes') return list(nested.scenes).map((item, index) => {
    const row = object(item);
    return editorGroup(firstText(row.name, row.scene_name, row.scene_id, `场景 ${index + 1}`), [
      editorField(`reference_understanding.scenes.${index}.narrative_function`, '叙事作用', row.narrative_function, { required: true, full: true }),
      editorField(`reference_understanding.scenes.${index}.entry_transition`, '进入方式', row.entry_transition),
      editorField(`reference_understanding.scenes.${index}.state_change`, '状态变化', row.state_change),
      editorField(`reference_understanding.scenes.${index}.exit_transition`, '离开方式', row.exit_transition),
    ]);
  }).join('') || emptyState('没有可编辑的场景内容。');
  if (tab === 'brand') {
    const row = object(nested.brand_role);
    return editorGroup('商品与品牌', [
      editorField('reference_understanding.brand_role.subject', '商品 / 品牌', row.subject, { required: true }),
      editorField('reference_understanding.brand_role.story_function', '故事职责', row.story_function, { required: true, full: true }),
      editorField('reference_understanding.brand_role.visible_claims', '可见卖点', row.visible_claims, { list: true, full: true }),
      editorField('reference_understanding.brand_role.proof_moments', '证明时刻', row.proof_moments, { list: true, full: true }),
      editorField('reference_understanding.brand_role.cta', '行动号召', row.cta, { full: true }),
    ]);
  }
  if (tab === 'camera') return list(reference.camera_intents).map((item, index) => {
    const row = object(item);
    return editorGroup(firstText(row.title, row.shot_name, row.shot_id, `镜头 ${index + 1}`), [
      editorField(`camera_intents.${index}.description`, '镜头与运镜', firstText(row.description, row.camera, row.movement, row.intent, row.visual), { full: true }),
      editorField(`camera_intents.${index}.narrative_purpose`, '叙事目的', firstText(row.narrative_purpose, row.story_function, row.reason, row.emotional_effect), { full: true }),
    ]);
  }).join('') || emptyState('没有可编辑的镜头内容。');
  const alignments = list(object(nested.audio_visual).alignments);
  return alignments.map((item, index) => {
    const row = object(item);
    return editorGroup(`声音段落 ${index + 1}`, [
      editorField(`reference_understanding.audio_visual.alignments.${index}.spoken_text`, '旁白 / 字幕 / 声音', firstText(row.spoken_text, row.transcript, row.dialogue, row.voiceover, row.audio, row.text), { full: true }),
      editorField(`reference_understanding.audio_visual.alignments.${index}.visual`, '同期画面', firstText(row.visual, row.image, row.on_screen_action, row.scene), { full: true }),
      editorField(`reference_understanding.audio_visual.alignments.${index}.function`, '叙事作用', firstText(row.function, row.narrative_function, row.purpose), { full: true }),
    ]);
  }).join('') || emptyState('没有可编辑的声音内容。');
}

function reportRevision(reference, data) {
  return Math.max(0, Number(data.user_edit_revision || data.revision || data.understanding_revision || data.schema_version || reference.understanding_revision || 0) || 0);
}

function playableVideoUrl(reference = {}) {
  const explicit = firstText(reference.playback_url, reference.video_url);
  if (explicit) return explicit;
  const candidate = firstText(reference.url);
  return /\.(?:mp4|mov|webm|m4v)(?:$|[?#])/i.test(candidate) || /\/api\/[^?#]*(?:video|stream|reference)/i.test(candidate)
    ? candidate
    : '';
}

function renderShell(reference, activeTab, editing = false, options = {}) {
  const data = understanding(reference);
  const bible = object(data.story_bible);
  const confirmed = isReferenceUnderstandingConfirmed(reference);
  const confirmation = object(data.understanding_confirmation || data.reference_understanding_confirmation || data.confirmation);
  const ready = confirmation.ready !== false && object(data.completeness).valid !== false;
  const revision = reportRevision(reference, data);
  const videoUrl = playableVideoUrl(reference);
  const synopsis = claimText(bible.full_synopsis || bible.short_synopsis || bible.logline) || '分析已完成，请逐项核对故事、人物、场景和证据。';
  return `<section class="card reference-understanding" data-reference-understanding data-reference-revision="${revision}">
    <div class="card-head reference-understanding-head"><div><h2>参考内容理解报告</h2><p>先核对系统如何理解故事，再将确认版本作为人物、场景、剧情、分镜与导演台的共同权威输入。</p></div><span class="status-tag ${confirmed ? 'is-success' : (ready ? 'is-info' : 'is-danger')}">${confirmed ? `已确认 · V${revision || 1}` : (ready ? `待确认 · V${revision || 1}` : `需补充 · V${revision || 1}`)}</span></div>
    <footer class="reference-understanding-actions">
      <div><b>${editing ? `正在修改“${escapeHtml(TAB_DEFINITIONS.find(([id]) => id === activeTab)?.[1] || '')}”` : (confirmed ? '该版本已作为项目权威输入' : (ready ? (options.continueToAssetPlan ? '确认后将建立人物与场景方案并进入资产中心' : '确认前不会创建人物、场景、剧情、分镜或触发付费生成') : '报告尚未达到确认标准'))}</b><small>${editing ? '保存后以你的修改为准；旧确认和受影响的下游结果会失效，但不会调用生成模型。' : (confirmed ? '后续环节应始终引用这一分析版本；新分析完成后必须重新确认。' : (ready ? (options.continueToAssetPlan ? '这里只把已识别内容整理成可编辑方案，不生成图片或视频；视觉生成仍需在资产中心另行确认。' : '请先核对事实、推断和待确认内容。确认动作只保存版本状态，不调用生成模型。') : `请重新整理报告后再确认：${escapeHtml(list(confirmation.failures || data.completeness?.failures).join('、') || '存在缺失内容')}`))}</small></div>
      ${editing
        ? '<button class="btn" type="button" data-cancel-reference-edit>取消</button><button class="btn primary" type="button" data-save-reference-edit>保存当前栏目</button>'
        : `${ready ? '<button class="btn" type="button" data-edit-reference-understanding>修改当前栏目</button>' : ''}${confirmed || !ready ? '' : `<button class="btn primary" type="button" data-confirm-reference-understanding>${options.continueToAssetPlan ? '确认并创建人物与场景方案' : '确认理解结果，作为项目权威输入'}</button>`}`}
    </footer>
    <div class="reference-understanding-brief-slot" data-reference-brief-slot></div>
    <div class="reference-understanding-summary">
      <div><small>完整故事摘要</small><p>${escapeHtml(synopsis)}</p></div>
      <dl><div><dt>故事事件</dt><dd>${list(data.story_events).length}</dd></div><div><dt>人物弧光</dt><dd>${list(data.character_arcs).length}</dd></div><div><dt>场景叙事</dt><dd>${list(data.scene_narratives).length}</dd></div><div><dt>待确认</dt><dd>${list(data.unknowns).length}</dd></div></dl>
    </div>
    ${videoUrl ? `<div class="reference-evidence-player"><video controls preload="metadata" data-reference-video src="${escapeHtml(videoUrl)}"></video><small>点击时间线或证据标签，可跳到对应时间核对画面。</small></div>` : '<div class="reference-evidence-player is-unavailable"><small>当前来源没有可直接播放的视频；证据时间仍会保留在报告中。</small></div>'}
    <div class="reference-understanding-tabs" role="tablist" aria-label="参考理解报告栏目">${TAB_DEFINITIONS.map(([id, label]) => `<button type="button" role="tab" aria-selected="${id === activeTab}" class="${id === activeTab ? 'active' : ''}" data-reference-tab="${id}">${escapeHtml(label)}</button>`).join('')}</div>
    <div class="reference-understanding-panel ${editing ? 'is-editing' : ''}" role="tabpanel" data-reference-panel>${editing ? renderEditor(reference, activeTab) : renderTab(data, activeTab)}</div>
  </section>`;
}

export function mountReferenceUnderstanding(host, options = {}) {
  if (!host) return { update() {}, destroy() {} };
  ensureStyles();
  let currentReference = options.reference || {};
  let activeTab = 'overview';
  let editing = false;
  let destroyed = false;

  const render = () => {
    if (destroyed) return;
    if (!hasReferenceUnderstanding(currentReference)) {
      host.innerHTML = '';
      return;
    }
    host.innerHTML = renderShell(currentReference, activeTab, editing, { continueToAssetPlan: typeof options.onConfirmed === 'function' });
    const briefSlot = host.querySelector('[data-reference-brief-slot]');
    if (briefSlot && options.briefSettingsNode) briefSlot.appendChild(options.briefSettingsNode);
  };

  const click = async event => {
    const tab = event.target.closest('[data-reference-tab]');
    if (tab) {
      if (editing) {
        toast('请先保存或取消当前栏目的修改。', 'warning');
        return;
      }
      activeTab = TAB_DEFINITIONS.some(([id]) => id === tab.dataset.referenceTab) ? tab.dataset.referenceTab : 'overview';
      render();
      return;
    }
    if (event.target.closest('[data-edit-reference-understanding]')) {
      editing = true;
      render();
      host.querySelector('[data-reference-edit-path]')?.focus();
      return;
    }
    if (event.target.closest('[data-cancel-reference-edit]')) {
      editing = false;
      render();
      return;
    }
    const saveButton = event.target.closest('[data-save-reference-edit]');
    if (saveButton) {
      const data = understanding(currentReference);
      const analysisId = firstText(data.analysis_id, currentReference.analysis_id);
      const baseContentRevision = Math.max(0, Number(options.store?.state?.bundle?.revisions?.content || 0) || 0);
      const baseEditRevision = Math.max(0, Number(object(currentReference.reference_understanding).user_edit_revision || 0) || 0);
      const fields = {};
      host.querySelectorAll('[data-reference-edit-path]').forEach(control => { fields[control.dataset.referenceEditPath] = control.value; });
      if (!analysisId || !baseContentRevision || !Object.keys(fields).length) {
        toast('当前栏目缺少可保存内容或版本信息，请刷新后重试。', 'danger');
        return;
      }
      try {
        setButtonBusy(saveButton, true, '正在保存…');
        await request(`/api/story-ad/projects/${encodeURIComponent(options.taskId)}/reference-understanding`, {
          method: 'PUT',
          body: {
            analysis_id: analysisId,
            tab: activeTab,
            fields,
            base_content_revision: baseContentRevision,
            base_edit_revision: baseEditRevision,
          },
        });
        editing = false;
        await options.store?.loadBundle?.(options.taskId, 'all');
        toast('参考内容已保存为你的修订版本；请核对后重新确认。', 'success');
      } catch (error) {
        if (error?.status === 409) {
          editing = false;
          await options.store?.loadBundle?.(options.taskId, 'all').catch(() => {});
          toast('参考内容已有更新，已读取最新版本，请重新修改。', 'warning');
        } else {
          toast(error.message, 'danger');
          setButtonBusy(saveButton, false);
        }
      }
      return;
    }
    const seek = event.target.closest('[data-reference-seek]');
    if (seek) {
      const seconds = timeValue(seek.dataset.referenceSeek);
      const video = host.querySelector('[data-reference-video]');
      if (seconds !== null && video) {
        video.currentTime = seconds;
        video.play().catch(() => {});
        video.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } else if (seconds !== null) {
        window.dispatchEvent(new CustomEvent('story-ad:reference-seek', { detail: { seconds } }));
        toast(`证据时间 ${formatTime(seconds)}；当前来源不能在页面内直接播放。`, 'info');
      }
      return;
    }
    const button = event.target.closest('[data-confirm-reference-understanding]');
    if (!button) return;
    const data = understanding(currentReference);
    const analysisId = firstText(data.analysis_id, currentReference.analysis_id);
    const baseRevision = Math.max(0, Number(options.store?.state?.bundle?.revisions?.content || 0) || 0);
    if (!analysisId || !baseRevision) {
      toast('报告缺少分析编号或版本，已停止确认以避免绑定错误内容。', 'danger');
      return;
    }
    const continueToAssetPlan = typeof options.onConfirmed === 'function';
    if (!await confirmDialog(continueToAssetPlan
      ? '确认后，这一版本将成为后续制作的共同权威输入，并立即建立可编辑的人物与场景方案、进入资产中心。此步骤不生成图片或视频；视觉生成仍需另行确认。'
      : '确认后，这一版本将成为人物、场景、剧情、分镜和导演台的共同权威输入。本操作不会触发任何生成或付费调用。', {
      title: '确认参考理解结果',
      confirmText: continueToAssetPlan ? '确认并进入资产中心' : '确认当前版本',
    })) return;
    try {
      setButtonBusy(button, true, '正在确认…');
      const taskId = options.taskId;
      await request(`/api/story-ad/projects/${encodeURIComponent(taskId)}/reference-understanding/confirm`, {
        method: 'POST',
        body: { analysis_id: analysisId, base_revision: baseRevision, confirmation: 'authoritative_input' },
      });
      await options.store?.loadBundle?.(taskId, 'all');
      if (continueToAssetPlan) {
        toast('参考理解已确认，正在创建人物与场景方案。', 'success');
        await options.onConfirmed({ taskId, analysisId, baseRevision });
      } else {
        toast('已确认当前参考理解版本；不会自动生成任何资产。', 'success');
      }
    } catch (error) {
      if (error?.status === 409) toast('参考理解报告已有更新，正在读取最新版本；请核对后重新确认。', 'warning');
      else toast(error.message, 'danger');
      await options.store?.loadBundle?.(options.taskId, 'all').catch(() => {});
      setButtonBusy(button, false);
    }
  };

  host.addEventListener('click', click);
  render();
  return {
    update(reference = {}) {
      currentReference = reference;
      if (isReferenceUnderstandingConfirmed(currentReference)) {
        activeTab = 'overview';
        editing = false;
      }
      render();
    },
    destroy() {
      destroyed = true;
      host.removeEventListener('click', click);
      host.innerHTML = '';
    },
  };
}
