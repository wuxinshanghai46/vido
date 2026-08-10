'use strict';

function clean(value = '', max = 180) { return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max); }
function rows(value, limit = 12) { return (Array.isArray(value) ? value : []).filter(Boolean).slice(0, limit); }

function normalizeAction(input = {}) {
  return {
    action_id: clean(input.action_id || input.actionId || input.id, 80),
    intent: clean(input.intent || input.action || input.purpose),
    start_pose: clean(input.start_pose || input.action_start),
    kinetic_chain: rows(input.kinetic_chain).map(item => clean(item, 120)),
    weight_shift: clean(input.weight_shift),
    hand_gesture: clean(input.hand_gesture),
    gaze_target: clean(input.gaze_target || input.eyeline),
    object_contact: clean(input.object_contact),
    tempo: clean(input.tempo, 60),
    end_pose: clean(input.end_pose || input.action_end),
    visible_evidence: rows(input.visible_evidence).map(item => clean(item, 120)),
  };
}

function normalizeCombat(input = {}) {
  return {
    combat_style: clean(input.combat_style || input.style || 'custom', 60),
    participants: rows(input.participants, 12).map(item => clean(item, 80)),
    weapon_prop_ids: rows(input.weapon_prop_ids, 12).map(item => clean(item, 80)),
    beats: rows(input.beats, 24).map((beat, index) => ({
      index: index + 1,
      phase: clean(beat.phase, 40), actor_id: clean(beat.actor_id, 80), target_id: clean(beat.target_id, 80),
      trajectory: clean(beat.trajectory), body_mechanics: clean(beat.body_mechanics),
      contact_point: clean(beat.contact_point), physical_result: clean(beat.physical_result),
      start_state: clean(beat.start_state), end_state: clean(beat.end_state),
      duration_sec: Math.max(0, Math.min(12, Number(beat.duration_sec || 0) || 0)),
    })),
  };
}

function promptBlock() {
  return 'Action contract: one visible primary action beat per short shot. Specify start pose, kinetic chain/weight shift, gaze or hand/object contact, tempo, and end pose. Combat must be split into anticipation, attack/defense, contact, reaction, and recovery beats; preserve axis, screen direction, participant positions, weapon/prop state, physical cause and visible result. Never paste a long action list into one shot.';
}

module.exports = { normalizeAction, normalizeCombat, promptBlock };
