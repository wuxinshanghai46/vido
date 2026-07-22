(() => {
  const text = value => String(value || '').trim();
  const blockId = clip => text(clip?.scene_block_id || clip?.lineage?.scene_block_id);

  function sameContinuousUnit(previous = {}, current = {}) {
    const previousBlock = blockId(previous);
    const currentBlock = blockId(current);
    if (previousBlock && currentBlock) return previousBlock === currentBlock;
    const previousSource = text(previous.scene_block_source_path || previous.source_video_path);
    const currentSource = text(current.scene_block_source_path || current.source_video_path);
    return !!(previousSource && currentSource && previousSource === currentSource);
  }

  function audit(clips = [], shotCount = clips.length) {
    const scoped = Array.from({ length: Math.max(0, Number(shotCount) || 0) }, (_, index) => clips[index] || {});
    const boundaries = scoped.slice(1).map((current, offset) => {
      const index = offset + 1;
      const required = !sameContinuousUnit(scoped[index - 1], current);
      const qa = current.cross_shot_qa;
      const pass = !required || qa?.pass === true;
      return { index, required, pass, status: !required ? 'same_generation_unit' : (qa?.pass === true ? 'passed' : (qa?.pass === false ? 'failed' : 'missing')) };
    }).filter(item => item.required);
    return {
      ready: boundaries.every(item => item.pass), total: boundaries.length,
      passed: boundaries.filter(item => item.pass).length,
      missing_indexes: boundaries.filter(item => item.status === 'missing').map(item => item.index),
      failed_indexes: boundaries.filter(item => item.status === 'failed').map(item => item.index),
      unready_indexes: boundaries.filter(item => !item.pass).map(item => item.index),
      boundaries,
    };
  }

  window.NewStoryAdVideoBoundaries = { sameContinuousUnit, audit };
})();
