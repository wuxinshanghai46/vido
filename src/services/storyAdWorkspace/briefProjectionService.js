'use strict';

const productAssetResolver = require('../newStoryAd/productAssetResolverService');
const benchmarkStrategy = require('../newStoryAd/benchmarkStrategyService');
const multilineTextContract = require('../newStoryAd/multilineTextContractService');
const briefDialogueHistory = require('../newStoryAd/briefDialogueHistoryService');

function project(context = {}, task = {}, clean = value => String(value || '').trim(), options = {}) {
  const castIntent = briefDialogueHistory.normalizeCastIntent(context.brief_intake?.cast_intent || context.cast_intent);
  const projectedCastMode = castIntent.background_people ? 'single' : clean(context.cast_mode || context.person_spec?.castMode || 'auto', 40);
  const projectedPeople = castIntent.background_people ? 1 : Math.max(0, Number(context.expected_people || 0) || 0);
  const presentation = options.includeAssetPresentation === false
    ? { mode: String(context.content_mode || ''), subject: null }
    : productAssetResolver.productPresentation(context);
  return {
    project_name: clean(context.project_name || task.title, 120),
    text: multilineTextContract.normalize(context.brief || task.brief, 5000),
    text_contract: multilineTextContract.metrics(context.brief || task.brief),
    text_versions: multilineTextContract.versions(context.brief_versions, context.brief || task.brief),
    product_subject: clean(context.product_subject, 200),
    product_presentation: presentation,
    content_mode: clean(context.content_mode || (presentation.mode === 'narrative_story' ? 'narrative_story' : 'commercial_subject'), 40),
    content_mode_source: clean(context.content_mode_source || '', 40),
    content_domain_contract: context.content_domain_contract || null,
    content_mode_migration: context.content_mode_migration || null,
    target_duration: Number(context.target_duration || context.duration || 0) || 0,
    output_ratio: clean(context.output_ratio || '9:16', 20),
    output_size: clean(context.output_size || 'standard', 30),
    video_resolution: clean(context.video_resolution || '480p', 30),
    video_quality: clean(context.video_quality || 'final', 30),
    cast_mode: projectedCastMode,
    expected_people: projectedPeople,
    expected_animals: Math.max(0, Number(context.expected_animals || 0) || 0),
    brief_source: clean(context.brief_source, 40),
    brief_intake: {
      creative_brief_confirmed: context.brief_intake?.creative_brief_confirmed === true,
      specifications_confirmed: context.brief_intake?.specifications_confirmed === true,
      reference_decision: ['attached', 'skipped'].includes(clean(context.brief_intake?.reference_decision, 20))
        ? clean(context.brief_intake?.reference_decision, 20) : '',
      completed_dialogue_topics: [...new Set((Array.isArray(context.brief_intake?.completed_dialogue_topics)
        ? context.brief_intake.completed_dialogue_topics : []).map(value => clean(value, 40)).filter(Boolean))].slice(0, 20),
      active_dialogue_topic: clean(context.brief_intake?.active_dialogue_topic, 40),
      dialogue_history: briefDialogueHistory.normalizeHistory(context.brief_intake?.dialogue_history),
      cast_intent: castIntent,
    },
    asset_setup_confirmed: context.asset_setup_confirmed === true,
    scene_setup_confirmed: context.scene_setup_confirmed === true,
    shot_design_confirmed: context.shot_design_confirmed === true,
    creative_direction: context.creative_direction || null,
    benchmark_strategy: benchmarkStrategy.resolve({ ...context, product_presentation: presentation }),
    world_setting: context.world_setting || null,
  };
}

module.exports = { project };
