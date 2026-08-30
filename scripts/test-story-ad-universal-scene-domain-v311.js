#!/usr/bin/env node
'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

const sceneDomain = require('../src/services/newStoryAd/sceneDomainContractService');
const subjectQa = require('../src/services/newStoryAd/storyboardSubjectQaService');

let checks = 0;
function verify(label, assertion) {
  assertion();
  checks += 1;
  process.stdout.write(`PASS ${String(checks).padStart(2, '0')} ${label}\n`);
}

function person(id) {
  return { id, name: id };
}

function animal(id, species) {
  return { id, name: id, species };
}

function vehicle(id, model) {
  return { id, name: id, model };
}

const cases = [
  {
    label: '室内人物互动',
    input: {
      shot: {
        title: '住宅客厅中的人物互动',
        action: '陈默站在整面材料墙前，右手触碰铜色样板',
        decisive_moment: '陈默独自站在整面材料墙前，右手指尖刚接触铜色样板',
        expected_people: 1,
        characters: [person('person_chenmo')],
      },
      sceneAsset: { name: '现代住宅室内客厅' },
    },
    expected: { environment: 'interior', subject: 'human', motion: 'interaction', topology: 'bounded_space', people: 1 },
  },
  {
    label: '户外追逐',
    input: {
      shot: {
        title: '山地森林户外追逐',
        action: '林岚在前方奔跑，周野保持距离追赶',
        decisive_moment: '林岚跃过倒木的瞬间，周野仍在后方追赶且两人清晰分离',
        expected_people: 2,
        characters: [person('person_lan'), person('person_zhou')],
      },
      sceneAsset: { name: '山地森林户外路径' },
    },
    expected: { environment: 'exterior', subject: 'human', motion: 'pursuit', topology: 'open_terrain', people: 2 },
  },
  {
    label: '道路车辆',
    input: {
      shot: {
        title: '公路车辆编队行驶',
        action: '两辆汽车沿同一车道向前行驶并保持安全车距',
        decisive_moment: '两辆汽车在弯道中保持同向、同车道和清晰前后间距',
        environment_archetype: 'roadway',
        primary_subject_class: 'vehicle',
        motion_model: 'rigid_body',
        expected_vehicles: 2,
        vehicles: [vehicle('vehicle_lead', '轿车'), vehicle('vehicle_follow', 'SUV')],
      },
    },
    expected: { environment: 'roadway', subject: 'vehicle', motion: 'rigid_body', topology: 'network_path', vehicles: 2 },
  },
  {
    label: '动物群体',
    input: {
      shot: {
        title: '草原动物群体迁徙',
        action: '三匹马组成小型马群向河谷迁徙',
        decisive_moment: '三匹马朝同一方向越过草坡，个体轮廓彼此分离',
        expected_animals: 3,
        animals: [animal('horse_alpha', '马'), animal('horse_beta', '马'), animal('horse_gamma', '马')],
      },
      sceneAsset: { name: '开阔草原户外场景' },
    },
    expected: { environment: 'exterior', subject: 'animal', motion: 'flock', topology: 'open_terrain', animals: 3 },
  },
  {
    label: '抽象变形',
    input: {
      shot: {
        title: '抽象粒子形态变化',
        action: '蓝色粒子聚合并变形成单一环状能量体',
        decisive_moment: '蓝色粒子刚聚合成一个完整环状能量体，视觉中心保持稳定',
        subject_archetype: 'abstract',
      },
      sceneAsset: { name: '抽象能量场' },
    },
    expected: { environment: 'abstract', subject: 'abstract', motion: 'transformation', topology: 'abstract_field' },
  },
  {
    label: '工业流程',
    input: {
      shot: {
        title: '工厂机械臂装配流程',
        action: '机械臂将一个金属零件压入固定夹具',
        decisive_moment: '机械臂夹爪与金属零件接触，零件刚对准固定夹具',
        primary_subject_class: 'product',
        expected_products: 1,
        products: [{ id: 'part_steel', on_screen: true }],
      },
      sceneAsset: { name: '自动化工厂生产线' },
    },
    expected: { environment: 'industrial', subject: 'product', motion: 'process', topology: 'workcell', products: 1 },
  },
  {
    label: '空中场景',
    input: {
      shot: {
        title: '无人机穿越高空云层',
        action: '一架无人机沿固定航向飞行并保持高度',
        decisive_moment: '一架无人机位于云层上方，机头朝向航线前方且地平线清晰',
        expected_vehicles: 1,
        vehicles: [vehicle('drone_survey', '测绘无人机')],
      },
      sceneAsset: { name: '天空与云层航空环境' },
    },
    expected: { environment: 'airborne', subject: 'vehicle', motion: 'rigid_body', topology: 'air_volume', vehicles: 1 },
  },
  {
    label: '水域场景',
    input: {
      shot: {
        title: '河流水域中的单艇航行',
        action: '一艘小艇顺流航行并保持完整船体与水线',
        decisive_moment: '一艘小艇经过河道中央，船体、水线和航向同时清晰可见',
        expected_vehicles: 1,
        vehicles: [vehicle('boat_rescue', '救援艇')],
      },
      sceneAsset: { name: '开阔河流水域' },
    },
    expected: { environment: 'aquatic', subject: 'vehicle', motion: 'rigid_body', topology: 'water_volume', vehicles: 1 },
  },
];

