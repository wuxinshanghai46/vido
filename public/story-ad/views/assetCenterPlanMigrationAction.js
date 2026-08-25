import { authorizeBillingReviews, confirmBillingAwareAction } from './assetCenterBillingRetry.js?v=20260826-production-v228d';
export async function submitPersonPlanUpdate({
  button, migrationOnly, requestKey, confirmDialog, confirmGeneration, bundle, store, setButtonBusy, toast, refresh,
}) {
  const message=migrationOnly?'系统将复用兼容的人物方案，并生成当前缺失的人物图片；不会重新生成已经成功且仍匹配方案的资产。':'系统将按已确认剧情和现有人物资产补全详细人物方案，随后生成缺失的人物图片。已有用户确认字段优先，不会被模型覆盖。';
  const confirmed=typeof confirmGeneration==='function'?await confirmGeneration({message,migrationOnly}):(bundle?await(async()=>{
      const confirmation=await confirmBillingAwareAction({bundle,lane:'subjects',message,
        title:migrationOnly?'确认方案并生成人物':'生成人物方案',confirmText:migrationOnly?'确认并生成':'开始生成'});
      if (!confirmation.accepted) return false;
      await authorizeBillingReviews({bundle,lane:'subjects',reviewBatch:confirmation.reviewBatch});
      return true;
    })():await confirmDialog(message,{title:migrationOnly?'确认方案并生成人物':'生成人物方案',confirmText:migrationOnly?'确认并生成':'开始生成'}));
  if(!confirmed)return false;
  try {
    setButtonBusy(button,true,'正在生成人物方案…',{elapsed:true});
    await store.runStage('person-plan', { request_key: requestKey });
    await refresh();
    return true;
  } catch(error) {
    toast(error.message,'danger');
    return false;
  } finally { setButtonBusy(button,false); }
}
