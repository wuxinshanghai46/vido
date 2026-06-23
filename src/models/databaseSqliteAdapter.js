const { getDbConfig } = require('../db/sqlite');
const records = require('../repositories/contentRecordRepository');

function isSqliteEnabled() {
  const config = getDbConfig();
  return config.enabled && config.type === 'sqlite';
}

function shouldReadPrimary() {
  return getDbConfig().readPrimary;
}

function shouldWriteLegacy() {
  const config = getDbConfig();
  return !config.readPrimary || config.dualWrite;
}

function withRead(collection, legacyFn, selectFn, filters = {}) {
  if (!isSqliteEnabled() || !shouldReadPrimary()) return legacyFn();
  const value = selectFn(records.list(collection, filters));
  if ((value == null || (Array.isArray(value) && value.length === 0)) && getDbConfig().jsonFallback) {
    return legacyFn();
  }
  return value;
}

function insert(collection, legacyFn, row) {
  if (isSqliteEnabled()) records.upsert(collection, row);
  if (shouldWriteLegacy()) legacyFn();
}

function update(collection, legacyFn, id, fields) {
  if (isSqliteEnabled()) records.update(collection, id, fields);
  if (shouldWriteLegacy()) legacyFn();
}

function remove(collection, legacyFn, id) {
  if (isSqliteEnabled()) records.remove(collection, id);
  if (shouldWriteLegacy()) legacyFn();
}

function byId(collection, legacyFn, id) {
  if (!isSqliteEnabled() || !shouldReadPrimary()) return legacyFn();
  const row = records.get(collection, id);
  if (!row && getDbConfig().jsonFallback) return legacyFn();
  return row;
}

function descCreated(rows) {
  return rows.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
}

function chapterTextValue(chapter = {}) {
  return String(chapter.content || chapter.text || chapter.body || chapter.draft || chapter.markdown || chapter.raw_content || '');
}

function displayWordCount(value) {
  return String(value || '').length;
}

function normalizeNovelFields(fields = {}) {
  if (!Array.isArray(fields.chapters)) return fields;
  const chapters = fields.chapters.map(chapter => {
    const text = chapterTextValue(chapter);
    return text ? { ...chapter, word_count: displayWordCount(text) } : chapter;
  });
  return {
    ...fields,
    chapters,
    total_words: chapters.reduce((sum, chapter) => sum + (Number(chapter.word_count) || 0), 0)
  };
}

