function registerPersonDossierApprovalRoute(router, deps = {}) {
  const {
    asyncRoute, taskForReq, userFromReq, personDossiers, personProviderAssets,
    service, upsertActorAssetForUser, storage, videoAdapter, persistProviderPersonIds, uuidv4,
  } = deps;
  router.post('/tasks/:id/person-dossiers/approve', asyncRoute(async (req, res) => {
    const task = taskForReq(req);
    const user = userFromReq(req);
    const userId = String(user.id || user.username || 'anonymous');
    let production = personDossiers.approveDossier({ taskId: req.params.id, user });
    const actorAsset = personProviderAssets.buildApprovedRealPersonAsset(production);
    if (actorAsset.person_contract?.status !== 'verified') {
      const error = new Error('真人档案自动审核结果已失效，不能写入可用于视频生成的人物资产');
      error.code = 'REAL_PERSON_DOSSIER_VERIFICATION_REQUIRED';
      error.status = 422;
      throw error;
    }
    const committed = service.commitGeneratedPersonAsset(req.params.id, actorAsset, production.person_profile || {});
    const privateActor = upsertActorAssetForUser(userId, committed.person_asset, {
      generated_by: 'new_story_ad.authorized_real_person_dossier', task_id: req.params.id,
    });
    production = personDossiers.updateApprovedAsset({
      taskId: req.params.id, user, asset: privateActor,
      providerSync: { status: 'running', progress: 10, phase: '正在上传人物身份资产到 Seedance 人物资产库', error: null, started_at: new Date().toISOString() },
    });
    const generationId = `person_provider_sync_${uuidv4()}`;
    storage.updateTask(req.params.id, {
      active_generation_id: generationId, active_stage: 'person_provider_sync', generation_started_at: new Date().toISOString(),
      generation_progress: { stage: 'person_provider_sync', status: 'running', phase: '正在上传人物身份资产到 Seedance 人物资产库', generation_id: generationId, total: 1, completed: 0, percent: 10, started_at: new Date().toISOString() },
    });
    try {
      const provider = await videoAdapter.prepareDeyunaiPersonAsset({ taskId: req.params.id, ctx: storage.getOutput(req.params.id, 'context') || task.request || {}, options: {} });
      const latestContext = storage.getOutput(req.params.id, 'context') || {};
      const persistedActors = persistProviderPersonIds(userId, latestContext);
      production = personDossiers.updateApprovedAsset({
        taskId: req.params.id, user, asset: persistedActors[0] || latestContext.person_asset || privateActor,
        providerSync: { status: 'completed', progress: 100, phase: '人物档案和 Seedance 人物资产 ID 已保存', provider_asset_ids: provider?.asset_ids || [provider?.asset_id].filter(Boolean), completed_at: new Date().toISOString(), error: null },
      });
      storage.updateTask(req.params.id, {
        active_generation_id: '', active_stage: '', generation_finished_at: new Date().toISOString(),
        generation_progress: { stage: 'person_provider_sync', status: 'completed', phase: '人物档案和 Seedance 人物资产 ID 已保存', generation_id: generationId, total: 1, completed: 1, percent: 100, started_at: production.provider_sync?.started_at || new Date().toISOString(), updated_at: new Date().toISOString() },
      });
      return res.json({ success: true, production, actor_asset: production.committed_asset, provider_sync: production.provider_sync });
    } catch (error) {
      production = personDossiers.updateApprovedAsset({
        taskId: req.params.id, user, asset: privateActor,
        providerSync: { status: 'failed', progress: 0, phase: '人物档案已保存，Seedance 人物资产同步失败，可单独重试', error: { code: error.code || 'PERSON_PROVIDER_SYNC_FAILED', message: String(error.message || error).slice(0, 500) }, retryable: error.retryable !== false, failed_at: new Date().toISOString() },
      });
      storage.updateTask(req.params.id, {
        active_generation_id: '', active_stage: '', generation_finished_at: new Date().toISOString(),
        generation_progress: { stage: 'person_provider_sync', status: 'failed', phase: '人物档案已保存，Seedance 人物资产同步失败，可单独重试', generation_id: generationId, total: 1, completed: 0, percent: 0, message: String(error.message || error).slice(0, 500), started_at: production.provider_sync?.started_at || new Date().toISOString(), updated_at: new Date().toISOString() },
      });
      return res.json({ success: true, production, actor_asset: privateActor, provider_sync: production.provider_sync, warning: production.provider_sync.error });
    }
  }));
}

module.exports = registerPersonDossierApprovalRoute;
