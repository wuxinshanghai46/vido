#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const isolatedOutputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vido-structured-output-'));
process.env.OUTPUT_DIR = isolatedOutputDir;
process.env.DB_ENABLED = 'false';

const adapters = require('../src/services/newStoryAd/providerAdapterRegistry');
const modelGateway = require('../src/services/newStoryAd/modelGateway');
const semanticContracts = require('../src/services/newStoryAd/referenceSemanticContractPromptService');

function completion(content = '{}') {
  return {
    choices: [{ message: { content }, finish_reason: 'stop' }],
    usage: { completion_tokens: 4 },
  };
}

function clientFrom(handler) {
  return { chat: { completions: { create: handler } } };
}

function compatibleConfig(overrides = {}) {
  return {
    family: 'openai-compatible',
    providerId: 'test-provider',
    modelId: 'test-model',
    apiKey: 'test-key',
    baseURL: 'https://provider.invalid/v1',
    provider: {},
    providerModel: {},
    ...overrides,
  };
}

async function testJsonSchemaPayload() {
  const payloads = [];
  const schema = {
    type: 'object',
    additionalProperties: false,
    required: ['ok'],
    properties: { ok: { type: 'boolean' } },
  };
  const result = await adapters.callOpenAICompatible(compatibleConfig({
    providerModel: { capabilities: { structured_output: ['json_schema', 'json_object'] } },
  }), 'system', 'user', {
    structuredOutput: { mode: 'json_schema', name: 'test_schema', schema },
    _client: clientFrom(async payload => {
      payloads.push(payload);
      return completion('{"ok":true}');
    }),
  });

  assert.equal(payloads.length, 1);
  assert.deepEqual(payloads[0].response_format, {
    type: 'json_schema',
    json_schema: { name: 'test_schema', strict: true, schema },
  });
  assert.equal(result.structured_output.applied_mode, 'json_schema');
  assert.equal(result.structured_output.native, true);
  assert.equal(result.structured_output.degraded, false);
}

function testSemanticContractSchemasDescribeBusinessItems() {
  const timeline = semanticContracts.semanticSchema('timeline');
  const cast = semanticContracts.semanticSchema('cast');
  const scenes = semanticContracts.semanticSchema('scenes');
  assert.deepEqual(
    timeline.properties.reference_understanding.properties.causal_chain.items.required,
    ['id', 'range', 'scene_id', 'subject', 'action', 'evidence_refs', 'certainty'],
    '时间线 schema 必须约束每个事件，而不是只声明 object 数组',
  );
  assert.ok(cast.properties.reference_understanding.properties.characters.items.required.includes('narrative_function'));
  assert.deepEqual(
    scenes.properties.reference_understanding.properties.scenes.items.required,
    ['scene_id', 'narrative_function', 'events', 'evidence_refs', 'certainty'],
  );
}

async function testDeyunGeminiJsonObjectDefault() {
  const payloads = [];
  const config = compatibleConfig({
    family: 'deyunai-openai-compatible',
    providerId: 'deyunai',
    modelId: 'gemini-2.5-flash',
  });
  assert.deepEqual(adapters.declaredStructuredOutputModes(config), ['json_object']);
  const result = await adapters.callOpenAICompatible(config, 'system', 'user', {
    structuredOutput: { mode: 'json_object' },
    _client: clientFrom(async payload => {
      payloads.push(payload);
      return completion('{"items":[]}');
    }),
  });
  assert.deepEqual(payloads[0].response_format, { type: 'json_object' });
  assert.match(payloads[0].messages[0].content, /Return JSON only/);
  assert.equal(result.structured_output.applied_mode, 'json_object');
}

