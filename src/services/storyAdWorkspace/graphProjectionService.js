/** 把任意值整理为安全短文本。 */
function clean(value = '', max = 200) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

/** 从媒体对象中提取可展示地址。 */
function mediaUrl(value = {}) {
  if (typeof value === 'string') return clean(value, 1200);
  return clean(
    value.thumbnail_url
      || value.image_url
      || value.imageUrl
      || value.video_url
      || value.videoUrl
      || value.url
      || value.file_path
      || '',
    1200,
  );
}

/** 创建 VideoCanvas 兼容的只读节点。 */
function node({ id, type, group, title, subtitle = '', status = '', media = '', target = '', detail = {}, x = 0, y = 0 }) {
  return {
    id: clean(id, 160),
    type: clean(type, 60),
    group: clean(group, 60),
    label: clean(title, 140),
    title: clean(title, 140),
    subtitle: clean(subtitle, 220),
    status: clean(status || 'ready', 50),
    media_url: mediaUrl(media),
    target_route: clean(target, 500),
    detail,
    position: { x, y },
    read_only: true,
  };
}

/** 创建稳定的有向关系。 */
function edge(source, target, kind = 'feeds') {
  if (!source || !target) return null;
  return {
    id: `${source}:${kind}:${target}`,
    source,
    sourcePort: 'output',
    target,
    targetPort: 'input',
    kind,
  };
}

