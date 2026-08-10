export function worldSettingPayload(data) {
  const family = String(data.get('world_family') || 'auto');
  return {
    status: family === 'auto' ? 'draft' : 'confirmed',
    authority: { source: 'user', user_confirmed: family !== 'auto' },
    profiles: [{ id: 'world_1', era_family: family,
      fidelity_mode: String(data.get('world_fidelity') || 'contemporary_realism'),
      visual_medium: String(data.get('visual_medium') || 'auto'),
      time_period: String(data.get('world_period') || '').trim(), region: String(data.get('world_region') || '').trim() }],
  };
}

export function worldSettingFields(profile = {}, escapeHtml = value => String(value || '')) {
  const familyOptions = [['auto','根据内容识别'],['chinese_historical','中国古代'],['republican_china','民国'],['xianxia','仙侠'],['wuxia','武侠'],['modern_china','现代中国'],['modern_overseas','海外现代'],['western_historical','西方历史'],['medieval','中世纪'],['future','未来'],['post_apocalyptic','末日'],['cyberpunk','赛博朋克'],['mixed','混合世界'],['custom','自定义']];
  const fidelityOptions = [['contemporary_realism','现实 / 当代写实'],['historical_realism','史实写实'],['stylized_history','艺术化历史'],['fantasy','幻想规则'],['custom','自定义规则']];
  const mediumOptions = [['auto','根据剧本与参考内容识别'],['live_action','真人 / 实拍'],['cinematic_3d','3D 动画'],['anime_2d','2D 动漫 / 赛璐璐'],['motion_comic','动态漫 / 插画'],['mixed_media','混合媒介'],['custom','自定义画面形态']];
  const options = (rows, current) => rows.map(([value,label]) => `<option value="${value}" ${String(current) === value ? 'selected' : ''}>${label}</option>`).join('');
  return `<label class="field"><span>世界 / 时代类型</span><select class="select" name="world_family">${options(familyOptions, profile.era_family || 'auto')}</select><small>这是项目级设定，会同时约束人物造型、场景、道具、分镜和提示词；不按行业写死。</small></label>
    <label class="field"><span>写实严格度</span><select class="select" name="world_fidelity">${options(fidelityOptions, profile.fidelity_mode || 'contemporary_realism')}</select><small>决定史实、艺术化或幻想规则的约束强度，不等同于真人/动漫画面类型。</small></label>
    <label class="field"><span>画面形态</span><select class="select" name="visual_medium">${options(mediumOptions, profile.visual_medium || 'auto')}</select><small>项目级渲染合同，会统一人物、场景、分镜、关键帧与视频质检；不模仿指定艺术家或受保护作品。</small></label>
    <label class="field"><span>具体时期</span><input class="input" name="world_period" maxlength="160" value="${escapeHtml(profile.time_period || '')}" placeholder="如：北宋中期、1930年代、近未来2045年"><small>可不填；系统会依据内容目标、剧本和参考材料分析。证据不足时保持通用，不会臆造具体年代。</small></label>
    <label class="field"><span>国家 / 地区</span><input class="input" name="world_region" maxlength="160" value="${escapeHtml(typeof profile.region === 'string' ? profile.region : '')}" placeholder="如：中国江南、1930年代上海、现代法国"><small>可不填；系统会从剧本地点和文化线索识别。海外、历史或混合世界建议填写，以减少建筑、服装和道具漂移。</small></label>`;
}
