const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../models/database');
const novelService = require('../services/novelService');
const { deductCredits } = require('../middleware/credits');
const { ownedBy, scopeUserId } = require('../middleware/auth');
const orchestrator = require('../services/agentOrchestrator');

const NOVEL_GENRE_PRESETS = [
  { key: 'auto', label: 'AI 推荐', api: 'auto', subtypes: [] },
  { key: 'fantasy', label: '玄幻', api: 'fantasy', subtypes: ['系统流', '升级流', '废柴逆袭', '宗门争霸', '家族崛起', '无敌流', '幕后流', '群像', '爽文'] },
  { key: 'xianxia', label: '仙侠', api: 'xianxia', subtypes: ['凡人修仙', '宗门修行', '剑修', '阵法丹道', '仙朝争霸', '师徒线', '红尘问道', '重生修仙'] },
  { key: 'urban', label: '都市', api: 'urban', subtypes: ['职场', '商战', '都市异能', '神医', '鉴宝', '重生创业', '娱乐圈', '生活流', '赘婿'] },
  { key: 'historical', label: '历史', api: 'historical', subtypes: ['架空历史', '权谋', '寒门崛起', '争霸', '朝堂', '边关', '种田', '穿越', '重生文'] },
  { key: 'scifi', label: '科幻', api: 'scifi', subtypes: ['星际', '赛博朋克', '末日', '机甲', '人工智能', '时间循环', '硬科幻', '废土'] },
  { key: 'wuxia', label: '武侠', api: 'wuxia', subtypes: ['江湖群像', '门派恩怨', '复仇', '镖局', '朝廷江湖', '侠义成长'] },
  { key: 'romance', label: '言情', api: 'romance', subtypes: ['现代言情', '古代言情', '幻想言情', '快穿', '重生', '破镜重圆', '先婚后爱', '女性成长'] },
  { key: 'mystery', label: '悬疑', api: 'mystery', subtypes: ['刑侦', '推理', '无限流', '密室', '心理悬疑', '民俗悬疑', '惊悚解谜'] },
  { key: 'horror', label: '灵异', api: 'horror', subtypes: ['民俗怪谈', '规则怪谈', '诡异复苏', '都市传说', '恐怖直播', '驱邪'] },
  { key: 'game', label: '游戏', api: 'game', subtypes: ['电竞', '游戏异界', '网游', '卡牌', '副本流', '职业选手'] },
  { key: 'realism', label: '现实', api: 'realism', subtypes: ['现实主义', '行业文', '年代', '乡村振兴', '家庭', '创业'] },
  { key: 'rebirth', label: '重生', api: 'rebirth', subtypes: ['重生文', '重生创业', '重生复仇', '重生年代', '重生修仙'] },
  { key: 'crossing', label: '穿越', api: 'crossing', subtypes: ['穿越文', '历史穿越', '异世穿越', '魂穿', '身穿'] },
  { key: 'light', label: '轻小说', api: 'light', subtypes: ['日轻', '校园', '异世界', '恋爱喜剧', '青春向'] }
];

const NOVEL_CHANNEL_PRESETS = [
  { key: 'auto', label: 'AI 推荐' },
  { key: 'male', label: '男频' },
  { key: 'female', label: '女频' },
  { key: 'publish', label: '出版向' },
  { key: 'short', label: '短故事' },
  { key: 'young', label: '青年向' },
  { key: 'all_age', label: '全年龄' },
  { key: 'drama', label: '强剧情' },
  { key: 'emotion', label: '情感向' },
  { key: 'suspense', label: '悬疑向' },
  { key: 'light', label: '轻小说' },
  { key: 'female_growth', label: '女性成长' },
  { key: '爽文', label: '爽文' },
  { key: '男频文', label: '男频文' },
  { key: '女频文', label: '女频文' }
];

function buildNovelTaxonomy() {
  const docs = db.listKnowledgeDocs({ enabledOnly: true });
  const dramaDocs = docs.filter(d => d.collection === 'drama');
  const genreMap = new Map(NOVEL_GENRE_PRESETS.map(item => [item.key, { ...item, subtypes: [...arr(item.subtypes)] }]));
  const kbSubcategories = Array.from(new Set(dramaDocs.map(d => str(d.subcategory)).filter(Boolean)));
  const subtypeToGenre = [
    [/玄幻|爽文|爆款/, 'fantasy'],
    [/仙侠/, 'xianxia'],
    [/武侠/, 'wuxia'],
    [/都市|职场/, 'urban'],
    [/历史|古装/, 'historical'],
    [/末日/, 'scifi'],
    [/悬疑/, 'mystery'],
    [/恐怖|灵异/, 'horror'],
    [/情感|女频|言情/, 'romance'],
    [/男频/, 'fantasy'],
    [/重生/, 'rebirth'],
    [/穿越/, 'crossing'],
    [/校园/, 'light']
  ];
  for (const name of kbSubcategories) {
    const found = subtypeToGenre.find(([re]) => re.test(name));
    if (!found) continue;
    const item = genreMap.get(found[1]);
    if (item && !item.subtypes.includes(name)) item.subtypes.push(name);
  }
  return {
    genres: Array.from(genreMap.values()),
    channels: NOVEL_CHANNEL_PRESETS,
    kb: {
      total: docs.length,
      drama_total: dramaDocs.length,
      drama_subcategories: kbSubcategories,
      featured: dramaDocs.slice(0, 18).map(d => ({
        collection: d.collection,
        subcategory: d.subcategory || '通用',
        title: d.title,
        summary: d.summary || ''
      }))
    }
  };
}

function getOwnedNovel(req, res, id) {
  const novel = db.getNovel(id);
  if (!novel || !ownedBy(req, novel)) { res.status(404).json({ success: false, error: '小说不存在' }); return null; }
  return novel;
}

