function registerPersonDossierApprovalRoute(router, deps = {}) {
  const {
    asyncRoute, taskForReq, userFromReq, personDossiers, personProviderAssets,
    service, upsertActorAssetForUser, storage, videoAdapter, persistProviderPersonIds, queueTaskStage,
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
    const committed = service.commitGeneratedPersonAsset(req.params.id, actorAsset, production.person_profile || {}, { change_kind: 'visual_dossier' });
    const privateActor = upsertActorAssetForUser(userId, committed.person_asset, {
      generated_by: 'new_story_ad.authorized_real_person_dossier', task_id: req.params.id,
    });
    production = personDossiers.updateApprovedAsset({
      taskId: req.params.id, user, asset: privateActor,
      providerSync: { status: 'running', progress: 10, phase: '正在上传人物身份资产到 Seedance 人物资产库', error: null, started_at: new Date().toISOString() },
    });
    req.body = {
      ...(req.body || {}),
      idempotency_key: `${req.params.id}:person_provider_sync:${production.dossier?.revision || production.updated_at || 'approved'}`,
    };
    return queueTaskStage(req, res, 'person_provider_sync', async (job) => {
      try {
        const provider = await videoAdapter.prepareDeyunaiPersonAsset({
          taskId: req.params.id,
          ctx: storage.getOutput(req.params.id, 'context') || task.request || {},
          options: { generation_id: job.generationId },
        });
        const latestContext = storage.getOutput(req.params.id, 'context') || {};
        const persistedActors = persistProviderPersonIds(userId, latestContext);
        production = personDossiers.updateApprovedAsset({
          taskId: req.params.id, user, asset: persistedActors[0] || latestContext.person_asset || privateActor,
          providerSync: {
            status: 'completed', progress: 100, phase: '人物档案和 Seedance 人物资产 ID 已保存',
            provider_asset_ids: provider?.asset_ids || [provider?.asset_id].filter(Boolean),
            completed_at: new Date().toISOString(), error: null,
          },
        });
        return { production, actor_asset: production.committed_asset, provider_sync: production.provider_sync };
      } catch (error) {
        personDossiers.updateApprovedAsset({
          taskId: req.params.id, user, asset: privateActor,
          providerSync: {
            status: 'failed', progress: 0, phase: '人物档案已保存，Seedance 人物资产同步失败，可单独重试',
            error: { code: error.code || 'PERSON_PROVIDER_SYNC_FAILED', message: String(error.message || error).slice(0, 500) },
            retryable: error.retryable !== false, failed_at: new Date().toISOString(),
          },
        });
        throw error;
      }
    }, { deadlineMs: 10 * 60 * 1000 });
  }));
}

module.exports = registerPersonDossierApprovalRoute;
