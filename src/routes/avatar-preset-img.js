const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');

const presetsDir = path.join(__dirname, '../../outputs/presets');

// GET /api/avatar/preset-img/:filename - 公开提供预设图片（无需认证）
router.get('/:filename', (req, res) => {
  const filePath = path.join(presetsDir, path.basename(req.params.filename));
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Not found' });
  // 检测实际文件格式
  try {
    const buf = Buffer.alloc(4);
    const fd = fs.openSync(filePath, 'r');
    fs.readSync(fd, buf, 0, 4, 0);
    fs.closeSync(fd);
    if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) {
      res.type('image/jpeg');
    } else if (buf[0] === 0x89 && buf[1] === 0x50) {
      res.type('image/png');
    }
  } catch {}
  res.sendFile(filePath);
});

module.exports = router;
