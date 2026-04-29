// 在生产机直接调 Ark Seedream 5.0 生成 3 张对比底图
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { loadSettings } = require(path.join(__dirname, '..', 'src', 'services', 'settingsService'));

const ark = (loadSettings().providers || []).find(p => /volces|火山方舟/.test((p.api_url||'')+(p.name||'')));
const KEY = ark?.api_key;
if (!KEY) { console.error('no Ark key'); process.exit(1); }

const OUT = '/opt/vido/app/outputs/jimeng-assets';
fs.mkdirSync(OUT, { recursive: true });

const PROMPTS = {
  elegant: 'ultra-realistic photorealistic editorial portrait of a 25 year old east asian young woman, graceful natural smile with subtle eye contact, long straight black silky hair flowing over shoulders, wearing an elegant beige cream knit spaghetti-strap mini dress, seated naturally in a warm nordic reading room with wooden bookshelves full of books, potted plants, and a soft warm desk lamp glowing at dusk, cinematic soft golden afternoon sunlight streaming from the left window, shallow depth of field DSLR 85mm f/2 bokeh, visible fine skin texture with faint freckles and realistic pores, crisp catchlights in eyes, natural flyaway hair strands catching the light, vogue magazine cover quality, NOT a cartoon NOT an illustration NOT 3D render, one single person centered, 9:16 vertical portrait composition, preserve realistic facial identity, cinematic color grading',
  business: 'ultra-realistic editorial photograph of a confident 28 year old east asian business professional woman, serene direct gaze at camera, neat shoulder-length wavy hair, wearing a crisp charcoal gray blazer over a white silk blouse with delicate pearl earrings, seated at a modern minimalist office desk with a laptop and fresh white orchids in background, floor-to-ceiling window showing blurred city skyline at golden hour, cinematic volumetric rim light from behind, DSLR 85mm f/1.8 shallow bokeh, visible natural skin texture pores and collarbone, crystal clear eye reflection, studio magazine quality, NOT cartoon NOT anime NOT 3D render, one single person, centered composition, 9:16 portrait',
  creator: 'ultra-realistic portrait photo of a 23 year old east asian female content creator, playful warm smile with slight head tilt, messy ponytail with soft bangs, wearing an oversized cream sweatshirt, sitting in a cozy bedroom studio filled with warm tungsten fairy lights, neon sign accent on the wall, a DSLR camera and ring light faintly blurred behind her, golden hour ambient atmosphere, very shallow DSLR 50mm f/1.4 depth of field, realistic skin texture with natural blemishes and soft peach fuzz, authentic candid lifestyle vlogger aesthetic, NOT cartoon NOT 3D render NOT overly smooth, one single person, 9:16 vertical composition, ultra natural unposed feeling',
};

async function gen(key, prompt) {
  console.log(`[${key}] submitting...`);
  const body = {
    model: 'doubao-seedream-5-0-260128',
    prompt: prompt.slice(0, 2000),
    size: '1536x2688',
    response_format: 'url',
    n: 1,
  };
  const r = await axios.post('https://ark.cn-beijing.volces.com/api/v3/images/generations', body, {
    headers: { 'Authorization': `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    timeout: 120000,
  });
  const url = r.data?.data?.[0]?.url;
  if (!url) throw new Error('no url: ' + JSON.stringify(r.data).slice(0,200));
  const dl = await axios.get(url, { responseType: 'arraybuffer', timeout: 60000 });
  const outPath = path.join(OUT, `demo_${key}.png`);
  fs.writeFileSync(outPath, Buffer.from(dl.data));
  const kb = (fs.statSync(outPath).size / 1024).toFixed(0);
  console.log(`[${key}] OK → ${outPath} (${kb} KB)`);
  return outPath;
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
