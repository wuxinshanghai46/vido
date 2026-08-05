const MAX_SUBJECT_TRACKS = 24;
const MAX_SCENE_TRACKS = 120;

function clean(value = '', max = 500) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function normalized(value = '') {
  return clean(value, 1000).toLowerCase().replace(/[\s，,。；;：:、.!！?？()（）\[\]{}]/gu, '');
}

function grams(value = '') {
  const source = normalized(value);
  if (!source) return new Set();
  if (source.length < 2) return new Set([source]);
  return new Set(Array.from({ length: source.length - 1 }, (_, index) => source.slice(index, index + 2)));
}

function similarity(left = '', right = '') {
  const a = grams(left);
  const b = grams(right);
  if (!a.size || !b.size) return 0;
  let common = 0;
  for (const item of a) if (b.has(item)) common += 1;
  return common / Math.max(1, Math.min(a.size, b.size));
}

function frameId(frame = {}, index = 0) {
  return clean(frame.frame_id || `F${String(index + 1).padStart(3, '0')}`, 24);
}

function trackSubjects(frames = [], kind = 'human') {
  const tracks = [];
  const rows = Array.isArray(frames) ? frames : [];
  for (let frameIndex = 0; frameIndex < rows.length; frameIndex += 1) {
    const frame = rows[frameIndex] || {};
    const isHuman = kind === 'human';
    const explicit = isHuman
      ? (Array.isArray(frame.people) ? frame.people : [])
      : (Array.isArray(frame.animals) ? frame.animals : []);
    const count = Math.max(0, Math.round(Number(
      isHuman ? frame.human_count : frame.animal_count,
    ) || 0));
    const observations = Array.from({ length: Math.max(count, explicit.length) }, (_, slot) => {
      const item = explicit[slot] || {};
      const description = clean(isHuman
        ? [item.role_hint, item.appearance, item.position].filter(Boolean).join('；')
        : [item.species, item.appearance, item.description, item.position].filter(Boolean).join('；'), 700);
      return {
        source_id: clean(item.id || item.person_id || item.animal_id, 80),
        description,
        role: clean(isHuman ? item.role_hint : item.role, 160),
        action: clean(item.action || (isHuman ? frame.human_actions?.[slot] : frame.animal_actions?.[slot]), 400),
        position: clean(item.position || item.screen_position, 160),
        slot,
      };
    });
    const used = new Set();
    for (const observation of observations) {
      const sourceMatch = observation.source_id && !/^(?:visible_)?(?:person|animal)_?\d*$/i.test(observation.source_id)
        ? tracks.find(track => track.source_ids.has(observation.source_id) && !used.has(track.id))
        : null;
      const candidates = tracks
        .filter(track => !used.has(track.id))
        .map(track => ({
          track,
          score: Math.max(
            similarity(observation.description, track.signature),
            observation.role && track.role ? similarity(observation.role, track.role) : 0,
          ) + (observation.position && observation.position === track.last_position ? 0.08 : 0),
        }))
        .sort((left, right) => right.score - left.score);
      // Description similarity is authoritative only when it is meaningfully specific. If the
      // model supplied no description, slot continuity is limited to adjacent frames in one shot.
      let track = sourceMatch || (candidates[0]?.score >= 0.48 ? candidates[0].track : null);
      if (!track && !observation.description) {
        track = tracks.find(item => !used.has(item.id)
          && item.last_slot === observation.slot
          && Number(item.last_shot || 0) === Number(frame.shot_index || 0)) || null;
      }
      if (!track && tracks.length < MAX_SUBJECT_TRACKS) {
        track = {
          id: `${kind}_track_${tracks.length + 1}`,
          kind,
          signature: observation.description,
          role: observation.role,
          source_ids: new Set(),
          observations: [],
        };
        tracks.push(track);
      }
      if (!track) continue;
      used.add(track.id);
      if (observation.source_id) track.source_ids.add(observation.source_id);
      if (!track.signature && observation.description) track.signature = observation.description;
      if (!track.role && observation.role) track.role = observation.role;
      track.last_position = observation.position;
      track.last_slot = observation.slot;
      track.last_shot = Number(frame.shot_index || 0);
      track.observations.push({
        frame_id: frameId(frame, frameIndex),
        timestamp_seconds: Number(frame.timestamp_seconds || 0),
        shot_index: Number(frame.shot_index || 0),
        description: observation.description,
        action: observation.action,
        position: observation.position,
      });
    }
  }
  return tracks.map(track => ({
    id: track.id,
    kind: track.kind,
    role: track.role,
    appearance: track.signature,
    evidence_refs: [...new Set(track.observations.map(item => item.frame_id))],
    observations: track.observations,
  }));
}

function trackScenes(frames = []) {
  const tracks = [];
  for (let index = 0; index < (Array.isArray(frames) ? frames : []).length; index += 1) {
    const frame = frames[index] || {};
    const signature = clean([frame.environment, frame.layout, frame.lighting].filter(Boolean).join('；'), 1200);
    const sameShot = tracks.find(track => track.last_shot === Number(frame.shot_index || 0));
    const best = tracks.map(track => ({ track, score: similarity(signature, track.signature) }))
      .sort((left, right) => right.score - left.score)[0];
    const matched = sameShot || (best?.score >= 0.52 ? best.track : null);
    const track = matched || (tracks.length < MAX_SCENE_TRACKS ? {
      id: `scene_track_${tracks.length + 1}`,
      signature,
      observations: [],
    } : tracks[tracks.length - 1]);
    if (!matched && track && !tracks.includes(track)) tracks.push(track);
    if (!track) continue;
    if (!track.signature && signature) track.signature = signature;
    track.last_shot = Number(frame.shot_index || 0);
    track.observations.push({
      frame_id: frameId(frame, index),
      timestamp_seconds: Number(frame.timestamp_seconds || 0),
      shot_index: Number(frame.shot_index || 0),
      environment: clean(frame.environment, 500),
      layout: clean(frame.layout, 700),
    });
  }
  return tracks.map(track => ({
    id: track.id,
    kind: 'physical_scene',
    description: track.signature,
    evidence_refs: [...new Set(track.observations.map(item => item.frame_id))],
    shot_indexes: [...new Set(track.observations.map(item => item.shot_index))],
    observations: track.observations,
  }));
}

function buildContinuity(frames = []) {
  const human_tracks = trackSubjects(frames, 'human');
  const animal_tracks = trackSubjects(frames, 'animal');
  const scene_tracks = trackScenes(frames);
  return {
    human_tracks,
    animal_tracks,
    scene_tracks,
    distinct_human_count: human_tracks.length,
    max_simultaneous_humans: Math.max(0, ...(frames || []).map(frame => Number(frame.human_count || 0))),
    distinct_animal_count: animal_tracks.length,
    max_simultaneous_animals: Math.max(0, ...(frames || []).map(frame => Number(frame.animal_count || 0))),
  };
}

module.exports = { buildContinuity, trackSubjects, trackScenes, _private: { similarity, normalized } };
