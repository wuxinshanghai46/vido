const assert = require('assert');

const deyunai = require('../src/services/deyunaiService');
const videoAdapter = require('../src/services/newStoryAd/videoAdapter');

const succeeded = deyunai.seedanceTaskSnapshot({
  data: {
    id: 'provider-1',
    status: 'succeeded',
    duration: 5,
    output: { video_url: 'https://example.com/video.mp4' },
  },
}, 4);
assert.strictEqual(succeeded.succeeded, true);
assert.strictEqual(succeeded.terminal, true);
assert.strictEqual(succeeded.durationSec, 5);
const failed = deyunai.seedanceTaskSnapshot({ data: { status: 'failed', error: { message: 'provider rejected' } } }, 5);
assert.strictEqual(failed.failed, true);
assert.strictEqual(failed.terminal, true);
assert.strictEqual(failed.message, 'provider rejected');

const expected = { fingerprint: 'lineage-current' };
const model = { provider_id: 'deyunai', model_id: 'doubao-seedance-2-0-260128' };
const active = {
  lifecycle: 'provider_running',
  provider_task_id: 'cgt-existing',
  provider_id: 'deyunai',
  model_id: 'doubao-seedance-2-0-260128',
  lineage_fingerprint: 'lineage-current',
};
assert.strictEqual(videoAdapter.resumableProviderTaskId(active, expected, model), 'cgt-existing');
assert.strictEqual(videoAdapter.resumableProviderTaskId({ ...active, lineage_fingerprint: 'old' }, expected, model), '');
assert.strictEqual(videoAdapter.resumableProviderTaskId({ ...active, error_code: 'PROVIDER_TASK_TERMINAL_FAILED' }, expected, model), '');
assert.strictEqual(videoAdapter.resumableProviderTaskId({ ...active, model_id: 'other-model' }, expected, model), '');
assert.strictEqual(videoAdapter.useSeedanceReferenceAssets({}), false, 'approved keyframe first-frame mode must be the default');
assert.strictEqual(videoAdapter.useSeedanceReferenceAssets({ seedance_input_mode: 'reference_assets' }), true, 'asset-reference mode must require an explicit opt-in');

console.log('NEW_STORY_AD_VIDEO_TASK_RESUME_TEST_OK');
