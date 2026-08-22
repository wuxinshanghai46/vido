const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const STORE_VERSION = 1;
const STATUSES = new Set(['pending', 'approved', 'rejected']);

function clean(value, max = 2000) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function list(value, max = 32, itemMax = 240) {
  const source = Array.isArray(value) ? value : String(value || '').split(/[\n,，；;]/);
  return [...new Set(source.map(item => clean(item, itemMax)).filter(Boolean))].slice(0, max);
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).sort().reduce((out, key) => { out[key] = stable(value[key]); return out; }, {});
}

function hash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

function canonicalUrl(value = '') {
  const input = clean(value, 1600);
  if (!input) return '';
  try {
    const parsed = new URL(input);
    parsed.hash = '';
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'spm', 'from'].forEach(key => parsed.searchParams.delete(key));
    parsed.searchParams.sort();
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return input;
  }
}

function storePath(options = {}) {
  return path.resolve(options.storePath || path.join(process.env.OUTPUT_DIR || './outputs', 'knowledge_candidates.json'));
}

function emptyStore() {
  return { version: STORE_VERSION, candidates: [] };
}

function readStore(options = {}) {
  const target = storePath(options);
  if (!fs.existsSync(target)) return emptyStore();
  try {
    const parsed = JSON.parse(fs.readFileSync(target, 'utf8'));
    return { version: STORE_VERSION, candidates: Array.isArray(parsed.candidates) ? parsed.candidates : [] };
  } catch (error) {
    error.message = `知识候选存储损坏，拒绝覆盖：${error.message}`;
    error.code = 'KNOWLEDGE_CANDIDATE_STORE_CORRUPT';
    throw error;
  }
}

function writeStore(store, options = {}) {
  const target = storePath(options);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
  const backup = `${target}.${process.pid}.${Date.now()}.bak`;
  fs.writeFileSync(temp, JSON.stringify({ version: STORE_VERSION, candidates: store.candidates }, null, 2), 'utf8');
  try {
    if (fs.existsSync(target)) fs.renameSync(target, backup);
    fs.renameSync(temp, target);
    try { if (fs.existsSync(backup)) fs.unlinkSync(backup); } catch {}
  } catch (error) {
    if (!fs.existsSync(target) && fs.existsSync(backup)) fs.renameSync(backup, target);
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
    throw error;
  }
}

function normalizeRuntimePolicy(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return JSON.parse(JSON.stringify(value));
}

function normalizeCandidate(input = {}, previous = {}) {
  const sourceUrl = canonicalUrl(input.source_url || input.sourceUrl || previous.source_url);
  const title = clean(input.title || previous.title, 300);
  const content = clean(input.content || previous.content, 24000);
  if (!title) {
    const error = new Error('知识候选标题必填');
    error.status = 400;
    throw error;
  }
  if (content.length < 20) {
    const error = new Error('知识候选正文至少 20 个字符');
    error.status = 400;
    throw error;
  }
  const facts = list(input.facts ?? previous.facts, 40, 600);
  const inferences = list(input.inferences ?? previous.inferences, 40, 600);
  const executableRules = list(input.executable_rules ?? input.executableRules ?? previous.executable_rules, 40, 900);
  const limitations = list(input.limitations ?? previous.limitations, 30, 600);
  const sourceFingerprint = hash({ source_url: sourceUrl, title, content });
  const identityFingerprint = hash(sourceUrl ? { source_url: sourceUrl } : { title: title.toLowerCase(), content: content.toLowerCase() });
  return {
    id: clean(previous.id || input.id || `knowledge_candidate_${identityFingerprint.slice(0, 24)}`, 100),
    schema_version: 1,
    status: STATUSES.has(previous.status) ? previous.status : 'pending',
    source_type: clean(input.source_type || input.sourceType || previous.source_type || 'manual', 60),
    source_url: sourceUrl,
    source_label: clean(input.source_label || input.sourceLabel || input.source || previous.source_label || '', 500),
    title,
    author: clean(input.author || previous.author, 160),
    published_at: clean(input.published_at || input.publishedAt || previous.published_at, 80),
    summary: clean(input.summary || previous.summary || facts.join('；'), 1000),
    content,
    facts,
    inferences,
    executable_rules: executableRules,
    limitations,
    collection: clean(input.collection || previous.collection || 'production', 60),
    subcategory: clean(input.subcategory || previous.subcategory || '外部学习', 100),
    tags: list(input.tags ?? previous.tags, 24, 80),
    keywords: list(input.keywords ?? previous.keywords, 32, 80),
    prompt_snippets: list(input.prompt_snippets ?? input.promptSnippets ?? previous.prompt_snippets, 20, 600),
    applies_to: list(input.applies_to ?? input.appliesTo ?? previous.applies_to, 32, 80),
    runtime_policy: normalizeRuntimePolicy(input.runtime_policy || input.runtimePolicy || previous.runtime_policy),
    lang: clean(input.lang || previous.lang || 'zh', 20),
    content_hash: sourceFingerprint,
    identity_hash: identityFingerprint,
    created_at: previous.created_at || new Date().toISOString(),
    updated_at: new Date().toISOString(),
    reviewed_at: previous.reviewed_at || '',
    reviewed_by: clean(previous.reviewed_by, 120),
    review_note: clean(previous.review_note, 600),
    knowledge_id: clean(previous.knowledge_id, 120),
  };
}

