export function worldSettingPayload(data) {
  const family = String(data.get('world_family') || 'auto');
  return {
    status: family === 'auto' ? 'draft' : 'confirmed',
    authority: { source: 'user', user_confirmed: family !== 'auto' },
    profiles: [{ id: 'world_1', era_family: family,
      fidelity_mode: String(data.get('world_fidelity') || 'contemporary_realism'),
      time_period: String(data.get('world_period') || '').trim(), region: String(data.get('world_region') || '').trim() }],
  };
}

export function worldSettingFields(profile = {}, escapeHtml = value => String(value || '')) {
  const familyOptions = [['auto','根据内容识别'],['chinese_historical','中国古代'],['republican_china','民国'],['xianxia','仙侠'],['wuxia','武侠'],['modern_china','现代中国'],['modern_overseas','海外现代'],['western_historical','西方历史'],['medieval','中世纪'],['future','未来'],['post_apocalyptic','末日'],['cyberpunk','赛博朋克'],['mixed','混合世界'],['custom','自定义']];
  const fidelityOptions = [['contemporary_realism','现实 / 当代写实'],['historical_realism','史实写实'],['stylized_history','艺术化历史'],['fantasy','幻想规则'],['custom','自定义规则']];
  const options = (rows, current) => rows.map(([value,label]) => `<option value="${value}" ${String(current) === value ? 'selected' : ''}>${label}</option>`).join('');
  return `<label class="field"><span>世界 / 时代类型</span><select class="select" name="world_family">${options(familyOptions, profile.era_family || 'auto')}</select><small>这是项目级设定，会同时约束人物造型、场景、道具、分镜和提示词；不按行业写死。</small></label>
    <label class="field"><span>写实严格度</span><select class="select" name="world_fidelity">${options(fidelityOptions, profile.fidelity_mode || 'contemporary_realism')}</select></label>
    <label class="field"><span>具体时期</span><input class="input" name="world_period" maxlength="160" value="${escapeHtml(profile.time_period || '')}" placeholder="如：北宋中期、1930年代、近未来2045年"></label>
    <label class="field"><span>国家 / 地区</span><input class="input" name="world_region" maxlength="160" value="${escapeHtml(typeof profile.region === 'string' ? profile.region : '')}" placeholder="海外、西方历史或自定义世界请尽量写明"></label>`;
}
