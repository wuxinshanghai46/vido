'use strict';

const assert = require('assert');
const media = require('../src/services/newStoryAd/mediaCatalogService');

const outputs = {
  keyframes: Array.from({ length: 1000 }, (_, index) => ({
    id: `frame-${index + 1}`,
    image_url: `/api/new-story-ad/assets/frame-${index + 1}.png`,
    status: 'ready',
  })),
  video_clips: Array.from({ length: 500 }, (_, index) => ({
    id: `clip-${index + 1}`,
    video_url: `/api/new-story-ad/assets/clip-${index + 1}.mp4`,
    poster_url: `/api/new-story-ad/assets/clip-${index + 1}.jpg`,
    status: 'ready',
  })),
  sound_journey: Array.from({ length: 100 }, (_, index) => ({
    id: `audio-${index + 1}`,
    audio_url: `/api/new-story-ad/assets/audio-${index + 1}.mp3`,
  })),
};

const started = process.hrtime.bigint();
let projected = null;
for (let index = 0; index < 200; index += 1) {
  projected = media.page(outputs, { kind: 'keyframes', offset: 480, limit: 24 });
}
const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
assert.strictEqual(projected.total, 1000);
assert.strictEqual(projected.items.length, 24);
assert.strictEqual(projected.items[0].id, 'frame-481');
assert.strictEqual(projected.next_offset, 504);
assert(projected.items.every(item => item.preview_url.includes('thumb=480')));
assert(projected.items.every(item => item.original_url && !item.original_url.includes('thumb=')));

const clips = media.page(outputs, { kind: 'clips', offset: 490, limit: 1000 });
assert.strictEqual(clips.limit, 100);
assert.strictEqual(clips.items.length, 10);
assert.strictEqual(clips.has_more, false);
assert(clips.items.every(item => item.media_type === 'video' && item.poster_url.includes('thumb=640')));

const all = media.page(outputs, { kind: 'all', offset: 0, limit: 24 });
assert.strictEqual(all.total, 1600);
assert.strictEqual(Buffer.byteLength(JSON.stringify(all), 'utf8') < 50 * 1024, true, '首屏媒体目录必须小于 50KB');
assert(elapsedMs < 1000, `1000 资产分页投影耗时过高: ${elapsedMs.toFixed(2)}ms`);

console.log(JSON.stringify({
  passed: true,
  assets: 1600,
  first_page_items: all.items.length,
  first_page_bytes: Buffer.byteLength(JSON.stringify(all), 'utf8'),
  repeated_projection_ms: Number(elapsedMs.toFixed(2)),
  thumbnail_first: true,
  original_on_demand: true,
}));
