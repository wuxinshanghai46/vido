const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function section(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, `${startMarker} section must remain discoverable`);
  return source.slice(start, end);
}

function main() {
  const manga = read('public/ai-manga-drama.html');
  const initialLoad = section(manga, 'async function loadRealData()', 'function pickModalValue');
  assert.match(initialLoad, /strict\('漫剧项目', '\/api\/drama\/projects'\)/);
  assert.doesNotMatch(initialLoad, /\/api\/comic\/tasks/);
  assert.doesNotMatch(initialLoad, /\/api\/novel/);
  assert.doesNotMatch(initialLoad, /\/api\/works/);
  assert.doesNotMatch(initialLoad, /await ensureDetails\(\)/);
  assert.match(manga, /async function renderAssetView\(view\)[\s\S]*?await ensureDetails\(\)/);
  assert.match(manga, /async function openRealProject\(id/);
  assert.match(manga, /let visibleCount = 60/);
  assert.match(manga, /visibleCount \+= 60/);
  assert.match(manga, /dataset\.realLoadMore/);

  const drama = read('public/drama-studio.html');
  assert.doesNotMatch(drama, /fonts\.googleapis\.com/);
  assert.doesNotMatch(drama, /fonts\.gstatic\.com/);
  assert.match(drama, /'PingFang SC', 'Microsoft YaHei'/);

  const trackedHtml = execFileSync('git', ['ls-files', '--', 'public/*.html'], {
    cwd: root,
    encoding: 'utf8'
  }).split(/\r?\n/).filter(Boolean);
  trackedHtml.forEach(relativePath => {
    const html = read(relativePath);
    assert.match(
      html,
      /\/js\/media-delivery\.js\?v=20260729-platform-media-v5/,
      `${relativePath} must load the current platform media delivery`
    );
  });

  console.log(`platform loading optimization tests passed: ${trackedHtml.length} HTML pages covered`);
}

main();
