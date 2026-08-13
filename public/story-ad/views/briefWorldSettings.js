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

export function worldSettingFields(profile = {}, escapeHtml = value => String(value || ''), settings = {}) {
  const familyOptions = [['auto','根据内容识别'],['chinese_historical','中国古代'],['republican_china','民国'],['xianxia','仙侠'],['wuxia','武侠'],['modern_china','现代中国'],['modern_overseas','海外现代'],['western_historical','西方历史'],['medieval','中世纪'],['future','未来'],['post_apocalyptic','末日'],['cyberpunk','赛博朋克'],['mixed','混合世界'],['custom','自定义']];
  const fidelityOptions = [['contemporary_realism','真人写实（各时代分别还原）'],['historical_realism','史实写实'],['stylized_history','艺术化历史'],['fantasy','幻想规则'],['custom','自定义规则']];
  const mediumOptions = [['auto','待识别：原文未指定真人、3D或动漫'],['live_action','真人 / 实拍'],['cinematic_3d','3D 动画'],['anime_2d','2D 动漫 / 赛璐璐'],['motion_comic','动态漫 / 插画'],['mixed_media','混合媒介'],['custom','自定义画面形态']];
  const selectOptions = (rows, current) => rows.map(([value,label]) => `<option value="${value}" ${String(current) === value ? 'selected' : ''}>${label}</option>`).join('');
  const formOwner = settings.formId ? ` form="${escapeHtml(settings.formId)}"` : '';
  return `<label class="field brief-setting-tile"><span>世界 / 时代类型 <em>AI 可识别</em></span><select class="select" name="world_family"${formOwner}>${selectOptions(familyOptions, profile.era_family || 'auto')}</select><small>根据内容目标或参考视频识别，也可以手动选择；统一约束人物、场景、道具与分镜。</small></label>
<label class="field brief-setting-tile"><span>视觉真实度 <em>可手动确认</em></span><select class="select" name="world_fidelity"${formOwner}>${selectOptions(fidelityOptions, profile.fidelity_mode || 'contemporary_realism')}</select><small>只决定画面是否像真人摄影；不会把古代剧情改成现代剧情。</small></label>
<label class="field brief-setting-tile"><span>画面形态 <em>AI 可识别</em></span><select class="select" name="visual_medium"${formOwner}>${selectOptions(mediumOptions, profile.visual_medium || 'auto')}</select><small>统一真人、3D、动漫或动态漫呈现。</small></label>
<label class="field brief-setting-tile"><span>具体时期 <em>根据内容同步</em></span><input class="input" name="world_period"${formOwner} maxlength="160" value="${escapeHtml(profile.time_period || '')}" placeholder="请填写或在内容中写明具体时期"><small>识别到古代/现代会显示在这里；原文没写朝代或年份时不会臆造。</small></label>
<label class="field brief-setting-tile"><span>国家 / 地区 <em>AI 可识别</em></span><input class="input" name="world_region"${formOwner} maxlength="160" value="${escapeHtml(typeof profile.region === 'string' ? profile.region : '')}" placeholder="如：中国江南、1930年代上海、现代法国"><small>留空时按地点与文化线索识别。</small></label>`;
}
