const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  parseCombinedSelection,
  resolveStageSelection,
  serializeSelection,
} = require('../src/services/pipelineSelectionService');

function main() {
  assert.deepStrictEqual(parseCombinedSelection('provider-a::model-a'), {
    provider_id: 'provider-a',
    model_id: 'model-a',
  });
  assert.strictEqual(parseCombinedSelection('auto'), null);

  const explicit = resolveStageSelection('imggen.i2v', {
    providerId: 'chosen-provider',
    modelId: 'chosen-model',
  });
  assert.strictEqual(explicit.source, 'business_input');
  assert.strictEqual(serializeSelection(explicit), 'chosen-provider::chosen-model');

  for (const stageId of ['imggen.i2v', 'drama.scene_image', 'drama.video_clip']) {
    const selected = resolveStageSelection(stageId);
    assert.ok(selected, `${stageId} must resolve from current pipeline management`);
    assert.ok(selected.provider_id);
    assert.ok(selected.model_id);
    assert.ok(['pipeline_config', 'pipeline_default'].includes(selected.source));
  }

  const root = path.join(__dirname, '..');
  const i2v = fs.readFileSync(path.join(root, 'src/routes/i2v.js'), 'utf8');
  const drama = fs.readFileSync(path.join(root, 'src/routes/drama.js'), 'utf8');
  assert.match(i2v, /resolveStageSelection\('imggen\.i2v'/);
  assert.match(drama, /resolveStageSelection\('drama\.scene_image'/);
  assert.ok((drama.match(/resolveStageSelection\('drama\.video_clip'/g) || []).length >= 2);
  assert.doesNotMatch(i2v, /请选择视频模型/);

  console.log('pipeline stage selection tests passed: 3 previously disconnected stages are now routed');
}

main();
