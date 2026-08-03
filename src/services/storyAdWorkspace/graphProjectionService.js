const crypto = require('crypto');

/** 把任意值整理为安全短文本。 */
function clean(value = '', max = 200) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

/** 工作流详情允许保留正文，但仍设置单字段上限，避免画布接口携带无界提示词。 */
function detailText(value = '', max = 4000) {
  return clean(value, max);
}

function uniqueText(values = [], maxItems = 40, maxLength = 160) {
  return [...new Set(values.map(value => clean(value, maxLength)).filter(Boolean))].slice(0, maxItems);
}

function beatDetail(beat = {}, index = 0) {
  if (typeof beat === 'string') {
    return { title: `情节 ${index + 1}`, content: detailText(beat, 2400) };
  }
  const content = uniqueText([
    beat.content,
    beat.summary,
    beat.description,
    beat.story,
    beat.purpose,
    beat.action,
    beat.visual,
    beat.spoken_line,
    beat.dialogue,
    beat.voiceover,
  ], 10, 1200).join('；');
  return {
    title: clean(beat.title || beat.name || beat.label || beat.beat_title || `情节 ${index + 1}`, 200),
    content: detailText(content, 2400),
  };
}

function dialogueDetails(value = []) {
  const rows = Array.isArray(value) ? value : (value ? [value] : []);
  return rows.slice(0, 6).map((item) => {
    if (typeof item === 'string') return detailText(item, 200);
    return {
      speaker: clean(item?.speaker || item?.character || item?.name, 120),
      text: detailText(item?.text || item?.line || item?.dialogue || item?.content, 200),
    };
  }).filter(item => (typeof item === 'string' ? item : (item.speaker || item.text)));
}

