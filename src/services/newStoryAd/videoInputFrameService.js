'use strict';

const storage = require('./storageService');
const frameState = require('./keyframeFrameStateService');
const storyboardImageGate = require('../storyAdWorkspace/storyboardImageConfirmationGateService');

function list(value) { return Array.isArray(value) ? value.filter(Boolean) : []; }
function clean(value = '', max = 1200) { return String(value || '').trim().slice(0, max); }

/**
 * V341 video-input contract.
 *
 * A confirmed storyboard image is already the authored first frame for
 * image-to-video.  This adapter is deliberately deterministic: it never calls
 * an image provider and it never writes a duplicate image artifact.
 */
function resolve(taskId, { shots = [], contracts = [], requireConfirmation = true } = {}) {
  const task = storage.getTask(taskId);
  if (!task) throw Object.assign(new Error('项目不存在'), { code: 'TASK_NOT_FOUND', status: 404 });
  const context = storage.getOutput(taskId, 'context') || task.request || {};
  if (requireConfirmation && context.shot_design_confirmed !== true) {
    throw Object.assign(new Error('请先在分镜页确认分镜，再进入声音与视频制作。'), {
      code: 'STORYBOARD_CONFIRMATION_REQUIRED', status: 409, retryable: false,
    });
  }
  const gate = storyboardImageGate.assertReady(taskId);
  const shotList = list(shots).length ? list(shots) : list(storage.getOutput(taskId, 'storyboard_table'));
  const images = list(storage.getOutput(taskId, 'storyboard_images'));
  const byIndex = new Map(images.map((image, index) => [
    Number(image.shot_index || image.index || index + 1) || index + 1,
    image,
  ]));
  const failures = [];
  const frames = shotList.map((shot, index) => {
    const shotIndex = Number(shot.shot_index || shot.index || index + 1) || index + 1;
    const image = byIndex.get(shotIndex) || {};
    const imageUrl = clean(image.image_url || image.imageUrl || image.url);
    if (!imageUrl || !frameState.localAssetExists(imageUrl)) failures.push(`第 ${shotIndex} 镜分镜文件不可用`);
    return {
      ...image,
      shot_index: shotIndex,
      image_url: imageUrl,
      imageUrl,
      source_type: 'confirmed_storyboard',
      source_output_kind: 'storyboard_images',
      video_input_contract_version: 1,
      contract: contracts[index] || {},
      contract_fingerprint: clean(contracts[index]?.contract_fingerprint, 200),
      current_generation_status: 'confirmed',
      qa_policy_version: 3,
      qa: {
        pass: true,
        status: 'human_confirmed_storyboard',
        source: 'storyboard_image_confirmation',
        subject_count: image.subject_count_qa || null,
        stale_lineage_review_required: (gate.stale_indexes || []).includes(shotIndex),
      },
    };
  });
  if (frames.length !== shotList.length || failures.length) {
    throw Object.assign(new Error(`视频首帧准备失败：${failures.join('；') || '分镜数量不完整'}`), {
      code: 'VIDEO_INPUT_FRAME_REQUIRED', status: 422, retryable: false, details: failures,
    });
  }
  return {
    frames,
    gate,
    source_type: 'confirmed_storyboard',
    fingerprint: storage.canonicalFingerprint(frames.map(frame => ({
      shot_index: frame.shot_index,
      image_url: frame.image_url,
      file_sha256: frame.file_sha256 || '',
      shot_contract_fingerprint: frame.shot_contract_fingerprint || '',
      reference_pack_fingerprint: frame.reference_pack_fingerprint || '',
    }))),
  };
}

module.exports = { resolve };
