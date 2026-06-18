#!/usr/bin/env node
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { openDatabase } = require('../../src/db/sqlite');

const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const force = args.has('--force') || dryRun;
const outputDir = path.resolve(process.env.OUTPUT_DIR || path.join(__dirname, '../../outputs'));

function nowIso() {
  return new Date().toISOString();
}

function stableId(prefix, ...parts) {
  const raw = parts.filter(v => v != null && v !== '').map(v => String(v)).join('|');
  const hash = crypto.createHash('sha1').update(raw || `${prefix}|empty`).digest('hex').slice(0, 24);
  return `${prefix}_${hash}`;
}

function hashSecret(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function readJson(fileName, defaultValue = null) {
  const filePath = path.join(outputDir, fileName);
  if (!fs.existsSync(filePath)) return defaultValue;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readJsonl(fileName) {
  const filePath = path.join(outputDir, fileName);
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map(line => JSON.parse(line));
}

function toJson(value) {
  return JSON.stringify(value == null ? null : value);
}

function sanitizeConfig(value) {
  if (Array.isArray(value)) return value.map(sanitizeConfig);
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [key, val] of Object.entries(value)) {
    if (/api[_-]?key|secret|token|password|passwd|authorization|credential/i.test(key)) continue;
    out[key] = sanitizeConfig(val);
  }
  return out;
}

function pickDate(row, field, fallback) {
  const value = row && row[field];
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
}

function titleOf(row, fallback) {
  return row?.title || row?.name || row?.project_name || row?.topic || row?.prompt?.slice?.(0, 80) || fallback;
}

function createInserter(ctx, table, columns, conflictColumn = 'id') {
  const db = ctx.db;
  const placeholders = columns.map(() => '?').join(', ');
  const conflictColumns = Array.isArray(conflictColumn) ? conflictColumn : [conflictColumn];
  const conflictTarget = conflictColumns.join(', ');
  const updates = columns
    .filter(column => !conflictColumns.includes(column))
    .map(column => `${column}=excluded.${column}`)
    .join(', ');
  const sql = `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders}) ON CONFLICT(${conflictTarget}) DO UPDATE SET ${updates}`;
  if (typeof db.upsertMany === 'function') {
    const buffer = [];
    ctx.flushers.push(() => {
      if (!buffer.length) return;
      const rows = buffer.splice(0, buffer.length).map(row => columns.map(column => row[column] ?? null));
      db.upsertMany(table, columns, conflictColumns, rows);
    });
    return row => buffer.push(row);
  }
  const stmt = db.prepare(sql);
  return row => stmt.run(columns.map(column => row[column] ?? null));
}

function createContext(db) {
  const ctx = {
    db,
    knownProjects: new Set(db.prepare('SELECT id FROM projects').all().map(row => row.id)),
    counts: {},
    notes: [],
    flushers: [],
    upserts: {
      appKv: null,
      user: null,
      session: null,
      project: null,
      step: null,
      task: null,
      event: null,
      artifact: null,
      asset: null,
      actorAsset: null,
      voice: null,
      provider: null,
      model: null,
      route: null,
      collection: null,
      document: null,
      usage: null,
      audit: null,
      luxuryProject: null,
      contentRecord: null,
    },
    flushAll() {
      for (const flush of this.flushers) flush();
    },
  };
  ctx.upserts.appKv = createInserter(ctx, 'app_kv', ['key', 'value_json', 'updated_at'], 'key');
  ctx.upserts.user = createInserter(ctx, 'users', ['id', 'username', 'phone', 'email', 'password_hash', 'role', 'status', 'payload_json', 'created_at', 'updated_at']);
  ctx.upserts.session = createInserter(ctx, 'user_sessions', ['id', 'user_id', 'token_hash', 'expires_at', 'created_at']);
  ctx.upserts.project = createInserter(ctx, 'projects', ['id', 'user_id', 'type', 'title', 'status', 'current_step', 'locked_step', 'source', 'payload_json', 'created_at', 'updated_at']);
  ctx.upserts.step = createInserter(ctx, 'project_steps', ['id', 'project_id', 'step_key', 'status', 'locked', 'locked_at', 'completed_at', 'data_json', 'created_at', 'updated_at']);
  ctx.upserts.task = createInserter(ctx, 'generation_tasks', ['id', 'project_id', 'user_id', 'module', 'task_type', 'status', 'progress', 'provider', 'model', 'input_json', 'output_json', 'error_message', 'started_at', 'finished_at', 'created_at', 'updated_at']);
  ctx.upserts.event = createInserter(ctx, 'task_events', ['id', 'task_id', 'event_type', 'message', 'payload_json', 'created_at']);
  ctx.upserts.artifact = createInserter(ctx, 'artifacts', ['id', 'project_id', 'task_id', 'type', 'file_path', 'public_url', 'mime_type', 'size', 'hash', 'width', 'height', 'duration', 'metadata_json', 'created_at']);
  ctx.upserts.asset = createInserter(ctx, 'assets', ['id', 'user_id', 'category', 'name', 'source', 'status', 'artifact_id', 'metadata_json', 'created_at', 'updated_at']);
  ctx.upserts.actorAsset = createInserter(ctx, 'actor_assets', ['id', 'asset_id', 'actor_type', 'gender', 'age_range', 'wardrobe_style', 'style_tags_json', 'prompt', 'consistency_key', 'created_at', 'updated_at']);
  ctx.upserts.voice = createInserter(ctx, 'voices', ['id', 'user_id', 'name', 'provider', 'voice_key', 'asset_id', 'metadata_json', 'created_at', 'updated_at']);
  ctx.upserts.provider = createInserter(ctx, 'model_providers', ['id', 'name', 'enabled', 'config_json', 'created_at', 'updated_at']);
  ctx.upserts.model = createInserter(ctx, 'provider_models', ['id', 'provider_id', 'model_key', 'display_name', 'capability', 'enabled', 'priority', 'cost_config_json', 'created_at', 'updated_at']);
  ctx.upserts.route = createInserter(ctx, 'pipeline_routes', ['id', 'module', 'step_key', 'provider_model_id', 'fallback_order', 'enabled', 'created_at', 'updated_at']);
  ctx.upserts.collection = createInserter(ctx, 'knowledge_collections', ['id', 'name', 'description', 'created_at', 'updated_at']);
  ctx.upserts.document = createInserter(ctx, 'knowledge_documents', ['id', 'collection_id', 'title', 'content', 'tags_json', 'source', 'created_at', 'updated_at']);
  ctx.upserts.usage = createInserter(ctx, 'usage_records', ['id', 'user_id', 'project_id', 'task_id', 'provider', 'model', 'input_tokens', 'output_tokens', 'image_count', 'video_seconds', 'cost_estimate', 'status', 'payload_json', 'created_at']);
  ctx.upserts.audit = createInserter(ctx, 'audit_logs', ['id', 'user_id', 'action', 'target_type', 'target_id', 'payload_json', 'created_at']);
  ctx.upserts.luxuryProject = createInserter(ctx, 'luxury_ad_projects', ['id', 'project_id', 'brand', 'product', 'audience', 'style', 'status', 'created_at', 'updated_at']);
  ctx.upserts.contentRecord = createInserter(ctx, 'content_records', ['id', 'collection', 'user_id', 'project_id', 'account_id', 'type', 'status', 'payload_json', 'created_at', 'updated_at'], ['collection', 'id']);
  return ctx;
}

function inc(ctx, key, amount = 1) {
  ctx.counts[key] = (ctx.counts[key] || 0) + amount;
}

function saveAppKv(ctx, key, value) {
  ctx.upserts.appKv({ key, value_json: toJson(value), updated_at: nowIso() });
  inc(ctx, 'app_kv');
}

function saveContentRecord(ctx, collection, row = {}) {
  const created = pickDate(row, 'created_at', row.timestamp || nowIso());
  const id = String(row.id || stableId('record', collection, row.project_id || row.user_id || '', row.name || row.title || '', created));
  const payload = { ...row, id };
  ctx.upserts.contentRecord({
    id,
    collection,
    user_id: payload.user_id || payload.userId || null,
    project_id: payload.project_id || payload.projectId || null,
    account_id: payload.account_id || payload.accountId || null,
    type: payload.type || payload.category || null,
    status: payload.status || payload.state || null,
    payload_json: toJson(payload),
    created_at: created,
    updated_at: pickDate(payload, 'updated_at', created),
  });
  inc(ctx, 'content_records');
}

function upsertProject(ctx, row, type, source, fallbackTitle) {
  const created = pickDate(row, 'created_at', nowIso());
  const updated = pickDate(row, 'updated_at', created);
  const id = String(row?.id || stableId(type, source, titleOf(row, fallbackTitle), created));
  ctx.upserts.project({
    id,
    user_id: row?.user_id || row?.userId || null,
    type,
    title: titleOf(row, fallbackTitle),
    status: row?.status || row?.project_state || row?.state || null,
    current_step: row?.current_step || row?.step || row?.stage || null,
    locked_step: row?.locked_step || null,
    source,
    payload_json: toJson(row),
    created_at: created,
    updated_at: updated,
  });
  ctx.knownProjects.add(id);
  inc(ctx, 'projects');
  return id;
}

function upsertTask(ctx, row, module, taskType, source, projectId = null) {
  const created = pickDate(row, 'created_at', nowIso());
  const updated = pickDate(row, 'updated_at', created);
  const id = String(row?.id || row?.task_id || stableId('task', source, module, taskType, titleOf(row, ''), created));
  const linkedProjectId = projectId && ctx.knownProjects.has(projectId) ? projectId : null;
  ctx.upserts.task({
    id,
    project_id: linkedProjectId,
    user_id: row?.user_id || row?.userId || null,
    module,
    task_type: taskType,
    status: row?.status || row?.state || 'imported',
    progress: Number.isFinite(Number(row?.progress)) ? Number(row.progress) : null,
    provider: row?.provider || row?.model_provider || null,
    model: row?.model || row?.model_id || null,
    input_json: toJson(row?.input || row?.request || row?.prompt || null),
    output_json: toJson(row?.output || row?.result || null),
    error_message: row?.error || row?.error_message || null,
    started_at: row?.started_at || null,
    finished_at: row?.finished_at || row?.completed_at || null,
    created_at: created,
    updated_at: updated,
  });
  inc(ctx, 'generation_tasks');
  return id;
}

function upsertArtifactFromRow(ctx, row, source, type, projectId = null, taskId = null) {
  const filePath = row?.file_path || row?.path || row?.local_path || row?.videoPath || row?.imagePath || row?.audioPath || null;
  const publicUrl = row?.url || row?.file_url || row?.video_url || row?.image_url || row?.audio_url || null;
  if (!filePath && !publicUrl) return null;
  const created = pickDate(row, 'created_at', nowIso());
  const id = String(row?.artifact_id || stableId('artifact', source, type, filePath || publicUrl));
  ctx.upserts.artifact({
    id,
    project_id: projectId && ctx.knownProjects.has(projectId) ? projectId : null,
    task_id: taskId || null,
    type,
    file_path: filePath,
    public_url: publicUrl,
    mime_type: row?.mime_type || null,
    size: row?.size || null,
    hash: row?.hash || null,
    width: row?.width || null,
    height: row?.height || null,
    duration: row?.duration || row?.duration_seconds || null,
    metadata_json: toJson(row),
    created_at: created,
  });
  inc(ctx, 'artifacts');
  return id;
}

function migrateAuth(ctx) {
  const data = readJson('auth_db.json', {});
  for (const user of data.users || []) {
    saveContentRecord(ctx, 'users', user);
    const created = pickDate(user, 'created_at', nowIso());
    ctx.upserts.user({
      id: String(user.id || stableId('user', user.username, user.email, created)),
      username: user.username || null,
      phone: user.phone || null,
      email: user.email || null,
      password_hash: user.password_hash || user.password || null,
      role: user.role || null,
      status: user.status || 'active',
      payload_json: toJson(sanitizeConfig(user)),
      created_at: created,
      updated_at: pickDate(user, 'updated_at', created),
    });
    inc(ctx, 'users');
  }
  for (const token of data.refresh_tokens || []) {
    if (!token.user_id && !token.userId) continue;
    const rawToken = token.token || token.refresh_token || token.id || '';
    ctx.upserts.session({
      id: String(token.id || stableId('session', rawToken)),
      user_id: String(token.user_id || token.userId),
      token_hash: hashSecret(rawToken),
      expires_at: token.expires_at || token.expiresAt || null,
      created_at: pickDate(token, 'created_at', nowIso()),
    });
    inc(ctx, 'user_sessions');
  }
  if (data.roles) saveAppKv(ctx, 'auth.roles', data.roles);
  if (data.api_accounts) saveAppKv(ctx, 'auth.api_accounts', sanitizeConfig(data.api_accounts));
  for (const row of data.credits_log || []) {
    ctx.upserts.audit({
      id: String(row.id || stableId('audit', 'credits_log', row.user_id, row.created_at, row.amount)),
      user_id: row.user_id || null,
      action: 'credits_log',
      target_type: 'user',
      target_id: row.user_id || null,
      payload_json: toJson(row),
      created_at: pickDate(row, 'created_at', nowIso()),
    });
    inc(ctx, 'audit_logs');
  }
}

function migrateProjectDb(ctx) {
  const data = readJson('project_db.json', {});
  for (const row of data.projects || []) {
    saveContentRecord(ctx, 'projects', row);
    upsertProject(ctx, row, 'project_pipeline', 'project_db.projects', 'Project');
  }
  for (const row of data.stories || []) {
    saveContentRecord(ctx, 'stories', row);
    const projectId = String(row.project_id || row.projectId || stableId('project', 'project_db.stories', row.id || row.title || row.content));
    if (!ctx.knownProjects.has(projectId)) {
      const created = pickDate(row, 'created_at', nowIso());
      ctx.upserts.project({
        id: projectId,
        user_id: row.user_id || row.userId || null,
        type: 'project_pipeline',
        title: titleOf(row, 'Imported Story Project'),
        status: 'imported_orphan',
        current_step: 'story',
        locked_step: null,
        source: 'project_db.stories.orphan',
        payload_json: toJson({ imported_from: 'project_db.stories', story_id: row.id || null }),
        created_at: created,
        updated_at: pickDate(row, 'updated_at', created),
      });
      ctx.knownProjects.add(projectId);
      inc(ctx, 'projects');
      ctx.notes.push(`Created placeholder project for story ${row.id || projectId}`);
    }
    const id = String(row.id || stableId('step', projectId, 'story'));
    const created = pickDate(row, 'created_at', nowIso());
    ctx.upserts.step({
      id,
      project_id: projectId,
      step_key: 'story',
      status: row.status || 'imported',
      locked: 0,
      locked_at: null,
      completed_at: row.completed_at || null,
      data_json: toJson(row),
      created_at: created,
      updated_at: pickDate(row, 'updated_at', created),
    });
    inc(ctx, 'project_steps');
  }
  for (const row of data.video_clips || []) {
    saveContentRecord(ctx, 'video_clips', row);
    upsertArtifactFromRow(ctx, row, 'project_db.video_clips', 'video_clip', row.project_id || null, null);
  }
  for (const row of data.final_videos || []) {
    saveContentRecord(ctx, 'final_videos', row);
    upsertArtifactFromRow(ctx, row, 'project_db.final_videos', 'final_video', row.project_id || null, null);
  }
}

function migrateTaskFile(ctx, fileName, key, module, taskType) {
  const data = readJson(fileName, {});
  for (const row of data[key] || []) {
    saveContentRecord(ctx, key, row);
    const taskId = upsertTask(ctx, row, module, taskType, `${fileName}.${key}`, row.project_id || null);
    upsertArtifactFromRow(ctx, row, `${fileName}.${key}`, taskType, row.project_id || null, taskId);
  }
}

function migrateAssets(ctx) {
  const sources = [
    ['asset_db.json', 'assets', 'asset'],
    ['ai_characters.json', 'characters', 'character'],
    ['ai_scenes.json', 'scenes', 'scene'],
  ];
  for (const [fileName, key, category] of sources) {
    const data = readJson(fileName, {});
    for (const row of data[key] || []) {
      saveContentRecord(ctx, key, row);
      const artifactId = upsertArtifactFromRow(ctx, row, `${fileName}.${key}`, category, null, null);
      const created = pickDate(row, 'created_at', nowIso());
      const assetId = String(row.id || stableId('asset', fileName, category, titleOf(row, category), created));
      ctx.upserts.asset({
        id: assetId,
        user_id: row.user_id || null,
        category,
        name: titleOf(row, category),
        source: `${fileName}.${key}`,
        status: row.status || 'imported',
        artifact_id: artifactId,
        metadata_json: toJson(row),
        created_at: created,
        updated_at: pickDate(row, 'updated_at', created),
      });
      inc(ctx, 'assets');
      if (category === 'character') {
        ctx.upserts.actorAsset({
          id: String(row.actor_asset_id || stableId('actor', assetId)),
          asset_id: assetId,
          actor_type: row.actor_type || row.type || null,
          gender: row.gender || null,
          age_range: row.age_range || null,
          wardrobe_style: row.wardrobe_style || null,
          style_tags_json: toJson(row.tags || row.style_tags || []),
          prompt: row.prompt || null,
          consistency_key: row.consistency_key || null,
          created_at: created,
          updated_at: pickDate(row, 'updated_at', created),
        });
        inc(ctx, 'actor_assets');
      }
    }
  }
}

function migratePortraits(ctx) {
  const data = readJson('portrait_db.json', {});
  for (const row of data.portraits || []) {
    saveContentRecord(ctx, 'portraits', row);
    const artifactId = upsertArtifactFromRow(ctx, row, 'portrait_db.portraits', 'portrait', null, null);
    const created = pickDate(row, 'created_at', nowIso());
    const assetId = String(row.id || stableId('asset', 'portrait', titleOf(row, 'portrait'), created));
    ctx.upserts.asset({
      id: assetId,
      user_id: row.user_id || null,
      category: 'portrait',
      name: titleOf(row, 'Portrait'),
      source: 'portrait_db.portraits',
      status: row.status || 'imported',
      artifact_id: artifactId,
      metadata_json: toJson(row),
      created_at: created,
      updated_at: pickDate(row, 'updated_at', created),
    });
    ctx.upserts.actorAsset({
      id: String(row.actor_asset_id || stableId('actor', assetId)),
      asset_id: assetId,
      actor_type: row.actor_type || 'portrait',
      gender: row.gender || null,
      age_range: row.age_range || null,
      wardrobe_style: row.wardrobe_style || null,
      style_tags_json: toJson(row.tags || []),
      prompt: row.prompt || null,
      consistency_key: row.consistency_key || null,
      created_at: created,
      updated_at: pickDate(row, 'updated_at', created),
    });
    inc(ctx, 'assets');
    inc(ctx, 'actor_assets');
  }
}

function migrateVoices(ctx) {
  const data = readJson('voice_db.json', {});
  for (const row of data.voices || []) {
    saveContentRecord(ctx, 'voices', row);
    const artifactId = upsertArtifactFromRow(ctx, row, 'voice_db.voices', 'voice', null, null);
    const created = pickDate(row, 'created_at', nowIso());
    const assetId = String(row.asset_id || stableId('asset', 'voice', row.id || row.name));
    if (artifactId) {
      ctx.upserts.asset({
        id: assetId,
        user_id: row.user_id || null,
        category: 'voice',
        name: titleOf(row, 'Voice'),
        source: 'voice_db.voices',
        status: row.status || 'imported',
        artifact_id: artifactId,
        metadata_json: toJson(row),
        created_at: created,
        updated_at: pickDate(row, 'updated_at', created),
      });
      inc(ctx, 'assets');
    }
    ctx.upserts.voice({
      id: String(row.id || stableId('voice', row.name, created)),
      user_id: row.user_id || null,
      name: titleOf(row, 'Voice'),
      provider: row.provider || null,
      voice_key: row.voice_key || row.voice_id || null,
      asset_id: artifactId ? assetId : null,
      metadata_json: toJson(row),
      created_at: created,
      updated_at: pickDate(row, 'updated_at', created),
    });
    inc(ctx, 'voices');
  }
}

function migrateSettings(ctx) {
  const settings = readJson('settings.json', {});
  for (const provider of settings.providers || []) {
    const id = String(provider.id || provider.preset || stableId('provider', provider.name));
    const created = pickDate(provider, 'created_at', nowIso());
    ctx.upserts.provider({
      id,
      name: provider.name || id,
      enabled: provider.enabled === false ? 0 : 1,
      config_json: toJson(sanitizeConfig(provider)),
      created_at: created,
      updated_at: pickDate(provider, 'updated_at', created),
    });
    inc(ctx, 'model_providers');
    for (const [index, model] of (provider.models || []).entries()) {
      const modelKey = String(model.id || model.model || stableId('model', id, index));
      ctx.upserts.model({
        id: stableId('model', id, modelKey),
        provider_id: id,
        model_key: modelKey,
        display_name: model.name || modelKey,
        capability: model.type || model.use || null,
        enabled: model.enabled === false ? 0 : 1,
        priority: Number.isFinite(Number(model.priority)) ? Number(model.priority) : index,
        cost_config_json: toJson(model.cost || null),
        created_at: created,
        updated_at: pickDate(model, 'updated_at', created),
      });
      inc(ctx, 'provider_models');
    }
  }
  saveAppKv(ctx, 'settings.mcps', sanitizeConfig(settings.mcps || []));
  saveAppKv(ctx, 'settings.skills', sanitizeConfig(settings.skills || []));
  saveAppKv(ctx, 'settings.sync', sanitizeConfig(settings.sync || {}));

  const pipeline = readJson('pipeline_model_config.json', {});
  saveAppKv(ctx, 'pipeline_model_config.stages', sanitizeConfig(pipeline.stages || {}));
  const search = readJson('search_providers.json', {});
  saveAppKv(ctx, 'search_providers.providers', sanitizeConfig(search.providers || {}));
  const styles = readJson('ai_styles.json', {});
  for (const row of styles.styles || []) saveContentRecord(ctx, 'styles', row);
  saveAppKv(ctx, 'ai_styles.styles', styles.styles || []);
}

function migrateKnowledge(ctx) {
  const data = readJson('knowledge_base.json', {});
  const collectionIds = new Set();
  for (const row of data.documents || []) {
    saveContentRecord(ctx, 'documents', row);
    const collectionId = String(row.collection || 'default');
    if (!collectionIds.has(collectionId)) {
      ctx.upserts.collection({
        id: collectionId,
        name: collectionId,
        description: null,
        created_at: nowIso(),
        updated_at: nowIso(),
      });
      collectionIds.add(collectionId);
      inc(ctx, 'knowledge_collections');
    }
    const created = pickDate(row, 'created_at', nowIso());
    ctx.upserts.document({
      id: String(row.id || stableId('doc', collectionId, row.title, created)),
      collection_id: collectionId,
      title: row.title || 'Untitled',
      content: row.content || row.summary || '',
      tags_json: toJson(row.tags || row.keywords || []),
      source: row.source || 'knowledge_base.json',
      created_at: created,
      updated_at: pickDate(row, 'updated_at', created),
    });
    inc(ctx, 'knowledge_documents');
  }
}

function migrateUsage(ctx) {
  const data = readJson('token_usage.json', {});
  const rows = [...(data.calls || []), ...readJsonl('usage_log.jsonl')];
  for (const row of rows) {
    saveContentRecord(ctx, 'calls', row);
    const created = row.created_at || row.timestamp || (row.ts ? new Date(row.ts).toISOString() : nowIso());
    const id = String(row.id || stableId('usage', row.provider, row.model, row.requestId || row.workflowId, created));
    ctx.upserts.usage({
      id,
      user_id: row.user_id || row.userId || null,
      project_id: row.project_id && ctx.knownProjects.has(row.project_id) ? row.project_id : null,
      task_id: row.task_id || null,
      provider: row.provider || null,
      model: row.model || null,
      input_tokens: row.input_tokens || row.inputTokens || row.promptTokens || 0,
      output_tokens: row.output_tokens || row.outputTokens || row.completionTokens || 0,
      image_count: row.image_count || row.imageCount || 0,
      video_seconds: row.video_seconds || row.videoSeconds || 0,
      cost_estimate: row.cost_estimate || row.costUsd || 0,
      status: row.status || 'imported',
      payload_json: toJson(row),
      created_at: created,
    });
    inc(ctx, 'usage_records');
  }
}

function migrateDramaAndWorkflow(ctx) {
  const drama = readJson('drama_db.json', {});
  for (const row of drama.drama_projects || []) {
    saveContentRecord(ctx, 'drama_projects', row);
    upsertProject(ctx, row, 'drama', 'drama_db.drama_projects', 'Drama');
  }
  for (const row of drama.drama_episodes || []) {
    saveContentRecord(ctx, 'drama_episodes', row);
    const projectId = row.project_id || null;
    upsertTask(ctx, row, 'drama', 'episode', 'drama_db.drama_episodes', projectId);
    upsertArtifactFromRow(ctx, row, 'drama_db.drama_episodes', 'drama_episode', projectId, null);
  }
  const workflow = readJson('workflow_db.json', {});
  for (const row of workflow.workflows || []) {
    saveContentRecord(ctx, 'workflows', row);
    upsertProject(ctx, row, 'workflow', 'workflow_db.workflows', 'Workflow');
  }
}

function migrateLuxury(ctx) {
  const data = readJson('luxury_ad_projects.json', {});
  for (const row of data.projects || []) {
    saveContentRecord(ctx, 'luxury_ad_projects', row);
    const projectId = upsertProject(ctx, row, 'luxury_ad', 'luxury_ad_projects.projects', 'Luxury Ad');
    const created = pickDate(row, 'created_at', nowIso());
    ctx.upserts.luxuryProject({
      id: String(row.id || stableId('luxury', projectId)),
      project_id: projectId,
      brand: row.brand || row.brand_name || null,
      product: row.product || row.product_name || null,
      audience: row.audience || row.target_audience || null,
      style: row.style || row.visual_style || null,
      status: row.status || row.project_state || null,
      created_at: created,
      updated_at: pickDate(row, 'updated_at', created),
    });
    inc(ctx, 'luxury_ad_projects');
  }
}

function migrateMisc(ctx) {
  const miscFiles = [
    'daily_learn_state.json',
    'edit_db.json',
    'hifly_avatar_cache.json',
    'monitor_db.json',
    'content_db.json',
    'subscription_db.json',
    'vido_db.json',
    'vido_db_backup.json',
  ];
  for (const fileName of miscFiles) {
    const data = readJson(fileName, null);
    if (data != null) saveAppKv(ctx, `legacy.${fileName.replace(/\.json$/, '')}`, sanitizeConfig(data));
  }
}

function plannedCountsOnly() {
  const counts = {};
  const add = (key, amount) => { counts[key] = (counts[key] || 0) + amount; };
  const files = [
    ['auth_db.json', data => {
      add('users', (data.users || []).length);
      add('user_sessions', (data.refresh_tokens || []).length);
      add('audit_logs', (data.credits_log || []).length);
    }],
    ['project_db.json', data => {
      add('projects', (data.projects || []).length);
      add('project_steps', (data.stories || []).length);
      add('artifacts', (data.video_clips || []).length + (data.final_videos || []).length);
    }],
    ['drama_db.json', data => {
      add('projects', (data.drama_projects || []).length);
      add('generation_tasks', (data.drama_episodes || []).length);
    }],
    ['workflow_db.json', data => add('projects', (data.workflows || []).length)],
    ['i2v_db.json', data => add('generation_tasks', (data.i2v_tasks || []).length)],
    ['avatar_db.json', data => add('generation_tasks', (data.avatar_tasks || []).length)],
    ['comic_db.json', data => add('generation_tasks', (data.comic_tasks || []).length)],
    ['novel_db.json', data => add('generation_tasks', (data.novels || []).length)],
    ['asset_db.json', data => add('assets', (data.assets || []).length)],
    ['portrait_db.json', data => add('assets', (data.portraits || []).length)],
    ['voice_db.json', data => add('voices', (data.voices || []).length)],
    ['knowledge_base.json', data => add('knowledge_documents', (data.documents || []).length)],
    ['token_usage.json', data => add('usage_records', (data.calls || []).length)],
    ['settings.json', data => {
      add('model_providers', (data.providers || []).length);
      add('provider_models', (data.providers || []).reduce((sum, p) => sum + (p.models || []).length, 0));
    }],
  ];
  for (const [fileName, fn] of files) {
    const data = readJson(fileName, {});
    fn(data);
  }
  console.log(JSON.stringify({ dryRun: true, outputDir, planned: counts }, null, 2));
}

function main() {
  if (dryRun) {
    plannedCountsOnly();
    return;
  }

  const db = openDatabase({ force });
  const ctx = createContext(db);
  const apply = db.transaction(() => {
    migrateAuth(ctx);
    migrateProjectDb(ctx);
    migrateDramaAndWorkflow(ctx);
    migrateTaskFile(ctx, 'i2v_db.json', 'i2v_tasks', 'i2v', 'image_to_video');
    migrateTaskFile(ctx, 'avatar_db.json', 'avatar_tasks', 'avatar', 'avatar_video');
    migrateTaskFile(ctx, 'comic_db.json', 'comic_tasks', 'comic', 'comic_generation');
    migrateTaskFile(ctx, 'novel_db.json', 'novels', 'novel', 'novel_generation');
    migrateTaskFile(ctx, 'replicate_db.json', 'tasks', 'replicate', 'replicate_task');
    migrateTaskFile(ctx, 'content_db.json', 'contents', 'content_radar', 'content');
    migrateTaskFile(ctx, 'monitor_db.json', 'accounts', 'content_radar', 'monitor_account');
    migrateTaskFile(ctx, 'subscription_db.json', 'subscriptions', 'content_radar', 'subscription');
    migrateAssets(ctx);
    migratePortraits(ctx);
    migrateVoices(ctx);
    migrateSettings(ctx);
    migrateKnowledge(ctx);
    migrateUsage(ctx);
    migrateLuxury(ctx);
    migrateMisc(ctx);
    saveAppKv(ctx, 'migration.json_to_sqlite.last_report', {
      migrated_at: nowIso(),
      outputDir,
      counts: ctx.counts,
      notes: ctx.notes,
    });
    ctx.flushAll();
  });
  apply();
  console.log(JSON.stringify({ migrated: true, outputDir, counts: ctx.counts, notes: ctx.notes }, null, 2));
}

main();
