'use strict';

function clean(value = '', max = 320) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > max ? text.slice(0, max).trim() : text;
}

function numberInRange(value, fallback = 0, min = 0, max = 3) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

const EXECUTION_CLASSES = new Set(['editorial_only', 'semantic_cut', 'generated_boundary']);

function normalizeTransitionDesign(value = {}, transitionType = '') {
  const source = typeof value === 'string' ? { motif: value } : (value && typeof value === 'object' ? value : {});
  const type = clean(transitionType, 40).toLowerCase();
  const defaultExecution = ['cut_on_action', 'match_cut'].includes(type)
    ? 'semantic_cut'
    : (source.motif || source.outgoing_end_state || source.incoming_start_state ? 'generated_boundary' : 'editorial_only');
  const requestedExecution = clean(source.execution_class || source.executionClass, 40).toLowerCase();
  return {
    motif: clean(source.motif || source.name || source.transition_motif, 100),
    execution_class: EXECUTION_CLASSES.has(requestedExecution) ? requestedExecution : defaultExecution,
    source_object: clean(source.source_object || source.sourceObject || source.occlusion_source, 160),
    outgoing_end_state: clean(source.outgoing_end_state || source.outgoingEndState || source.source_state, 320),
    incoming_start_state: clean(source.incoming_start_state || source.incomingStartState || source.target_state, 320),
    motion_direction: clean(source.motion_direction || source.motionDirection || source.screen_direction, 80),
    generation_prompt: clean(source.generation_prompt || source.generationPrompt || source.prompt, 500),
    verification_evidence: clean(source.verification_evidence || source.verificationEvidence || source.evidence, 320),
    deterministic_fallback: clean(source.deterministic_fallback || source.deterministicFallback, 80)
      || (defaultExecution === 'generated_boundary' ? 'dissolve' : type || 'hard_cut'),
  };
}

function normalizeMicroExpression(value = {}, emotionalTurn = '') {
  const source = typeof value === 'string' ? { label: value } : (value && typeof value === 'object' ? value : {});
  return {
    label: clean(source.label || source.name || source.expression || emotionalTurn, 100),
    gaze: clean(source.gaze || source.eyeline, 180),
    eyelids: clean(source.eyelids || source.eyes, 160),
    brows: clean(source.brows || source.eyebrows, 160),
    mouth: clean(source.mouth || source.lips || source.mouth_corners, 180),
    jaw: clean(source.jaw || source.jaw_tension, 120),
    head_pose: clean(source.head_pose || source.headPose || source.head, 160),
    gesture: clean(source.gesture || source.hand_gesture || source.handGesture, 180),
    intensity: clean(source.intensity, 40) || 'restrained',
    onset: clean(source.onset || source.timeline, 100),
    hold_sec: numberInRange(source.hold_sec ?? source.holdSec, 0, 0, 3),
    trigger: clean(source.trigger || source.story_trigger, 220),
    prohibited: clean(source.prohibited || source.negative, 240) || '禁止只动嘴、空洞凝视、夸张瞪眼张嘴和与剧情无关的摆拍表情',
  };
}

function microExpressionPrompt(value = {}) {
  const item = normalizeMicroExpression(value);
  return [
    item.label,
    item.gaze && `视线：${item.gaze}`,
    item.eyelids && `眼睑：${item.eyelids}`,
    item.brows && `眉部：${item.brows}`,
    item.mouth && `嘴部：${item.mouth}`,
    item.jaw && `下颌：${item.jaw}`,
    item.head_pose && `头部：${item.head_pose}`,
    item.gesture && `手部：${item.gesture}`,
    item.trigger && `触发：${item.trigger}`,
    `强度：${item.intensity}`,
    item.hold_sec > 0 && `保持：${item.hold_sec.toFixed(2)}秒`,
    `禁止：${item.prohibited}`,
  ].filter(Boolean).join('；');
}

function transitionDesignPrompt(value = {}, transitionType = '') {
  const item = normalizeTransitionDesign(value, transitionType);
  return [
    item.motif && `动机：${item.motif}`,
    `执行类别：${item.execution_class}`,
    item.source_object && `遮挡/承接物：${item.source_object}`,
    item.outgoing_end_state && `上一镜尾态：${item.outgoing_end_state}`,
    item.incoming_start_state && `下一镜首态：${item.incoming_start_state}`,
    item.motion_direction && `方向：${item.motion_direction}`,
    item.generation_prompt && `边界生成：${item.generation_prompt}`,
    item.verification_evidence && `验收证据：${item.verification_evidence}`,
    `安全回退：${item.deterministic_fallback}`,
  ].filter(Boolean).join('；');
}

module.exports = {
  EXECUTION_CLASSES,
  microExpressionPrompt,
  normalizeMicroExpression,
  normalizeTransitionDesign,
  transitionDesignPrompt,
};
