const router = require('express').Router();
const { isAdmin } = require('../../middleware/auth');
const projectRepository = require('../../services/videoCanvas/projectRepository');
const { getTemplate } = require('../../services/videoCanvas/domainPacks');
const { validateGraph } = require('../../services/videoCanvas/graphService');
const { projectForRequest } = require('./helpers');

router.get('/', (req, res) => {
  const data = projectRepository.listProjects({ userId: req.user.id, includeAll: isAdmin(req) && req.query.all === '1', limit: req.query.limit, status: req.query.status || 'active' });
  res.json({ success: true, data });
});
router.post('/', (req, res) => {
  const template = req.body.templateId ? getTemplate(req.body.templateId) : null;
  const graph = template?.graph || req.body.graph || { nodes: [], edges: [] };
  const validation = validateGraph(graph);
  if (!validation.valid) return res.status(400).json({ success: false, code: 'INVALID_GRAPH', errors: validation.errors });
  const data = projectRepository.createProject({ userId: req.user.id, name: req.body.name, domainPack: req.body.domainPack || template?.packId || 'blank', settings: req.body.settings, graph });
  res.status(201).json({ success: true, data });
});
router.get('/:id', (req, res) => {
  if (!projectForRequest(req, req.params.id)) return res.status(404).json({ success: false, error: '项目不存在' });
  res.json({ success: true, data: projectRepository.getCurrentBundle(req.params.id) });
});
router.patch('/:id', (req, res) => {
  if (!projectForRequest(req, req.params.id)) return res.status(404).json({ success: false, error: '项目不存在' });
  const data = projectRepository.updateProject(req.params.id, req.body || {});
  res.json({ success: true, data });
});
router.get('/:id/revisions', (req, res) => {
  if (!projectForRequest(req, req.params.id)) return res.status(404).json({ success: false, error: '项目不存在' });
  res.json({ success: true, data: projectRepository.listRevisions(req.params.id, req.query.limit) });
});
router.post('/:id/revisions', (req, res) => {
  if (!projectForRequest(req, req.params.id)) return res.status(404).json({ success: false, error: '项目不存在' });
  const validation = validateGraph(req.body.graph || {});
  if (!validation.valid) return res.status(400).json({ success: false, code: 'INVALID_GRAPH', errors: validation.errors });
  const result = projectRepository.saveRevision({ projectId: req.params.id, userId: req.user.id, baseRevisionId: req.body.baseRevisionId, graph: validation.graph });
  if (result.conflict) return res.status(409).json({ success: false, code: 'REVISION_CONFLICT', currentRevisionId: result.currentRevisionId, error: '项目已在其他页面更新，请加载最新版本后重试' });
  res.status(201).json({ success: true, data: result });
});

module.exports = router;
