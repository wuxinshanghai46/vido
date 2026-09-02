#!/usr/bin/env node
'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.OUTPUT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'vido-v391-'));
process.env.DB_ENABLED = '0';

const root = path.resolve(__dirname, '..');
const gateway = require('../src/services/newStoryAd/modelGateway');
const adapters = require('../src/services/newStoryAd/providerAdapterRegistry');
const storage = require('../src/services/newStoryAd/storageService');
const lifecycle = require('../src/services/newStoryAd/personAssetLifecycleService');
const flow = require('../src/services/newStoryAd/storyboardFlowConsistencyService');

const verifiedContract = {
  status: 'verified', verification: { state: 'verified' }, cross_view_qa: { pass: true },
  member_contracts: [{ status: 'verified', verification: { state: 'verified' }, cross_view_qa: { pass: true } }],
};
const personBundle = contract => ({
  counts: { mode: 'single' },
  cast_assets: [{
    id: 'candidate-1', actor_id: 'candidate-1', actor_asset_id: 'candidate-1', name: '通用人物',
    image_url: '/front.png', view_images: [{ key: 'front', image_url: '/front.png' }],
    subject_profile: { id: 'person-1', displayName: '通用人物', roleName: '主角' },
    person_contract: contract.member_contracts?.[0] || contract,
  }],
  pet_profiles: [], person_contract: contract,
});

(async () => {
  try {
    const candidates = ['vendor-a', 'vendor-b', 'vendor-c'].map((provider_id, index) => ({
      provider_id, model_id: `text-${index + 1}`, endpoint: `https://${provider_id}.example/v1`, wallet: provider_id,
    }));
    const attempted = [];
    const fallback = await gateway.generateText({
      taskId: 'new-task-text-chain', stage: 'new_story_ad.asset_plan', systemPrompt: 'system', userPrompt: 'user',
      _candidateModels: candidates,
      _generateText: async ({ model }) => {
        attempted.push(model.provider_id);
        if (model.provider_id === 'vendor-a') throw Object.assign(new Error('upstream rejected'), { code: 'AUTH_CONFIG' });
        if (model.provider_id === 'vendor-b') throw Object.assign(new Error('socket timeout'), { code: 'TIMEOUT_OR_NETWORK' });
        return { text: '{"ok":true}', provider_request_id: 'vendor-c-success' };
      },
    });
    assert.deepEqual(attempted, ['vendor-a', 'vendor-b', 'vendor-c']);
    assert.equal(fallback.used_model, 'vendor-c/text-3');
    assert.equal(fallback.fallback_used, true);
    assert.equal(fallback.failed_models[1].billing_state, 'unknown');
    assert.equal(storage.getTaskBundle('new-task-text-chain').model_calls.length, 3);

    const claudePayloads = [];
    const client = { chat: { completions: { create: async payload => {
      claudePayloads.push(payload);
      return { choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }], usage: {} };
    } } } };
    const claudeConfig = { modelId: 'claude-opus-4-8', providerId: 'proxy', family: 'openai-compatible', apiKey: 'test-only', provider: {}, providerModel: {} };
    await adapters.callOpenAICompatible(claudeConfig, 'system', 'user', { temperature: 0.3, _client: client });
    assert.equal(Object.hasOwn(claudePayloads[0], 'temperature'), false);
    const declaredPayloads = [];
    await adapters.callOpenAICompatible({
      ...claudeConfig, providerModel: { capabilities: { temperature: true } },
    }, 'system', 'user', { temperature: 0.25, _client: { chat: { completions: { create: async payload => {
      declaredPayloads.push(payload);
      return { choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }], usage: {} };
    } } } } });
    assert.equal(declaredPayloads[0].temperature, 0.25);

    storage.createTask({ id: 'new-task-person', title: '通用人物门禁', request: { cast_profiles: [] }, status: 'draft' });
    storage.saveOutput('new-task-person', 'context', { cast_profiles: [], revisions: { person: 1 } });
    storage.saveOutput('new-task-person', 'blueprint', { title: 'must remain' });
    const rejected = {
      status: 'rejected', verification: { state: 'rejected', reasons: ['年龄不一致'] }, cross_view_qa: { pass: false, mismatch_reasons: ['年龄不一致'] },
      member_contracts: [{ status: 'rejected', verification: { state: 'rejected' }, cross_view_qa: { pass: false } }],
    };
    assert.throws(() => lifecycle.commitGeneratedSubjectAssets('new-task-person', personBundle(rejected), {}), error => error.code === 'PERSON_ASSET_QA_REJECTED');
    assert.equal(storage.getOutput('new-task-person', 'context').person_asset, undefined);
    assert.equal(storage.getOutput('new-task-person', 'blueprint').title, 'must remain');
    const committed = lifecycle.commitGeneratedSubjectAssets('new-task-person', personBundle(verifiedContract), {});
    assert.equal(committed.person_contract.status, 'verified');
    assert.equal(storage.getOutput('new-task-person', 'context').person_asset.production_usable_actor, true);

    const contract = {
      contract_fingerprint: 'current-flow-fingerprint',
      units: [
        { beat_id: 'beat-1', scene_id: 'scene-a' },
        { beat_id: 'beat-2', scene_id: 'scene-b' },
      ],
    };
    const oldShots = [
      { index: 1, source_beat_id: 'beat-1', scene_id: 'scene-b', story_flow_contract_fingerprint: 'old' },
      { index: 2, source_beat_id: 'beat-2', scene_id: 'scene-a', story_flow_contract_fingerprint: 'old' },
    ];
    const rebased = flow.rebaseWhenPresent(oldShots, contract, { boundary: 'test' });
    assert.equal(rebased.changed, true);
    assert.equal(flow.assertMatches(rebased.shots, contract).ok, true);
    assert.deepEqual(rebased.shots.map(shot => shot.scene_id), ['scene-a', 'scene-b']);
    assert.throws(() => flow.rebaseWhenPresent([{ source_beat_id: 'missing' }], contract), error => error.code === 'STORYBOARD_FLOW_REBASE_UNSAFE');

    const planning = fs.readFileSync(path.join(root, 'public/story-ad/views/assetCenterPlanningDetails.js'), 'utf8');
    const assetView = fs.readFileSync(path.join(root, 'public/story-ad/views/assetCenterView.js'), 'utf8');
    const library = fs.readFileSync(path.join(root, 'public/story-ad/views/assetCenterPersonSources.js'), 'utf8');
    const css = fs.readFileSync(path.join(root, 'public/story-ad/character-library.css'), 'utf8');
    assert.match(assetView, /initialPersonTab: group === 'people' \? 'images'/);
    assert.match(planning, /if \(!initialPersonTab && rememberedPersonTab\)/);
    assert.match(planning, />人物视图<\/button>/);
    assert.match(library, /data-toggle-actor-library-details/);
    assert.match(library, /bindMediaLightbox\(modal\.body\)/);
    assert.match(css, /object-fit:contain/);
    assert.doesNotMatch(css, /grid-template-columns:\.82fr \.82fr 1\.35fr 1\.9fr/);

    console.log(JSON.stringify({
      passed: true,
      new_task_text_providers_attempted: attempted,
      claude_proxy_temperature_omitted: true,
      rejected_person_authority_commits: 0,
      verified_person_authority_commits: 1,
      old_storyboard_rebased_without_model_calls: true,
      invalid_storyboard_rebase_rejected: true,
      person_views_default_tab: 'images',
      person_library_images: 'contain',
    }, null, 2));
  } finally {
    fs.rmSync(process.env.OUTPUT_DIR, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
