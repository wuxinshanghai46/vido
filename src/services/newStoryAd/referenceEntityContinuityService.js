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

function identityCues(value = '') {
  const source = clean(value, 2000).toLowerCase();
  const patterns = [
    /(?:男性|男士|男孩|男童|man|male|boy)/gu,
    /(?:女性|女士|女孩|女童|woman|female|girl)/gu,
    /(?:儿童|孩子|少年|child|teen)/gu,
    /(?:青年|年轻|成年|老人|老年|adult|young|elder)/gu,
    /(?:短发|长发|齐肩发|卷发|直发|光头|short hair|long hair)/gu,
    /(?:黑色|白色|米色|棕色|灰色|蓝色|红色|绿色|黄色|金色|银色)/gu,
    /(?:连衣裙|长裙|上衣|夹克|西装|衬衫|制服|外套|dress|jacket|shirt|suit)/gu,
    /(?:耳机|眼镜|帽子|项链|围巾|earbud|glasses|hat|scarf)/gu,
    /(?:背对镜头|侧脸|正脸|back view|profile|front view)/gu,
  ];
  return new Set(patterns.flatMap(pattern => source.match(pattern) || []));
}

function identityConflict(left = '', right = '') {
  const a = normalized(left);
  const b = normalized(right);
  const has = (source, pattern) => pattern.test(source);
  const male = /男性|男士|男孩|男童|\bman\b|\bmale\b|\bboy\b/u;
  const female = /女性|女士|女孩|女童|\bwoman\b|\bfemale\b|\bgirl\b/u;
  const child = /儿童|孩子|男童|女童|\bchild\b/u;
  const adult = /成年|青年|中年|老人|老年|\badult\b|\belder\b/u;
  return (has(a, male) && has(b, female))
    || (has(a, female) && has(b, male))
    || (has(a, child) && has(b, adult))
    || (has(a, adult) && has(b, child));
}

function partialBodyOnly(track = {}) {
  const descriptions = (track.observations || []).map(item => clean(item.description, 700)).filter(Boolean);
  return descriptions.length > 0 && descriptions.every(description => (
    /(?:双手|手部|手指|手腕|手掌|hands?|fingers?|wrist)/iu.test(description)
    && !/(?:人物|男性|女性|男士|女士|青年|儿童|老人|脸|头发|全身|半身|person|man|woman|face|hair)/iu.test(description)
  ));
}

function consolidateSubjectTracks(tracks = [], kind = 'human') {
  const candidates = kind === 'human' ? tracks.filter(track => !partialBodyOnly(track)) : tracks;
  const parents = candidates.map((_, index) => index);
  const find = index => parents[index] === index ? index : (parents[index] = find(parents[index]));
  const join = (left, right) => {
    const a = find(left);
    const b = find(right);
    if (a !== b) parents[b] = a;
  };
  for (let left = 0; left < candidates.length; left += 1) {
    for (let right = left + 1; right < candidates.length; right += 1) {
      const a = candidates[left];
      const b = candidates[right];
      const simultaneous = (a.observations || []).some(one => (b.observations || []).some(two => (
        one.frame_id === two.frame_id || (one.shot_index && one.shot_index === two.shot_index)
      )));
      if (simultaneous || identityConflict(a.signature, b.signature)) continue;
      const score = similarity(a.signature, b.signature);
      const cuesA = identityCues(a.signature);
      const sharedCues = [...identityCues(b.signature)].filter(cue => cuesA.has(cue)).length;
      if (score >= 0.22 && (sharedCues >= 2 || score >= 0.38)) join(left, right);
    }
  }
  const groups = new Map();
  candidates.forEach((track, index) => {
    const root = find(index);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(track);
  });
  return [...groups.values()].map((group, index) => {
    const observations = group.flatMap(track => track.observations || [])
      .sort((a, b) => Number(a.timestamp_seconds || 0) - Number(b.timestamp_seconds || 0));
    const signatures = [...new Set(group.map(track => clean(track.signature, 700)).filter(Boolean))];
    return {
      id: `${kind}_track_${index + 1}`,
      kind,
      role: group.map(track => track.role).find(Boolean) || '',
      appearance: signatures.slice(0, 4).join('；'),
      evidence_refs: [...new Set(observations.map(item => item.frame_id))],
      observations,
    };
  });
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
        ? [item.role_hint, item.appearance].filter(Boolean).join('；')
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
      if (observation.description && !normalized(track.signature).includes(normalized(observation.description))) {
        track.signature = clean([track.signature, observation.description].filter(Boolean).join('；'), 1800);
      }
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
  return consolidateSubjectTracks(tracks, kind);
}

function trackScenes(frames = []) {
  const tracks = [];
  for (let index = 0; index < (Array.isArray(frames) ? frames : []).length; index += 1) {
    const frame = frames[index] || {};
    const locationSignature = clean(frame.environment, 700);
    const signature = clean([frame.environment, frame.layout, frame.lighting].filter(Boolean).join('；'), 1200);
    const sameShot = tracks.find(track => track.last_shot === Number(frame.shot_index || 0));
    const best = tracks.map(track => ({
      track,
      locationScore: similarity(locationSignature, track.location_signature),
      detailScore: similarity(signature, track.signature),
    }))
      .map(row => ({ ...row, score: Math.max(row.detailScore, row.locationScore) }))
      .sort((left, right) => right.score - left.score)[0];
    // Physical-space identity is carried by the environment description. Layout
    // and lighting legitimately change across wide/detail shots and must not
    // create a new scene by themselves.
    const matched = sameShot || (best && (best.detailScore >= 0.52 || best.locationScore >= 0.34) ? best.track : null);
    const track = matched || (tracks.length < MAX_SCENE_TRACKS ? {
      id: `scene_track_${tracks.length + 1}`,
      signature,
      location_signature: locationSignature,
      observations: [],
    } : tracks[tracks.length - 1]);
    if (!matched && track && !tracks.includes(track)) tracks.push(track);
    if (!track) continue;
    if (!track.signature && signature) track.signature = signature;
    if (!track.location_signature && locationSignature) track.location_signature = locationSignature;
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

module.exports = {
  buildContinuity,
  trackSubjects,
  trackScenes,
  _private: { similarity, normalized, identityCues, identityConflict, partialBodyOnly, consolidateSubjectTracks },
};
