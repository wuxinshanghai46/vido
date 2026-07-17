#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vido-nsa-compose-transitions-'));
process.env.OUTPUT_DIR = tempDir;

const videoAdapter = require('../src/services/newStoryAd/videoAdapter');
const composeService = require('../src/services/newStoryAd/composeService');

(async () => {
  try {
    const first = path.join(tempDir, 'first.mp4');
    const second = path.join(tempDir, 'second.mp4');
    await videoAdapter.renderLocalClip({ outputPath: first, durationSec: 2, aspectRatio: '16:9' });
    await videoAdapter.renderLocalClip({ outputPath: second, durationSec: 2, aspectRatio: '16:9' });
    const result = await composeService.concatVideos({
      taskId: 'compose-transition-test',
      clips: [
        { shot_index: 0, file_path: first },
        { shot_index: 1, file_path: second },
      ],
      transitions: [
        { transition_type: 'none' },
        { transition_type: 'dissolve', transition_reason: 'authored test transition' },
      ],
    });
    assert.ok(fs.existsSync(result.file_path));
    assert.strictEqual(result.transition_plan[1].execution, 'dissolve');
    assert.strictEqual(result.transition_plan[1].overlap_sec, 0.35);
    assert.match(result.provider_used, /authored-transitions/);
    const duration = await videoAdapter.probeDuration(result.file_path);
    assert(duration > 3.45 && duration < 3.85, `dissolve should overlap the two clips, got ${duration}`);

    const continuousPlan = composeService.buildTransitionPlan([
      { scene_block_id: 'one-source', scene_block_members: [1, 2] },
      { scene_block_id: 'one-source', scene_block_members: [1, 2] },
    ], [{}, { transition_type: 'fade' }], [2, 2]);
    assert.strictEqual(continuousPlan[1].execution, 'continuous_source_cut');
    assert.strictEqual(continuousPlan[1].overlap_sec, 0, 'segments from one continuous provider clip must not be blurred by another transition');
    console.log('new story ad compose transitions: ok');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