const compiled = cases.map(testCase => ({
  ...testCase,
  contract: sceneDomain.compile(testCase.input),
}));

for (const testCase of compiled) {
  const { label, contract, expected } = testCase;
  verify(`${label}：领域、主体、运动与空间拓扑正确`, () => {
    assert.equal(contract.environment_archetype, expected.environment);
    assert.equal(contract.primary_subject_class, expected.subject);
    assert.equal(contract.motion_model, expected.motion);
    assert.equal(contract.spatial_topology, expected.topology);
  });
  verify(`${label}：结构化主体数量精确`, () => {
    for (const key of ['people', 'animals', 'vehicles', 'products']) {
      if (Object.prototype.hasOwnProperty.call(expected, key)) {
        assert.equal(contract.subject_counts[key], expected[key], `${label} ${key} 数量不匹配`);
      }
    }
    assert.equal(contract.subject_counts.strict_principal_counts, true);
  });
  verify(`${label}：提示词锁定精确数量、身份唯一与决定性单帧`, () => {
    const prompt = sceneDomain.promptBlock(contract);
    assert.match(prompt, /同一身份不得[^。]*复制成多个实例/u);
    assert.match(prompt, /不得新增、删除、合并或替换主体/u);
    assert.match(prompt, /本张图只呈现这个决定性瞬间/u);
    assert.match(prompt, /禁止把不同时间位置同时画进一张图/u);
    assert.match(prompt, new RegExp(contract.decisive_moment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'u'));
  });
  if (expected.environment !== 'interior') {
    verify(`${label}：非室内提示不注入入口或展示墙要求`, () => {
      assert.doesNotMatch(sceneDomain.promptBlock(contract), /室内专属入口|展厅入口|展示墙|showroom entrance|display wall/iu);
    });
  }
}

verify('结构化字段优先于场景、上下文和文本推断', () => {
  const contract = sceneDomain.compile({
    shot: {
      title: '室内展厅人物走向展示墙',
      environment_archetype: 'aquatic',
      primary_subject_class: 'animal',
      motion_model: 'flock',
      expected_animals: 2,
      animals: [animal('dolphin_one', '海豚'), animal('dolphin_two', '海豚')],
      decisive_moment: '两只海豚在同一水深并排转向',
    },
    sceneAsset: {
      name: '室内商业展厅',
      environment_archetype: 'interior',
      subject_archetype: 'human',
      motion_model: 'interaction',
    },
    scenePlanningContract: {
      environment_archetype: 'roadway',
      subject_archetype: 'vehicle',
      motion_model: 'pursuit',
    },
    context: {
      environment_archetype: 'industrial',
      subject_archetype: 'product',
      motion_model: 'process',
    },
  });
  assert.equal(contract.environment_archetype, 'aquatic');
  assert.equal(contract.primary_subject_class, 'animal');
  assert.equal(contract.motion_model, 'flock');
  assert.equal(contract.subject_counts.animals, 2);
});

verify('显式决定性瞬间优先于多阶段动作描述', () => {
  const shot = {
    action: '人物从门口进入，走过通道，拿起产品，最后离开画面',
    decisive_moment: '人物右手刚拿起唯一产品，双脚停在操作台前',
    expected_people: 1,
    characters: [person('person_operator')],
  };
  assert.equal(sceneDomain.decisiveMoment(shot), shot.decisive_moment);
  assert.match(sceneDomain.promptBlock(sceneDomain.compile({ shot })), /人物右手刚拿起唯一产品，双脚停在操作台前/u);
});

const onePersonExpected = {
  people: 1,
  animals: 0,
  vehicles: 0,
  products: 0,
  people_ids: ['person_chenmo'],
  animal_ids: [],
  vehicle_ids: [],
  strict_principal_counts: true,
  background_crowd_allowed: false,
};

verify('主体 QA 拒绝预期 1 人但实际 2 人', () => {
  const result = subjectQa.evaluate({
    pass: true,
    visible_people: 2,
    visible_animals: 0,
    visible_vehicles: 0,
    visible_products: 0,
    duplicated_identity: false,
  }, onePersonExpected);
  assert.equal(result.pass, false);
  assert.deepEqual(result.count_mismatches, ['people']);
  assert.equal(result.actual.people, 2);
});

verify('主体 QA 拒绝同一身份重复实例', () => {
  const result = subjectQa.evaluate({
    pass: true,
    visible_people: 1,
    visible_animals: 0,
    visible_vehicles: 0,
    visible_products: 0,
    same_identity_multiple_instances: true,
  }, onePersonExpected);
  assert.equal(result.pass, false);
  assert.equal(result.duplicated_identity, true);
  assert.deepEqual(result.count_mismatches, []);
});