function knowledgeFilter(filter = {}) {
  return d => {
    if (filter.collection && d.collection !== filter.collection) return false;
    if (filter.subcategory && d.subcategory !== filter.subcategory) return false;
    if (filter.appliesTo && !(d.applies_to || []).includes(filter.appliesTo)) return false;
    if (filter.enabledOnly && d.enabled === false) return false;
    if (filter.q) {
      const q = String(filter.q).toLowerCase();
      const hay = [d.title, d.summary, d.content, (d.tags || []).join(' '), (d.keywords || []).join(' ')]
        .filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  };
}

function tokenUsageFilter(filter = {}) {
  return r => {
    if (filter.from && r.timestamp < filter.from) return false;
    if (filter.to && r.timestamp > filter.to) return false;
    if (filter.provider && r.provider !== filter.provider) return false;
    if (filter.model && r.model !== filter.model) return false;
    if (filter.category && r.category !== filter.category) return false;
    if (filter.agent_id && r.agent_id !== filter.agent_id) return false;
    if (filter.user_id && r.user_id !== filter.user_id) return false;
    if (filter.status && r.status !== filter.status) return false;
    return true;
  };
}

function adapt(legacy) {
  return {
    ...legacy,

    insertProject(row) { insert('projects', () => legacy.insertProject(row), row); },
    getProject(id) { return byId('projects', () => legacy.getProject(id), id); },
    listProjects(userId) { return withRead('projects', () => legacy.listProjects(userId), rows => descCreated(rows.filter(p => !userId || p.user_id === userId)), userId ? { user_id: userId } : {}); },
    updateProject(id, fields) { update('projects', () => legacy.updateProject(id, fields), id, fields); },
    deleteProject(id) { remove('projects', () => legacy.deleteProject(id), id); },

    insertStory(row) { insert('stories', () => legacy.insertStory(row), row); },
    getStoryByProject(projectId) { return withRead('stories', () => legacy.getStoryByProject(projectId), rows => rows.find(s => s.project_id === projectId) || null, { project_id: projectId }); },

    insertClip(row) { insert('video_clips', () => legacy.insertClip(row), row); },
    updateClip(id, fields) { update('video_clips', () => legacy.updateClip(id, fields), id, fields); },
    getClipsByProject(projectId) {
      return withRead('video_clips', () => legacy.getClipsByProject(projectId), rows => rows.filter(c => c.project_id === projectId).sort((a, b) => (a.scene_index || 0) - (b.scene_index || 0)), { project_id: projectId });
    },
    getClip(id, projectId) { return withRead('video_clips', () => legacy.getClip(id, projectId), rows => rows.find(c => c.id === id && c.project_id === projectId) || null, { project_id: projectId }); },

    insertFinalVideo(row) { insert('final_videos', () => legacy.insertFinalVideo(row), row); },
    getFinalVideoByProject(projectId) {
      return withRead('final_videos', () => legacy.getFinalVideoByProject(projectId), rows => {
        const matches = rows.filter(v => v.project_id === projectId);
        return matches.length ? matches[matches.length - 1] : null;
      }, { project_id: projectId });
    },

    insertI2VTask(row) { insert('i2v_tasks', () => legacy.insertI2VTask(row), row); },
    getI2VTask(id) { return byId('i2v_tasks', () => legacy.getI2VTask(id), id); },
    listI2VTasks(userId) { return withRead('i2v_tasks', () => legacy.listI2VTasks(userId), rows => descCreated(rows.filter(t => !userId || t.user_id === userId)), userId ? { user_id: userId } : {}); },
    updateI2VTask(id, fields) { update('i2v_tasks', () => legacy.updateI2VTask(id, fields), id, fields); },
    deleteI2VTask(id) { remove('i2v_tasks', () => legacy.deleteI2VTask(id), id); },

    insertNovel(row) { insert('novels', () => legacy.insertNovel(row), row); },
    getNovel(id) { return byId('novels', () => legacy.getNovel(id), id); },
    listNovels(userId) { return withRead('novels', () => legacy.listNovels(userId), rows => descCreated(rows.filter(n => !userId || n.user_id === userId)), userId ? { user_id: userId } : {}); },
    updateNovel(id, fields) {
      const normalized = normalizeNovelFields(fields);
      update('novels', () => legacy.updateNovel(id, normalized), id, normalized);
    },
    deleteNovel(id) { remove('novels', () => legacy.deleteNovel(id), id); },

    insertAsset(row) { insert('assets', () => legacy.insertAsset(row), row); },
    getAsset(id) { return byId('assets', () => legacy.getAsset(id), id); },
    listAssets(userId, type) { return withRead('assets', () => legacy.listAssets(userId, type), rows => descCreated(rows.filter(a => (!userId || a.user_id === userId) && (!type || type === 'all' || a.type === type))), { ...(userId ? { user_id: userId } : {}), ...(type && type !== 'all' ? { type } : {}) }); },
    updateAsset(id, fields) { update('assets', () => legacy.updateAsset(id, fields), id, fields); },
    deleteAsset(id) { remove('assets', () => legacy.deleteAsset(id), id); },

    insertPortrait(row) { insert('portraits', () => legacy.insertPortrait(row), row); },
    getPortrait(id) { return byId('portraits', () => legacy.getPortrait(id), id); },
    listPortraits(userId) { return withRead('portraits', () => legacy.listPortraits(userId), rows => descCreated(rows.filter(t => !userId || t.user_id === userId)), userId ? { user_id: userId } : {}); },
    updatePortrait(id, fields) { update('portraits', () => legacy.updatePortrait(id, fields), id, fields); },
    deletePortrait(id) { remove('portraits', () => legacy.deletePortrait(id), id); },

    insertComicTask(row) { insert('comic_tasks', () => legacy.insertComicTask(row), row); },
    getComicTask(id) { return byId('comic_tasks', () => legacy.getComicTask(id), id); },
    listComicTasks(userId) { return withRead('comic_tasks', () => legacy.listComicTasks(userId), rows => descCreated(rows.filter(t => !userId || t.user_id === userId)), userId ? { user_id: userId } : {}); },
    updateComicTask(id, fields) { update('comic_tasks', () => legacy.updateComicTask(id, fields), id, fields); },
    deleteComicTask(id) { remove('comic_tasks', () => legacy.deleteComicTask(id), id); },

    insertAvatarTask(row) { insert('avatar_tasks', () => legacy.insertAvatarTask(row), row); },
    getAvatarTask(id) { return byId('avatar_tasks', () => legacy.getAvatarTask(id), id); },
    listAvatarTasks(userId) { return withRead('avatar_tasks', () => legacy.listAvatarTasks(userId), rows => descCreated(rows.filter(t => !userId || t.user_id === userId)), userId ? { user_id: userId } : {}); },
    updateAvatarTask(id, fields) { update('avatar_tasks', () => legacy.updateAvatarTask(id, fields), id, fields); },
    deleteAvatarTask(id) { remove('avatar_tasks', () => legacy.deleteAvatarTask(id), id); },

    insertMonitor(row) { insert('accounts', () => legacy.insertMonitor(row), row); },
    getMonitor(id) { return byId('accounts', () => legacy.getMonitor(id), id); },
    listMonitors(userId) { return withRead('accounts', () => legacy.listMonitors(userId), rows => descCreated(rows.filter(m => !userId || m.user_id === userId)), userId ? { user_id: userId } : {}); },
    updateMonitor(id, fields) { update('accounts', () => legacy.updateMonitor(id, fields), id, fields); },
    deleteMonitor(id) { remove('accounts', () => legacy.deleteMonitor(id), id); },

    insertContent(row) { insert('contents', () => legacy.insertContent(row), row); },
    getContent(id) { return byId('contents', () => legacy.getContent(id), id); },
    listContents(userId, accountId) { return withRead('contents', () => legacy.listContents(userId, accountId), rows => descCreated(rows.filter(c => (!userId || c.user_id === userId) && (!accountId || c.account_id === accountId))), { ...(userId ? { user_id: userId } : {}), ...(accountId ? { account_id: accountId } : {}) }); },
    updateContent(id, fields) { update('contents', () => legacy.updateContent(id, fields), id, fields); },
    deleteContent(id) { remove('contents', () => legacy.deleteContent(id), id); },

    insertSubscription(row) { insert('subscriptions', () => legacy.insertSubscription(row), row); },
    getSubscription(id) { return byId('subscriptions', () => legacy.getSubscription(id), id); },
    listSubscriptions(userId) { return withRead('subscriptions', () => legacy.listSubscriptions(userId), rows => descCreated(rows.filter(s => !userId || s.user_id === userId)), userId ? { user_id: userId } : {}); },
    listAllSubscriptions() { return withRead('subscriptions', () => legacy.listAllSubscriptions(), rows => descCreated(rows)); },
    updateSubscription(id, fields) { update('subscriptions', () => legacy.updateSubscription(id, fields), id, fields); },
    deleteSubscription(id) { remove('subscriptions', () => legacy.deleteSubscription(id), id); },

    insertReplicateTask(row) { insert('tasks', () => legacy.insertReplicateTask(row), row); },
    getReplicateTask(id) { return byId('tasks', () => legacy.getReplicateTask(id), id); },
    listReplicateTasks(userId) { return withRead('tasks', () => legacy.listReplicateTasks(userId), rows => descCreated(rows.filter(t => !userId || t.user_id === userId)), userId ? { user_id: userId } : {}); },
    updateReplicateTask(id, fields) { update('tasks', () => legacy.updateReplicateTask(id, fields), id, fields); },
    deleteReplicateTask(id) { remove('tasks', () => legacy.deleteReplicateTask(id), id); },

    insertVoice(row) { insert('voices', () => legacy.insertVoice(row), row); },
    getVoice(id) { return byId('voices', () => legacy.getVoice(id), id); },
    listVoices(userId) { return withRead('voices', () => legacy.listVoices(userId), rows => descCreated(rows.filter(v => !userId || v.user_id === userId)), userId ? { user_id: userId } : {}); },
    updateVoice(id, fields) { update('voices', () => legacy.updateVoice(id, fields), id, fields); },
    deleteVoice(id) { remove('voices', () => legacy.deleteVoice(id), id); },

    insertPublication(row) { insert('publications', () => legacy.insertPublication(row), row); },
    getPublication(id) { return byId('publications', () => legacy.getPublication(id), id); },
    listPublications() { return withRead('publications', () => legacy.listPublications(), rows => descCreated(rows)); },
    updatePublication(id, fields) { update('publications', () => legacy.updatePublication(id, fields), id, fields); },
    deletePublication(id) { remove('publications', () => legacy.deletePublication(id), id); },

    insertAIChar(row) { insert('characters', () => legacy.insertAIChar(row), row); },
    getAIChar(id) { return byId('characters', () => legacy.getAIChar(id), id); },
    listAIChars(userId) { return withRead('characters', () => legacy.listAIChars(userId), rows => descCreated(rows.filter(c => !userId || c.user_id === userId)), userId ? { user_id: userId } : {}); },
    updateAIChar(id, fields) { update('characters', () => legacy.updateAIChar(id, fields), id, fields); },
    deleteAIChar(id) { remove('characters', () => legacy.deleteAIChar(id), id); },

    insertAIScene(row) { insert('scenes', () => legacy.insertAIScene(row), row); },
    getAIScene(id) { return byId('scenes', () => legacy.getAIScene(id), id); },
    listAIScenes(userId) { return withRead('scenes', () => legacy.listAIScenes(userId), rows => descCreated(rows.filter(s => !userId || s.user_id === userId)), userId ? { user_id: userId } : {}); },
    updateAIScene(id, fields) { update('scenes', () => legacy.updateAIScene(id, fields), id, fields); },
    deleteAIScene(id) { remove('scenes', () => legacy.deleteAIScene(id), id); },

    insertAIStyle(row) { insert('styles', () => legacy.insertAIStyle(row), row); },
    getAIStyle(id) { return byId('styles', () => legacy.getAIStyle(id), id); },
    listAIStyles() { return withRead('styles', () => legacy.listAIStyles(), rows => descCreated(rows)); },
    updateAIStyle(id, fields) { update('styles', () => legacy.updateAIStyle(id, fields), id, fields); },
    deleteAIStyle(id) { remove('styles', () => legacy.deleteAIStyle(id), id); },

    insertKnowledgeDoc(row) { insert('documents', () => legacy.insertKnowledgeDoc(row), row); },
    getKnowledgeDoc(id) { return byId('documents', () => legacy.getKnowledgeDoc(id), id); },
    listKnowledgeDocs(filter = {}) { return withRead('documents', () => legacy.listKnowledgeDocs(filter), rows => descCreated(rows.filter(knowledgeFilter(filter)))); },
    updateKnowledgeDoc(id, fields) { update('documents', () => legacy.updateKnowledgeDoc(id, fields), id, fields); },
    deleteKnowledgeDoc(id) { remove('documents', () => legacy.deleteKnowledgeDoc(id), id); },
    bulkInsertKnowledgeDocs(rows) {
      if (isSqliteEnabled()) for (const row of rows) records.upsert('documents', row);
      if (shouldWriteLegacy()) legacy.bulkInsertKnowledgeDocs(rows);
    },

    insertTokenUsage(row) { insert('calls', () => legacy.insertTokenUsage(row), row); },
    listTokenUsage(filter = {}) { return withRead('calls', () => legacy.listTokenUsage(filter), rows => descCreated(rows.filter(tokenUsageFilter(filter)))); },
    getTokenUsage(id) { return byId('calls', () => legacy.getTokenUsage(id), id); },
    deleteTokenUsage(id) { remove('calls', () => legacy.deleteTokenUsage(id), id); },
    pruneTokenUsageBefore(ts) {
      const removed = isSqliteEnabled() ? records.pruneBefore('calls', 'timestamp', ts) : 0;
      if (shouldWriteLegacy()) return legacy.pruneTokenUsageBefore(ts);
      return removed;
    },

    insertDramaProject(row) { insert('drama_projects', () => legacy.insertDramaProject(row), row); },
    getDramaProject(id) { return byId('drama_projects', () => legacy.getDramaProject(id), id); },
    listDramaProjects(userId) { return withRead('drama_projects', () => legacy.listDramaProjects(userId), rows => descCreated(rows.filter(r => !userId || r.user_id === userId)), userId ? { user_id: userId } : {}); },
    updateDramaProject(id, fields) { update('drama_projects', () => legacy.updateDramaProject(id, fields), id, fields); },
    deleteDramaProject(id) { remove('drama_projects', () => legacy.deleteDramaProject(id), id); },

    insertDramaEpisode(row) { insert('drama_episodes', () => legacy.insertDramaEpisode(row), row); },
    getDramaEpisode(id) { return byId('drama_episodes', () => legacy.getDramaEpisode(id), id); },
    listDramaEpisodes(projectId) { return withRead('drama_episodes', () => legacy.listDramaEpisodes(projectId), rows => rows.filter(r => r.project_id === projectId).sort((a, b) => (a.episode_index || 0) - (b.episode_index || 0)), { project_id: projectId }); },
    updateDramaEpisode(id, fields) { update('drama_episodes', () => legacy.updateDramaEpisode(id, fields), id, fields); },
    deleteDramaEpisode(id) { remove('drama_episodes', () => legacy.deleteDramaEpisode(id), id); },

    insertDramaTask(row) { this.insertDramaEpisode(row); },
    getDramaTask(id) { return this.getDramaEpisode(id); },
    listDramaTasks(userId) { return withRead('drama_episodes', () => legacy.listDramaTasks(userId), rows => descCreated(rows.filter(r => !userId || r.user_id === userId)), userId ? { user_id: userId } : {}); },
    updateDramaTask(id, fields) { this.updateDramaEpisode(id, fields); },
    deleteDramaTask(id) { this.deleteDramaEpisode(id); },
  };
}

module.exports = { adapt };
