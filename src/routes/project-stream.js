const path = require('path');
const fs = require('fs');
const db = require('../models/database');

module.exports = (req, res) => {
  const projectId = req.params.id;
  const clipId = req.params.clipId;

  let videoPath;
  if (clipId) {
    videoPath = path.join(path.resolve(process.env.OUTPUT_DIR || './outputs'), 'videos', projectId, `clip_${clipId}.mp4`);
  } else {
    const project = db.getProject(projectId);
    videoPath = project?.final_video || path.join(path.resolve(process.env.OUTPUT_DIR || './outputs'), 'videos', projectId, 'final.mp4');
  }

  if (!videoPath || !fs.existsSync(videoPath)) return res.status(404).json({ error: '视频不存在' });

  const stat = fs.statSync(videoPath);
  const range = req.headers.range;
  if (range) {
    const [s, e] = range.replace(/bytes=/, '').split('-');
    const start = parseInt(s, 10);
    const end = e ? parseInt(e, 10) : stat.size - 1;
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${stat.size}`,
      'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1,
      'Content-Type': 'video/mp4', 'Cache-Control': 'public, max-age=3600'
    });
    fs.createReadStream(videoPath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, { 'Content-Length': stat.size, 'Content-Type': 'video/mp4', 'Cache-Control': 'public, max-age=3600' });
    fs.createReadStream(videoPath).pipe(res);
  }
};
