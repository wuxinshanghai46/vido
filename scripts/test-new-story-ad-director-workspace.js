const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const directorWorkspace = require('../src/services/newStoryAd/directorWorkspaceService');
const { normalizeSceneSpec } = require('../src/services/newStoryAd/contextBuilder');
const sceneAssist = require('../src/services/newStoryAd/sceneAssistCompletenessService');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function makeShot(index) {
  return {
    index: index + 1,
    title: `镜头 ${index + 1}`,
    duration: 3,
    purpose: index === 0 ? '建立问题' : (index === 119 ? '品牌收束' : '推动行动'),
    visual: `人物在场景中完成第 ${index + 1} 个可见步骤`,
    action: `人物从动作 ${index} 过渡到动作 ${index + 1}`,
    scene_id: 'scene_home',
    scene_name: '清晨住宅',
    scene_zone_label_zh: index % 2 ? '餐桌互动区' : '窗边行动区',
    entry_frame_state: [`杯子位于位置 ${index}`],
    exit_frame_state: [`杯子位于位置 ${index + 1}`],
    action_start: `手部开始动作 ${index}`,
    action_end: `手部结束动作 ${index + 1}`,
    keyframe_notes: `必须看见结果 ${index + 1}`,
    temporal_state: {
      state_before: [`杯子位于位置 ${index}`],
      intended_changes: [`杯子移动到位置 ${index + 1}`],
      state_after: [`杯子位于位置 ${index + 1}`],
      evidence_requirements: [`杯子位置 ${index + 1} 清晰可见`],
      invariants: ['人物身份、服装、杯子外观保持一致'],
    },
  };
}

