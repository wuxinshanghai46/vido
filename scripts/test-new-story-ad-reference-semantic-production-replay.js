#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const fixturePath = process.argv[2] || process.env.VIDO_REFERENCE_ANALYSIS_FIXTURE || '';
if (!fixturePath || !fs.existsSync(fixturePath)) {
  throw new Error('请传入脱离仓库保存的生产参考分析夹具路径。');
}

const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vido-reference-semantic-replay-'));
process.env.OUTPUT_DIR = outputDir;
process.env.DB_ENABLED = 'false';
process.env.NEW_STORY_AD_MOCK_LLM = '0';

const analysisService = require('../src/services/newStoryAd/referenceVideoAnalysisService');
const modelGateway = require('../src/services/newStoryAd/modelGateway');

function promptJson(prompt = '', label = '') {
  const line = String(prompt).split('\n').find(item => item.startsWith(label));
  if (!line) return {};
  return JSON.parse(line.slice(label.length));
}

function castPatch(evidence = {}) {
  const frameIds = (evidence.evidence_frames || []).map(item => item.frame_id).filter(Boolean);
  const actions = evidence.character_actions || [];
  const characters = (evidence.character_prompts || []).map((item, index) => {
    const related = actions.filter(action => (
      action.character_id === item.id || action.subject_id === item.id || action.person_id === item.id
    ));
    const refs = [...new Set(related.flatMap(action => action.evidence_refs || []))];
    return {
      character_id: item.id || `character_prompt_${index + 1}`,
      role: `持续叙事人物 ${index + 1}`,
      narrative_function: '在对应证据镜头中完成可见动作并推动体验过程向结果发展',
      initial_state: '进入当前证据覆盖的叙事阶段',
      final_state: '完成当前证据可确认的动作与状态变化',
      evidence_refs: refs.length ? refs : frameIds.slice(index, index + 1),
      certainty: 'fact',
    };
  });
  return {
    character_prompts: evidence.character_prompts || [],
    character_actions: actions,
    animal_prompts: evidence.animal_prompts || [],
    animal_actions: evidence.animal_actions || [],
    reference_understanding: { characters },
  };
}

function scenePatch(evidence = {}, accepted = {}) {
  const chain = accepted.reference_understanding?.causal_chain || [];
  const scenes = (evidence.scene_prompts || []).map((item, index) => {
    const events = chain.filter(event => event.scene_id === item.id);
    return {
      scene_id: item.id,
      narrative_function: `${item.location_type || `物理空间 ${index + 1}`}承载对应人物、商品或环境的可见事件与状态变化`,
      events: events.map(event => event.id),
      state_change: events.map(event => event.result || event.action).filter(Boolean).slice(0, 4).join('；'),
      evidence_refs: [...new Set(events.flatMap(event => event.evidence_refs || []))],
      certainty: 'fact',
    };
  });
  return { reference_understanding: { scenes } };
}

function timelinePatch(evidence = {}) {
  const frames = evidence.evidence_frames || [];
  const chain = (evidence.shot_breakdown || []).map((shot, index) => {
    const refs = frames.filter(frame => (
      Number(frame.timestamp_seconds) >= Number(shot.range?.[0] || 0)
      && Number(frame.timestamp_seconds) <= Number(shot.range?.[1] || 0)
    )).map(frame => frame.frame_id).filter(Boolean);
    return {
      id: `event_${index + 1}`,
      range: shot.range,
      scene_id: shot.scene_id,
      subject: (shot.subject_ids || [])[0] || '画面主体',
      action: shot.action || shot.visual || `完成第 ${index + 1} 个可见事件`,
      motivation: '',
      result: `完成第 ${index + 1} 段可见状态变化`,
      caused_by: null,
      leads_to: null,
      evidence_refs: refs.length ? refs : frames.slice(index, index + 1).map(frame => frame.frame_id),
      certainty: 'fact',
    };
  });
  return {
    plot_beats: evidence.plot_beats || [],
    reference_understanding: {
      causal_chain: chain,
      facts: chain.map((event, index) => ({ id: `fact_${index + 1}`, claim: `${event.subject}${event.action}`, evidence_refs: event.evidence_refs })),
      inferences: [],
      unknowns: [],
    },
  };
}

