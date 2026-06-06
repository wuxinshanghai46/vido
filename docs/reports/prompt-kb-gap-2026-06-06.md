# Prompt KB Gap Review - 2026-06-06

## Context

User provided two external references for evaluating whether VIDO should enrich its knowledge base:

- Prompt123: https://prompt123.cn/
- Douyin short-link reference: "75个AI漫剧高级运镜类型汇总" by 灵创AI漫剧, shared via https://v.douyin.com/WEdB-Q9zxSo/

Scope for this review is local-only. No Git push or server deployment was performed.

## Findings

### 1. Prompt123 is useful as a taxonomy/reference source

Prompt123 publicly presents itself as a Chinese AI prompt library covering:

- DeepSeek / Kimi and general Chinese prompt templates
- Xiaohongshu, short video, AI writing, meeting notes, AI programming, papers, translation, data analysis
- AI drawing prompts
- A linked video prompt section at https://vlogprompt.com/

This is relevant to VIDO, but should not be copied wholesale. The better use is to extract taxonomy, prompt structure patterns, quality criteria, and import workflow ideas.

### 2. VIDO already has prompt knowledge, but it is not yet operated like a prompt library

Current local KB has 227 documents in `outputs/knowledge_base.json`. Relevant built-in seed modules include:

- `src/services/seeds/storyboard.js`
- `src/services/seeds/vido_premium_prompts.js`
- `src/services/seeds/production.js`
- `src/services/seeds/engineering.js`

Local query found 72 docs related to prompts, camera movement, storyboard, AI drawing, short video, and Seedance. Examples:

- `kb_sb_seedance_multishot`
- `kb_sb_veo3_5part_formula`
- `kb_sb_v2_sora2_schema`
- `kb_sb_v2_veo31_cinematographer`
- `kb_sb_v2_kling21_camera`
- `kb_sb_v3_handheld_vs_stable`
- `kb_vidopremium_t2v_7part_industry`
- `kb_vidopremium_action_3shot_combo`

So the issue is not "no prompt knowledge". The issue is that VIDO does not yet have enough structured prompt-library operations:

- No clear source intake pipeline for public prompt websites.
- No scoring fields for prompt quality, model fit, business fit, and verification status.
- No dedicated motion/camera taxonomy table for AI drama and story ads.
- Agent retrieval is keyword-based and may miss semantically related prompt entries.
- Prompt entries are mixed across storyboard, atmosphere, production, and premium prompt seeds, which makes discovery inconsistent.

### 3. Douyin motion-prompt content should be abstracted into a camera taxonomy

The Douyin reference appears to be a curated list of "75 AI manga-drama advanced camera movement types". Public access to the full text is unstable, so this should be treated as a lead for manual review rather than a crawl source.

Recommended KB treatment:

- Create a "camera movement taxonomy" KB family, not a single long copied list.
- Each entry should contain:
  - Chinese name
  - English prompt phrase
  - movement mechanics
  - emotional purpose
  - best scene type
  - model compatibility notes
  - avoid/negative constraints
  - 1-2 short reusable prompt snippets

Priority categories:

- Push / pull: push-in, pull-back, dolly-in, dolly-out.
- Track / follow: side tracking, follow shot, lead shot.
- Orbit / arc: 180 orbit, 360 orbit, parallax orbit.
- Crane / boom: rise, descend, reveal, overhead.
- Handheld / shake: subtle handheld, active handheld, panic shake.
- Whip / snap: whip pan, crash zoom, snap zoom.
- POV / subjective: first-person, over-shoulder, eye-line reveal.
- Transition motion: match movement, object wipe, speed ramp, rack focus reveal.
- Manga-specific motion: panel reveal, speed-line burst, impact cut, parallax layer drift.

## Recommendation

Yes, VIDO should supplement the KB, but the supplement should be "learned and structured", not direct copying.

### Phase 1: local KB additions

Add 3-5 local KB docs:

1. `kb_prompt_library_intake_method`
   - How to evaluate and import public prompt examples into VIDO safely.

2. `kb_sb_camera_movement_taxonomy_ai_drama`
   - Advanced AI drama camera movement taxonomy.

3. `kb_sb_motion_prompt_quality_gate`
   - What makes a motion prompt usable: one subject, one action, camera first, duration, continuity, model-specific constraints.

4. `kb_prompt_model_fit_matrix`
   - Match prompt forms to Seedance, Kling, Sora, Veo, image models.

5. `kb_prompt_agent_usage_protocol`
   - How screenwriter/director/storyboard/prompt_engineer agents should retrieve and apply prompt KB.

### Phase 2: product workflow

Add an admin-side "prompt source import" workflow:

- Source URL / pasted content
- Extract categories
- Deduplicate against existing KB
- Score quality
- Convert to VIDO KB schema
- Mark as draft until reviewed

### Phase 3: retrieval upgrade

Upgrade or augment `knowledgeBaseService.searchForAgent`:

- Add synonym expansion for Chinese camera terms.
- Add collection/subcategory boosts for `storyboard` and `atmosphere`.
- Add optional prompt-quality tags such as `verified`, `motion`, `character-lock`, `commercial-realism`.

## Immediate Conclusion

The user's concern is valid. VIDO's prompts are not empty, but they are currently too static and too seed-file-oriented. Prompt123 and the Douyin camera-movement lead should be used to build a living prompt KB and a dedicated AI drama camera movement taxonomy, especially for story ads and storyboard generation.
