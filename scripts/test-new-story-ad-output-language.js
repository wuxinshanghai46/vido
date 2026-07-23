const assert = require('assert');
const {
  assessChineseContent,
  ensureChineseOutput,
} = require('../src/services/newStoryAd/outputLanguageService');
const { inferVisibleTextPolicy } = require('../src/services/newStoryAd/contextBuilder');

async function main() {
  const source = {
    story_title: 'Secure Token Platform',
    logline: 'A developer discovers one secure and affordable platform for every AI model.',
    beat_style: 'content_driven_visual_beats',
    beats: [{
      beat_index: 1,
      role: 'Opening',
      subject_type: 'human_scene',
      scene_id: 'scene_001',
      duration: 5,
      visual: 'The developer studies a transparent dashboard in a quiet technology studio.',
      action: 'She selects a model and checks the stable connection status.',
      spoken_line: 'One platform makes every model easier to use.',
    }],
  };
  const translated = {
    story_title: '安全稳定的 Token 聚合平台',
    logline: '一名开发者发现了一个安全、稳定且价格友好的 AI 模型聚合平台。',
    beat_style: '错误改写的枚举',
    beats: [{
      beat_index: 99,
      role: '开场',
      subject_type: '错误枚举',
      scene_id: '错误场景',
      duration: 99,
      visual: '开发者在安静的科技工作室中查看透明的数据面板。',
      action: '她选择一个模型，并确认连接状态稳定。',
      spoken_line: '一个平台，让所有模型都更容易使用。',
    }],
  };
  assert.equal(assessChineseContent(source).needsRepair, true);
  const gateway = {
    generateText: async () => ({ text: JSON.stringify(translated), used_model: 'test/translator', fallback_used: false, failed_models: [] }),
  };
  const repair = {
    parseOrRepair: async ({ raw }) => JSON.parse(raw),
  };
  const result = await ensureChineseOutput({ payload: source, kind: 'blueprint', taskId: 'language-test', context: {}, gateway, repair });
  assert.equal(result.repaired, true);
  assert.equal(assessChineseContent(result.payload).needsRepair, false);
  assert.equal(result.payload.story_title, translated.story_title);
  assert.equal(result.payload.beat_style, source.beat_style);
  assert.equal(result.payload.beats[0].beat_index, 1);
  assert.equal(result.payload.beats[0].subject_type, 'human_scene');
  assert.equal(result.payload.beats[0].scene_id, 'scene_001');
  assert.equal(result.payload.beats[0].duration, 5);

  const strictContext = {
    visible_text_policy: inferVisibleTextPolicy({}, '所有内容必须使用全中文，禁止出现英文字母和问号'),
  };
  assert.equal(strictContext.visible_text_policy.language, 'zh_only');
  const strictSource = {
    business_boundary: '展示维度智能视频创作平台',
    advertised_subject: '维度智能视频创作平台',
    story_strategy: ['结尾使用中文Slogan?', '展示完整创作流程'],
    cast_mode: 'single',
  };
  const strictTranslated = {
    business_boundary: '展示维度智能视频创作平台',
    advertised_subject: '维度智能视频创作平台',
    story_strategy: ['结尾使用中文宣传语', '展示完整创作流程'],
    cast_mode: 'wrong-but-invisible',
  };
  assert.equal(assessChineseContent(strictSource, { strict_chinese_only: true }).needsRepair, true);
  const strictResult = await ensureChineseOutput({
    payload: strictSource,
    kind: 'scene_config',
    taskId: 'strict-language-test',
    context: strictContext,
    gateway: {
      generateText: async () => ({
        text: JSON.stringify(strictTranslated),
        used_model: 'test/translator',
        fallback_used: false,
        failed_models: [],
      }),
    },
    repair,
  });
  assert.equal(strictResult.repaired, true);
  assert.equal(strictResult.payload.story_strategy[0], '结尾使用中文宣传语');
  assert.equal(strictResult.payload.cast_mode, 'single');
  assert.equal(assessChineseContent(strictResult.payload, { strict_chinese_only: true }).needsRepair, false);

  await assert.rejects(
    ensureChineseOutput({
      payload: strictSource,
      kind: 'scene_config',
      taskId: 'strict-language-failure-test',
      context: strictContext,
      gateway: {
        generateText: async () => ({
          text: JSON.stringify(strictSource),
          used_model: 'test/translator',
          fallback_used: false,
          failed_models: [],
        }),
      },
      repair,
    }),
    error => error?.code === 'OUTPUT_LANGUAGE_INVALID',
  );
  console.log('PASS new story ad Chinese output guard');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
