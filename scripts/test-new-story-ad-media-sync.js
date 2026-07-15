const assert = require('assert');
const fs = require('fs');
const path = require('path');

const storyAdService = require('../src/services/newStoryAd/storyAdService');
const ttsService = require('../src/services/ttsService');
const { buildAssSubtitleFile } = require('../src/services/effectsService');

assert.strictEqual(ttsService.voiceProviderForId('tongtong'), 'zhipu', '智谱音色不得误送到阿里 CosyVoice');
assert.strictEqual(ttsService.voiceProviderForId('longxiaochun_v3'), 'aliyun-tts', '阿里音色必须保留 CosyVoice 路由');

const uiPath = path.join(__dirname, '../public/js/new-story-ad-legacy-ui.js');
const uiSource = fs.readFileSync(uiPath, 'utf8');
const digitalHumanHtml = fs.readFileSync(path.join(__dirname, '../public/digital-human.html'), 'utf8');
const wizardCss = fs.readFileSync(path.join(__dirname, '../public/css/digital-human-wizard.css'), 'utf8');

assert(uiSource.includes("/api/new-story-ad/music/search"), '新版公开曲库必须使用新版专属搜索接口');
assert(uiSource.includes("/api/new-story-ad/music/import"), '新版公开曲库必须使用新版专属导入接口');
assert(!uiSource.includes("/api/dh/luxury-ad/open-music"), '新版页面不得继续调用已下线旧剧情广告接口');
assert(uiSource.includes('data-nsa-voice-preview'), '新版音色列表必须提供试听操作');
assert(uiSource.includes("/api/dh/tts/preview-voice"), '新版音色试听必须调用共用 TTS 试听能力');
assert(uiSource.includes("/api/workbench/voices"), '新版音色列表必须合并用户自己录制的声音');
assert(uiSource.includes('data-nsa-voice-record'), '新版音色列表必须提供录制/管理我的声音入口');
assert(uiSource.includes('data-nsa-voice-gender'), '新版音色列表必须提供全部、女声、男声筛选');
assert(uiSource.includes('nsaVoiceGender(voice)'), '新版音色卡片必须规范化性别字段');
assert(uiSource.includes("page_size: '20'"), '公开曲库必须遵守 Openverse 匿名 API 单页 20 首限制');
assert(uiSource.includes('data-nsa-music-more'), '公开曲库必须支持分页加载更多');
assert(uiSource.includes('data-nsa-music-profile'), '音乐风格必须在公开曲库弹窗内选择');
assert(!digitalHumanHtml.includes('dhNsaAdBgmProfileToggle'), '新版主页面不得保留独立的音乐风格选择卡片');
assert(wizardCss.includes("content: '关'"), '关闭状态必须显示明确的“关”文字');
assert(wizardCss.includes("content: '开'"), '开启状态必须显示明确的“开”文字');
assert(wizardCss.includes('.dh-switch input[type="checkbox"]:focus-visible'), '开关必须保留键盘焦点提示');
assert(uiSource.includes('hasMore: r.has_more === true'), '公开曲库必须读取后端分页状态');
assert(uiSource.includes('stopNsaMusicPreview'), '公开曲库必须保证同一时间只试听一首音乐');
assert(uiSource.includes("value=\"${escapeHtml(String(query || '').slice(0, 80))}\""), '公开曲库查询框只能回显用户查询，不能默认填入广告标题');

const digitalHumanRoute = fs.readFileSync(path.join(__dirname, '../src/routes/digitalHuman.js'), 'utf8');
assert(digitalHumanRoute.includes("title_zh: '古琴音乐会（一）'"), '公开曲库必须补充中文/国风曲目');
assert(digitalHumanRoute.includes('guzheng|erhu|pipa|guqin|dizi'), '公开曲库必须识别常见中国民族乐器');
assert(digitalHumanRoute.includes("license: 'cc0,pdm,by'"), '公开曲库只允许可商用的 CC0、PDM、CC BY');
assert(digitalHumanRoute.includes("category: 'music'"), 'Openverse 搜索必须排除播客、有声书和音效');
assert(digitalHumanRoute.includes("'storage.jamendo.com'"), '公开曲库必须支持 Openverse 的 Jamendo 可下载音乐');
assert(digitalHumanRoute.includes('page < remotePageCount'), '公开曲库后端必须返回加载更多状态');

const subtitleStyles = [
  'popup', 'bouncy', 'karaoke', 'neon', 'comic', 'news', 'emphasis', 'classic',
  'fire', 'shake', 'gold', 'matrix', 'film', 'pink', 'wave', 'zoom',
];
subtitleStyles.forEach(style => assert(uiSource.includes(`['${style}',`), `缺少字幕样式：${style}`));

const segments = storyAdService.subtitleSegmentsFromShots([
  { duration_sec: 3, voiceover: '限时优惠 99元' },
], {
  style: 'popup',
  smartEmphasis: true,
  fontName: 'Noto Sans SC',
  fontSize: 72,
  color: '#FFFFFF',
  outlineColor: '#000000',
});

assert.strictEqual(segments.length, 1);
assert.strictEqual(segments[0].preset, 'subtitle', '字幕段必须标记为 subtitle，才能应用动效预设');
assert.strictEqual(segments[0].subtitleStyle, 'popup');
assert.strictEqual(segments[0].smartEmphasis, true);

const assPath = buildAssSubtitleFile(segments, `nsa_media_sync_${Date.now()}`, {
  width: 1080,
  height: 1920,
  duration: 3,
}, { defaultStyle: 'popup' });

try {
  const ass = fs.readFileSync(assPath, 'utf8');
  assert(ass.includes('\\fad(120,80)'), '弹跳字幕动画必须写入最终 ASS 文件');
  assert(ass.includes('Noto Sans SC'), '字幕字体必须写入最终 ASS 文件');
  assert(ass.includes('Dialogue:'), '最终 ASS 文件必须包含字幕事件');
} finally {
  try { fs.unlinkSync(assPath); } catch {}
}

console.log(`new-story-ad media sync: ${subtitleStyles.length} subtitle styles, voice preview and music API passed`);
