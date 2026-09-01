'use strict';

function list(value) { return Array.isArray(value) ? value.filter(Boolean) : []; }
function text(value = '') { return String(value || '').replace(/\s+/g, ' ').trim(); }
function beatId(beat = {}, index = 0) {
  return text(beat.source_story_beat_id || beat.story_beat_id || beat.beat_id || beat.shot_id || beat.id || `story_beat_${index + 1}`);
}
function shotIdentity(shot = {}) { return text(shot.coverage_id || shot.shot_id || shot.id); }

function authorityRows(blueprint = {}, coveragePlan = {}) {
  const beats = list(blueprint.beats);
  const beatOrder = new Map(beats.map((beat, index) => [beatId(beat, index), index + 1]));
  const beatLines = new Map(beats.map((beat, index) => [
    beatId(beat, index),
    text(beat.spoken_line || beat.voiceover || beat.copy),
  ]));
  const rows = list(coveragePlan.beat_coverage).flatMap((entry, entryIndex) => {
    const sourceId = text(entry.story_beat_id);
    return list(entry.coverage_units).map((unit, unitIndex) => ({
      identity: text(unit.coverage_id),
      source_id: sourceId,
      sequence: Number(unit.global_sequence) || (entryIndex * 1000) + unitIndex + 1,
      spoken_line: text(unit.spoken_line || beatLines.get(sourceId.replace(/:source:\d+$/, ''))),
    }));
  });
  if (rows.length) return rows;
  return beats.map((beat, index) => ({
    identity: beatId(beat, index),
    source_id: beatId(beat, index),
    sequence: index + 1,
    spoken_line: beatLines.get(beatId(beat, index)) || '',
  }));
}

function authorityForShot(shot = {}, authorities = []) {
  const identity = shotIdentity(shot);
  const source = text(shot.source_beat_id || shot.source_story_beat_id);
  return authorities.find(row => row.identity && row.identity === identity)
    || authorities.find(row => row.source_id && row.source_id === source)
    || authorities.find(row => identity && (identity === row.source_id || identity.startsWith(`${row.source_id}:source:`)))
    || null;
}

function canonicalize(shots = [], { blueprint = {}, coveragePlan = {}, enforceSpeech = true } = {}) {
  const source = list(shots);
  const authorities = authorityRows(blueprint, coveragePlan);
  if (!source.length || !authorities.length) return { shots: source, changed: false, orderChanged: false, speechChanged: false, permutation: source.map((_, index) => index) };
  const ranked = source.map((shot, position) => ({
    shot,
    position,
    authority: authorityForShot(shot, authorities),
  })).sort((left, right) => {
    const leftRank = left.authority?.sequence ?? Number.MAX_SAFE_INTEGER;
    const rightRank = right.authority?.sequence ?? Number.MAX_SAFE_INTEGER;
    return leftRank - rightRank || left.position - right.position;
  });
  const permutation = ranked.map(item => item.position);
  const normalized = ranked.map((item, index) => {
    const spokenLine = enforceSpeech ? text(item.authority?.spoken_line) : '';
    const next = {
      ...item.shot,
      index: index + 1,
      shot_index: index + 1,
    };
    if (spokenLine) {
      next.blueprint_spoken_line = spokenLine;
      next.voiceover = spokenLine;
      next.narration = spokenLine;
    }
    return next;
  });
  const orderChanged = permutation.some((position, index) => position !== index)
    || normalized.some((shot, index) => Number(source[index]?.shot_index || source[index]?.index || index + 1) !== index + 1);
  const speechChanged = normalized.some((shot, index) => text(shot.voiceover) !== text(source[permutation[index]]?.voiceover));
  return { shots: normalized, changed: orderChanged || speechChanged, orderChanged, speechChanged, permutation };
}

function reorderAligned(rows = [], permutation = [], shots = []) {
  const source = list(rows);
  if (!source.length || source.length !== permutation.length) return source;
  return permutation.map((oldPosition, index) => ({
    ...source[oldPosition],
    index: index + 1,
    shot_index: index + 1,
  }));
}

module.exports = { authorityRows, authorityForShot, canonicalize, reorderAligned, shotIdentity };
