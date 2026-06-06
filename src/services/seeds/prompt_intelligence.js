/**
 * Prompt intelligence seed docs.
 *
 * These docs turn external prompt-library observations into VIDO-owned,
 * structured knowledge. They are not copied source content.
 */
module.exports = [
  {
    id: 'kb_prompt_library_intake_method',
    collection: 'engineering',
    subcategory: 'Prompt KB Operations',
    title: 'Prompt library intake method for VIDO',
    summary: 'Convert public prompt references into structured VIDO KB entries through taxonomy extraction, dedupe, scoring, and review instead of copying text.',
    content: `Use public prompt sites as reference material, not as copy sources.

Intake workflow:
1. Capture source URL, topic, visible taxonomy, and intended VIDO workflow.
2. Extract reusable structure: task type, input variables, output format, model fit, constraints, and quality signals.
3. Deduplicate against existing KB by title, tags, prompt snippets, and semantic purpose.
4. Score each candidate on five axes: VIDO relevance, model fit, actionability, originality, and verification status.
5. Rewrite into VIDO-owned language with a clear agent target and short reusable snippets.
6. Mark as draft until a real generation or agent preview confirms it helps.

Do not ingest secrets, private paid content, personal data, or long verbatim third-party prompt text.`,
    tags: ['prompt library', 'kb intake', 'prompt operations', 'dedupe', 'review'],
    keywords: ['Prompt123', 'prompt source import', 'knowledge base operations', 'prompt scoring', 'agent learning'],
    prompt_snippets: [
      'Convert this prompt reference into VIDO KB schema: task, variables, model fit, constraints, quality gates, reusable snippets.',
      'Score this prompt candidate on relevance, actionability, originality, model fit, and verification status before adding it to KB.',
    ],
    applies_to: ['project_assistant', 'prompt_engineer', 'director', 'storyboard', 'screenwriter'],
    source: 'VIDO local review of Prompt123 and public prompt-library patterns, 2026-06-06',
    lang: 'en-zh',
    enabled: true,
  },
  {
    id: 'kb_sb_camera_movement_taxonomy_ai_drama',
    collection: 'storyboard',
    subcategory: 'Camera Movement Taxonomy',
    title: 'AI drama advanced camera movement taxonomy',
    summary: 'A structured camera movement taxonomy for AI manga drama and story ads: movement mechanics, emotional purpose, use cases, and prompt phrases.',
    content: `Every motion prompt should specify camera movement before style decoration.

Core categories:
- Push / pull: push-in, dolly-in, pull-back, dolly-out. Use push-in for realization, pressure, intimacy; use pull-back for loneliness, reveal, or loss of control.
- Track / follow: side tracking, follow shot, lead shot. Use for walking dialogue, chase, product demonstration, and spatial continuity.
- Orbit / arc: 180-degree orbit, 360-degree orbit, parallax orbit. Use for relationship tension, hero reveal, product premium reveal, or character transformation.
- Crane / boom: crane up, crane down, overhead reveal, top-down transition. Use for scale, status shift, discovery, and scene geography.
- Handheld / stability: locked-off, steadicam, gentle handheld, active handheld, unstable shake. Stability is emotion: tripod is authority, steadicam is control, handheld is realism, shake is panic.
- Whip / snap: whip pan, snap zoom, crash zoom. Use sparingly for shock, comedy, impact, or fast information shift.
- POV / subjective: first-person view, over-shoulder, eye-line reveal, hidden observer. Use for immersion and suspense.
- Transition motion: match movement, object wipe, rack focus reveal, speed ramp. Use to connect shots and reduce fragmented AI video feel.
- Manga drama motion: panel reveal, speed-line burst, impact cut, parallax layer drift. Use when the output is stylized manga drama instead of live-action realism.

Each shot should choose one primary camera movement and one emotional goal. Do not stack many movements in one short 3-5 second shot.`,
    tags: ['camera movement', 'AI drama', 'storyboard', 'motion prompt', '运镜'],
    keywords: ['push in', 'pull back', 'tracking shot', 'orbit shot', 'crane shot', 'handheld', 'whip pan', 'POV', 'match movement', 'AI漫剧运镜'],
    prompt_snippets: [
      'slow dolly-in toward the character, pressure increasing, shallow depth of field',
      'side tracking shot following the character walking through the corridor, steady cinematic motion',
      '180-degree orbit around the two characters, relationship tension, parallax background',
      'crane-up reveal from close foreground object to full environment, epic scale',
      'gentle handheld camera with natural breathing, intimate realistic mood',
      'fast whip pan into a match cut, sudden reveal, controlled motion blur',
    ],
    applies_to: ['director', 'storyboard', 'prompt_engineer', 'art_director'],
    source: 'VIDO synthesis from AI drama camera-movement research lead, 2026-06-06',
    lang: 'en-zh',
    enabled: true,
  },
  {
    id: 'kb_sb_motion_prompt_quality_gate',
    collection: 'storyboard',
    subcategory: 'Prompt Quality Gate',
    title: 'Motion prompt quality gate for AI video shots',
    summary: 'A preflight checklist for usable video motion prompts: camera first, one action, duration fit, subject lock, continuity, and model constraints.',
    content: `A motion prompt is usable only if it passes these gates:

1. Camera first: camera type, lens or shot scale, and movement appear before mood adjectives.
2. One primary subject: the shot clearly says who or what the model should follow.
3. One primary action: a 3-5 second shot should not contain multiple story events.
4. Physical verbs: use visible verbs like turns, reaches, walks, lifts, opens, points, stops.
5. Duration fit: intense action 2-3s, normal action 3-5s, emotional hold 5-8s.
6. Continuity anchor: repeat character identity, wardrobe, product, location, and color palette when cross-shot consistency matters.
7. Negative constraints are rewritten positively where possible: use "empty background" instead of "no people".
8. Model fit: Seedance prefers simple single-action shots; Kling benefits from precise action mechanics; Veo/Sora can use audio and DOP-style notes; image models need static composition before motion.
9. QA-ready: the prompt states what must be visible so visual QA can judge the same contract.

If any gate fails, rewrite before spending image or video generation quota.`,
    tags: ['motion prompt', 'quality gate', 'video generation', 'prompt QA'],
    keywords: ['camera first', 'one action per shot', 'continuity anchor', 'model fit', 'visual QA'],
    prompt_snippets: [
      'Rewrite this shot as camera first, one subject, one visible action, one continuity anchor, and one mood.',
      'Check this motion prompt for camera-first order, duration fit, subject lock, model fit, and QA-visible requirements.',
    ],
    applies_to: ['director', 'storyboard', 'prompt_engineer', 'test_engineer'],
    source: 'VIDO prompt QA synthesis, 2026-06-06',
    lang: 'en-zh',
    enabled: true,
  },
  {
    id: 'kb_prompt_model_fit_matrix',
    collection: 'storyboard',
    subcategory: 'Model Fit Matrix',
    title: 'Prompt model-fit matrix for AI video and image generation',
    summary: 'Match prompt structure to Seedance, Kling, Sora, Veo, image generation, and storyboard-sheet planning stages.',
    content: `Prompt format should match the generation stage and model family.

Seedance:
- Best for concise multi-shot story flow.
- Use one action per shot, strong subject lock, and simple camera movement.

Kling:
- Best when action mechanics are explicit.
- Describe body movement, object interaction, speed, direction, and camera follow.

Sora / Veo style models:
- Best with cinematographer notes.
- Use Camera -> Subject -> Action -> Environment -> Audio -> Style.
- Audio and scene extension can be described when supported.

Image generation / keyframe:
- Best with static composition and visible evidence.
- Use subject identity, wardrobe, product, scene, lighting, composition, and style.
- Do not ask image models to perform long motion.

Storyboard-sheet planning:
- Best with readable shot table, composition notes, action beats, dialogue/VO, and continuity anchors.
- It should not be blocked by final keyframe QA. Planning sheet review comes before expensive final frame/video generation.`,
    tags: ['model fit', 'Seedance', 'Kling', 'Sora', 'Veo', 'storyboard sheet'],
    keywords: ['seedance prompt', 'kling prompt', 'sora prompt', 'veo prompt', 'image prompt', 'storyboard planning'],
    prompt_snippets: [
      'For Seedance: one shot, one action, one emotion, clear subject, concise camera movement.',
      'For Kling: explicit physical action, direction, speed, object interaction, and camera follow.',
      'For Sora/Veo: Camera -> Subject -> Action -> Environment -> Audio -> Style.',
      'For keyframes: static composition, subject identity, product evidence, lighting, scene, style.',
    ],
    applies_to: ['director', 'storyboard', 'prompt_engineer', 'algorithm_engineer'],
    source: 'VIDO model routing and prompt review, 2026-06-06',
    lang: 'en-zh',
    enabled: true,
  },
  {
    id: 'kb_prompt_agent_usage_protocol',
    collection: 'engineering',
    subcategory: 'Agent Learning',
    title: 'Agent protocol for using prompt KB during generation',
    summary: 'How VIDO agents should retrieve, apply, and verify prompt knowledge instead of relying on fixed generic prompts.',
    content: `Agents should use prompt KB as active working memory.

Screenwriter:
- Retrieve hook, reversal, dialogue, and pacing docs before writing script beats.

Director:
- Retrieve camera movement, composition, lighting, and model-fit docs before generating storyboard plans.

Storyboard agent:
- Retrieve motion taxonomy and prompt quality gates before writing per-shot visual prompts.

Prompt engineer:
- Retrieve prompt library intake, model-fit matrix, and quality gate docs before improving prompts.

QA / test engineer:
- Retrieve motion prompt quality gate and visual contract docs before deciding whether a generation failure is prompt, model, quota, or QA mismatch.

Project assistant:
- When the user provides external prompt references, first create a source review, then convert useful structures into VIDO-owned KB entries, then verify with searchForAgent preview.

Do not assume learning happened because a report exists. Learning happens when the knowledge is in KB, enabled, mapped to applies_to agents, and retrievable by agent query.`,
    tags: ['agent learning', 'prompt KB', 'RAG', 'usage protocol'],
    keywords: ['agent learning', 'searchForAgent', 'prompt engineer', 'director', 'storyboard agent', 'project assistant'],
    prompt_snippets: [
      'Before writing storyboard prompts, retrieve camera movement taxonomy + model-fit matrix + motion quality gate.',
      'After adding external prompt knowledge, verify it with searchForAgent for director, storyboard, and prompt_engineer.',
    ],
    applies_to: ['project_assistant', 'screenwriter', 'director', 'storyboard', 'prompt_engineer', 'test_engineer'],
    source: 'VIDO agent learning protocol, 2026-06-06',
    lang: 'en-zh',
    enabled: true,
  },
];
