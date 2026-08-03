const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const brief = fs.readFileSync(path.join(root, 'public/story-ad/views/briefView.js'), 'utf8');
const report = fs.readFileSync(path.join(root, 'public/story-ad/views/referenceUnderstandingView.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public/story-ad/reference-understanding.css'), 'utf8');

assert.match(brief, /import\('\.\/referenceUnderstandingView\.js\?v=/, '深度报告必须按需加载，不能加入所有项目首屏');
assert.match(brief, /String\(reference\.status \|\| ''\)\.toLowerCase\(\) === 'completed'/, '分析未完成时不得挂载理解报告');
assert.match(brief, /请先确认参考理解报告/, '深度报告存在时，未确认不得进入资产创建');
assert.match(brief, /understandingController\?\.destroy\(\)/, '视图退出时必须释放报告事件与 DOM');

for (const field of ['story_bible', 'story_events', 'character_arcs', 'scene_narratives', 'brand_role', 'audio_visual_alignment', 'inferences', 'unknowns']) {
  assert.match(report, new RegExp(`\\b${field}\\b`), `报告缺少 ${field} 消费合同`);
}
for (const alias of ['story_summary', 'causal_chain', 'characters', 'scenes', 'audio_visual']) {
  assert.match(report, new RegExp(`\\b${alias}\\b`), `报告必须兼容服务端权威字段 ${alias}`);
}
for (const tab of ['故事全貌', '时间线', '人物与关系', '场景', '商品与品牌', '镜头与运镜', '旁白、字幕与声音']) {
  assert.ok(report.includes(tab), `报告缺少页签：${tab}`);
}
assert.match(report, /const MAX_ITEMS = 120;/, '长视频数组必须有 DOM 条目上限');
assert.match(report, /const MAX_EVIDENCE_BADGES = 8;/, '单条记录的证据标签必须有 DOM 上限');
assert.match(report, /preload="metadata"/, '参考视频不得在首屏预加载完整媒体');
assert.match(report, /data-reference-seek/, '证据必须支持跳转到对应时间');
assert.match(report, /return 'inference'/, '必须区分合理推断');
assert.match(report, /return 'unknown'/, '必须区分尚未确认');
assert.match(report, /return 'corrected'/, '必须区分用户修正');
assert.match(report, /return fallback/, '必须保留可见事实作为默认状态');
for (const kind of ['fact', 'inference', 'unknown', 'corrected']) {
  assert.match(css, new RegExp(`\\.reference-claim-status\\.is-${kind}`), `必须为 ${kind} 提供可见样式区分`);
}

assert.match(report, /\/reference-understanding\/confirm/, '确认操作必须使用独立的权威输入接口');
assert.match(report, /analysis_id: analysisId, base_revision: baseRevision, confirmation: 'authoritative_input'/, '确认操作必须携带分析编号、基线版本和确认语义');
assert.match(report, /bundle\?\.revisions\?\.content/, '确认必须使用项目内容版本，不能误用分析合同版本');
assert.match(report, /error\?\.status === 409/, '必须处理并发版本冲突');
assert.match(report, /不会自动生成任何资产/, '确认后必须明确告知不会触发生成');
assert.doesNotMatch(report, /runStage\s*\(/, '理解报告不得直接触发任何生成阶段');
assert.doesNotMatch(report, /scene-config|generate-keyframe|generate-video/, '理解报告不得绑定下游生成接口');

assert.match(report, /document\.createElement\('link'\)/, '报告样式必须随报告按需加载');
assert.match(css, /@media \(max-width: 600px\)/, '报告必须支持移动端');
assert.ok(Buffer.byteLength(report) < 50000, '报告模块过大，会增加解析和缓存成本');
assert.ok(Buffer.byteLength(css) < 18000, '报告样式过大，会增加首次查看成本');

const fixedIndustryTerms = ['汽车行业专用', '美妆行业专用', '家居行业专用', '餐饮行业专用'];
fixedIndustryTerms.forEach(term => assert.ok(!report.includes(term), `报告不应写死行业：${term}`));

function browserFunctions(source, names) {
  const executable = source
    .replace(/^import[^;]+;\s*$/gm, '')
    .replace(/export\s+(?=(?:async\s+)?function\s+)/g, '')
    + `\n;globalThis.__tested = { ${names.join(', ')} };`;
  const sandbox = { console };
  vm.runInNewContext(executable, sandbox, { filename: 'reference-understanding-ui-contract.js' });
  return sandbox.__tested;
}

const reportFunctions = browserFunctions(report, ['hasReferenceUnderstanding', 'isReferenceUnderstandingConfirmed']);
const backendShape = {
  analysis_id: 'analysis-1', status: 'completed', analysis_valid: true,
  reference_understanding: {
    schema_version: 6,
    story_summary: { full_synopsis: '完整故事' },
    causal_chain: [{ id: 'event-1', range: [0, 2], action: '主体行动', evidence_refs: ['F001'] }],
    characters: [], scenes: [], audio_visual: { alignments: [] },
  },
  understanding_confirmation: { status: 'unconfirmed', ready: true },
};
assert.strictEqual(reportFunctions.hasReferenceUnderstanding(backendShape), true, '服务端原始 V6 结构必须能挂载报告');
assert.strictEqual(reportFunctions.isReferenceUnderstandingConfirmed(backendShape), false, '未确认报告不得误判为已确认');
assert.strictEqual(reportFunctions.isReferenceUnderstandingConfirmed({ ...backendShape, understanding_confirmation: { status: 'confirmed', ready: true } }), true, '服务端确认状态必须被识别');

const briefFunctions = browserFunctions(brief, ['referenceActionState']);
assert.strictEqual(briefFunctions.referenceActionState(backendShape).blocked, true, '深度报告未确认时必须阻止资产创建');
assert.strictEqual(briefFunctions.referenceActionState({ ...backendShape, understanding_confirmation: { status: 'confirmed', ready: true } }).blocked, false, '确认后才允许用户主动进入资产创建');

console.log(JSON.stringify({
  passed: true,
  checks: 40,
  tabs: 7,
  max_items: 120,
  max_evidence_badges: 8,
  report_bytes: Buffer.byteLength(report),
  css_bytes: Buffer.byteLength(css),
  paid_generation_calls: 0,
}));