function buildStoryBible(outline = {}) {
  return {
    logline: outline.logline || '',
    promise: outline.promise || '',
    inciting_incident: outline.inciting_incident || '',
    core_problem: outline.core_problem || '',
    conflict_engine: outline.conflict_engine || '',
    stakes: outline.stakes || '',
    escalation_path: outline.escalation_path || '',
    theme: outline.theme || '',
    world: outline.world || {},
    characters: outline.characters || [],
    relationships: outline.relationships || [],
    locations: outline.locations || [],
    timeline: outline.timeline || [],
    conflicts: outline.conflicts || [],
    writing_rules: outline.writing_rules || [],
    manga_adaptation: outline.manga_adaptation || {}
  };
}

function arr(value) {
  return Array.isArray(value) ? value : [];
}

function str(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function objectText(value, keys = []) {
  if (!value) return '';
  if (typeof value === 'string') return str(value);
  if (typeof value !== 'object' || Array.isArray(value)) return '';
  const parts = keys.length ? keys.map(key => value[key]) : Object.values(value);
  return parts.map(item => typeof item === 'string' ? item.trim() : '').filter(Boolean).join('\n');
}

function sourceLength(value = '') {
  return String(value || '').replace(/[\s，。！？、；：,.!?;:()[\]{}"'“”‘’《》<>【】\-_/\\|]+/g, '').length;
}

function buildNovelSourceBrief(novel = {}) {
  const contract = novel.contract || {};
  const worldText = objectText(contract.world, ['setting', 'rules', 'taboos', 'cost', 'visual_style']);
  const constraintsText = objectText(contract.constraints, ['continuity_rules', 'forbidden', 'voice', 'pacing']);
  const promisesText = objectText(contract.promises, ['core_conflict', 'long_goal', 'payoff', 'ending_direction']);
  const source = novel.source_material || {};
  return [
    novel.source_material?.type === 'idea_seed' && source.text_excerpt ? `用户原始想法：${str(source.text_excerpt)}` : '',
    novel.source_material?.type === 'user_upload' && source.summary ? `导入作品摘要：${str(source.summary)}` : '',
    novel.source_material?.type === 'user_upload' && source.text_excerpt ? `导入作品节选：${str(source.text_excerpt).slice(0, 6000)}` : '',
    novel.description ? `当前简介：${str(novel.description)}` : '',
    novel.logline ? `一句话卖点：${str(novel.logline)}` : '',
    contract.promise ? `作品承诺：${str(contract.promise)}` : '',
    contract.logline ? `档案卖点：${str(contract.logline)}` : '',
    worldText ? `用户保存的世界观：${worldText}` : '',
    contract.rules ? `用户保存的规则：${str(contract.rules)}` : '',
    constraintsText ? `不可写崩规则：${constraintsText}` : '',
    promisesText ? `主线承诺：${promisesText}` : ''
  ].filter(Boolean).join('\n');
}

function ensureNovelSourceReady(sourceBrief) {
  if (sourceLength(sourceBrief) < 24) {
    const error = new Error('当前小说档案缺少足够的用户需求，无法可靠完善世界观和大纲。请先补充作品承诺、世界观、主角目标或核心冲突。');
    error.status = 400;
    throw error;
  }
}

function normalizedChapters(novel = {}) {
  const existing = arr(novel.chapters);
  const byIndex = new Map(existing.map(ch => [Number(ch.index), ch]));
  const target = Math.max(
    Number(novel.chapter_count || 0),
    arr(novel.outline?.chapters).length,
    existing.length
  );
  return Array.from({ length: target }, (_, idx) => {
    const index = idx + 1;
    return byIndex.get(index) || { index, title: '', content: '', status: 'draft' };
  });
}

function chapterSubmitted(chapter = {}) {
  return str(chapter.content) && (chapter.status === 'done' || chapter.submitted_at || chapter.committed_at);
}

function completionBlockers(novel = {}) {
  const list = normalizedChapters(novel);
  if (!list.length) return [{ type: 'no_chapters', message: '还没有章节，不能完结小说' }];
  return list
    .filter(ch => !chapterSubmitted(ch))
    .map(ch => ({ type: 'chapter_unsubmitted', chapter_index: Number(ch.index), message: `第 ${Number(ch.index)} 章尚未提交` }));
}

function buildNovelAdaptationSource(novel = {}) {
  const chapters = normalizedChapters(novel);
  const contentChapters = chapters.filter(ch => str(ch.content));
  const outlineChapters = arr(novel.outline?.chapters);
  const hasOutline = !!(novel.outline && (outlineChapters.length || str(novel.outline.synopsis) || str(novel.outline.logline)));
  const hasBrief = !!(str(novel.description) || str(novel.logline));
  const canImport = contentChapters.length > 0 || hasOutline || hasBrief;
  const sourceStage = contentChapters.length > 0
    ? 'chapters'
    : hasOutline
      ? 'outline'
      : hasBrief
        ? 'brief'
        : 'empty';
  return {
    ...novel,
    chapters,
    adaptation: {
      can_import: canImport,
      source_stage: sourceStage,
      unfinished: novel.status !== 'completed',
      content_chapter_count: contentChapters.length,
      planned_chapter_count: chapters.length,
      outline_chapter_count: outlineChapters.length,
      permission_scope: 'current_user_or_admin_all'
    }
  };
}

function entityId(name, index) {
  return 'ent_' + (str(name) || String(index + 1)).replace(/[^\w\u4e00-\u9fa5]+/g, '_').slice(0, 32);
}

function buildContract(input = {}) {
  const bible = input.story_bible || {};
  const outline = input.outline || {};
  const world = bible.world || outline.world || {};
  const existing = input.contract || {};
  return {
    logline: str(existing.logline) || str(input.logline) || str(bible.logline) || str(outline.logline),
    promise: str(existing.promise) || str(input.promise) || str(bible.promise) || str(outline.promise),
    inciting_incident: str(existing.inciting_incident) || str(bible.inciting_incident) || str(outline.inciting_incident),
    core_problem: str(existing.core_problem) || str(bible.core_problem) || str(outline.core_problem),
    conflict_engine: str(existing.conflict_engine) || str(bible.conflict_engine) || str(outline.conflict_engine),
    stakes: str(existing.stakes) || str(bible.stakes) || str(outline.stakes),
    escalation_path: str(existing.escalation_path) || str(bible.escalation_path) || str(outline.escalation_path),
    audience: str(existing.audience),
    target_words: Number(existing.target_words) || (Number(input.chapter_count) || 0) * (Number(input.chapter_words) || 0),
    genre: str(existing.genre) || str(input.genre),
    style: str(existing.style) || str(input.style),
    world: {
      setting: str(existing.world?.setting) || str(world.setting) || str(input.description),
      power_system: str(existing.world?.power_system) || str(world.power_system),
      rules: str(existing.world?.rules) || str(world.rules),
      taboos: str(existing.world?.taboos) || str(world.taboos),
      cost: str(existing.world?.cost) || str(world.cost),
      visual_style: str(existing.world?.visual_style) || str(world.visual_style)
    },
    promises: {
      core_conflict: str(existing.promises?.core_conflict),
      long_goal: str(existing.promises?.long_goal),
      payoff: str(existing.promises?.payoff),
      ending_direction: str(existing.promises?.ending_direction)
    },
    constraints: {
      voice: str(existing.constraints?.voice),
      pacing: str(existing.constraints?.pacing),
      forbidden: str(existing.constraints?.forbidden),
      continuity_rules: str(existing.constraints?.continuity_rules)
    },
    version: Number(existing.version) || 1,
    updated_at: existing.updated_at || new Date().toISOString()
  };
}

function buildEntities(input = {}) {
  if (arr(input.entities).length) return arr(input.entities);
  const bible = input.story_bible || {};
  const outline = input.outline || {};
  return arr(bible.characters || outline.characters).map((c, index) => {
    const name = str(c.name);
    if (!name) return null;
    return {
      id: str(c.id) || entityId(name, index),
      name,
      aliases: arr(c.aliases).map(str).filter(Boolean),
      role: str(c.role),
      gender: str(c.gender || c.sex || c.gender_presentation),
      identity: str(c.identity),
      goal: str(c.goal),
      motivation: str(c.motivation),
      weakness: str(c.weakness),
      personality: str(c.personality),
      arc: str(c.arc),
      voice: str(c.voice),
      evidence: str(c.evidence),
      current_state: str(c.current_state),
      first_seen_chapter: Number(c.first_seen_chapter) || null,
      last_seen_chapter: Number(c.last_seen_chapter) || null,
      source: str(c.source) || 'outline'
    };
  }).filter(Boolean);
}

function buildRelationships(input = {}, entities = []) {
  if (arr(input.relationships).length) return arr(input.relationships);
  const bible = input.story_bible || {};
  const outline = input.outline || {};
  const names = new Set(entities.map(e => e.name));
  return arr(bible.relationships || outline.relationships).map((r, index) => {
    const from = str(r.from);
    const to = str(r.to);
    if (!from || !to || !names.has(from) || !names.has(to)) return null;
    return {
      id: str(r.id) || `rel_${index + 1}`,
      from,
      to,
      type: str(r.type),
      description: str(r.description),
      tension: str(r.tension),
      status: str(r.status),
      source_chapter: Number(r.source_chapter) || null,
      history: arr(r.history)
    };
  }).filter(Boolean);
}

function buildPlotThreads(input = {}) {
  if (arr(input.plot_threads).length) return arr(input.plot_threads);
  const bible = input.story_bible || {};
  const outline = input.outline || {};
  const conflicts = arr(bible.conflicts || outline.conflicts);
  return conflicts.map((c, index) => ({
    id: str(c.id) || `thread_${index + 1}`,
    type: str(c.type) || 'main',
    title: str(c.title) || str(c.description).slice(0, 24) || `剧情线 ${index + 1}`,
    status: str(c.status) || 'planned',
    chapters: arr(c.chapters),
    description: str(c.description),
    stakes: str(c.stakes)
  }));
}

function buildRuntimeStatus(input = {}) {
  const existing = input.runtime_status || {};
  let model = null;
  try { model = novelService.getAvailableModels()[0]; } catch {}
  return {
    model_provider: str(existing.model_provider) || str(input.provider) || str(model?.providerId),
    model_id: str(existing.model_id) || str(model?.modelId),
    rag_enabled: Boolean(existing.rag_enabled),
    kb_enabled: Boolean(existing.kb_enabled),
    agent_workflow: existing.agent_workflow || 'not_started',
    last_error: str(existing.last_error),
    updated_at: existing.updated_at || new Date().toISOString()
  };
}

function buildLongformState(input = {}) {
  const entities = buildEntities(input);
  return {
    contract: buildContract(input),
    entities,
    relationships: buildRelationships(input, entities),
    plot_threads: buildPlotThreads(input),
    foreshadows: arr(input.foreshadows),
    chapter_briefs: arr(input.chapter_briefs),
    chapter_commits: arr(input.chapter_commits),
    review_reports: arr(input.review_reports),
    memory_items: arr(input.memory_items),
    runtime_status: buildRuntimeStatus(input)
  };
}

function buildChapterCommitDraft(novel, chapterIndex, chapterData, chapterInfo) {
  const existing = arr(novel.chapter_commits).filter(c => Number(c.chapter_index) !== Number(chapterIndex));
  const draft = {
    chapter_index: Number(chapterIndex),
    status: 'draft',
    events: arr(chapterInfo?.key_events).length ? arr(chapterInfo.key_events) : (chapterInfo?.summary ? [chapterInfo.summary] : []),
    character_changes: [],
    relationship_changes: [],
    location_changes: [],
    foreshadow_updates: chapterInfo?.hook ? [{ type: 'hook', description: chapterInfo.hook }] : [],
    word_count: chapterData.word_count || 0,
    source: 'generated_chapter',
    created_at: new Date().toISOString()
  };
  existing.push(draft);
  return existing.sort((a, b) => Number(a.chapter_index) - Number(b.chapter_index));
}

function updateRuntimeStatus(novel = {}, patch = {}) {
  return {
    ...(novel.runtime_status || {}),
    ...patch,
    updated_at: new Date().toISOString()
  };
}

function upsertByName(items = [], item = {}) {
  const name = str(item.name);
  if (!name) return items;
  const next = [...items];
  const index = next.findIndex(existing => str(existing.name) === name);
  const merged = {
    ...(index >= 0 ? next[index] : {}),
    ...item
  };
  if (index >= 0) next[index] = merged;
  else next.push(merged);
  return next;
}

function mergeChapterFactsIntoNovel(novel = {}, facts = {}) {
  let entities = arr(novel.entities);
  for (const change of arr(facts.character_changes)) {
    entities = upsertByName(entities, {
      id: change.id || entityId(change.name, entities.length),
      name: change.name,
      aliases: arr(change.aliases),
      role: change.role,
      identity: change.identity,
      goal: change.goal,
      motivation: change.motivation,
      weakness: change.weakness,
      current_state: change.current_state || change.change,
      last_change: change.change,
      last_seen_chapter: facts.chapter_index,
      source: `chapter_${facts.chapter_index}`
    });
  }

  const names = new Set(entities.map(e => e.name));
  const relationships = [...arr(novel.relationships)];
  const ignored = [];
  for (const change of arr(facts.relationship_changes)) {
    if (!names.has(change.from) || !names.has(change.to)) {
      ignored.push({ ...change, reason: '关系两端人物未全部存在，未写入关系图谱' });
      continue;
    }
    const index = relationships.findIndex(item => item.from === change.from && item.to === change.to && item.type === change.type);
    const nextRel = {
      id: change.id || `rel_${relationships.length + 1}`,
      from: change.from,
      to: change.to,
      type: change.type,
      description: change.description,
      tension: change.tension,
      status: change.status,
      source_chapter: facts.chapter_index,
      history: [
        ...arr(index >= 0 ? relationships[index].history : []),
        {
          chapter_index: facts.chapter_index,
          description: change.description || change.status || change.tension,
          evidence: change.evidence,
          created_at: new Date().toISOString()
        }
      ].filter(item => item.description || item.evidence)
    };
    if (index >= 0) relationships[index] = { ...relationships[index], ...nextRel };
    else relationships.push(nextRel);
  }

  const plotThreads = [...arr(novel.plot_threads)];
  for (const update of arr(facts.plot_thread_updates)) {
    const title = str(update.title);
    if (!title && !str(update.description)) continue;
    const index = plotThreads.findIndex(item => str(item.title) === title && str(item.type) === str(update.type));
    const nextThread = {
      id: update.id || `thread_${plotThreads.length + 1}`,
      title: title || str(update.description).slice(0, 24),
      type: update.type || 'main',
      status: update.status || 'progress',
      description: update.description,
      stakes: update.stakes,
      chapters: Array.from(new Set([...arr(index >= 0 ? plotThreads[index].chapters : []), facts.chapter_index]))
    };
    if (index >= 0) plotThreads[index] = { ...plotThreads[index], ...nextThread };
    else plotThreads.push(nextThread);
  }

  const foreshadows = [
    ...arr(novel.foreshadows),
    ...arr(facts.foreshadow_updates).map((item, index) => ({
      id: item.id || `fs_${facts.chapter_index}_${index + 1}`,
      setup_chapter: facts.chapter_index,
      payoff_chapter: item.payoff_chapter || null,
      status: item.status || 'open',
      description: item.description,
      risk: item.risk,
      evidence: item.evidence
    }))
  ].filter(item => item.description);

  const memoryItems = [
    ...arr(novel.memory_items),
    ...arr(facts.memory_items).map((item, index) => ({
      id: item.id || `mem_${facts.chapter_index}_${Date.now()}_${index}`,
      type: item.type || 'plot',
      text: item.text,
      source_chapter: facts.chapter_index,
      importance: Number(item.importance) || 1,
      evidence: item.evidence,
      created_at: new Date().toISOString()
    }))
  ].filter(item => item.text);

  const chapterCommits = arr(novel.chapter_commits)
    .filter(item => Number(item.chapter_index) !== Number(facts.chapter_index))
    .concat([{ ...facts, ignored_relationships: ignored }])
    .sort((a, b) => Number(a.chapter_index) - Number(b.chapter_index));

  return {
    entities,
    relationships,
    plot_threads: plotThreads,
    foreshadows,
    memory_items: memoryItems,
    chapter_commits: chapterCommits,
    runtime_status: updateRuntimeStatus(novel, { agent_workflow: 'facts_committed', last_error: '' }),
    updated_at: new Date().toISOString()
  };
}

// 获取可用模型
router.get('/models', (req, res) => {
  try {
    const models = novelService.getAvailableModels();
    res.json({ success: true, models });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// 小说创建分类树：合并固定网文分类和知识库 drama 子分类
router.get('/taxonomy', (req, res) => {
  try {
    res.json({ success: true, taxonomy: buildNovelTaxonomy() });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// 小说列表
router.get('/', (req, res) => {
  try {
    const novels = db.listNovels(scopeUserId(req));
    if (req.query.scope === 'adaptation' || req.query.include_unfinished === '1') {
      return res.json({
        success: true,
        novels: novels.map(buildNovelAdaptationSource),
        scope: scopeUserId(req) ? 'own' : 'all',
        include_unfinished: true
      });
    }
    res.json({ success: true, novels });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// AI 创建小说：一句想法生成 / 导入已有作品分析补充
router.post('/ai-create', async (req, res) => {
  try {
    const {
      mode = 'idea',
      idea = '',
      source_text = '',
      title = '',
      genre = '',
      style = 'descriptive',
      novel_type = 'short',
      cultural_region = 'chinese',
      chapter_count = 5,
      chapter_words = 2000,
      subtype = '',
      channel = '',
      provider = ''
    } = req.body || {};
    if (mode === 'import' && !str(source_text)) return res.status(400).json({ success: false, error: '请上传或粘贴已有作品内容' });
    if (mode !== 'import' && !str(idea)) return res.status(400).json({ success: false, error: '请先输入小说想法' });

    deductCredits(req.user?.id, 'novel_outline', mode === 'import' ? '导入作品分析并创建小说' : 'AI 创建小说');
    const plan = await novelService.analyzeNovelSeed({
      mode,
      idea,
      sourceText: source_text,
      title,
      genre,
      style,
      novelType: novel_type,
      culturalRegion: cultural_region,
      chapterCount: chapter_count,
      chapterWords: chapter_words,
      subtype,
      channel,
      provider: provider || null
    });
    const planMeta = plan._meta || {};
    delete plan._meta;

    const outline = await novelService.generateOutline({
      title: plan.title,
      genre: plan.genre,
      subtype: plan.subtype || subtype || '',
      channel: plan.channel || channel || '',
      style: plan.style,
      chapterCount: plan.chapter_count,
      description: [
        mode === 'idea' && str(idea) ? `用户原始想法：${str(idea)}` : '',
        mode === 'import' && str(source_text) ? `导入作品原文节选：${str(source_text).slice(0, 6000)}` : '',
        plan.description,
        plan.logline ? `一句话卖点：${plan.logline}` : '',
        plan.core_conflict ? `核心冲突：${plan.core_conflict}` : '',
        plan.long_goal ? `长期目标：${plan.long_goal}` : '',
        mode === 'import' && plan.source_summary ? `已有作品摘要：${plan.source_summary}` : ''
      ].filter(Boolean).join('\n'),
      provider: provider || null,
      novelType: plan.novel_type,
      culturalRegion: plan.cultural_region || cultural_region || 'chinese'
    });
    const outlineMeta = outline._meta || {};
    delete outline._meta;

    const storyBible = buildStoryBible(outline);
    const baseNovel = {
      id: uuidv4(),
      user_id: req.user?.id,
      title: plan.title,
      genre: plan.genre,
      style: plan.style,
      novel_type: plan.novel_type,
      cultural_region: plan.cultural_region || cultural_region || 'chinese',
      description: plan.description,
      logline: outline.logline || plan.logline || '',
      tags: plan.tags || [],
      chapter_count: plan.chapter_count,
      chapter_words: plan.chapter_words,
      provider: provider || null,
      outline,
      story_bible: storyBible,
      contract: {
        logline: outline.logline || plan.logline || '',
        audience: plan.audience || '',
        target_words: plan.chapter_count * plan.chapter_words,
        genre: plan.genre,
        subtype: plan.subtype || subtype || '',
        channel: plan.channel || channel || '',
        style: plan.style,
        cultural_region: plan.cultural_region || cultural_region || 'chinese',
        world: {
          setting: plan.description || outline.world?.setting || '',
          rules: plan.continuity_rules || outline.world?.rules || ''
        },
        promises: {
          core_conflict: plan.core_conflict || '',
          long_goal: plan.long_goal || ''
        },
        constraints: {
          continuity_rules: plan.continuity_rules || ''
        },
        version: 1,
        updated_at: new Date().toISOString()
      },
      chapters: [],
      total_words: 0,
      source_material: {
        type: mode === 'import' ? 'user_upload' : 'idea_seed',
        text_excerpt: (mode === 'import' ? str(source_text) : str(idea)).slice(0, 12000),
        length: String(mode === 'import' ? source_text || '' : idea || '').length,
        summary: plan.source_summary || '',
        imported_at: new Date().toISOString()
      },
      status: 'draft',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    const longform = buildLongformState(baseNovel);
    const novel = {
      ...baseNovel,
      ...longform,
      memory_items: [
        ...arr(longform.memory_items),
        mode === 'import' ? {
          id: `source_${Date.now()}`,
          type: 'source',
          text: plan.source_summary || str(source_text).slice(0, 600),
          source: 'user_import',
          importance: 5,
          created_at: new Date().toISOString()
        } : null
      ].filter(Boolean),
      runtime_status: updateRuntimeStatus({ ...baseNovel, ...longform }, {
        agent_workflow: mode === 'import' ? 'import_analyzed_outline_completed' : 'idea_analyzed_outline_completed',
        last_error: '',
        model_provider: outlineMeta.provider_id || planMeta.provider_id,
        model_id: outlineMeta.model_id || planMeta.model_id,
        attempts: [...arr(planMeta.attempts), ...arr(outlineMeta.attempts)]
      })
    };
    db.insertNovel(novel);
    res.json({ success: true, novel, plan, outline, model: { plan: planMeta, outline: outlineMeta } });
  } catch (error) {
    res.status(error.status || (error.attempts?.length ? 502 : 500)).json({ success: false, error: error.message, code: error.code || '', attempts: error.attempts || [] });
  }
});

// 小说详情
router.get('/:id', (req, res) => {
  const novel = getOwnedNovel(req, res, req.params.id);
  if (!novel) return;
  res.json({ success: true, novel });
});

// 创建小说
router.post('/', (req, res) => {
  try {
    const { title, genre = 'fantasy', style = 'descriptive', novel_type = 'short', cultural_region = 'chinese', chapter_count = 10, chapter_words = 2000, description = '', logline = '', tags = [], provider } = req.body;
    if (!title || !title.trim()) return res.status(400).json({ success: false, error: '请输入小说标题' });
    const baseNovel = {
      id: uuidv4(),
      user_id: req.user?.id,
      title: title.trim(),
      genre,
      style,
      novel_type,
      cultural_region,
      description,
      logline,
      tags: Array.isArray(tags) ? tags : [],
      chapter_count: parseInt(chapter_count) || 10,
      chapter_words: parseInt(chapter_words) || 2000,
      provider: provider || null,
      outline: null,
      story_bible: {
        logline,
        theme: '',
        world: { setting: description },
        characters: [],
        relationships: [],
        locations: [],
        timeline: [],
        conflicts: [],
        manga_adaptation: {}
      },
      chapters: [],
      total_words: 0,
      status: 'draft',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    const novel = { ...baseNovel, ...buildLongformState(baseNovel) };
    db.insertNovel(novel);
    res.json({ success: true, novel });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// 更新小说
router.put('/:id', (req, res) => {
  try {
    const novel = getOwnedNovel(req, res, req.params.id);
    if (!novel) return;
    const {
      title, genre, style, novel_type, chapter_count, chapter_words, chapters, outline,
      description, logline, tags, story_bible, status, provider, contract, entities,
      cultural_region, relationships, plot_threads, foreshadows, chapter_briefs, chapter_commits,
      review_reports, memory_items, runtime_status
    } = req.body;
    const fields = {};
    if (title !== undefined) fields.title = title;
    if (genre !== undefined) fields.genre = genre;
    if (style !== undefined) fields.style = style;
    if (novel_type !== undefined) fields.novel_type = novel_type;
    if (cultural_region !== undefined) fields.cultural_region = cultural_region;
    if (description !== undefined) fields.description = description;
    if (logline !== undefined) fields.logline = logline;
    if (tags !== undefined) fields.tags = Array.isArray(tags) ? tags : [];
    if (story_bible !== undefined) fields.story_bible = story_bible;
    if (contract !== undefined) fields.contract = contract;
    if (entities !== undefined) fields.entities = Array.isArray(entities) ? entities : [];
    if (relationships !== undefined) fields.relationships = Array.isArray(relationships) ? relationships : [];
    if (plot_threads !== undefined) fields.plot_threads = Array.isArray(plot_threads) ? plot_threads : [];
    if (foreshadows !== undefined) fields.foreshadows = Array.isArray(foreshadows) ? foreshadows : [];
    if (chapter_briefs !== undefined) fields.chapter_briefs = Array.isArray(chapter_briefs) ? chapter_briefs : [];
    if (chapter_commits !== undefined) fields.chapter_commits = Array.isArray(chapter_commits) ? chapter_commits : [];
    if (review_reports !== undefined) fields.review_reports = Array.isArray(review_reports) ? review_reports : [];
    if (memory_items !== undefined) fields.memory_items = Array.isArray(memory_items) ? memory_items : [];
    if (runtime_status !== undefined) fields.runtime_status = runtime_status;
    if (status !== undefined) fields.status = status;
    if (provider !== undefined) fields.provider = provider;
    if (chapter_count !== undefined) fields.chapter_count = parseInt(chapter_count);
    if (chapter_words !== undefined) fields.chapter_words = parseInt(chapter_words);
    if (chapters !== undefined) {
      fields.chapters = chapters;
      fields.total_words = chapters.reduce((sum, c) => sum + (c.word_count || 0), 0);
    }
    if (outline !== undefined) {
      fields.outline = novelService.normalizeNovelOutline(outline, { ...novel, ...fields });
      fields.story_bible = buildStoryBible(fields.outline);
      Object.assign(fields, buildLongformState({ ...novel, ...fields }));
    }
    fields.updated_at = new Date().toISOString();
    db.updateNovel(req.params.id, fields);
    res.json({ success: true, novel: db.getNovel(req.params.id) });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// 删除小说
router.delete('/:id', (req, res) => {
  try {
    if (!getOwnedNovel(req, res, req.params.id)) return;
    db.deleteNovel(req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// 生成大纲
router.post('/:id/generate-outline', async (req, res) => {
  try {
    const novel = getOwnedNovel(req, res, req.params.id);
    if (!novel) return;
    db.updateNovel(req.params.id, { status: 'generating' });
    deductCredits(req.user?.id, 'novel_outline', `生成大纲: ${novel.title}`);

    const sourceBrief = buildNovelSourceBrief(novel);
    ensureNovelSourceReady(sourceBrief);

    // 先跑小说工作流分析
    let workflowAnalysis = null;
    try {
      const wfResult = await orchestrator.runWorkflow(
        `小说标题: ${novel.title}\n类型: ${novel.genre || '通用'}\n风格: ${novel.style || '默认'}\n章节数: ${novel.chapter_count || 10}\n\n用户需求与作品档案：\n${sourceBrief}`,
        { taskType: 'business', workflowName: 'novel' }
      );
      workflowAnalysis = wfResult;
      console.log(`[Novel] 工作流完成 (${wfResult.total_agents_involved} agent / ${(wfResult.total_duration_ms/1000).toFixed(0)}s)`);
    } catch (wfErr) {
      console.warn('[Novel] orchestrator workflow failed (non-fatal):', wfErr.message);
    }

    const outline = await novelService.generateOutline({
      title: novel.title,
      genre: novel.genre,
      style: novel.style,
      chapterCount: novel.chapter_count,
      description: sourceBrief,
      provider: novel.provider,
      novelType: novel.novel_type || 'short',
      culturalRegion: novel.cultural_region || 'chinese'
    });
    const outlineMeta = outline._meta || {};
    delete outline._meta;
    const storyBible = buildStoryBible(outline);
    const longform = buildLongformState({ ...novel, outline, story_bible: storyBible });
    db.updateNovel(req.params.id, {
      outline,
      story_bible: storyBible,
      ...longform,
      runtime_status: updateRuntimeStatus({ ...novel, ...longform }, {
        model_provider: outlineMeta.provider_id || longform.runtime_status?.model_provider,
        model_id: outlineMeta.model_id || longform.runtime_status?.model_id,
        agent_workflow: 'outline_completed',
        last_error: '',
        attempts: outlineMeta.attempts || []
      }),
      logline: outline.logline || novel.logline || '',
      status: 'draft',
      updated_at: new Date().toISOString()
    });
    res.json({ success: true, outline, story_bible: storyBible, workflow: workflowAnalysis, model: outlineMeta });
  } catch (e) {
    db.updateNovel(req.params.id, {
      status: 'draft',
      runtime_status: updateRuntimeStatus(db.getNovel(req.params.id) || {}, {
        agent_workflow: 'outline_failed',
        last_error: e.message,
        attempts: e.attempts || []
      })
    });
    res.status(e.status || (e.attempts?.length ? 502 : 500)).json({ success: false, error: e.message, code: e.code || '', attempts: e.attempts || [] });
  }
});

// SSE 流式生成章节
router.get('/:id/generate-chapter-stream', async (req, res) => {
  const novel = getOwnedNovel(req, res, req.params.id);
  if (!novel) return;
  if (!novel.outline) return res.status(400).json({ error: '请先生成大纲' });

  const chapterIndex = parseInt(req.query.chapter);
  if (!chapterIndex) return res.status(400).json({ error: '缺少 chapter 参数' });

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });

  try {
    db.updateNovel(req.params.id, { status: 'generating' });
    deductCredits(req.user?.id, 'novel_chapter', `生成章节: 第${chapterIndex}章`);
    const chapterInfo = novel.outline.chapters.find(c => c.index === chapterIndex);
    const generated = await novelService.generateChapterStream({
      outline: novel.outline,
      chapterIndex,
      chapters: novel.chapters || [],
      genre: novel.genre,
      style: novel.style,
      chapterWords: novel.chapter_words,
      provider: novel.provider,
      novelType: novel.novel_type || 'short'
    }, (chunk) => {
      res.write(`data: ${JSON.stringify({ type: 'chunk', text: chunk })}\n\n`);
    });
    const fullText = generated.text || '';

    // 保存章节
    const chapters = [...(novel.chapters || [])];
    const existing = chapters.findIndex(c => c.index === chapterIndex);
    const chapterData = {
      index: chapterIndex,
      title: chapterInfo?.title || `第${chapterIndex}章`,
      content: fullText,
      word_count: fullText.length,
      status: 'done'
    };
    if (existing >= 0) chapters[existing] = chapterData;
    else chapters.push(chapterData);
    chapters.sort((a, b) => a.index - b.index);

    const totalWords = chapters.reduce((s, c) => s + (c.word_count || 0), 0);
    const chapter_commits = buildChapterCommitDraft(novel, chapterIndex, chapterData, chapterInfo);
    db.updateNovel(req.params.id, {
      chapters,
      chapter_commits,
      total_words: totalWords,
      status: 'draft',
      runtime_status: updateRuntimeStatus(novel, {
        agent_workflow: 'chapter_completed',
        last_error: '',
        model_provider: generated.provider_id || novel.runtime_status?.model_provider,
        model_id: generated.model_id || novel.runtime_status?.model_id,
        attempts: generated.attempts || []
      }),
      updated_at: new Date().toISOString()
    });

    res.write(`data: ${JSON.stringify({ type: 'done', chapter: chapterData, total_words: totalWords, attempts: generated.attempts || [] })}\n\n`);
  } catch (e) {
    db.updateNovel(req.params.id, {
      status: 'draft',
      runtime_status: updateRuntimeStatus(db.getNovel(req.params.id) || novel, {
        agent_workflow: 'chapter_failed',
        last_error: e.message,
        attempts: e.attempts || []
      })
    });
    res.write(`data: ${JSON.stringify({ type: 'error', message: e.message, attempts: e.attempts || [] })}\n\n`);
  }
  res.end();
});

router.post('/:id/chapters/:chapter/review', async (req, res) => {
  const novel = getOwnedNovel(req, res, req.params.id);
  if (!novel) return;
  const chapterIndex = parseInt(req.params.chapter);
  if (!chapterIndex) return res.status(400).json({ success: false, error: '缺少章节编号' });
  try {
    db.updateNovel(req.params.id, {
      runtime_status: updateRuntimeStatus(novel, { agent_workflow: 'reviewing', last_error: '' })
    });
    const report = await novelService.reviewChapter({ novel, chapterIndex, provider: novel.provider });
    const review_reports = arr(novel.review_reports)
      .filter(item => Number(item.chapter_index) !== Number(chapterIndex))
      .concat([report])
      .sort((a, b) => Number(a.chapter_index) - Number(b.chapter_index));
    db.updateNovel(req.params.id, {
      review_reports,
      runtime_status: updateRuntimeStatus(novel, {
        agent_workflow: 'review_completed',
        last_error: '',
        model_provider: report.provider_id || novel.runtime_status?.model_provider,
        model_id: report.model_id || novel.runtime_status?.model_id,
        attempts: report.attempts || []
      }),
      updated_at: new Date().toISOString()
    });
    res.json({ success: true, report, novel: db.getNovel(req.params.id) });
  } catch (error) {
    db.updateNovel(req.params.id, {
      runtime_status: updateRuntimeStatus(novel, { agent_workflow: 'review_failed', last_error: error.message, attempts: error.attempts || [] }),
      updated_at: new Date().toISOString()
    });
    res.status(error.attempts?.length ? 502 : 500).json({ success: false, error: error.message, attempts: error.attempts || [] });
  }
});

router.post('/:id/chapters/:chapter/extract-facts', async (req, res) => {
  const novel = getOwnedNovel(req, res, req.params.id);
  if (!novel) return;
  const chapterIndex = parseInt(req.params.chapter);
  if (!chapterIndex) return res.status(400).json({ success: false, error: '缺少章节编号' });
  try {
    db.updateNovel(req.params.id, {
      runtime_status: updateRuntimeStatus(novel, { agent_workflow: 'extracting_facts', last_error: '' })
    });
    const facts = await novelService.extractChapterFacts({ novel, chapterIndex, provider: novel.provider });
    const fields = mergeChapterFactsIntoNovel(novel, facts);
    fields.runtime_status = updateRuntimeStatus({ ...novel, runtime_status: fields.runtime_status }, {
      agent_workflow: 'facts_committed',
      last_error: '',
      model_provider: facts.provider_id || novel.runtime_status?.model_provider,
      model_id: facts.model_id || novel.runtime_status?.model_id,
      attempts: facts.attempts || []
    });
    db.updateNovel(req.params.id, fields);
    const saved = db.getNovel(req.params.id);
    const commit = arr(saved.chapter_commits).find(item => Number(item.chapter_index) === Number(chapterIndex));
    res.json({ success: true, facts: { ...facts, ignored_relationships: commit?.ignored_relationships || [] }, novel: saved });
  } catch (error) {
    db.updateNovel(req.params.id, {
      runtime_status: updateRuntimeStatus(novel, { agent_workflow: 'fact_extract_failed', last_error: error.message, attempts: error.attempts || [] }),
      updated_at: new Date().toISOString()
    });
    res.status(error.attempts?.length ? 502 : 500).json({ success: false, error: error.message, attempts: error.attempts || [] });
  }
});

// SSE 流式优化文本
router.get('/:id/refine-stream', async (req, res) => {
  const novel = getOwnedNovel(req, res, req.params.id);
  if (!novel) return;

  const instruction = req.query.instruction;
  const text = req.query.text;
  if (!text || !instruction) return res.status(400).json({ error: '缺少 text 或 instruction 参数' });

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });

  try {
    const refined = await novelService.refineTextStream({
      text: decodeURIComponent(text),
      instruction: decodeURIComponent(instruction),
      genre: novel.genre,
      style: novel.style,
      provider: novel.provider
    }, (chunk) => {
      res.write(`data: ${JSON.stringify({ type: 'chunk', text: chunk })}\n\n`);
    });
    db.updateNovel(req.params.id, {
      runtime_status: updateRuntimeStatus(novel, {
        agent_workflow: 'refine_completed',
        last_error: '',
        model_provider: refined.provider_id || novel.runtime_status?.model_provider,
        model_id: refined.model_id || novel.runtime_status?.model_id,
        attempts: refined.attempts || []
      }),
      updated_at: new Date().toISOString()
    });
    res.write(`data: ${JSON.stringify({ type: 'done', text: refined.text, attempts: refined.attempts || [] })}\n\n`);
  } catch (e) {
    db.updateNovel(req.params.id, {
      runtime_status: updateRuntimeStatus(novel, {
        agent_workflow: 'refine_failed',
        last_error: e.message,
        attempts: e.attempts || []
      }),
      updated_at: new Date().toISOString()
    });
    res.write(`data: ${JSON.stringify({ type: 'error', message: e.message, attempts: e.attempts || [] })}\n\n`);
  }
  res.end();
});

// 导出小说
// 完结小说：所有章节提交后才允许把项目标记为已完成。
router.post('/:id/complete', (req, res) => {
  const novel = getOwnedNovel(req, res, req.params.id);
  if (!novel) return;
  const blockers = completionBlockers(novel);
  if (blockers.length) {
    return res.status(400).json({
      success: false,
      error: '还有章节未提交，不能完结小说',
      blockers
    });
  }
  const completedAt = new Date().toISOString();
  db.updateNovel(req.params.id, {
    status: 'completed',
    completed_at: completedAt,
    runtime_status: updateRuntimeStatus(novel, {
      agent_workflow: 'novel_completed',
      last_error: ''
    }),
    updated_at: completedAt
  });
  res.json({ success: true, novel: db.getNovel(req.params.id) });
});

router.get('/:id/export', (req, res) => {
  const novel = getOwnedNovel(req, res, req.params.id);
  if (!novel) return;

  let content = `# ${novel.title}\n\n`;
  if (novel.outline?.synopsis) content += `> ${novel.outline.synopsis}\n\n`;
  if (novel.logline || novel.story_bible?.logline) content += `**一句话卖点：** ${novel.logline || novel.story_bible.logline}\n\n`;
  if (novel.story_bible) {
    const bible = novel.story_bible;
    content += `## 作品档案\n\n`;
    if (bible.theme) content += `- 主题：${bible.theme}\n`;
    if (bible.world?.setting) content += `- 世界观：${bible.world.setting}\n`;
    if (bible.world?.rules) content += `- 世界规则：${bible.world.rules}\n`;
    if ((bible.characters || []).length) {
      content += `\n### 人物\n\n`;
      for (const c of bible.characters) content += `- ${c.name || '未命名'}（${c.role || '角色'}）：${c.goal || c.personality || ''}${c.arc ? `；弧线：${c.arc}` : ''}\n`;
    }
    if ((bible.relationships || []).length) {
      content += `\n### 人物关系\n\n`;
      for (const r of bible.relationships) content += `- ${r.from || '?'} → ${r.to || '?'}：${r.type || ''}${r.description ? `，${r.description}` : ''}${r.tension ? `，张力：${r.tension}` : ''}\n`;
    }
    if ((bible.locations || []).length) {
      content += `\n### 场景地点\n\n`;
      for (const l of bible.locations) content += `- ${l.name || '未命名地点'}：${l.description || ''}\n`;
    }
    content += `\n---\n\n`;
  } else {
    content += `---\n\n`;
  }
  for (const ch of (novel.chapters || []).sort((a, b) => a.index - b.index)) {
    content += `## 第${ch.index}章 ${ch.title}\n\n${ch.content}\n\n---\n\n`;
  }

  res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(novel.title)}.md"`);
  res.send(content);
});

module.exports = router;
