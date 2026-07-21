const ACTIVE_LIFECYCLES = new Set(['queued', 'submitting', 'provider_submitted', 'provider_running', 'downloading', 'normalizing']);
const GENERATED_LIFECYCLES = new Set(['generated', 'video_qa', 'qa_passed', 'qa_failed']);

function memberIndexes(row = {}, fallbackIndex = 0) {
  const values = Array.isArray(row.scene_block_members) && row.scene_block_members.length
    ? row.scene_block_members
    : [Number(row.index || 0) || fallbackIndex + 1];
  return [...new Set(values.map(Number).filter(value => Number.isInteger(value) && value > 0))].sort((a, b) => a - b);
}

/** 把兼容期逐镜状态投影为真实生成单元；供应商任务只在单元层出现一次。 */
function projectVideoGenerationUnits(shots = [], sceneBlocks = []) {
  const groups = new Map();
  const canonicalOwner = new Map();
  (Array.isArray(sceneBlocks) ? sceneBlocks : []).forEach((block, index) => {
    const members = (block.member_indexes || []).map(value => Number(value) + 1).filter(value => Number.isInteger(value) && value > 0);
    const id = String(block.id || `scene-block-${members.join('-') || index + 1}`);
    const group = { id, members: new Set(members), rows: [], block };
    groups.set(id, group);
    members.forEach(member => canonicalOwner.set(member, group));
  });
  (Array.isArray(shots) ? shots : []).forEach((row, index) => {
    if (!row) return;
    const members = memberIndexes(row, index);
    const ownIndex = Number(row.index || row.shot_index || index + 1);
    const canonical = canonicalOwner.get(ownIndex);
    let id = canonical?.id || String(row.scene_block_id || '');
    if (!id) {
      const matched = [...groups.values()].find(group => members.some(member => group.members.has(member)));
      id = matched?.id || String(row.provider_task_id || `shot-${members[0] || index + 1}`);
    }
    if (!groups.has(id)) groups.set(id, { id, members: new Set(), rows: [], block: null });
    const group = groups.get(id);
    if (!canonical) members.forEach(member => group.members.add(member));
    group.rows.push(row);
  });

  return [...groups.values()].map((group, unitIndex) => {
    const rows = group.rows;
    const members = [...group.members].sort((a, b) => a - b);
    const hasMedia = rows.some(row => row.file_exists || row.video_url || row.file_path);
    const active = rows.some(row => ACTIVE_LIFECYCLES.has(String(row.lifecycle || '')));
    const cancelled = rows.length > 0 && rows.every(row => String(row.lifecycle || '') === 'cancelled');
    const generated = hasMedia || rows.some(row => GENERATED_LIFECYCLES.has(String(row.lifecycle || '')));
    const hardFailure = rows.some(row => String(row.lifecycle || '') === 'failed') && !generated;
    const generation_status = cancelled ? 'cancelled' : (active ? 'running' : (hardFailure ? 'failed' : (generated ? 'succeeded' : 'pending')));
    const qa_passed = rows.filter(row => String(row.lifecycle || '') === 'qa_passed' || row.qa_status === 'passed').length;
    const qa_failed = rows.filter(row => String(row.lifecycle || '') === 'qa_failed' || row.qa_status === 'failed').length;
    const qa_status = qa_failed > 0 ? 'failed'
      : (members.length > 0 && qa_passed >= members.length ? 'passed' : (generated ? 'reviewing' : 'pending'));
    const providerRow = rows.find(row => row.provider_task_id) || rows[0] || {};
    const isLocal = !providerRow.provider_task_id
      && rows.some(row => /local|camera-motion/i.test(String(row.provider_used || '')));
    return {
      unit_index: unitIndex,
      id: group.id,
      member_indexes: members,
      continuous: group.block?.continuous === true || members.length > 1,
      duration_sec: Number(group.block?.duration_sec || 0),
      mode: isLocal ? 'local_motion' : 'provider',
      generation_status,
      qa_status,
      qa_passed,
      qa_failed,
      qa_pending: Math.max(0, members.length - qa_passed - qa_failed),
      provider_task_id: providerRow.provider_task_id || '',
      provider_status: providerRow.provider_status || '',
      provider_used: providerRow.provider_used || [providerRow.provider_id, providerRow.model_id].filter(Boolean).join('/'),
      started_at: rows.map(row => row.started_at || row.provider_submitted_at || '').filter(Boolean).sort()[0] || '',
      finished_at: rows.map(row => row.finished_at || '').filter(Boolean).sort().slice(-1)[0] || '',
      last_heartbeat_at: rows.map(row => row.last_heartbeat_at || row.updated_at || '').filter(Boolean).sort().slice(-1)[0] || '',
      shot_results: rows.map(row => ({
        index: Number(row.index || 0), title: row.title || '', lifecycle: row.lifecycle || 'pending',
        qa_status: row.qa_status || '', error: row.error || '', error_code: row.error_code || '',
        qa_problems: row.qa_problems || [], cross_shot_qa_problems: row.cross_shot_qa_problems || [],
      })),
    };
  });
}

module.exports = { projectVideoGenerationUnits };
