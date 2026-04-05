const path = require('path');
const fs = require('fs');
const OUTPUT_DIR = path.resolve(process.env.OUTPUT_DIR || './outputs');

module.exports = (req, res) => {
  const taskId = req.params.id;
  const videoPath = path.join(OUTPUT_DIR, 'i2v_videos', taskId, 'result.mp4');
  if (!fs.existsSync(videoPath)) return res.status(404).json({ error: '视频不存在' });

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