async function testUnsupported400FallsBackToPrompt() {
  const payloads = [];
  const config = compatibleConfig({
    family: 'deyunai-openai-compatible',
    providerId: 'deyunai',
    modelId: 'gemini-2.5-pro',
  });
  const result = await adapters.callOpenAICompatible(config, 'system', 'user', {
    structuredOutput: { mode: 'json_object' },
    _client: clientFrom(async payload => {
      payloads.push(payload);
      if (payload.response_format) {
        const error = new Error('HTTP 400: response_format json_object is not supported by this model');
        error.status = 400;
        throw error;
      }
      return completion('{"fallback":true}');
    }),
  });

  assert.equal(payloads.length, 2);
  assert.deepEqual(payloads[0].response_format, { type: 'json_object' });
  assert.equal(Object.prototype.hasOwnProperty.call(payloads[1], 'response_format'), false);
  assert.equal(result.structured_output.applied_mode, 'prompt');
  assert.equal(result.structured_output.degraded, true);
  assert.equal(result.structured_output.attempts[0].code, 'STRUCTURED_OUTPUT_UNSUPPORTED');
  assert.deepEqual(result.structured_output.attempts.map(item => item.status), ['failed', 'success']);
}

async function testNonJsonDiagnosticsAndPlainTextCompatibility() {
  const candidates = [{ provider_id: 'fake', model_id: 'fake-model', priority: 1, enabled: true }];
  const wrapped = await modelGateway.generateText({
    taskId: 'structured-output-wrapped-json',
    stage: 'new_story_ad.reference_video_synthesis',
    systemPrompt: 'Return data',
    userPrompt: 'test',
    structuredOutput: { mode: 'json_object' },
    _candidateModels: candidates,
    _generateText: async () => ({
      text: '分析结果如下：\n{"cast":[],"scenes":[],}\n以上为结构化结果。',
      structured_output: {
        requested_mode: 'json_object', applied_mode: 'prompt', native: false, degraded: true,
      },
    }),
  });
  assert.deepEqual(wrapped.parsed_json, { cast: [], scenes: [] }, '解释文字包裹及尾逗号必须先在本地修复，不追加模型调用');

  await assert.rejects(
    modelGateway.generateText({
      taskId: 'structured-output-invalid-json',
      stage: 'new_story_ad.qa',
      systemPrompt: 'Return data',
      userPrompt: 'test',
      structuredOutput: { mode: 'json_object' },
      _candidateModels: candidates,
      _generateText: async () => ({
        text: 'This is not JSON.',
        structured_output: {
          requested_mode: 'json_object', applied_mode: 'prompt', native: false, degraded: true,
        },
      }),
    }),
    (error) => {
      assert.equal(error.code, 'MODEL_ATTEMPTS_EXHAUSTED');
      assert.equal(error.failed_models.length, 1);
      assert.equal(error.failed_models[0].code, 'PROVIDER_RESPONSE_INVALID');
      assert.equal(error.failed_models[0].response_diagnostics.kind, 'structured_output_response');
      assert.equal(error.failed_models[0].response_diagnostics.requested_mode, 'json_object');
      assert.equal(error.failed_models[0].response_diagnostics.applied_mode, 'prompt');
      assert.match(error.failed_models[0].response_diagnostics.parse_error, /Unexpected token|not valid JSON/i);
      assert.equal(error.failed_models[0].response_diagnostics.response_excerpt, 'This is not JSON.');
      return true;
    },
  );

  const plain = await modelGateway.generateText({
    taskId: 'structured-output-plain-text',
    stage: 'new_story_ad.assist',
    systemPrompt: 'Return prose',
    userPrompt: 'test',
    _candidateModels: candidates,
    _generateText: async () => ({ text: 'ordinary prose remains valid' }),
  });
  assert.equal(plain.text, 'ordinary prose remains valid');
  assert.equal(plain.parsed_json, null);
  assert.equal(plain.structured_output, null);
}

async function main() {
  testSemanticContractSchemasDescribeBusinessItems();
  await testJsonSchemaPayload();
  await testDeyunGeminiJsonObjectDefault();
  await testUnsupported400FallsBackToPrompt();
  await testNonJsonDiagnosticsAndPlainTextCompatibility();
  console.log('new story ad structured output: ok');
}

main()
  .finally(() => fs.rmSync(isolatedOutputDir, { recursive: true, force: true }))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
