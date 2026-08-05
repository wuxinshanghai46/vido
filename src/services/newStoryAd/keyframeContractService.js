const crypto = require('crypto');
const { sceneContractForShot } = require('./sceneBindingService');
const productIdentity = require('./productIdentityContractService');
const shotDesign = require('./shotDesignService');
const temporalEvidenceGraph = require('./temporalEvidenceGraphService');
const petIdentity = require('./petIdentityContractService');
const brandEnding = require('./brandEndingService');

function canonicalContractValue(value, key = '') {
  if (Array.isArray(value)) return value.map(item => canonicalContractValue(item));
  if (!value || typeof value !== 'object') return value;
  // Audit and transport timestamps are not part of the visual contract. Including
  // them made an unchanged product identity look semantically different whenever
  // it was re-saved or re-verified.
  const ignored = new Set([
    'contract_fingerprint', 'contract_compiler_signature', 'compiled_at',
    'created_at', 'updated_at', 'checked_at', 'verified_at',
    // Provider/file bookkeeping describes how an already-selected reference
    // was transported. It is not part of the visual scene contract. The
    // stable URL/image identity remains in the surrounding `url` fields.
    'filename', 'provider_used', 'source_url',
  ]);
  return Object.keys(value).sort().reduce((out, childKey) => {
    if (!ignored.has(childKey)) out[childKey] = canonicalContractValue(value[childKey], childKey);
    return out;
  }, {});
}

function contractCompilerSignature(contract = {}) {
  return crypto.createHash('sha256')
    .update(JSON.stringify(canonicalContractValue(contract)))
    .digest('hex');
}

function contractFingerprint(contract = {}) {
  const personContract = contract.cast_lock?.person_contract || {};
  const productContract = contract.product_lock || {};
  const payload = {
    shot_index: contract.shot_index,
    output_ratio: contract.output_ratio,
    title: contract.title,
    role: contract.role,
    subject_lock: contract.subject_lock,
    scene_lock: contract.scene_lock,
    continuity_lock: contract.continuity_lock,
    temporal_evidence_lock: contract.temporal_evidence_lock,
    brand_ending_lock: contract.brand_ending_lock,
    cast_lock: {
      cast_mode: contract.cast_lock?.cast_mode,
      shot_characters: contract.cast_lock?.shot_characters,
      dialogue_lines: contract.cast_lock?.dialogue_lines,
      person_revision: personContract.person_revision,
      person_fingerprint: personContract.reference_fingerprint,
    },
    pet_lock: contract.pet_lock,
    product_lock: {
      product_revision: productContract.product_revision,
      product_fingerprint: productContract.reference_fingerprint,
    },
    visual_contract: contract.visual_contract,
    negative_prompt: contract.negative_prompt,
  };
  // Use the same semantic canonicalizer as the compiler signature. Older
  // fingerprints included audit timestamps and optional transport metadata,
  // so re-verifying an unchanged scene could invalidate every keyframe.
  return crypto.createHash('sha256').update(JSON.stringify(canonicalContractValue(payload))).digest('hex');
}