function main() {
  const shots = Array.from({ length: 120 }, (_, index) => makeShot(index));
  const keyframes = shots.map((shot, index) => ({
    index: shot.index,
    image_url: `/assets/keyframe-${index + 1}.webp`,
    selected_candidate_id: `candidate-${index + 1}-a`,
    candidates: Array.from({ length: 8 }, (_, candidateIndex) => ({
      id: `candidate-${index + 1}-${candidateIndex}`,
      image_url: `/assets/keyframe-${index + 1}-${candidateIndex}.webp`,
      status: 'qa_passed',
    })),
  }));
  const clips = shots.map((shot, index) => ({
    index: shot.index,
    video_url: `/videos/shot-${index + 1}.mp4`,
    status: 'qa_passed',
    attempts: Array.from({ length: 7 }, (_, attemptIndex) => ({
      id: `video-${index + 1}-${attemptIndex}`,
      video_url: `/videos/shot-${index + 1}-${attemptIndex}.mp4`,
      status: attemptIndex === 0 ? 'qa_passed' : 'rejected',
    })),
  }));
  const workspace = directorWorkspace.createDirectorWorkspace({
    task: {
      id: 'director-workspace-test',
      title: '咖啡剧情广告',
      stage: 'video',
      status: 'working',
      content_revision: 9,
    },
    outputs: {
      context: {
        brief: '清晨住宅中的咖啡剧情广告',
        product_subject: '咖啡',
        target_duration: 30,
        output_ratio: '16:9',
        person_asset: {
          name: '林晓',
          image_url: '/assets/person.webp',
          view_images: [
            { key: 'front', image_url: '/assets/person-front.webp' },
            { key: 'side', image_url: '/assets/person-side.webp' },
          ],
        },
        product_asset: { name: '咖啡杯', image_url: '/assets/product.webp' },
      },
      blueprint: {
        story_title: '清晨重新开始',
        logline: '人物通过一杯咖啡从疲惫恢复专注。',
        characters: [{
          id: 'person_linxiao',
          name: '林晓',
          role: '广告主角',
          description: '自然可信的都市女性',
          clothing: '米色针织衫',
        }],
        narrative_contract: {
          setup: '人物疲惫地进入住宅',
          trigger: '看到桌上的咖啡杯',
          progression: '拿起并饮用咖啡',
          result: '恢复专注并完成工作',
          closure: '咖啡与早餐形成产品定格',
        },
        beats: shots.slice(0, 9).map((shot, index) => ({
          index: index + 1,
          title: shot.title,
          causal_role: index === 0 ? 'setup' : 'development',
          plot: shot.visual,
          action: shot.action,
          state_before: shot.temporal_state.state_before,
          state_after: shot.temporal_state.state_after,
          visible_evidence: shot.temporal_state.evidence_requirements,
        })),
      },
      scene_config: {
        scene_mode: 'single',
        spaces: [{
          id: 'scene_home',
          name: '清晨住宅',
          description: '窗边、木桌与早餐区关系清晰',
          story_purpose: '承载从疲惫到恢复专注的完整变化',
          scene_spec: {
            layoutText: '窗边、木桌和人物路线保持固定',
            materialLightText: '清晨侧逆光，木质桌面和陶瓷杯材质真实',
            interactionText: '人物从入口走到桌边，右手接触杯柄',
            negativeText: '不要提前出现尚未进入剧情的书和可颂',
            storyStates: [{
              id: 'state_opening',
              label: '开场',
              state_before: ['桌面为空'],
              visible_change: ['人物把咖啡杯放到桌上'],
              state_after: ['咖啡杯稳定停在桌面中央'],
              shot_refs: ['1', '2'],
            }],
            interactionAnchors: [{
              id: 'anchor_cup',
              label: '咖啡杯互动点',
              purpose: '右手拿取和放回杯子',
              contact_rules: ['手指必须完整接触杯柄'],
            }],
            routes: [{
              id: 'route_entry_table',
              label: '入口到餐桌',
              from: '入口',
              to: '餐桌互动区',
              actor: '林晓',
              continuity: '保持从左向右移动',
            }],
          },
        }],
      },
      scene_assets: [{
        scene_id: 'scene_home',
        name: '清晨住宅',
        image_url: '/assets/scene.webp',
        view_images: [
          { key: 'master', label: '空间全貌', image_url: '/assets/scene-master.webp' },
          { key: 'interaction', label: '互动区', image_url: '/assets/scene-action.webp' },
        ],
        scene_contract: {
          status: 'verified',
          zones: [{ id: 'zone_table', label_zh: '餐桌互动区', purpose: '放置和拿取咖啡杯' }],
          cameras: Array.from({ length: 30 }, (_, index) => ({ id: `camera-${index}`, secret: 'must-not-leak-to-director-view' })),
        },
      }],
      storyboard_table: shots,
      keyframes,
      video_clips: clips,
    },
    personProduction: {
      dossier: {
        status: 'approved',
        revision: 2,
        atomic_assets: [{ id: 'expression-smile', label: '放松微笑', image_url: '/assets/smile.webp' }],
        expressions: Array.from({ length: 6 }, () => ({})),
      },
      action_assets: [{
        id: 'action-shot-1',
        status: 'approved',
        image_url: '/assets/action-1.webp',
        contract: {
          shot_index: 1,
          start_pose: '手离开杯子',
          key_action: '右手拿起杯子',
          end_pose: '杯子停在唇边',
          prop_contact: '右手完整握住杯柄',
          eyeline: '看向杯子',
          expression_change: '疲惫转为放松',
        },
      }],
    },
  }, {
    sections: 'overview,people,scenes,story,shots,candidates,continuity',
    shotOffset: 40,
    shotLimit: 20,
    candidateLimit: 3,
  });

  assert.strictEqual(workspace.schema_version, 'director-workspace-v1');
  assert.strictEqual(workspace.shots.length, 20);
  assert.strictEqual(workspace.shots[0].index, 41);
  assert.strictEqual(workspace.pagination.has_more_shots, true);
  assert.strictEqual(workspace.pagination.next_shot_offset, 60);
  assert.strictEqual(workspace.shots[0].keyframe.candidates.length, 3);
  assert.strictEqual(workspace.shots[0].video.candidates.length, 3);
  assert.strictEqual(workspace.people.action_pack[0].key_action, '右手拿起杯子');
  assert.strictEqual(workspace.scenes[0].state_timeline[0].state_before[0], '桌面为空');
  assert.strictEqual(workspace.scenes[0].routes[0].from, '入口');
  assert.strictEqual(workspace.story.arc.trigger, '看到桌上的咖啡杯');
  assert.ok(workspace.shots[0].lineage_inputs.some(item => item.kind === 'person'));
  assert.ok(workspace.shots[0].lineage_inputs.some(item => item.kind === 'scene'));
  assert.ok(workspace.shots[0].lineage_inputs.some(item => item.kind === 'product'));
  assert.ok(workspace.payload_bytes < 160000, `director page payload too large: ${workspace.payload_bytes}`);
  assert.strictEqual(JSON.stringify(workspace).includes('must-not-leak-to-director-view'), false);
  assert.strictEqual(JSON.stringify(workspace).includes('"cameras"'), false);
  const structuredProfile = directorWorkspace._private.peopleProjection({
    cast_profiles: [{
      displayName: 'Structured Profile',
      roleName: 'Lead',
      appearance: { userPrompt: 'Natural appearance' },
      wardrobe: { userPrompt: 'Navy wardrobe' },
    }],
  }, {}, {});
  assert.strictEqual(structuredProfile.characters[0].profile, 'Natural appearance');
  assert.strictEqual(structuredProfile.characters[0].wardrobe, 'Navy wardrobe');
  assert.strictEqual(JSON.stringify(structuredProfile).includes('[object Object]'), false);

  const normalizedScene = normalizeSceneSpec({
    layoutText: '固定餐桌和窗边关系',
    materialLightText: '清晨侧光',
    interactionText: '从入口走向餐桌',
    storyStates: [{ id: 'state_1', label: '开场', state_before: ['桌面为空'], state_after: ['杯子出现'] }],
    interactionAnchors: [{ id: 'cup', label: '杯子', contact_rules: ['握住杯柄'] }],
    routes: [{ id: 'entry', label: '入口路线', from: '门口', to: '桌边' }],
  });
  assert.strictEqual(normalizedScene.storyStates.length, 1);
  assert.strictEqual(normalizedScene.interactionAnchors.length, 1);
  assert.strictEqual(normalizedScene.routes.length, 1);
  const preservedScene = sceneAssist.enforceAssistedSceneSpec({
    layoutText: '新的布局说明足够完整并且可用于当前剧情空间',
    materialLightText: '新的材质和光线说明足够完整并且可用于当前剧情',
    interactionText: '新的人物和商品互动路线说明足够完整',
    negativeText: '不要出现无关人物、文字、水印或额外空间',
    storyStates: [{ id: 'new-state' }],
  }, normalizedScene, { product_subject: '咖啡' }, { preserveCurrentFields: true });
  assert.strictEqual(preservedScene.storyStates[0].id, 'state_1');

  const routeSource = read('src/routes/newStoryAd.js');
  const uiSource = read('public/js/new-story-ad/director-workspace.js');
  const bootstrapSource = read('public/js/new-story-ad/bootstrap.js');
  const assetLoaderSource = read('public/js/new-story-ad/bootstrap-asset-loader.js');
  const htmlSource = read('public/digital-human.html');
  assert.match(routeSource, /router\.get\('\/tasks\/:id\/director-workspace'/);
  assert.match(uiSource, /sections,\s*shot_offset/);
  assert.match(uiSource, /loading="lazy"/);
  assert.match(bootstrapSource, /bootstrap-asset-loader\.js/);
  assert.match(bootstrapSource, /loadAssetModules/);
  assert.match(bootstrapSource, /const loadAssetModules = async \(\) => \{\s*await loadStoryAd\(\)/);
  assert.match(assetLoaderSource, /ASSET_STUDIO_SCRIPT_PATHS/);
  assert.strictEqual(
    bootstrapSource.includes('real-person-dossier.js'),
    false,
  );
  assert.match(htmlSource, /人物与场景档案/);
  assert.match(htmlSource, /导演故事板/);
  assert.match(htmlSource, /关键帧与候选视频/);
  assert.match(htmlSource, /技术机位/);
  assert.match(htmlSource, /dhNsaDirectorAssetsHost/);
  assert.match(htmlSource, /dhNsaDirectorStoryHost/);
  assert.match(htmlSource, /dhNsaDirectorCandidatesHost/);

  console.log(JSON.stringify({
    passed: true,
    checks: 38,
    shot_total: workspace.pagination.shot_total,
    paged_shots: workspace.shots.length,
    candidate_limit: workspace.pagination.candidate_limit,
    payload_bytes: workspace.payload_bytes,
    leaked_camera_fields: false,
    asset_studio_lazy: true,
  }));
}

main();