async function main() {
  const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  assert.equal(fixture._visual_evidence_cache?.batches?.length, 8, '生产夹具必须保留8批已完成镜头证据');
  assert.deepStrictEqual(
    fixture._semantic_checkpoint?.best_candidate?.audit?.failures,
    ['character_semantics_incomplete', 'scene_semantics_incomplete'],
  );
  const record = {
    ...fixture,
    id: 'production-semantic-replay',
    user_id: 'replay-user',
    task_id: '',
    source: {
      ...fixture.source,
      input_url: '', display_url: '', local_path: '', private_directory: '',
    },
  };
  const calls = [];
  const originalGenerateText = modelGateway.generateText;
  modelGateway.generateText = async (options = {}) => {
    assert.equal(options.stage, 'new_story_ad.reference_video_synthesis');
    const contract = String(options.structuredOutput?.name || '').replace(/^reference_|_contract$/g, '');
    calls.push(contract);
    const evidence = promptJson(options.userPrompt, '当前合同证据：');
    const accepted = promptJson(options.userPrompt, '已通过且禁止改写的其他合同：');
    const validPatch = contract === 'cast'
      ? castPatch(evidence)
      : (contract === 'timeline' ? timelinePatch(evidence) : scenePatch(evidence, accepted));
    const failedModels = [];
    if (contract === 'cast') {
      const flashPatch = {
        character_prompts: [], character_actions: [], animal_prompts: [], animal_actions: [],
        reference_understanding: { characters: [] },
      };
      await assert.rejects(
        options.validateText(JSON.stringify(flashPatch), {
          model: { provider_id: 'deyunai', model_id: 'gemini-2.5-flash' },
          candidate_index: 0,
          parsed_json: flashPatch,
        }),
        error => error.code === 'PROVIDER_RESPONSE_INVALID',
      );
      failedModels.push({
        provider_id: 'deyunai', model_id: 'gemini-2.5-flash', code: 'PROVIDER_RESPONSE_INVALID',
        message: '定向语义修复仍缺少合同：cast', response_diagnostics: { contract: 'cast' },
      }, {
        provider_id: 'deyunai', model_id: 'gemini-2.5-pro', code: 'PROVIDER_RESPONSE_INVALID',
        message: '3212字符响应不是JSON', response_diagnostics: { response_length: 3212, json_like: false },
      });
    }
    await options.validateText(JSON.stringify(validPatch), {
      model: { provider_id: 'openai', model_id: 'gpt-4o' },
      candidate_index: failedModels.length,
      parsed_json: validPatch,
    });
    return {
      text: JSON.stringify(validPatch),
      used_model: 'openai/gpt-4o',
      failed_models: failedModels,
    };
  };
  try {
    const result = await analysisService._private.synthesizeAnalysisFromEvidence(
      record,
      fixture._visual_evidence_cache.batches,
      fixture.transcript || { status: 'no_audio', text: '', segments: [] },
    );
    assert.equal(result.reference_understanding?.completeness?.valid, true, JSON.stringify(result.reference_understanding?.completeness));
    assert.deepStrictEqual(calls, ['cast', 'timeline'], '人物与场景事件映射补齐后应由确定性场景投影收敛，不得重复调用场景或镜头模型');
    const saved = analysisService._private.readRecord('replay-user', 'production-semantic-replay');
    assert.equal(saved._visual_evidence_cache?.batches?.length, 8, '已完成的8批画面证据必须原样保留');
    const progress = require('../src/services/newStoryAd/referenceSemanticRecoveryService').publicProgress(saved._semantic_checkpoint);
    assert.equal(progress.completed, 5);
    assert.equal(progress.valid, true);
    assert.ok(saved._semantic_checkpoint.attempt_summaries.some(item => item.model === 'deyunai/gemini-2.5-pro'));
    console.log(JSON.stringify({ passed: true, evidence_batches_recalled: 0, semantic_calls: calls.length, completed_contracts: progress.completed }));
  } finally {
    modelGateway.generateText = originalGenerateText;
  }
}

main()
  .finally(() => fs.rmSync(outputDir, { recursive: true, force: true }))
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