function ingest(input = {}, options = {}) {
  const store = readStore(options);
  const draft = normalizeCandidate(input);
  const existingIndex = store.candidates.findIndex(item => item.identity_hash === draft.identity_hash || item.content_hash === draft.content_hash);
  if (existingIndex >= 0) {
    const existing = store.candidates[existingIndex];
    if (existing.content_hash === draft.content_hash) return { candidate: existing, created: false, duplicate: true, updated: false };
    const updated = normalizeCandidate(input, existing);
    updated.status = existing.status === 'approved' ? 'pending' : existing.status;
    updated.reviewed_at = updated.status === 'pending' ? '' : existing.reviewed_at;
    updated.reviewed_by = updated.status === 'pending' ? '' : existing.reviewed_by;
    updated.knowledge_id = existing.knowledge_id;
    store.candidates[existingIndex] = updated;
    writeStore(store, options);
    return { candidate: updated, created: false, duplicate: false, updated: true };
  }
  store.candidates.unshift(draft);
  writeStore(store, options);
  return { candidate: draft, created: true, duplicate: false, updated: false };
}

function listCandidates(filter = {}, options = {}) {
  const query = clean(filter.q, 200).toLowerCase();
  return readStore(options).candidates.filter(item => {
    if (filter.status && item.status !== filter.status) return false;
    if (filter.source_type && item.source_type !== filter.source_type) return false;
    if (query && ![item.title, item.summary, item.content, item.source_url, item.tags?.join(' ')].join(' ').toLowerCase().includes(query)) return false;
    return true;
  });
}

function getCandidate(id, options = {}) {
  return readStore(options).candidates.find(item => item.id === id) || null;
}

function mutateCandidate(id, mutator, options = {}) {
  const store = readStore(options);
  const index = store.candidates.findIndex(item => item.id === id);
  if (index < 0) {
    const error = new Error('知识候选不存在');
    error.status = 404;
    throw error;
  }
  const next = mutator({ ...store.candidates[index] });
  store.candidates[index] = next;
  writeStore(store, options);
  return next;
}

function approvedDocument(candidate) {
  const body = [
    candidate.content,
    candidate.facts.length ? `\n\n## 已确认事实\n${candidate.facts.map(value => `- ${value}`).join('\n')}` : '',
    candidate.inferences.length ? `\n\n## VIDO 推论\n${candidate.inferences.map(value => `- ${value}`).join('\n')}` : '',
    candidate.executable_rules.length ? `\n\n## 已审核的产品化建议\n${candidate.executable_rules.map(value => `- ${value}`).join('\n')}` : '',
    candidate.limitations.length ? `\n\n## 适用边界\n${candidate.limitations.map(value => `- ${value}`).join('\n')}` : '',
  ].filter(Boolean).join('');
  return {
    id: candidate.knowledge_id || `kb_reviewed_${candidate.identity_hash.slice(0, 24)}`,
    collection: candidate.collection,
    subcategory: candidate.subcategory,
    title: candidate.title,
    summary: candidate.summary,
    content: body,
    tags: candidate.tags,
    keywords: candidate.keywords,
    prompt_snippets: candidate.prompt_snippets,
    applies_to: candidate.applies_to,
    source: candidate.source_url || candidate.source_label || `candidate:${candidate.id}`,
    source_url: candidate.source_url,
    source_candidate_id: candidate.id,
    source_content_hash: candidate.content_hash,
    facts: candidate.facts,
    inferences: candidate.inferences,
    executable_rules: candidate.executable_rules,
    limitations: candidate.limitations,
    runtime_policy: candidate.runtime_policy,
    lang: candidate.lang,
    enabled: true,
    reviewed: true,
  };
}

function approve(id, review = {}, options = {}) {
  const database = options.database || require('../models/database');
  const existing = getCandidate(id, options);
  if (!existing) {
    const error = new Error('知识候选不存在'); error.status = 404; throw error;
  }
  const document = approvedDocument(existing);
  const prior = database.getKnowledgeDoc(document.id);
  if (prior) database.updateKnowledgeDoc(document.id, document);
  else database.insertKnowledgeDoc(document);
  let candidate;
  try {
    candidate = mutateCandidate(id, item => ({
      ...item,
      status: 'approved',
      reviewed_at: new Date().toISOString(),
      reviewed_by: clean(review.reviewed_by || review.reviewedBy || 'admin', 120),
      review_note: clean(review.review_note || review.reviewNote, 600),
      knowledge_id: document.id,
      updated_at: new Date().toISOString(),
    }), options);
  } catch (error) {
    try {
      if (prior) database.updateKnowledgeDoc(document.id, prior);
      else database.deleteKnowledgeDoc(document.id);
    } catch {}
    throw error;
  }
  try { (options.clearPolicyCache || require('./newStoryAd/knowledgePolicyCompilerService').clearCache)(); } catch {}
  return { candidate, document, created: !prior };
}

function reject(id, review = {}, options = {}) {
  return mutateCandidate(id, item => ({
    ...item,
    status: 'rejected',
    reviewed_at: new Date().toISOString(),
    reviewed_by: clean(review.reviewed_by || review.reviewedBy || 'admin', 120),
    review_note: clean(review.review_note || review.reviewNote, 600),
    updated_at: new Date().toISOString(),
  }), options);
}

function stats(options = {}) {
  const rows = readStore(options).candidates;
  return {
    total: rows.length,
    pending: rows.filter(item => item.status === 'pending').length,
    approved: rows.filter(item => item.status === 'approved').length,
    rejected: rows.filter(item => item.status === 'rejected').length,
  };
}

module.exports = {
  STORE_VERSION, canonicalUrl, normalizeCandidate, readStore, ingest, listCandidates,
  getCandidate, approve, reject, stats, approvedDocument, _private: { hash, storePath, writeStore },
};
