const router = require('express').Router();
const projectRepository = require('../../services/videoCanvas/projectRepository');
const { createPlan } = require('../../services/videoCanvas/planService');
const { projectForRequest } = require('./helpers');

router.post('/projects/:id/plan', (req, res) => {
  const project = projectForRequest(req, req.params.id);
  if (!project) return res.status(404).json({ success: false, error: '项目不存在' });
  const revision = projectRepository.getRevision(req.body.revisionId || project.current_revision_id);
  if (!revision || revision.project_id !== project.id) return res.status(404).json({ success: false, error: '图版本不存在' });
  const plan = createPlan({ project, revision, requestedNodeIds: req.body.requestedNodeIds || [] });
  res.status(plan.valid ? 200 : 400).json({ success: plan.valid, data: plan, errors: plan.errors || [] });
});

module.exports = router;