verify('主体 QA 即使模型错误报告一人，也按同身份实例数拒绝重复人物', () => {
  const result = subjectQa.evaluate({
    pass: true,
    visible_people: 1,
    visible_animals: 0,
    visible_vehicles: 0,
    visible_products: 0,
    duplicated_identity: false,
    same_identity_multiple_instances: false,
    same_identity_instance_count: 2,
  }, onePersonExpected);
  assert.equal(result.pass, false);
  assert.equal(result.duplicated_identity, true);
});

verify('主体 QA 在数量、身份和模型判定均匹配时通过', () => {
  const result = subjectQa.evaluate({
    pass: true,
    visible_people: 1,
    visible_animals: 0,
    visible_vehicles: 0,
    visible_products: 0,
    duplicated_identity: false,
    same_identity_multiple_instances: false,
  }, onePersonExpected);
  assert.equal(result.pass, true);
  assert.deepEqual(result.count_mismatches, []);
  assert.equal(result.duplicated_identity, false);
  assert.deepEqual(result.actual, { people: 1, animals: 0, vehicles: 0, products: 0 });
});

verify('旧版主体 QA 结果必须失效，不能继续进入视频生成', () => {
  const imageGateSource = fs.readFileSync(path.join(__dirname, '../src/services/storyAdWorkspace/storyboardImageConfirmationGateService.js'), 'utf8');
  assert.match(imageGateSource, /subject_qa_policy_version[\s\S]*storyboardSubjectQa\.QA_POLICY_VERSION/);
  assert.match(imageGateSource, /SUBJECT_COUNT_QA_POLICY_OUTDATED/);
});

function cssRule(source, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = source.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 's'));
  assert.ok(match, `缺少 CSS 规则：${selector}`);
  return match[1].replace(/\s+/g, '');
}

const storyboardCss = fs.readFileSync(path.join(__dirname, '../public/story-ad/storyboard-simple.css'), 'utf8');
const storyboardView = fs.readFileSync(path.join(__dirname, '../public/story-ad/views/storyboardView.js'), 'utf8');
const workspaceRoute = fs.readFileSync(path.join(__dirname, '../src/routes/storyAdWorkspace.js'), 'utf8');
const sketchServiceSource = fs.readFileSync(path.join(__dirname, '../src/services/storyAdWorkspace/storyboardSketchService.js'), 'utf8');
const projectBundleSource = fs.readFileSync(path.join(__dirname, '../src/services/storyAdWorkspace/projectBundleService.js'), 'utf8');

verify('分镜操作栏保持紧凑并靠右', () => {
  const actionBar = cssRule(storyboardCss, '.storyboard-simple-view .sketch-tile-editor > .sketch-action-bar');
  assert.match(actionBar, /display:flex/);
  assert.match(actionBar, /justify-content:flex-end/);
  assert.match(actionBar, /margin:0/);
  assert.match(actionBar, /padding:6px10px8px/);
  assert.match(actionBar, /border-top:0/);
});

verify('分镜操作按钮组宽度随内容收敛并贴右', () => {
  const actions = cssRule(storyboardCss, '.storyboard-simple-view .sketch-actions');
  assert.match(actions, /display:flex/);
  assert.match(actions, /justify-content:flex-end/);
  assert.match(actions, /width:auto/);
  assert.match(actions, /margin-left:auto/);
  assert.match(actions, /gap:6px/);
});

verify('分镜操作按钮尺寸符合紧凑合同', () => {
  const buttons = cssRule(storyboardCss, '.storyboard-simple-view .sketch-actions .btn');
  assert.match(buttons, /width:auto/);
  assert.match(buttons, /min-width:86px/);
  assert.match(buttons, /min-height:30px/);
  assert.match(buttons, /padding:5px11px/);
  assert.match(buttons, /font-size:10px/);
});

verify('逐镜编辑器展示引用、提示词并通过独立零生成路由保存', () => {
  assert.match(storyboardView, /本镜引用资产/u);
  assert.match(storyboardView, /data-sketch-prompt/u);
  assert.match(storyboardView, /data-save-sketch-prompt/u);
  assert.match(storyboardView, /storyboard-images\/\$\{shotIndex\}\/prompt/u);
  assert.match(storyboardView, /仅本镜需重新生成/u);
  assert.match(workspaceRoute, /storyboard-images\/:shotIndex\/prompt/u);
  assert.match(workspaceRoute, /savePromptOverride/u);
  assert.match(sketchServiceSource, /用户可编辑的本镜创作提示/u);
  assert.match(projectBundleSource, /prompt_defaults/u);
  assert.match(projectBundleSource, /sceneDomainContract\.userPrompt/u);
});

console.log(JSON.stringify({
  ok: true,
  contract: 'story_ad_universal_scene_domain_v311',
  domains: cases.map(item => item.label),
  checks,
  provider_calls: 0,
  production_writes: 0,
}, null, 2));
