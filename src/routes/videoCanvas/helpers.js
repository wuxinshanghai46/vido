const { isAdmin } = require('../../middleware/auth');
const projectRepository = require('../../services/videoCanvas/projectRepository');
const runRepository = require('../../services/videoCanvas/runRepository');

function projectForRequest(req, projectId) {
  const project = projectRepository.getProject(projectId);
  if (!project || (!isAdmin(req) && project.user_id !== req.user.id)) return null;
  return project;
}
function runForRequest(req, runId) {
  const run = runRepository.getRun(runId);
  if (!run || (!isAdmin(req) && run.user_id !== req.user.id)) return null;
  return run;
}
function asyncRoute(handler) { return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next); }

module.exports = { asyncRoute, projectForRequest, runForRequest };
