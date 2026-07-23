const fs = require('fs');

function text(value = '') {
  return String(value || '').trim();
}

function statusHasVerifiedMedia(status = {}) {
  if (!status || typeof status !== 'object') return false;
  const filePath = text(status.file_path);
  const mediaExists = status.file_exists === true || (filePath && fs.existsSync(filePath)) || !!text(status.video_url);
  return mediaExists
    && text(status.lifecycle).toLowerCase() === 'qa_passed'
    && text(status.qa_status).toLowerCase() === 'passed'
    && !!text(status.lineage_fingerprint)
    && !text(status.error_code);
}

function inputStrategy(status = {}) {
  if (!status || typeof status !== 'object') return '';
  const saved = text(status.input_mode).toLowerCase();
  if (saved) return saved;
  const local = !text(status.provider_task_id)
    && (/local_motion/i.test(text(status.file_path)) || /local_motion/i.test(text(status.video_url)));
  return local ? 'approved_keyframe_local_motion' : '';
}

function recoveredClip(status = {}, previousStatus = {}) {
  status = status && typeof status === 'object' ? status : {};
  previousStatus = previousStatus && typeof previousStatus === 'object' ? previousStatus : {};
  const currentFingerprint = text(status.lineage_fingerprint);
  const previousFingerprint = text(previousStatus.lineage_fingerprint);
  const crossPassed = text(status.cross_shot_qa_status).toLowerCase() === 'passed';
  return {
    shot_index: Math.max(0, Number(status.shot_index ?? status.index - 1) || 0),
    index: Math.max(1, Number(status.index || status.shot_index + 1) || 1),
    title: text(status.title),
    file_path: text(status.file_path),
    video_url: text(status.video_url),
    provider_used: [text(status.provider_id), text(status.model_id)].filter(Boolean).join('/'),
    provider_task_id: text(status.provider_task_id),
    provider_submission_state: text(status.provider_submission_state),
    billing_state: text(status.billing_state),
    seedance_input_mode: inputStrategy(status),
    boundary_repair_fingerprint: text(status.boundary_repair_fingerprint),
    scene_block_id: text(status.scene_block_id),
    scene_block_fingerprint: text(status.scene_block_fingerprint),
    scene_block_members: Array.isArray(status.scene_block_members) ? status.scene_block_members.map(Number).filter(Number.isInteger) : [],
    lineage_fingerprint: currentFingerprint,
    qa: {
      pass: true,
      status: 'verified_status_snapshot',
      problems: [],
      failure_dimensions: [],
      checked_at: status.finished_at || status.updated_at || '',
    },
    ...(crossPassed ? {
      cross_shot_qa: {
        pass: true,
        status: 'verified_status_snapshot',
        previous_lineage_fingerprint: previousFingerprint,
        current_lineage_fingerprint: currentFingerprint,
        problems: [],
        failure_dimensions: [],
      },
    } : {}),
    recovered_from_status_snapshot: true,
    error: '',
    error_code: '',
  };
}

function recover(clips = [], statuses = []) {
  const next = Array.isArray(clips) ? clips.slice() : [];
  (Array.isArray(statuses) ? statuses : []).forEach((status, position) => {
    if (!statusHasVerifiedMedia(status)) return;
    const index = Math.max(0, Number(status.shot_index ?? status.index - 1 ?? position) || 0);
    if (next[index]?.video_url || next[index]?.file_path) return;
    const previousStatus = statuses[index - 1] || {};
    next[index] = recoveredClip(status, {
      ...previousStatus,
      lineage_fingerprint: previousStatus.lineage_fingerprint || next[index - 1]?.lineage_fingerprint || next[index - 1]?.lineage?.fingerprint || '',
    });
  });
  return next;
}

function statusesFromOutputRows(rows = []) {
  return (Array.isArray(rows) ? rows : [])
    .filter(row => /^video_shot_status_\d+$/.test(String(row.kind || '')))
    .sort((a, b) => Number(String(a.kind).split('_').pop()) - Number(String(b.kind).split('_').pop()))
    .map(row => row.payload || {});
}

function recoverFromOutputRows(rows = [], clips = []) {
  return recover(clips, statusesFromOutputRows(rows));
}

module.exports = {
  statusHasVerifiedMedia,
  inputStrategy,
  recoveredClip,
  recover,
  statusesFromOutputRows,
  recoverFromOutputRows,
};
