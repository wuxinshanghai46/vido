'use strict';

const assert = require('assert/strict');
const contracts = require('../src/services/newStoryAd/negativeConstraintContractService');
const subjects = require('../src/services/newStoryAd/subjectAssetBundleService');

const rows = [
  ['shen_yanci_ancient', '禁止加入商品、品牌、销售感或与剧情无关的现代身份设定；避免现代潮流配饰；避免夸张玄幻铠甲；避免商品化展示', '禁止加入商品、品牌、销售感或与剧情无关的现代身份设定', '避免现代潮流配饰；避免夸张玄幻铠甲；避免商品化展示。'],
  ['shen_yanci_modern', '禁止加入商品、品牌、销售感或与剧情无关的现代身份设定；避免商业精英广告感；避免品牌标识；避免过度时尚化', '禁止加入商品、品牌、销售感或与剧情无关的现代身份设定', '避免商业精英广告感；避免品牌标识；避免过度时尚化。'],
  ['yun_zhiyue_ancient_identity', '不得将她与现代转世合并为同一叙事身份；不得加入原文之外的身世、职业或商品关系；避免现代服饰；避免过度妖艳或攻击性造型；避免商品化饰品特写', '不得将她与现代转世合并为同一叙事身份；不得加入原文之外的身世、职业或商品关系', '避免现代服饰；避免过度妖艳或攻击性造型；避免商品化饰品特写。'],
  ['yun_zhiyue_reincarnation', '不得补充原文之外的姓名、职业、家庭关系或记忆设定；不得加入商品、品牌或销售导向；避免华丽古装；避免浓妆；避免品牌、商品或广告化展示', '不得补充原文之外的姓名、职业、家庭关系或记忆设定；不得加入商品、品牌或销售导向', '避免华丽古装；避免浓妆；避免品牌、商品或广告化展示。'],
];

const profile = (id, negativeText, lookNegative, separator = '') => ({
  id, displayName: id, roleName: '剧情人物', age: '25~35岁', appearanceText: '稳定原创外貌',
  wardrobeText: `稳定服装。${separator}AI补齐：稳定鞋履与配饰`, hairMakeupText: '稳定发型与妆容。', negativeText,
  look_profiles: [{ id: `${id}-look`, name: '权威造型', wardrobeText: '稳定服装。AI补齐：稳定鞋履与配饰', hairMakeupText: '稳定发型与妆容', negativeText: lookNegative }],
});

for (const [id, oldTop, currentTop, lookNegative] of rows) {
  const relation = contracts.compareNegativeConstraintContracts(oldTop, currentTop, { previousSource: 'checkpoint_person', currentSource: 'current_person' });
  assert.equal(relation.version, 'negative-constraint-v1');
  assert.equal(relation.relation, 'monotonic_relaxation');
  assert(relation.previous.constraints.every(row => row.category && row.tokens.length && row.source === 'checkpoint_person'));
  assert.equal(subjects.personProfileResumeCompatible(
    profile(id, oldTop, lookNegative), profile(id, currentTop, lookNegative, '；'),
  ), true, `${id} must reuse the retained images after semantic negative normalization`);
}

const added = profile(rows[0][0], `${rows[0][2]}；禁止改变人物发型`, rows[0][3]);
assert.equal(subjects.personProfileResumeCompatible(profile(rows[0][0], rows[0][1], rows[0][3]), added), false,
  'a real new restriction must remain blocked even when the other clauses are a relaxation');
console.log(JSON.stringify({ passed: true, production_people: 4, semantic_relaxations: 4, added_restriction_blocked: true, model_calls: 0 }));