/** 把真实项目 bundle 投影成节点和关系，不保存第二套画布状态。 */
function projectGraph(bundle = {}) {
  const projectId = clean(bundle.project?.id, 100);
  const nodes = [];
  const edges = [];
  const firstByGroup = {};
  const lastByGroup = {};
  const groupY = {};
  const columns = {
    input: 60,
    assets: 520,
    story: 1020,
    shots: 1460,
    media: 1940,
    final: 2400,
  };

  const add = (value) => {
    const current = { ...value };
    const group = current.group;
    const row = groupY[group] || 0;
    current.x = current.x ?? columns[group] ?? 60;
    current.y = current.y ?? (80 + row * 190);
    groupY[group] = row + 1;
    nodes.push(node(current));
    firstByGroup[group] ||= current.id;
    lastByGroup[group] = current.id;
    return current.id;
  };
  const connect = (source, target, kind) => {
    const value = edge(source, target, kind);
    if (value) edges.push(value);
  };

  let inputRoot = '';
  if (bundle.brief?.text) {
    inputRoot = add({
      id: `brief:${projectId}`,
      type: 'brief',
      group: 'input',
      title: '广告目标',
      subtitle: bundle.brief.text,
      status: 'confirmed',
      target: `/story-ad/projects/${encodeURIComponent(projectId)}?view=brief`,
      detail: {
        ratio: bundle.brief.output_ratio || '',
        duration: bundle.brief.target_duration || 0,
      },
    });
  }
  if (bundle.reference?.analysis_id || bundle.reference?.filename || bundle.reference?.url) {
    const referenceId = add({
      id: `reference:${bundle.reference.analysis_id || projectId}`,
      type: 'reference',
      group: 'input',
      title: bundle.reference.filename || '参考材料',
      subtitle: bundle.reference.status || '',
      status: bundle.reference.status || 'ready',
      media: bundle.reference.url,
      target: `/story-ad/projects/${encodeURIComponent(projectId)}?view=brief`,
      detail: {
        duration: bundle.reference.duration || 0,
        resolution: bundle.reference.width && bundle.reference.height
          ? `${bundle.reference.width}×${bundle.reference.height}`
          : '',
      },
    });
    if (inputRoot) connect(referenceId, inputRoot, 'grounds');
    else inputRoot = referenceId;
  }

  const assets = bundle.assets || {};
  const assetNodes = [];
  const addAssets = (rows, type, route) => {
    (Array.isArray(rows) ? rows : []).forEach((item, index) => {
      const assetId = add({
        id: `${type}:${item.id || index + 1}`,
        type,
        group: 'assets',
        title: item.name || `${type} ${index + 1}`,
        subtitle: item.role || item.status || '',
        status: item.status || 'ready',
        media: item.image_url,
        target: `/story-ad/projects/${encodeURIComponent(projectId)}?view=${route}&asset=${encodeURIComponent(item.id || '')}`,
        detail: {
          revision: item.revision || 0,
          views: Array.isArray(item.view_images) ? item.view_images.length : 0,
        },
      });
      assetNodes.push(assetId);
      if (inputRoot) connect(inputRoot, assetId, 'defines');
    });
  };
  addAssets(assets.people, 'person', 'assets');
  addAssets(assets.animals, 'animal', 'assets');
  addAssets(assets.products, 'product', 'assets');
  addAssets(assets.logos, 'logo', 'assets');
  addAssets(assets.props, 'prop', 'assets');
  addAssets(assets.scenes, 'scene', 'assets');

  let storyId = '';
  const blueprint = bundle.story?.blueprint;
  if (blueprint) {
    storyId = add({
      id: `story:${projectId}`,
      type: 'story',
      group: 'story',
      title: blueprint.story_title || blueprint.title || '剧情蓝图',
      subtitle: blueprint.logline || blueprint.summary || '',
      status: 'ready',
      target: `/story-ad/projects/${encodeURIComponent(projectId)}?view=plot`,
      detail: {
        beats: Array.isArray(blueprint.beats) ? blueprint.beats.length : 0,
        revision: blueprint.revision || 0,
      },
    });
    (assetNodes.length ? assetNodes : [inputRoot]).filter(Boolean).forEach(source => connect(source, storyId, 'informs'));
  }

  const shots = Array.isArray(bundle.storyboard?.shots) ? bundle.storyboard.shots : [];
  const shotIds = [];
  shots.forEach((shot, index) => {
    const shotIndex = Number(shot.shot_index || shot.index || index + 1) || index + 1;
    const shotId = add({
      id: `shot:${shotIndex}`,
      type: 'shot',
      group: 'shots',
      title: shot.title || `镜头 ${shotIndex}`,
      subtitle: shot.visual || shot.visual_description || shot.action || '',
      status: shot.status || 'ready',
      target: `/story-ad/projects/${encodeURIComponent(projectId)}?view=shot&shot=${shotIndex}`,
      detail: {
        index: shotIndex,
        duration: Number(shot.duration || shot.duration_sec || 0) || 0,
        scene_id: shot.scene_id || shot.scene_asset_id || '',
        transition_from: shot.transition_from || '',
      },
    });
    shotIds.push(shotId);
    if (storyId) connect(storyId, shotId, 'contains');
    else if (inputRoot) connect(inputRoot, shotId, 'contains');
    if (index > 0) connect(shotIds[index - 1], shotId, 'continues');

    const sceneId = clean(shot.scene_id || shot.scene_asset_id, 120);
    if (sceneId && nodes.some(item => item.id === `scene:${sceneId}`)) connect(`scene:${sceneId}`, shotId, 'binds');
    const referencedIds = [
      ...(Array.isArray(shot.person_ids) ? shot.person_ids : []),
      ...(Array.isArray(shot.character_ids) ? shot.character_ids : []),
      ...(Array.isArray(shot.asset_ids) ? shot.asset_ids : []),
    ].map(value => clean(value, 120)).filter(Boolean);
    referencedIds.forEach(id => {
      const source = nodes.find(item => item.id.endsWith(`:${id}`));
      if (source) connect(source.id, shotId, 'binds');
    });
  });

  const keyframes = Array.isArray(bundle.generation?.keyframes) ? bundle.generation.keyframes : [];
  const mediaIds = [];
  keyframes.forEach((frame, index) => {
    const shotIndex = Number(frame.shot_index || frame.index || index + 1) || index + 1;
    const frameId = add({
      id: `keyframe:${shotIndex}`,
      type: 'keyframe',
      group: 'media',
      title: `镜头 ${shotIndex} 关键帧`,
      subtitle: frame.qa?.pass === true ? '审核通过' : (frame.status || frame.current_generation_status || ''),
      status: frame.qa?.pass === true ? 'passed' : (frame.status || frame.current_generation_status || 'ready'),
      media: frame,
      target: `/story-ad/projects/${encodeURIComponent(projectId)}?view=shot&shot=${shotIndex}`,
      detail: { candidate_id: frame.selected_candidate_id || '' },
    });
    mediaIds.push(frameId);
    connect(`shot:${shotIndex}`, frameId, 'renders');
  });

  const clips = Array.isArray(bundle.generation?.clips) ? bundle.generation.clips : [];
  clips.forEach((clip, index) => {
    const shotIndex = Number(clip.shot_index || clip.index || index + 1) || index + 1;
    const clipId = add({
      id: `clip:${shotIndex}`,
      type: 'clip',
      group: 'media',
      title: `镜头 ${shotIndex} 视频`,
      subtitle: clip.qa?.pass === true ? '审核通过' : (clip.status || clip.lifecycle || ''),
      status: clip.qa?.pass === true ? 'passed' : (clip.status || clip.lifecycle || 'ready'),
      media: clip,
      target: `/story-ad/projects/${encodeURIComponent(projectId)}?view=final&shot=${shotIndex}`,
      detail: { duration: Number(clip.duration || clip.duration_sec || 0) || 0 },
    });
    mediaIds.push(clipId);
    const source = nodes.some(item => item.id === `keyframe:${shotIndex}`) ? `keyframe:${shotIndex}` : `shot:${shotIndex}`;
    connect(source, clipId, 'animates');
  });

  const finalVideo = bundle.generation?.final_video;
  if (finalVideo && mediaUrl(finalVideo)) {
    const finalId = add({
      id: `final:${projectId}`,
      type: 'final',
      group: 'final',
      title: '最终成片',
      subtitle: finalVideo.status || '已生成',
      status: finalVideo.status || 'ready',
      media: finalVideo,
      target: `/story-ad/projects/${encodeURIComponent(projectId)}?view=final`,
      detail: { duration: Number(finalVideo.duration || finalVideo.duration_sec || 0) || 0 },
    });
    const sources = mediaIds.filter(id => id.startsWith('clip:'));
    (sources.length ? sources : shotIds).forEach(source => connect(source, finalId, 'composes'));
  }

  const clusters = [
    ['input', '输入与目标'],
    ['assets', '身份资产'],
    ['story', '剧情'],
    ['shots', '分镜与镜头'],
    ['media', '生成结果'],
    ['final', '成片'],
  ].map(([id, label]) => {
    const grouped = nodes.filter(item => item.group === id);
    if (!grouped.length) return null;
    const minX = Math.min(...grouped.map(item => item.position.x));
    const minY = Math.min(...grouped.map(item => item.position.y));
    const maxX = Math.max(...grouped.map(item => item.position.x + 220));
    const maxY = Math.max(...grouped.map(item => item.position.y + 142));
    return {
      id,
      label,
      node_ids: grouped.map(item => item.id),
      x: minX - 24,
      y: minY - 48,
      width: Math.max(268, maxX - minX + 48),
      height: Math.max(230, maxY - minY + 72),
    };
  }).filter(Boolean);
  const bounds = {
    x: Math.min(...clusters.map(item => item.x)),
    y: Math.min(...clusters.map(item => item.y)),
    width: Math.max(...clusters.map(item => item.x + item.width)) - Math.min(...clusters.map(item => item.x)),
    height: Math.max(...clusters.map(item => item.y + item.height)) - Math.min(...clusters.map(item => item.y)),
  };

  return {
    schema_version: 'story-ad-graph-projection-v1',
    project_id: projectId,
    revision: bundle.revisions?.content || 1,
    read_only: true,
    nodes,
    edges,
    clusters,
    bounds,
    stats: {
      nodes: nodes.length,
      edges: edges.length,
      blockers: nodes.filter(item => ['failed', 'blocked', 'unauthorized'].includes(item.status)).length,
    },
  };
}

module.exports = { projectGraph };