function buildKeyframeContracts(ctx, shots) {
  const controls = ctx.controlled_production || {};
  const productControl = controls.product_control || {};
  const styleControl = controls.style_control || {};
  const negativeControl = controls.negative_control || {};
  const environmentControl = controls.environment_control || {};
  return (Array.isArray(shots) ? shots : []).map((shot, idx) => {
    const sceneLock = sceneContractForShot(ctx, shot, idx);
    const productPresence = productIdentity.shotProductPresence(ctx, shot, {});
    const compiledShotDesign = shotDesign.compileShotDesign({
      shot,
      sceneSurface: sceneLock?.spatial_contract?.surface_topology || null,
      sceneText: [
        sceneLock?.layout_summary,
        sceneLock?.material_summary,
        sceneLock?.scene_contract?.layout_summary,
        sceneLock?.scene_contract?.material_summary,
      ],
    });
    const temporalEvidence = shot.temporal_evidence
      || temporalEvidenceGraph.graphForShot(ctx.temporal_evidence_graph || {}, idx + 1);
    const expectedAnimals = petIdentity.expectedAnimalsForShot(ctx, shot);
    const brandEndingContract = shot.brand_ending?.enabled === true
      ? shot.brand_ending
      : (idx === shots.length - 1 ? brandEnding.contract(ctx) : { enabled: false });
    const contract = {
      shot_index: idx + 1,
      title: shot.title || `镜头 ${idx + 1}`,
      role: shot.role || shot.purpose || '',
      output_ratio: ctx.output_ratio,
      subject_lock: {
        // Once a product identity has been verified it is the canonical subject
        // source. Generated/normalized brief text may become more descriptive,
        // but must not silently invalidate media for the same product revision.
        advertised_subject: ctx.product_contract?.advertised_subject || ctx.product_subject,
        forbidden: ctx.forbidden || [],
        task_isolation: 'only use current new_story_ad task context',
      },
      scene_lock: sceneLock,
      continuity_lock: shot.continuity || {
        continuity_from: shot.continuity_from || '',
        entry_frame_state: shot.entry_frame_state || '',
        exit_frame_state: shot.exit_frame_state || '',
        action_start: shot.action_start || '',
        action_end: shot.action_end || '',
        screen_direction: shot.screen_direction || '',
        eyeline: shot.eyeline || '',
        camera_axis: shot.camera_axis || '',
        camera_movement: shot.camera_movement || '',
        shot_size: shot.shot_size || '',
        camera_angle: shot.camera_angle || '',
        lens_mm: shot.lens_mm || 0,
        depth_of_field: shot.depth_of_field || '',
        composition: shot.composition || '',
        subject_position: shot.subject_position || '',
        object_states: shot.object_states || '',
        transition_type: shot.transition_type || '',
        transition_duration_sec: Number(shot.transition_duration_sec || 0),
        transition_match_anchor: shot.transition_match_anchor || '',
        transition_source: shot.transition_source || '',
        boundary_mode: shot.boundary_mode || '',
        transition_reason: shot.transition_reason || '',
        audio_bridge: shot.audio_bridge || '',
        audio_bridge_duration_sec: Number(shot.audio_bridge_duration_sec || 0),
        ambient_sound: shot.ambient_sound || '',
        sfx: shot.sfx || [],
        music_cue: shot.music_cue || '',
        voiceover_timing: shot.voiceover_timing || '',
        requires_previous_frame: shot.requires_previous_frame === true,
      },
      // V2.0 合同只携带当前镜头所需的图切片，避免把整张任务图复制到每个合同，
      // 同时让关键帧、视频和质检共享完全相同的状态与证据边界。
      temporal_evidence_lock: temporalEvidence || null,
      brand_ending_lock: brandEndingContract.enabled === true ? brandEndingContract : null,
      cast_lock: {
        cast_mode: ctx.cast_mode,
        characters: ctx.characters || [],
        shot_characters: shot.characters || [],
        dialogue_lines: shot.dialogue_lines || [],
        person_asset: ctx.person_asset || null,
        cast_profiles: ctx.cast_profiles || [],
        real_person_locked: ctx.person_context?.real_person_locked === true,
        production_usable_actor: ctx.person_context?.production_usable_actor === true,
        person_contract: ctx.person_contract || ctx.person_asset?.person_contract || null,
      },
      pet_lock: {
        expected_animals: expectedAnimals,
        shot_pets: shot.pets || [],
        pet_contract: ctx.pet_contract || null,
      },
      product_lock: ctx.product_contract || null,
      visual_contract: {
        must_show: shot.visual,
        action: shot.action,
        evidence: shot.keyframe_notes || shot.material_usage || '',
        scene_direction: environmentControl.mode || 'auto',
        custom_scene_requirement: environmentControl.custom || '',
        product_required: productIdentity.shotProductProofRequired(ctx, shot, {}),
        product_visual_lock_required: productIdentity.shotProductVisualLockRequired(ctx, shot, {}),
        product_proof_requirements: (ctx.product_contract?.proof_requirements || []).slice(0, 24),
        product_presence_mode: productPresence.mode,
        product_presence: productControl.presence || 'medium',
        product_lock_strength: productControl.lock_strength || 'standard',
        product_methods: Array.isArray(productControl.methods) ? productControl.methods : [],
        style_direction: styleControl.notes || '',
        negative_requirements: negativeControl.text || '',
        text_rule: brandEndingContract.enabled === true
          ? `do not render any logo or brand text; preserve the current approved scene and leave the ${brandEndingContract.position_label} brand safe area clean for exact post-production overlay`
          : 'do not render readable UI labels, slogans, captions, logo or brand text; no brand safe area is required',
        shot_design: compiledShotDesign,
        surface_topology_resolution: compiledShotDesign.surface_resolution,
      },
      negative_prompt: [
        'wrong advertised subject',
        'old task subject contamination',
        'unconfirmed character',
        expectedAnimals > 0 ? 'missing, extra, replaced, duplicated or inconsistent required pet' : 'unrequested pet or robot',
        'poster-only abstract scene',
        'unrequested stock-market or finance dashboard',
        'unrelated charts, K-line candles or trading screens',
        'generic data wall replacing the actual advertised subject',
        'different industry setting not requested by current task',
        'readable random text or logo',
        'missing required people in multi-person story',
        negativeControl.text || '',
      ],
    };
    contract.contract_fingerprint = contractFingerprint(contract);
    contract.contract_revision = 1;
    contract.contract_compiler_signature = contractCompilerSignature(contract);
    return contract;
  });
}

module.exports = { buildKeyframeContracts, contractFingerprint, contractCompilerSignature };