function stableNodeToken(value = {}) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 12);
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
function node({ id, type, group, title, subtitle = '', status = '', media = '', target = '', detail = {}, ports = null, x = 0, y = 0 }) {
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
    ...(ports ? { ports } : {}),
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
  const usedNodeIds = new Set();
  const usedEdgeIds = new Set();
  const columns = {
    input: 60,
    assets: 520,
    story: 1020,
    director: 1460,
    shots: 1900,
    media: 2380,
    final: 2840,
  };

  const add = (value) => {
    const current = { ...value };
    const baseId = clean(current.id, 160) || `${clean(current.type, 60) || 'node'}:${stableNodeToken(current)}`;
    let resolvedId = baseId;
    if (usedNodeIds.has(resolvedId)) {
      const token = stableNodeToken({ ...current, id: undefined });
      resolvedId = `${baseId}:${token}`;
      let collision = 2;
      while (usedNodeIds.has(resolvedId)) {
        resolvedId = `${baseId}:${token}:${collision}`;
        collision += 1;
      }
    }
    usedNodeIds.add(resolvedId);
    current.id = resolvedId;
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
    if (value && !usedEdgeIds.has(value.id)) {
      usedEdgeIds.add(value.id);
      edges.push(value);
    }
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
        full_text: detailText(bundle.brief.text, 5000),
        product_subject: detailText(bundle.brief.product_subject, 800),
        duration: bundle.brief.target_duration || 0,
        ratio: clean(bundle.brief.output_ratio, 30),
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

  let understandingId = '';
  const understanding = bundle.reference?.reference_understanding;
  if (understanding && typeof understanding === 'object') {
    const confirmation = bundle.reference?.understanding_confirmation || {};
    understandingId = add({
      id: `reference-understanding:${bundle.reference.analysis_id || projectId}`,
      type: 'reference_understanding',
      group: 'input',
      title: '参考内容深度理解',
      subtitle: understanding.story_summary?.short_synopsis || understanding.story_summary?.logline || '',
      status: confirmation.status === 'confirmed' ? 'confirmed' : (confirmation.ready ? 'ready' : 'blocked'),
      target: `/story-ad/projects/${encodeURIComponent(projectId)}?view=brief`,
      ports: {
        inputs: [{ id: 'reference', contract: 'ReferenceMedia', max: 1 }],
        outputs: [{ id: 'understanding', contract: 'ReferenceUnderstanding' }],
      },
      detail: {
        contract_version: clean(understanding.contract_version, 80),
        confirmation_status: clean(confirmation.status, 40),
        causal_event_count: Array.isArray(understanding.causal_chain) ? understanding.causal_chain.length : 0,
        character_count: Array.isArray(understanding.characters) ? understanding.characters.length : 0,
        scene_count: Array.isArray(understanding.scenes) ? understanding.scenes.length : 0,
        unknown_count: Array.isArray(understanding.unknowns) ? understanding.unknowns.length : 0,
      },
    });
    const referenceNode = nodes.find(item => item.type === 'reference');
    if (referenceNode) connect(referenceNode.id, understandingId, 'learns');
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
      if (understandingId) connect(understandingId, assetId, 'extracts');
      else if (inputRoot) connect(inputRoot, assetId, 'defines');
    });
  };
  addAssets(assets.people, 'person', 'assets');
  addAssets(assets.animals, 'animal', 'assets');
  addAssets(assets.products, 'product', 'assets');
  addAssets(assets.logos, 'logo', 'assets');
  addAssets(assets.props, 'prop', 'assets');
  addAssets(assets.scenes, 'scene', 'assets');

  const directorByWorld = new Map();
  const animationByWorld = new Map();
  const worldsById = new Map((Array.isArray(bundle.scene_worlds) ? bundle.scene_worlds : [])
    .map(world => [String(world.id || ''), world]));
  (Array.isArray(bundle.director_scenes) ? bundle.director_scenes : []).forEach((director, index) => {
    const worldId = clean(director.world_id, 120);
    if (!worldId) return;
    const world = worldsById.get(worldId) || {};
    const worldLabel = world.display_name || world.name || `场景 ${index + 1}`;
    const directorId = add({
      id: `director:${worldId}`,
      type: 'director_scene',
      group: 'director',
      title: `${worldLabel} · 导演台`,
      subtitle: director.path_count ? `${director.camera_count || 0} 个机位 · ${director.path_count} 条运动轨迹` : '布置人物、机位与运动轨迹',
      status: director.status || 'draft',
      media: world.source_asset?.image_url || world.source_asset?.layout_image_url || '',
      target: `/story-ad/projects/${encodeURIComponent(projectId)}?view=workflow&director=${encodeURIComponent(worldId)}`,
      ports: {
        inputs: [
          { id: 'scene', contract: 'SceneReference', max: 1 },
          { id: 'people', contract: 'PersonReference' },
          { id: 'products', contract: 'ProductReference' },
        ],
        outputs: [{ id: 'scene', contract: 'DirectorScene' }],
      },
      detail: {
        director_scene_id: clean(director.director_scene_id, 120),
        world_id: worldId,
        revision: Number(director.revision || 1) || 1,
        world_revision: Number(director.world_revision || 1) || 1,
        source_revision: Number(director.source_revision || 0) || 0,
        status: clean(director.status, 50),
        compatibility_status: clean(director.compatibility_status, 50),
        entity_refs: (Array.isArray(director.entity_refs) ? director.entity_refs : []).slice(0, 60),
        camera_count: Number(director.camera_count || 0) || 0,
        path_count: Number(director.path_count || 0) || 0,
        snapshot_count: Number(director.snapshot_count || 0) || 0,
        updated_at: clean(director.updated_at, 80),
      },
    });
    directorByWorld.set(worldId, directorId);
    const sceneSource = nodes.find(item => item.type === 'scene' && item.id.endsWith(`:${worldId}`));
    if (sceneSource) connect(sceneSource.id, directorId, 'stages');
    (Array.isArray(director.entity_refs) ? director.entity_refs : []).forEach(ref => {
      const entityId = clean(ref.entity_id, 120);
      const source = entityId && nodes.find(item => ['person', 'product'].includes(item.type) && item.id.endsWith(`:${entityId}`));
      if (source) connect(source.id, directorId, 'stages');
    });
    if (Number(director.path_count || 0) > 0) {
      const animationId = add({
        id: `director-animation:${worldId}`,
        type: 'director_animation',
        group: 'director',
        title: `${worldLabel} · 运动设计`,
        subtitle: `${director.path_count} 条运动轨迹`,
        status: director.status || 'ready',
        target: `/story-ad/projects/${encodeURIComponent(projectId)}?view=workflow&director=${encodeURIComponent(worldId)}`,
        ports: {
          inputs: [{ id: 'scene', contract: 'DirectorScene', max: 1 }],
          outputs: [{ id: 'motion', contract: 'DirectorAnimation' }],
        },
        detail: {
          world_id: worldId,
          director_revision: Number(director.revision || 1) || 1,
          path_count: Number(director.path_count || 0) || 0,
        },
      });
      animationByWorld.set(worldId, animationId);
      connect(directorId, animationId, 'animates');
    }
  });

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
        logline: detailText(blueprint.logline, 2400),
        summary: detailText(blueprint.summary || blueprint.synopsis || blueprint.story_summary, 2400),
        beats: (Array.isArray(blueprint.beats) ? blueprint.beats : []).slice(0, 40).map(beatDetail),
      },
    });
    (assetNodes.length ? assetNodes : [understandingId || inputRoot]).filter(Boolean).forEach(source => connect(source, storyId, 'informs'));
  }

  const shots = Array.isArray(bundle.storyboard?.shots) ? bundle.storyboard.shots : [];
  const sketches = Array.isArray(bundle.storyboard?.sketches) ? bundle.storyboard.sketches : [];
  const shotIds = [];
  shots.forEach((shot, index) => {
    const shotIndex = Number(shot.shot_index || shot.index || index + 1) || index + 1;
    const shotStableId = clean(shot.shot_id || shot.id, 120);
    const sketch = sketches.find((item, sketchIndex) => {
      const sketchStableId = clean(item.shot_id || item.source_shot_id, 120);
      if (shotStableId && sketchStableId) return shotStableId === sketchStableId;
      const sketchShotIndex = Number(item.shot_index || item.index || sketchIndex + 1) || sketchIndex + 1;
      return sketchShotIndex === shotIndex;
    });
    const characterIds = uniqueText([
      ...(Array.isArray(shot.character_ids) ? shot.character_ids : []),
      ...(Array.isArray(shot.person_ids) ? shot.person_ids : []),
      ...(Array.isArray(shot.characters) ? shot.characters.map(item => (
        typeof item === 'string' ? item : (item?.id || item?.character_id || item?.person_id)
      )) : []),
    ], 40, 120);
    const shotId = add({
      id: `shot:${shotIndex}`,
      type: 'shot',
      group: 'shots',
      title: shot.title || `镜头 ${shotIndex}`,
      subtitle: shot.visual || shot.visual_description || shot.action || '',
      status: shot.status || 'ready',
      media: sketch || '',
      target: `/story-ad/projects/${encodeURIComponent(projectId)}?view=shot&shot=${shotIndex}`,
      detail: {
        shot_index: shotIndex,
        shot_id: shotStableId,
        visual: detailText(shot.visual || shot.visual_description || shot.story_visual, 1000),
        action: detailText(shot.action || shot.visual_action || shot.action_start, 500),
        narration: detailText(shot.narration || shot.voiceover || shot.blueprint_spoken_line || shot.subtitle, 400),
        dialogue_lines: dialogueDetails(shot.dialogue_lines || shot.dialogue || []),
        purpose: detailText(shot.purpose || shot.objective || shot.role, 250),
        bindings: {
          scene_id: clean(shot.scene_id || shot.scene_asset_id, 120),
          camera_id: clean(shot.camera_id, 120),
          character_ids: characterIds,
        },
        duration: Number(shot.duration || shot.duration_sec || 0) || 0,
        transition: {
          from: clean(shot.transition_from, 120),
          type: clean(shot.transition_type, 120),
          duration: Number(shot.transition_duration_sec || 0) || 0,
          reason: detailText(shot.transition_reason, 200),
          match_anchor: detailText(shot.transition_match_anchor, 150),
          requires_previous_frame: shot.requires_previous_frame === true,
        },
      },
    });
    shotIds.push(shotId);
    if (storyId) connect(storyId, shotId, 'contains');
    else if (inputRoot) connect(inputRoot, shotId, 'contains');
    if (index > 0) connect(shotIds[index - 1], shotId, 'continues');

    const sceneId = clean(shot.scene_id || shot.scene_asset_id, 120);
    if (directorByWorld.has(sceneId)) connect(directorByWorld.get(sceneId), shotId, 'directs');
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
  const usedKeyframeIds = new Set();
  const keyframeIdsByShot = new Map();
  keyframes.forEach((frame, index) => {
    const shotIndex = Number(frame.shot_index || frame.index || index + 1) || index + 1;
    const baseId = `keyframe:${shotIndex}`;
    let requestedId = baseId;
    if (usedKeyframeIds.has(requestedId)) {
      const naturalToken = clean(
        frame.id || frame.keyframe_id || frame.generation_id || frame.selected_candidate_id || frame.candidate_id,
        80,
      ).replace(/[^a-z0-9_-]+/ig, '-');
      const token = naturalToken || stableNodeToken({
        shot_index: shotIndex,
        status: frame.status || frame.current_generation_status || '',
        media: mediaUrl(frame),
        candidate: frame.selected_candidate_id || frame.candidate_id || '',
      });
      requestedId = `${baseId}:${token}`;
      let collision = 2;
      while (usedKeyframeIds.has(requestedId)) {
        requestedId = `${baseId}:${token}:${collision}`;
        collision += 1;
      }
    }
    usedKeyframeIds.add(requestedId);
    const frameId = add({
      id: requestedId,
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
    if (!keyframeIdsByShot.has(shotIndex)) keyframeIdsByShot.set(shotIndex, []);
    keyframeIdsByShot.get(shotIndex).push(frameId);
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
    const source = keyframeIdsByShot.get(shotIndex)?.[0] || `shot:${shotIndex}`;
    connect(source, clipId, 'animates');
    const sourceShot = shots.find((item, shotArrayIndex) => (
      (Number(item.shot_index || item.index || shotArrayIndex + 1) || shotArrayIndex + 1) === shotIndex
    )) || {};
    const worldId = clean(sourceShot.scene_id || sourceShot.scene_asset_id, 120);
    if (animationByWorld.has(worldId)) connect(animationByWorld.get(worldId), clipId, 'drives_motion');
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
    ['director', '导演台与运动设计'],
    ['shots', '分镜与镜头'],
    ['media', '生成结果'],
    ['final', '成片'],
  ].map(([id, label]) => {
    const grouped = nodes.filter(item => item.group === id);
    if (!grouped.length) return null;
    const minX = Math.min(...grouped.map(item => item.position.x));
    const minY = Math.min(...grouped.map(item => item.position.y));
    const maxX = Math.max(...grouped.map(item => item.position.x + 220));
    const maxY = Math.max(...grouped.map(item => item.position.y + 168));
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
