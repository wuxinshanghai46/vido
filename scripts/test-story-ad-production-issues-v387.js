'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vido-v387-'));
process.env.OUTPUT_DIR = outputDir;
process.env.DB_ENABLED = '0';

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8').replace(/\r\n/g, '\n');
const access = require('../src/services/newStoryAd/taskListAccessService');
const adapters = require('../src/services/newStoryAd/providerAdapterRegistry');
const gateway = require('../src/services/newStoryAd/modelGateway');
const units = require('../src/services/newStoryAd/generationUnitService');

async function main() {
  assert.deepEqual(access.resolveListScope({ id: 'admin-id', role: 'admin' }, {}), {
    user_id: '', scope: 'all_users', is_admin: true,
  }, '超管默认必须查看全部用户任务');
  assert.equal(access.resolveListScope({ id: 'admin-id', role: 'admin' }, { mine: '1' }).user_id, 'admin-id');
  assert.equal(access.resolveListScope({ id: 'user-id', role: 'user' }, { all: '1' }).user_id, 'user-id', '普通用户不能越权查看全量任务');

  let claudePayload;
  await adapters.callOpenAICompatible(
    { family: 'smscrw', providerId: 'smscrw', modelId: 'claude-opus-4-8', apiKey: 'fixture', baseURL: 'https://example.invalid/v1' },
    'system', 'user', {
      maxTokens: 2048,
      temperature: 0.2,
      _client: { chat: { completions: { create: async payload => {
        claudePayload = payload;
        return { choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }], usage: {} };
      } } } },
    },
  );
  assert(!Object.hasOwn(claudePayload, 'temperature'), 'OpenAI-compatible Claude 请求不得发送供应商已弃用的 temperature');
  assert.deepEqual(
    gateway.classifyError(new Error('ValidationException: `temperature` is deprecated for this model.')),
    { code: 'MODEL_REQUEST_PARAMETER_UNSUPPORTED', retryable: true },
    '历史供应商错误必须识别为模型级参数不兼容，而不是未知错误',
  );

  const identity = {
    work_id: 'task-v387', domain: 'blueprint', target_permanent_id: 'task-v387:blueprint',
    operation: 'run_blueprint', input_fingerprint: 'same-content', spec_revision: 1,
    provider_id: 'internal-orchestrator', model_id: 'release-v387',
  };
  const first = units.claim(identity);
  const queued = units.transition(first.unit.id, 'queued', {}, { expected_version: first.unit.unit_version });
  const running = units.transition(queued.id, 'running', {
    billing_state: 'confirmed', provider_submission_state: 'submitted',
  }, { expected_version: queued.unit_version });
  const unknown = units.transition(running.id, 'billing_unknown', {
    billing_state: 'unknown', provider_submission_state: 'submitted_unknown', error_code: 'TIMEOUT_OR_NETWORK',
  }, { expected_version: running.unit_version });
  assert.throws(() => units.claim(identity, { explicit_user_retry: true }), error => error.code === 'GENERATION_BILLING_REVIEW_REQUIRED');
  const retry = units.claim(identity, {
    explicit_user_retry: true,
    allow_unacknowledged_billing_unknown_retry: true,
  });
  assert.equal(retry.claimed, true, '明确允许的文本阶段用户主动重试不再要求费用确认');
  assert.equal(retry.unit.explicit_user_retry_of, unknown.id, '旧未知计费记录仍须保留并关联，不能覆盖审计证据');

  const route = read('src/routes/newStoryAd.js');
  assert.match(route, /'blueprint',[\s\S]{0,300}allowUnacknowledgedBillingUnknownRetry: true/);
  assert.match(route, /'script_package',[\s\S]{0,400}allowUnacknowledgedBillingUnknownRetry: true/);
  const assetView = read('public/story-ad/views/assetCenterView.js');
  assert.match(assetView, /data-verify-person=/, '未验证人物必须有可执行的重新验证入口');
  assert.match(assetView, /\/person-verify/, '重新验证入口必须调用真实服务端验证接口');

  console.log(JSON.stringify({
    passed: true,
    admin_default_scope: 'all_users',
    ordinary_user_isolation: true,
    claude_temperature_omitted: true,
    parameter_error_classified: true,
    text_explicit_retry_without_confirmation: true,
    automatic_retry_after_unknown_billing: 0,
    person_reverify_action: true,
    paid_model_calls: 0,
  }));
}

main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  fs.rmSync(outputDir, { recursive: true, force: true });
});
