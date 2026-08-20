'use strict';

const productAssetResolver = require('../newStoryAd/productAssetResolverService');
const benchmarkStrategy = require('../newStoryAd/benchmarkStrategyService');
const multilineTextContract = require('../newStoryAd/multilineTextContractService');

function project(context = {}, task = {}, clean = value => String(value || '').trim(), options = {}) {
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
    video_resolution: clean(context.video_resolution || '1080p', 30),
    video_quality: clean(context.video_quality || 'final', 30),
    cast_mode: clean(context.cast_mode || context.person_spec?.castMode || 'auto', 40),
    expected_people: Math.max(0, Number(context.expected_people || 0) || 0),
    expected_animals: Math.max(0, Number(context.expected_animals || 0) || 0),
    brief_source: clean(context.brief_source, 40),
    asset_setup_confirmed: context.asset_setup_confirmed === true,
    shot_design_confirmed: context.shot_design_confirmed === true,
    creative_direction: context.creative_direction || null,
    benchmark_strategy: benchmarkStrategy.resolve({ ...context, product_presentation: presentation }),
    world_setting: context.world_setting || null,
  };
}

module.exports = { project };
