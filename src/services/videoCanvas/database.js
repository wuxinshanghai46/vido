const { openDatabase } = require('../../db/sqlite');

let checked = false;

function db() {
  const database = openDatabase({ force: true });
  if (!checked) {
    const row = database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='video_canvas_projects'").get();
    if (!row) throw new Error('视频画布 V2 数据表尚未初始化，请先运行 npm run db:migrate -- --force');
    checked = true;
  }
  return database;
}

module.exports = { db };
