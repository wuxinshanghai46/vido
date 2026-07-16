const router = require('express').Router();
const { NODE_CATALOG } = require('../../services/videoCanvas/nodeCatalog');
const { listPacks, listTemplates, getTemplate } = require('../../services/videoCanvas/domainPacks');
const { getModelCatalog } = require('../../services/videoCanvas/modelCatalogService');
const settingsRepository = require('../../services/videoCanvas/settingsRepository');

router.get('/catalog', (_req, res) => res.json({ success: true, data: NODE_CATALOG }));
router.get('/models', (_req, res) => res.json({ success: true, data: getModelCatalog() }));
router.get('/packs', (_req, res) => res.json({ success: true, data: listPacks() }));
router.get('/templates', (req, res) => res.json({ success: true, data: listTemplates(req.query.pack || '').map(item => ({ ...item, graph: req.query.includeGraph === '1' ? item.graph : undefined })) }));
router.get('/templates/:id', (req, res) => {
  const data = getTemplate(req.params.id); if (!data) return res.status(404).json({ success: false, error: '模板不存在' }); res.json({ success: true, data });
});
router.get('/settings', (req, res) => res.json({ success: true, data: settingsRepository.getSettings(req.user.id) }));
router.put('/settings', (req, res) => res.json({ success: true, data: settingsRepository.saveSettings(req.user.id, req.body) }));

module.exports = router;
