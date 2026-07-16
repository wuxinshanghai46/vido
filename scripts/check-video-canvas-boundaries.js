#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const roots = ['src/services/videoCanvas','src/routes/videoCanvas','src/workers/videoCanvas','public/js/video-canvas'];
const files = roots.flatMap(root => walk(path.join(ROOT, root))).filter(file => /\.(js|mjs)$/.test(file));
const failures = [];
for (const file of files) {
  const source = fs.readFileSync(file, 'utf8'); const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  if (/newStoryAd|new-story-ad|\/api\/new-story-ad/i.test(source)) failures.push(`${rel}: 禁止引用新剧情广告`);
  if (/\/api\/(imggen|i2v|workflow|agent)\b/.test(source)) failures.push(`${rel}: V2 前端/路由禁止绕过独立 API`);
  if (source.length > 80000) failures.push(`${rel}: 文件超过 80KB，应继续拆分`);
}
for (const file of walk(path.join(ROOT, 'src/services/newStoryAd')).concat(walk(path.join(ROOT, 'public/js/new-story-ad')))) {
  if (!/\.js$/.test(file)) continue;
  const source = fs.readFileSync(file, 'utf8'); if (/videoCanvas|video-canvas|\/api\/video-canvas/i.test(source)) failures.push(`${path.relative(ROOT,file)}: 新剧情广告禁止反向引用视频画布`);
}
if (failures.length) { console.error(failures.join('\n')); process.exit(1); }
console.log(`VIDEO_CANVAS_BOUNDARIES_OK files=${files.length}`);
function walk(dir) { if (!fs.existsSync(dir)) return []; return fs.readdirSync(dir,{withFileTypes:true}).flatMap(item=>item.isDirectory()?walk(path.join(dir,item.name)):[path.join(dir,item.name)]); }
