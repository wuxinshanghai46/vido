import { confirmDialog } from '../components/dialog.js?v=20260829-production-v277';

export async function confirmContentModeMigration(savedMode = '', nextMode = '') {
  if (!savedMode || savedMode === nextMode) return { cancelled: false, confirmed: false };
  const confirmed = await confirmDialog('切换广告/剧情类型后，旧剧本、领域提示词、分镜、线稿、镜头、声音和成片都会失效；已上传素材、人物身份和场景原始素材会保留。是否继续？', {
    title: '确认切换内容类型',
    confirmText: '确认切换并重建',
    cancelText: '取消',
  });
  return { cancelled: !confirmed, confirmed };
}
