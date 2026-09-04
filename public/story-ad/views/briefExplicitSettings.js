export function suggestedName(idea = '', mode = '') {
  if (/不锈钢|佛山|金属/.test(idea)) return '佛山智造 · 不锈钢品牌广告';
  if (/护肤|精华|面霜/.test(idea)) return '高端护肤品牌短片';
  if (/校园|学院|孩子/.test(idea)) return '校园故事 · 剧情短片';
  return mode === 'narrative_story' ? '未命名剧情项目' : '未命名广告项目';
}

export const OUTPUT_SETTING_KEYS = ['target_duration', 'output_ratio', 'video_resolution'];

export function explicitOutputSettingKeys(settings = {}) {
  return OUTPUT_SETTING_KEYS.filter(key => Object.prototype.hasOwnProperty.call(settings || {}, key));
}

export function isBriefConfirmationReply(text = '') {
  return /^(?:(?:我觉得|我认为|这个|这样|该方案)\s*)?(?:好|好的|可以|行|确认|确定|就这样|按这个|按当前|按建议|用这个|没问题)[吧啊呀。！!，,\s]*$/.test(String(text || '').trim());
}

export function isNoReferenceReply(text = '') {
  return /^(?:没有|无|不用|不需要|没有参考|没有参考材料|暂无|暂时没有|不提供|跳过)[了吧啊呀。！!，,\s]*$/.test(String(text || '').trim());
}

export function extractExplicitBriefSettings(text = '') {
  const source = String(text || '');
  const result = {};
  const duration = source.match(/(?:时长|做|约|大概)?\s*(15|30|45|60|90|120|180|240|300|360|480|600)\s*(?:秒|s\b)/i);
  const minutes = source.match(/(?:时长|做|约|大概)?\s*(1|2|3|4|5|6|8|10)\s*分钟/);
  const ratio = source.match(/(?:画幅|比例|竖屏|横屏|方形)?\s*(9\s*[:：]\s*16|16\s*[:：]\s*9|1\s*[:：]\s*1)/i);
  const resolution = source.match(/(?:清晰度|分辨率)?\s*(480p|720p|1080p|4k)\b/i);
  if (duration) result.target_duration = Number(duration[1]);
  else if (minutes) result.target_duration = Number(minutes[1]) * 60;
  if (ratio) result.output_ratio = ratio[1].replace(/\s/g, '').replace('：', ':');
  if (resolution) result.video_resolution = resolution[1].toUpperCase() === '4K' ? '4K' : resolution[1].toLowerCase();
  const world = [
    ['cyberpunk', /赛博朋克/], ['post_apocalyptic', /末日|废土/], ['xianxia', /仙侠/], ['wuxia', /武侠/],
    ['republican_china', /民国/], ['medieval', /中世纪/], ['future', /未来世界|未来时代/],
    ['modern_china', /现代中国|当代中国/], ['modern_overseas', /海外现代|现代海外/],
    ['chinese_historical', /中国古代|古代中国|唐朝|宋朝|明朝|清朝|汉朝|秦朝/],
  ].find(([, pattern]) => pattern.test(source));
  const medium = [
    ['cinematic_3d', /(?:3D|三维)\s*(?:动画|电影)/i], ['anime_2d', /(?:2D|二维)\s*(?:动漫|动画)|赛璐璐/i],
    ['motion_comic', /动态漫|动态漫画/], ['mixed_media', /混合媒介/], ['live_action', /真人(?:实拍|写实)|实拍/],
  ].find(([, pattern]) => pattern.test(source));
  const fidelity = [
    ['historical_realism', /史实写实/], ['stylized_history', /艺术化历史/], ['fantasy', /幻想规则|奇幻风格/],
    ['contemporary_realism', /真人写实|电影写实|摄影写实/],
  ].find(([, pattern]) => pattern.test(source));
  const period = source.match(/(?:具体时期|时代|年代)[：:]?\s*([^，。；;\n]{2,30})/);
  const region = source.match(/(?:国家|地区|地点)[：:]?\s*([^，。；;\n]{2,40})/);
  if (world) result.world_family = world[0];
  if (medium) result.visual_medium = medium[0];
  if (fidelity) result.world_fidelity = fidelity[0];
  if (period) result.world_period = period[1].trim();
  if (region) result.world_region = region[1].trim();
  return result;
}
