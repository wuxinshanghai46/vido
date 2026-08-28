const assert = require('assert/strict');

const docs = require('../src/services/seeds/previz_comic_style_knowledge');
const allSeeds = require('../src/services/knowledgeBaseSeed');

function run() {
  assert.equal(docs.length, 26, '必须包含 1 条白模预演知识和本地附件中 25 条可核对画风');
  assert.equal(new Set(docs.map(doc => doc.id)).size, docs.length, '知识 ID 不得重复');
  assert(docs.every(doc => doc.enabled && doc.lang === 'zh'), '新增知识必须可检索且语言正确');
  assert(docs.every(doc => allSeeds.some(seed => seed.id === doc.id)), '所有新增知识必须接入启动 seed 聚合器');

  const previz = docs.find(doc => doc.id === 'kb_white_model_previsualization_20260828');
  assert(previz, '缺少白模预演知识');
  assert.match(previz.content, /场景重建层/);
  assert.match(previz.content, /确定性预演层/);
  assert.match(previz.content, /参考视频/);
  assert.match(previz.content, /Seedance 2\.5/);
  assert.match(previz.content, /不能仅因名称相近/);
  assert.match(previz.content, /不得自动降级后继续收费/);

  const styles = docs.filter(doc => doc.subcategory === '漫剧画风');
  assert.equal(styles.length, 25);
  for (const name of ['电影写实', '赛博朋克', '水彩插画', '等距插画', '分层剪纸']) {
    const doc = styles.find(item => item.title.endsWith(name));
    assert(doc, `缺少画风：${name}`);
    assert(doc.prompt_snippets[0].includes(name), `${name} 必须提供可直接检索的提示词片段`);
  }
  assert(styles.every(doc => /主体与动作 \+ 场景与时代 \+ 画风名称/.test(doc.content)), '每种画风都必须使用完整提示词公式');
  assert(styles.every(doc => /连续性要求/.test(doc.content)), '每种画风都必须约束跨场景连续性');

  console.log(JSON.stringify({
    passed: true,
    seed_docs: docs.length,
    previz_docs: 1,
    verified_style_cards: styles.length,
    claimed_but_unavailable_style_cards: 15,
  }, null, 2));
}

run();
