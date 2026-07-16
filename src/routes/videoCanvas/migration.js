const router = require('express').Router();
const { isAdmin } = require('../../middleware/auth');
const migration = require('../../services/videoCanvas/migrationService');

router.get('/migration/v1/preview', (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ success: false, error: '仅管理员可以预览全量迁移' });
  res.json({ success: true, data: migration.preview({ includeAll: true }) });
});
router.post('/migration/v1/apply', (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ success: false, error: '仅管理员可以执行迁移' });
  res.json({ success: true, data: migration.migrate({ includeAll: true }) });
});

module.exports = router;
