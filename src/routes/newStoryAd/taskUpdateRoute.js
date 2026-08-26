'use strict';

const service = require('../../services/newStoryAd');
const storage = require('../../services/newStoryAd/storageService');
const assetPlan = require('../../services/newStoryAd/assetPlanService');
const authoritativeReference = require('../../services/storyAdWorkspace/authoritativeReferenceProjectionService');

function registerTaskUpdateRoute(router, { asyncRoute, taskForReq, userFromReq }) {
  router.put('/tasks/:id', asyncRoute(async (req, res) => {
    const task = taskForReq(req);
    const storedPreviousContext = storage.getOutput(req.params.id, 'context') || task.request || {};
    const previousContext = authoritativeReference.snapshot(task, storedPreviousContext).context;
    const previousScenePlan = storage.getOutput(req.params.id, 'scene_config');
    const referenceExplicit = Object.prototype.hasOwnProperty.call(req.body || {}, 'reference_video_analysis')
      || Object.prototype.hasOwnProperty.call(req.body || {}, 'referenceVideoAnalysis');
    const suppliedReference = referenceExplicit
      ? (req.body?.reference_video_analysis ?? req.body?.referenceVideoAnalysis ?? null)
      : undefined;
    const metadataKeys = new Set(['base_content_revision', 'baseContentRevision', 'client_edit_seq', 'clientEditSeq']);
    const workflowKeys = new Set(['asset_setup_confirmed', 'assetSetupConfirmed', 'scene_setup_confirmed', 'sceneSetupConfirmed', 'shot_design_confirmed', 'shotDesignConfirmed']);
    const businessKeys = Object.keys(req.body || {}).filter(key => !metadataKeys.has(key));
    if (!businessKeys.length) return res.json({
      success: true,
      task,
      context: previousContext,
      content_revision: Number(task.content_revision || 1) || 1,
      acknowledged_client_edit_seq: Math.max(
        Number(task.latest_client_edit_seq || 0) || 0,
        Number(req.body?.client_edit_seq || req.body?.clientEditSeq || 0) || 0,
      ),
      changed_domains: [],
      invalidated_outputs: [],
      reference_projection: { projected: false, reason: 'no_business_change', model_call_count: 0 },
    });
    const updated = service.updateTaskRequest(req.params.id, req.body || {}, userFromReq(req), { previousContext });
    const workflowStateOnly = businessKeys.every(key => workflowKeys.has(key));
    const noBusinessChange = !referenceExplicit && !(updated.changed_domains || []).length;
    const authoritativeUpdatedContext = authoritativeReference.snapshot(
      updated.task || task,
      updated.context || previousContext,
    ).context;
    const projection = workflowStateOnly ? {
      projected: false, reason: 'workflow_state_only', model_call_count: 0,
    } : (noBusinessChange ? {
      projected: false, reason: 'no_business_change', model_call_count: 0,
    } : (referenceExplicit && suppliedReference === null ? {
      projected: false, reason: 'reference_removed', model_call_count: 0,
    } : await assetPlan.projectReferenceIntake(req.params.id, {
      previous_context: previousContext,
      existing_scene_plan: previousScenePlan,
      reference_analysis: suppliedReference
        ? { ...(authoritativeUpdatedContext.reference_video_analysis || {}), ...suppliedReference }
        : authoritativeUpdatedContext.reference_video_analysis,
    })));
    if (projection.projected) updated.context = projection.context;
    updated.reference_projection = {
      projected: projection.projected,
      reason: projection.reason,
      model_call_count: projection.model_call_count || 0,
    };
    return res.json({ success: true, ...updated });
  }));
}

module.exports = registerTaskUpdateRoute;
