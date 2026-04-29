// Seedream 5.0 第二轮：偶像脸方向 + 后处理裁掉底部"AI 生成"水印
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const sharp = require('sharp');
const { loadSettings } = require(path.join(__dirname, '..', 'src', 'services', 'settingsService'));

const KEY = (loadSettings().providers || []).find(p => /volces|火山方舟/.test((p.api_url||'')+(p.name||'')))?.api_key;
if (!KEY) { console.error('no Ark key'); process.exit(1); }

const OUT = '/opt/vido/app/outputs/jimeng-assets';
fs.mkdirSync(OUT, { recursive: true });

// 关键调整：
// + beautiful idol, flawless luminous skin, golden ratio, porcelain skin, ethereal
// + cinematic beauty shot, fashion magazine cover
// - blemishes, freckles, pores, skin texture, oily skin, wrinkles, asymmetry
// 景别：半身正襟坐姿，正对镜头，适合 Omni 驱动
const PROMPTS = {
  idol_warm: 'cinematic beauty portrait photograph of a breathtakingly beautiful 22 year old east asian female idol, flawless luminous porcelain skin with natural healthy glow, perfect golden ratio facial harmony, large expressive almond eyes with sparkling catchlights, delicate pink cupid-bow lips with subtle gloss, small straight nose, soft natural smile showing slight teeth, long silky straight jet black hair falling gracefully over shoulders, wearing an elegant cream knit spaghetti-strap dress, seated upright facing camera in a warm cozy library with blurred wooden bookshelves, fairy lights bokeh background, soft golden hour light from front-left, even beauty-dish style key light on face, DSLR 85mm f/1.8 dreamy bokeh, vogue magazine cover quality, commercial beauty photography, one single person, perfectly centered 9:16 portrait, upper body composition with shoulders and chest fully visible, looking directly at viewer. NEGATIVE: freckles, blemishes, skin texture, pores, oily skin, wrinkles, harsh shadows, asymmetric features, plastic doll, 3D render, cartoon, anime, illustration, multiple people',

  idol_cool: 'cinematic beauty portrait of a stunning 24 year old east asian female model, flawless dewy glass skin, perfect symmetric features, large doe eyes with dramatic eyeliner and natural lashes, delicate nose, plump glossy pink lips with a confident subtle smile, long silky dark brown hair with soft side-swept bangs and volumized waves, wearing a minimalist ivory silk camisole top, seated upright facing camera, modern minimalist studio backdrop in soft dove-gray gradient, professional beauty-dish lighting with soft fill, clean clamshell beauty lighting, DSLR 85mm f/2 sharp eyes and soft bokeh, fashion editorial cover, Vogue China quality, one single person, centered 9:16 half-body composition, shoulders and upper chest visible, direct gaze at viewer. NEGATIVE: freckles, blemishes, skin texture, pores, oily skin, wrinkles, uneven skin tone, plastic, doll, 3D render, cartoon, anime, illustration, multiple people, crowd',

  idol_soft: 'beauty magazine cover portrait of an exquisitely beautiful 23 year old east asian young woman, flawless translucent porcelain skin with subtle rosy cheeks, impeccable golden ratio facial harmony, bright crystal clear almond eyes with feathered natural lashes, delicately arched eyebrows, pretty small nose, soft peach-pink lips with natural gloss and gentle smile revealing white teeth, long wavy chestnut brown hair cascading over one shoulder, wearing a soft pastel pink cashmere knit sweater with delicate gold chain necklace, seated upright facing the camera in a sunlit modern cafe with pastel pink and cream decor and blurred fresh flowers bokeh, dreamy front soft window light, cinematic beauty retouching, DSLR 85mm f/1.8 bokeh, pinterest aesthetic, luxury brand commercial, one single person, perfectly centered 9:16 portrait, half-body composition shoulders and upper chest visible, direct warm gaze at viewer. NEGATIVE: freckles, blemishes, skin texture, visible pores, oily skin, wrinkles, plastic doll, 3D render, cartoon, anime, illustration, multiple people',
};

async function gen(key, prompt) {
  console.log(`[${key}] submitting...`);
  const body = {
    model: 'doubao-seedream-5-0-260128',
    prompt: prompt.slice(0, 2000),
    size: '1536x2688',
    response_format: 'url',
    n: 1,
    watermark: false,
  };
  const r = await axios.post('https://ark.cn-beijing.volces.com/api/v3/images/generations', body, {
    headers: { 'Authorization': `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    timeout: 120000,
  });
  const url = r.data?.data?.[0]?.url;
  if (!url) throw new Error('no url');
  const dl = await axios.get(url, { responseType: 'arraybuffer', timeout: 60000 });
  const buf = Buffer.from(dl.data);
  const meta = await sharp(buf).metadata();
  const trimmedOut = path.join(OUT, `idol_${key}.png`);
  // 裁掉底部 100 px（2688 约占 3.7%），防止"AI 生成"字样被嵌入仍可见
  await sharp(buf)
    .extract({ left: 0, top: 0, width: meta.width, height: meta.height - 100 })
    .png()
    .toFile(trimmedOut);
  const kb = (fs.statSync(trimmedOut).size / 1024).toFixed(0);
  console.log(`[${key}] OK → ${trimmedOut} (${meta.width}x${meta.height-100}, ${kb} KB, watermark=false + extra crop)`);
  return trimmedOut;
}

(async () => {
  const results = {};
  for (const [k, p] of Object.entries(PROMPTS)) {
    try { results[k] = await gen(k, p); }
    catch (e) { console.error(`[${k}] FAIL:`, e.response?.status, JSON.stringify(e.response?.data||e.message).slice(0,200)); }
  }
  console.log('\n=== DONE ===');
  for (const [k, p] of Object.entries(results)) {
    console.log(`${k}: http://43.98.167.151:4600/public/jimeng-assets/${path.basename(p)}`);
  }
})();
