const router = require('express').Router();

router.use('/projects', require('./projects'));
router.use('/', require('./plans'));
router.use('/runs', require('./runs'));
router.use('/artifacts', require('./artifacts'));
router.use('/', require('./catalog'));
router.use('/', require('./migration'));

router.use((err, _req, res, _next) => {
  console.error('[VideoCanvasV2]', err);
  res.status(err.statusCode || 500).json({ success: false, code: err.code || 'VIDEO_CANVAS_ERROR', error: err.message || '视频画布服务错误' });
});

module.exports = router;
