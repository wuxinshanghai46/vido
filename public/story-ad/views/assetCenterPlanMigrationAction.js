export async function submitPersonPlanUpdate({
  button, migrationOnly, requestKey, confirmDialog, store, setButtonBusy, toast, refresh,
}) {
  const confirmed = await confirmDialog(migrationOnly
    ? '系统将核对合同、内容版本、故事覆盖和稳定 ID；兼容时仅升级版本且模型调用为 0，否则更新人物文字方案。'
    : '本次只更新人物文字方案，不修改场景方案、图片或站位绑定，也不会生成图片。', {
    title: migrationOnly ? '升级当前方案' : '更新人物方案',
    confirmText: migrationOnly ? '确认检查并升级' : '确认更新人物方案',
  });
  if (!confirmed) return false;
  try {
    setButtonBusy(button, true, migrationOnly ? '正在检查并升级方案…' : '正在更新人物方案…', { elapsed: true });
    const result = await store.runStage('person-plan', { request_key: requestKey });
    const supportId = result?.job?.support_id || result?.job?.id || '';
    toast(`${migrationOnly ? '方案兼容检查' : '人物方案更新'}已提交${supportId ? `（支持编号：${supportId}）` : ''}；同一次点击不会重复请求。`, 'success');
    await refresh();
    return true;
  } catch (error) {
    toast(error.message, 'danger');
    return false;
  } finally { setButtonBusy(button, false); }
}
