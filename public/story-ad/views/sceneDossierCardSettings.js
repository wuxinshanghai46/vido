export function sceneGenerationSettingsMarkup() {
  return '<span class="scene-image-settings"><select data-scene-quality aria-label="场景画质"><option value="low">低画质</option><option value="standard" selected>标准画质</option><option value="high">高画质</option></select><select data-scene-resolution aria-label="场景清晰度"><option value="1K">1K</option><option value="2K" selected>2K</option><option value="4K" disabled>4K（当前模型不支持）</option></select></span>';
}
