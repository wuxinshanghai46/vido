module.exports = [
  {
    id: 'kb_world_setting_fidelity_contract_v1', collection: 'storyboard', subcategory: 'World Setting Contract',
    title: 'World setting fidelity contract',
    summary: 'A project-level, multi-world contract for period, region, culture, visual medium, fidelity and forbidden anachronisms.',
    content: 'Use one or more stable world profiles. User choices outrank brief facts, references and KB suggestions. Bind scenes and character looks to a profile. Separate historical realism, stylized history and fantasy. Lock one declared visual medium—live action, cinematic 3D, original 2D anime, motion comic, mixed media or custom—across people, scenes, storyboards, keyframes and QA. Auto values may be inferred only from current script evidence; never invent unsupported specificity. “Overseas” is incomplete until region or period is supplied. Keep rules compact; do not copy article-length prompts or imitate named creators and protected titles.',
    tags: ['world setting', 'era', 'region', 'visual medium', 'fidelity', 'continuity'], keywords: ['world_setting_fidelity_contract', 'setting lock', 'visual medium', 'historical realism'],
    applies_to: ['project_assistant', 'screenwriter', 'director', 'storyboard', 'art_director', 'prompt_engineer'],
    source: 'VIDO synthesis from user-provided character, costume and prompt references, 2026-08-10', enabled: true,
  },
  {
    id: 'kb_performance_action_lexicon_v1', collection: 'storyboard', subcategory: 'Performance Mechanics',
    title: 'Performance action mechanics lexicon',
    summary: 'Open-domain action semantics based on pose, kinetic chain, weight, gaze, contact, tempo and visible end state.',
    content: 'Index actions by intent and subject capability, not by industry. For each shot compile a start pose, kinetic chain and weight shift, hands, gaze, object contact, tempo, expression change, end pose and visible evidence. Use task objects and spaces; never introduce a fixed office, medical or manufacturing template.',
    tags: ['performance', 'action', 'body mechanics', 'gaze', 'object contact'], keywords: ['performance_action_lexicon', 'kinetic chain', 'weight shift'],
    applies_to: ['screenwriter', 'director', 'storyboard', 'prompt_engineer', 'qa'],
    source: 'VIDO synthesis from user-provided AI drama action references, 2026-08-10', enabled: true,
  },
  {
    id: 'kb_combat_beat_camera_contract_v1', collection: 'storyboard', subcategory: 'Combat Beat Contract',
    title: 'Combat beat and camera continuity contract',
    summary: 'Decomposes combat into physically causal beats with camera-axis, prop-state and continuity evidence.',
    content: 'Treat combat as an extension of the generic action contract. Split combinations into anticipation, attack, defense, contact, reaction and recovery. Each short shot carries at most one primary beat, with actor, target, trajectory, body mechanics, contact point, physical result, environment effect and start/end state. Camera choices must preserve axis, screen direction, positions and weapon state.',
    tags: ['combat', 'camera', 'continuity', 'physical causality'], keywords: ['combat_beat_camera_contract', 'attack reaction recovery'],
    applies_to: ['director', 'storyboard', 'prompt_engineer', 'qa'],
    source: 'VIDO synthesis from user-provided high-energy combat prompt references, 2026-08-10', enabled: true,
  },
];
