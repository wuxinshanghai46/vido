const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const learningTime = require('../src/services/learningTimeService');
const candidates = require('../src/services/knowledgeCandidateService');
const { SessionDigestSource, ManualFileSource } = require('../src/services/knowledgeSources');
const db = require('../src/models/database');
const kb = require('../src/services/knowledgeBaseService');

async function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vido-learning-closure-'));
  try {
    assert.strictEqual(learningTime.dateKey(new Date('2026-08-21T16:05:00.000Z')), '2026-08-22');
    assert.strictEqual(learningTime.previousDateKey(new Date('2026-08-21T16:05:00.000Z')), '2026-08-21');
    assert.strictEqual(learningTime.timeKey(new Date('2026-08-21T16:05:00.000Z')), '00:05');

    const sessionsDir = path.join(tempRoot, 'sessions');
    fs.mkdirSync(sessionsDir, { recursive: true });
    fs.writeFileSync(path.join(sessionsDir, `${learningTime.dateKey()}.md`), [
      '# VIDO 会话日志',
      '## 当日概览',
      '这段不应进入候选。',
      '## [10:20] 用户反馈与决策',
      '用户要求外部文章必须先区分事实、推论与产品化建议，再由管理员审核；未经审核不能影响生成。',
      '同时必须保留来源与内容指纹，运行时要能追踪命中的知识编号。',
      '## [10:40] 验证过程',
      '- 候选去重测试通过',
      '- 审核后才进入知识库',
    ].join('\n'), 'utf8');
    const sessionDocs = await new SessionDigestSource().fetch({ sessionsDir, existingIds: new Set() });
    assert.strictEqual(sessionDocs.length, 2);
    assert.ok(sessionDocs.some(item => item.title.includes('用户反馈与决策')));
    assert.ok(sessionDocs.every(item => item.limitations.length > 0));
    assert.ok(sessionDocs.every(item => !item.runtime_policy));

    const manualDir = path.join(tempRoot, 'kb_manual');
    fs.mkdirSync(manualDir, { recursive: true });
    fs.writeFileSync(path.join(manualDir, 'one.json'), JSON.stringify({
      title: '动作节拍原始资料', content: '原始资料说明动作要有开始、过程和结果，且接触与反馈应当可见。',
    }), 'utf8');
    const manualDocs = await new ManualFileSource().fetch({ manualDir, existingIds: new Set() });
    assert.strictEqual(manualDocs.length, 1);

    const storePath = path.join(tempRoot, 'knowledge_candidates.json');
    const base = {
      source_url: 'https://example.test/article?utm_source=test&b=2&a=1#part',
      title: '动作连续性方法',
      content: '文章原文说明复杂动作需要拆成可观察的起始姿态、接触过程、因果反馈和结束姿态。',
      facts: ['文章明确提出四阶段结构'],
      inferences: ['VIDO 可将其映射为动作合同'],
      executable_rules: ['复杂动作至少填写三个可见阶段'],
      limitations: ['仅适用于存在连续动作的镜头'],
      applies_to: ['director'],
    };
    const first = candidates.ingest(base, { storePath });
    const duplicate = candidates.ingest({ ...base, source_url: 'https://example.test/article?a=1&b=2' }, { storePath });
    assert.strictEqual(first.created, true);
    assert.strictEqual(duplicate.duplicate, true);
    assert.strictEqual(candidates.stats({ storePath }).pending, 1);

    const memory = new Map();
    const fakeDb = {
      getKnowledgeDoc: id => memory.get(id),
      insertKnowledgeDoc: doc => memory.set(doc.id, { ...doc }),
      updateKnowledgeDoc: (id, doc) => memory.set(id, { ...doc }),
      deleteKnowledgeDoc: id => memory.delete(id),
    };
    let cacheCleared = 0;
    const approved = candidates.approve(first.candidate.id, { reviewed_by: 'test-admin' }, {
      storePath, database: fakeDb, clearPolicyCache: () => { cacheCleared += 1; },
    });
    assert.strictEqual(approved.candidate.status, 'approved');
    assert.strictEqual(cacheCleared, 1);
    assert.ok(memory.get(approved.document.id).content.includes('## 已确认事实'));
    assert.ok(memory.get(approved.document.id).content.includes('## VIDO 推论'));
    assert.ok(memory.get(approved.document.id).content.includes('## 已审核的产品化建议'));

    const changed = candidates.ingest({ ...base, content: `${base.content} 新版本增加摄影轴线要求。` }, { storePath });
    assert.strictEqual(changed.updated, true);
    assert.strictEqual(changed.candidate.status, 'pending');
    assert.strictEqual(changed.candidate.knowledge_id, approved.document.id);

    const originalList = db.listKnowledgeDocs;
    db.listKnowledgeDocs = () => [{
      id: approved.document.id, title: '动作连续性方法', collection: 'storyboard', subcategory: '动作',
      summary: '复杂动作结构', content: '开始、接触、反馈和结束', applies_to: ['director'], enabled: true,
      source_content_hash: first.candidate.content_hash, updated_at: '2026-08-22T00:00:00.000Z',
    }];
    try {
      const plain = kb.buildAgentContext('director', { includeCache: false });
      const traced = kb.buildAgentContext('director', { includeCache: false, withTrace: true });
      assert.strictEqual(typeof plain, 'string');
      assert.strictEqual(traced.knowledge_ids[0], approved.document.id);
      assert.strictEqual(traced.knowledge_fingerprint.length, 64);
      assert.ok(traced.context.includes('动作连续性方法'));
    } finally {
      db.listKnowledgeDocs = originalList;
    }

    console.log('daily-learning knowledge closure: 20 assertions passed');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error); process.exit(1); });
