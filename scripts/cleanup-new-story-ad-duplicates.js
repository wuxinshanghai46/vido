const fs = require('fs');
const path = require('path');
const storage = require('../src/services/newStoryAd/storageService');

const apply = process.argv.includes('--apply');
const reportPath = process.env.NSA_DEDUPE_REPORT || path.resolve(__dirname, '../outputs/new-story-ad-dedupe-report.json');

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function fingerprint(task = {}) {
  const request = task.request || {};
  const brief = clean(task.brief || request.brief || request.content || '');
  if (!brief) return '';
  const user = clean(task.user_id || request.user_id || 'legacy');
  const duration = Number(request.duration_sec || request.duration || 30) || 30;
  const ratio = clean(request.output_ratio || request.outputRatio || '9:16');
  return JSON.stringify([user, brief, duration, ratio]);
}

function timestamp(task = {}) {
  const value = Date.parse(task.updated_at || task.created_at || '') || 0;
  return value;
}

function analyze(tasks) {
  const groups = new Map();
  for (const task of tasks) {
    const key = fingerprint(task);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(task);
  }
  return [...groups.entries()].filter(([, rows]) => rows.length > 1).map(([key, rows]) => {
    rows.sort((a, b) => timestamp(b) - timestamp(a) || String(b.id).localeCompare(String(a.id)));
    return {
      fingerprint: key,
      keep: { id: rows[0].id, title: rows[0].title, updated_at: rows[0].updated_at },
      remove: rows.slice(1).map(row => ({ id: row.id, title: row.title, updated_at: row.updated_at })),
    };
  });
}

function main() {
  const db = storage.readDb();
  const tasks = db.tasks || [];
  const groups = analyze(tasks);
  const removeIds = groups.flatMap(group => group.remove.map(row => row.id));
  const report = {
    generated_at: new Date().toISOString(), mode: apply ? 'apply' : 'dry-run',
    total_tasks: tasks.length, duplicate_groups: groups.length,
    records_to_remove: removeIds.length, groups,
  };
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  let backupPath = '';
  if (apply && removeIds.length) {
    const removeSet = new Set(removeIds.map(String));
    const backup = Object.fromEntries(Object.entries(db).map(([key, rows]) => [key, (rows || []).filter(row => key === 'tasks' ? removeSet.has(String(row.id)) : removeSet.has(String(row.task_id || '')))]));
    backupPath = reportPath.replace(/\.json$/i, '-removed-records.json');
    fs.writeFileSync(backupPath, JSON.stringify({ generated_at: new Date().toISOString(), remove_ids: removeIds, records: backup }, null, 2));
    removeIds.forEach(id => storage.deleteTask(id));
  }
  const remainingGroups = apply ? analyze(storage.readDb().tasks || []) : groups;
  if (apply && remainingGroups.length) throw new Error(`去重后仍存在 ${remainingGroups.length} 组重复任务`);
  console.log(JSON.stringify({ mode: report.mode, total_tasks: tasks.length, duplicate_groups: groups.length, records_removed: apply ? removeIds.length : 0, records_to_remove: removeIds.length, remaining_duplicate_groups: remainingGroups.length, report: reportPath, backup: backupPath }));
}

if (require.main === module) main();

module.exports = { clean, fingerprint, analyze };
