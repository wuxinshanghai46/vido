const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

const knowledge = require('../src/services/newStoryAd/wardrobeStyleKnowledgeService');
const completion = require('../src/services/newStoryAd/generationSpecCompletionService');
const personLooks = require('../src/services/newStoryAd/personLookProfileService');
const dossier = require('../src/services/newStoryAd/dossierCompositeService');
const seedDocs = require('../src/services/seeds/wardrobe_scene_style_knowledge');

function storage() {
  const rows = new Map();
  return {
    getOutput(taskId, kind) { return rows.get(`${taskId}:${kind}`) || null; },
    saveOutput(taskId, kind, value) { rows.set(`${taskId}:${kind}`, JSON.parse(JSON.stringify(value))); return value; },
  };
}

async function run() {
  assert.equal(seedDocs.length, 7, '本轮应落库七条结构化装束/场景知识');
  assert(seedDocs.every(doc => Array.isArray(doc.source_urls) && doc.source_urls.length === 26), '每条知识必须保留本轮 26 篇参考来源链路');
  assert.equal(new Set(seedDocs[0].source_urls).size, 26, '参考来源不得重复或丢失');
  assert(seedDocs.some(doc => doc.runtime_policy?.rules?.some(rule => rule.id === 'person-structured-wardrobe-contract')));
  const seededIds = new Set(seedDocs.map(doc => doc.id));
  assert(knowledge.STYLE_FAMILIES.every(family => seededIds.has(family.doc_id)), '每个运行时风格分支都必须引用真实落库的知识 ID');

  const ancient = knowledge.resolve({
    brief: '同一名女性从宋代穿越到现代都市',
    profile: { roleName: '时空连接者' },
    look: { name: '古代造型', story_state: '宋代', wardrobeText: '宋式长衫' },
  });
  assert.equal(ancient.families[0].id, 'chinese_historical');
  const modern = knowledge.resolve({
    brief: '同一名女性从宋代穿越到现代都市',
    profile: { roleName: '时空连接者' },
    look: { name: '现代造型', story_state: '现代', wardrobeText: '通勤衬衫' },
  });
  assert.equal(modern.families[0].id, 'modern_contemporary', '造型本地证据必须压过任务中另一时代的弱匹配');
  assert.equal(knowledge.resolve({ brief: '民国旧上海女记者穿旗袍' }).families[0].id, 'republican_china');
  assert.equal(knowledge.resolve({ brief: '国外风格的现代男士商务造型' }).families[0].id, 'international_style');
  assert.match(knowledge.promptBlock({ brief: '古装美女' }), /不得把古代与现代/);

  assert.deepEqual(
    completion.wardrobeMissingComponents('粉色真丝齐胸襦裙、米白色绣花鞋、金色发簪固定高髻'),
    [],
    '齐胸襦裙是完整分层服制，不得再误报 garment/lower',
  );
  assert.deepEqual(
    completion.wardrobeMissingComponents('月白色棉麻宋式长衫、黑色布鞋、木簪束发，无其他配饰'),
    [],
    '宋式长衫是完整袍服，不得再误报 garment/lower',
  );
  assert.deepEqual(
    completion.wardrobeMissingComponents('墨绿色真丝旗袍、黑色皮革低跟鞋、珍珠耳钉'),
    [],
    '民国旗袍必须作为完整连体服识别',
  );
  assert.deepEqual(
    completion.wardrobeMissingComponents('藏青色羊毛西装外套搭配白色棉质衬衫和灰色羊毛长裤、棕色皮鞋、银色腕表'),
    [],
    '现代男装上装+下装闭环必须通过',
  );

  const historicalProfile = {
    wardrobeText: '古代场景中，穿着一套素雅的淡青色宋式长衫，无繁复绣花，长发用木簪挽起。腰间系深色织锦腰带并佩戴白玉腰佩，脚穿黑色布靴。',
    hairMakeupText: '长发用木簪挽起，干净自然淡妆',
  };
  const repeatedSentence = historicalProfile.wardrobeText;
  const repeatedProjection = knowledge.normalizeContract({
    garment_system: { mode: 'one_piece', items: [{ slot: 'one_piece', type: repeatedSentence }] },
    footwear: { type: repeatedSentence },
    accessories: { mode: 'specified', items: [{ type: repeatedSentence }] },
    palette: { colors: [repeatedSentence] },
    materials: [{ name: repeatedSentence }],
  }, repeatedSentence, { profile: historicalProfile });
  assert(
    knowledge.missingComponents(repeatedProjection).includes('structured_inventory'),
    '同一整段描述复制进衣服、鞋、配饰、颜色和材质时必须被结构质量门禁拒绝',
  );
  const correctedProjection = knowledge.buildEvidenceContract(historicalProfile.wardrobeText, { profile: historicalProfile });
  assert(!knowledge.missingComponents(correctedProjection).includes('structured_inventory'), '新确定性投影必须按语义分句，不得继续制造跨字段整段复制');
  assert.deepEqual(
    dossier.explicitAccessoryDefinitions(historicalProfile).map(item => item.key),
    ['hair_makeup', 'hair_accessories', 'waist_accessories', 'shoes'],
    '古代男装档案必须独立呈现发型妆面、发饰、腰佩和鞋履证据',
  );
  const femaleDefinitions = dossier.explicitAccessoryDefinitions({
    wardrobeText: '浅粉色齐胸襦裙、珍珠耳坠、绣花鞋',
    hairMakeupText: '高髻佩戴珠花与步摇，清透淡妆',
  }).map(item => item.key);
  assert.deepEqual(femaleDefinitions, ['hair_makeup', 'hair_accessories', 'ear_accessories', 'shoes']);

  const explicitContract = knowledge.normalizeContract({
    style_family: 'task_defined',
    garment_system: { mode: 'one_piece', items: [{ slot: 'one_piece', type: '星纹礼衣', evidence: '星纹礼衣' }] },
    footwear: { type: '软底鞋', color: '银灰', material: '皮革', evidence: '银灰皮革软底鞋' },
    accessories: { mode: 'none', items: [], evidence: '无配饰' },
    palette: { colors: ['银灰', '深蓝'], evidence: '银灰与深蓝' },
    materials: [{ name: '织锦', used_for: '礼衣', evidence: '织锦礼衣' }],
  }, '星纹礼衣、银灰皮革软底鞋、无配饰、深蓝织锦');
  assert.deepEqual(knowledge.missingComponents(explicitContract), []);

  let calls = 0;
  const completed = await completion.completePersonProfiles({
    taskId: 'structured-contract-terminal',
    brief: '架空世界礼仪场景',
    castProfiles: [{ id: 'envoy', displayName: '使者', roleName: '礼仪使者', wardrobeText: '深蓝织锦星纹礼衣、银灰皮革软底鞋、无配饰' }],
  }, {
    storage: storage(), forceModel: true,
    jsonRepair: { async parseOrRepair({ raw }) { return JSON.parse(raw); } },
    modelGateway: { async generateText(input) {
      calls += 1;
      assert.match(input.systemPrompt, /wardrobe_contract/);
      return { used_model: 'mock/structured', text: JSON.stringify({ completions: [{
        id: 'envoy', index: 0, look_id: 'envoy_look_1', look_index: 0, wardrobe_supplement: '主色深蓝、辅色银灰',
        wardrobe_contract: explicitContract,
      }] }) };
    } },
  });
  assert.equal(calls, 1);
  assert.equal(completed.cast_profiles[0].look_profiles[0].wardrobe_contract.garment_system.items[0].type, '星纹礼衣');
  assert.deepEqual(knowledge.missingComponents(completed.cast_profiles[0].look_profiles[0].wardrobe_contract), []);

  const normalized = personLooks.normalizeProfileLooks(completed.cast_profiles[0]);
  assert.equal(normalized.look_profiles[0].wardrobe_contract.garment_system.mode, 'one_piece', '跨层归一化不得丢失结构化服装合同');
  assert(normalized.look_profiles[0].knowledge_refs.length > 0, '造型必须保留实际选中的知识条目 ID');

  const allSeeds = require('../src/services/knowledgeBaseSeed');
  assert(seedDocs.every(doc => allSeeds.some(item => item.id === doc.id)), '新增知识必须接入启动时实际落库的 seed 聚合器');
  const root = path.resolve(__dirname, '..');
  const assistSource = fs.readFileSync(path.join(root, 'src/services/newStoryAd/storyAdService.js'), 'utf8');
  const plannerSource = fs.readFileSync(path.join(root, 'src/services/newStoryAd/assetPlanService.js'), 'utf8');
  const completionSource = fs.readFileSync(path.join(root, 'src/services/newStoryAd/generationSpecCompletionService.js'), 'utf8');
  assert.doesNotMatch(assistSource, /wardrobeStyleKnowledge\.promptBlock/, '人物 AI 帮写不得继续注入重复 wardrobe 长提示块');
  assert.doesNotMatch(plannerSource, /wardrobeStyleKnowledge\.promptBlock/, '统一资产规划不得继续注入重复 wardrobe 长提示块');
  assert.match(assistSource, /worldSetting\.promptBlock/, '人物 AI 帮写必须使用项目级世界设定合同');
  assert.match(plannerSource, /worldSetting\.promptBlock/, '统一资产规划必须使用项目级世界设定合同');
  assert.match(completionSource, /wardrobeKnowledge\.promptBlock/, '仅缺项补齐阶段保留紧凑服装知识选择器');
  assert.match(plannerSource, /wardrobe_contract/, '资产规划输出必须携带结构化服装合同');

  console.log(JSON.stringify({
    passed: true,
    seed_docs: seedDocs.length,
    source_urls: seedDocs[0].source_urls.length,
    style_cases: 4,
    wardrobe_cases: 4,
    structured_terminal_model_calls: calls,
  }, null, 2));
}

run().catch(error => { console.error(error); process.exitCode = 1; });
