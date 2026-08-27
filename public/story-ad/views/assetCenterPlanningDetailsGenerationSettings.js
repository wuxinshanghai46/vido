export function personGenerationSettingsControls(runtime = {}, settings = {}) {
  const type = String(runtime.generation_type || settings.generation_type || 'three_view');
  const quality = String(settings.quality || 'standard');
  const resolution = String(settings.resolution || '2K').toUpperCase();
  const supported = new Set(runtime.supported_resolutions || ['1K', '2K']);
  const option = (value, label, selected, disabled = false) => `<option value="${value}" ${value === selected ? 'selected' : ''} ${disabled ? 'disabled' : ''}>${label}</option>`;
  return `<label class="person-setting-select" title="广告默认 3 视图，剧情默认全局整图；数量固定为 1"><span class="sr-only">生成类型</span><select name="generation_type">${option('three_view', '3视图', type)}${option('four_view', '4视图', type)}${option('global_dossier', '全局整图', type)}</select></label>
    <label class="person-setting-select"><span class="sr-only">画质</span><select name="quality">${option('low', '低画质', quality)}${option('standard', '标准画质', quality)}${option('high', '高画质', quality)}</select></label>
    <label class="person-setting-select"><span class="sr-only">清晰度</span><select name="resolution">${option('1K', '1K', resolution, !supported.has('1K'))}${option('2K', '2K', resolution, !supported.has('2K'))}${option('4K', '4K（当前模型不支持）', resolution, !supported.has('4K'))}</select></label>`;
}
