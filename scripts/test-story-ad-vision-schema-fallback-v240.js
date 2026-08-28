#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vido-vision-schema-v240-'));
process.env.OUTPUT_DIR = outputDir;
process.env.DB_ENABLED = '0';
delete process.env.NEW_STORY_AD_MOCK_LLM;

const gateway = require('../src/services/newStoryAd/modelGateway');
const sceneSpace = require('../src/services/newStoryAd/sceneSpaceContractService');

(async () => {
  const invoked = [];
  const result = await gateway.generateVision({
    taskId: 'vision-schema-fallback-v240',
    stage: 'new_story_ad.scene_camera_qa',
    systemPrompt: 'Return JSON only.',
    userPrompt: 'Return {"ok":true}.',
    imageUrls: ['https://test.invalid/reference.png'],
    imageDataUrls: ['data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='],
    maxCandidates: 3,
    stageBudgetMs: 90000,
    _candidateModels: [
      { provider_id: 'deyunai', model_id: 'claude-sonnet-4-6' },
      { provider_id: 'webang-maas', model_id: 'gemini-2.5-flash' },
      { provider_id: 'zhipu', model_id: 'glm-4.6v-flash' },
    ],
    _generateText: async ({ model }) => {
      invoked.push(`${model.provider_id}/${model.model_id}`);
      return { text: model.provider_id === 'deyunai' ? '{"ok":false}' : '{"ok":true}' };
    },
    validateText: text => {
      const parsed = JSON.parse(text);
      if (parsed.ok === true) return true;
      const error = new Error('camera_design_qa.required_scores');
      error.code = 'CAMERA_QA_SCHEMA_INVALID';
      error.missing_fields = ['camera_design_qa.required_scores'];
      throw error;
    },
  });
  assert.deepEqual(invoked, ['deyunai/claude-sonnet-4-6', 'webang-maas/gemini-2.5-flash']);
  assert.equal(result.used_model, 'webang-maas/gemini-2.5-flash');
  assert.equal(result.fallback_used, true);
  assert.equal(result.failed_models[0].code, 'PROVIDER_RESPONSE_INVALID');
  assert.deepEqual(result.failed_models[0].response_diagnostics.issues, ['camera_design_qa.required_scores']);

  const unverified = sceneSpace.buildUnverifiedContract({
    sceneId: 'scene-v240',
    views: ['master', 'reverse', 'interaction', 'detail', 'layout'].map(key => ({ key, url: `/${key}.png` })),
    requested: {},
  }, {
    code: 'VISION_QA_UNAVAILABLE',
    message: 'all candidates failed schema validation',
    candidate_text: '{"camera_design_qa":{"pass":true}}',
    failed_models: [{
      provider_id: 'deyunai',
      model_id: 'claude-sonnet-4-6',
      code: 'PROVIDER_RESPONSE_INVALID',
      message: 'missing camera evidence',
      response_diagnostics: { issues: ['cameras[master,reverse,interaction,detail].structured_evidence'] },
    }],
  });
  assert.match(unverified.qa_response_excerpt, /camera_design_qa/);
  assert.deepEqual(unverified.qa_failed_models[0].schema_issues, ['cameras[master,reverse,interaction,detail].structured_evidence']);

  console.log(JSON.stringify({
    passed: true,
    schema_fallback: invoked,
    persisted_failure_excerpt: true,
    paid_model_calls: 0,
  }));
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  fs.rmSync(outputDir, { recursive: true, force: true });
});
