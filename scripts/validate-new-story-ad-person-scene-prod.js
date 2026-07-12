const { Client } = require('ssh2');

const host = process.env.VIDO_DEPLOY_HOST;
const username = process.env.VIDO_DEPLOY_USER || 'root';
const password = process.env.VIDO_DEPLOY_PASSWORD;
if (!host || !password) throw new Error('缺少生产服务器连接环境变量');

const remoteScript = process.env.VIDO_SKIP_MODEL_VALIDATION === '1' ? `console.log('MODEL_VALIDATION_SKIPPED');` : `
const media = require('./src/services/newStoryAd/mediaAdapter');
const gateway = require('./src/services/newStoryAd/modelGateway');
(async () => {
  const cases = [
    ['new_story_ad.person_sheet', '3:4', 'Commercial casting reference of one fictional adult professional, neutral studio background, full body, consistent outfit, no text.'],
    ['new_story_ad.scene_asset', '16:9', 'Empty generic modern commercial interior reference, coherent architecture and lighting, no people, no text.'],
  ];
  const results = [];
  for (const [stage, aspectRatio, prompt] of cases) {
    const started = Date.now();
    const generated = await media.generateImage({ stage, aspectRatio, prompt, filename: 'prod_validation_' + Date.now() });
    results.push({ stage, ok: Boolean(generated.url || generated.image_url), provider: generated.provider_used, latency_ms: Date.now() - started });
  }
  const vision = await gateway.generateVision({
    stage: 'new_story_ad.scene_vision',
    systemPrompt: 'Inspect the supplied image and return JSON only.',
    userPrompt: 'Return pass and numeric scene_consistency_score, geometry_consistency_score, material_consistency_score plus mismatch_reasons.',
    imageUrls: ['https://images.unsplash.com/photo-1497366754035-f200968a6e72?w=512'],
    maxTokens: 1200,
    timeoutMs: 90000,
    maxCandidates: 2,
  });
  results.push({ stage: 'new_story_ad.scene_vision', ok: Boolean(vision.text), provider: vision.used_model, failed_models: vision.failed_models });
  console.log(JSON.stringify(results));
})().catch(error => {
  console.error(JSON.stringify({ ok: false, code: error.code, message: error.message, attempts: error.attempts, failed_models: error.failed_models }));
  process.exit(1);
});
`;

const command = `cd /opt/vido/app && node - <<'NODE'\n${remoteScript}\nNODE\ngrep -q '20260712-person-scene-fix' public/digital-human.html && echo FRONTEND_FILE_OK\nstatus=$(curl -sS -o /tmp/vido-dh-check.html -w '%{http_code}' http://127.0.0.1:4600/digital-human.html); echo FRONTEND_HTTP=$status; grep -q '20260712-person-scene-fix' /tmp/vido-dh-check.html && echo FRONTEND_CACHE_OK || echo FRONTEND_RESPONSE_NOT_HTML`;
const client = new Client();
client.on('ready', () => {
  client.exec(command, (error, stream) => {
    if (error) throw error;
    let stdout = '';
    let stderr = '';
    stream.on('data', chunk => { stdout += chunk; });
    stream.stderr.on('data', chunk => { stderr += chunk; });
    stream.on('close', code => {
      if (stdout.trim()) console.log(stdout.trim());
      if (stderr.trim()) console.error(stderr.trim());
      client.end();
      if (code !== 0) process.exitCode = 1;
    });
  });
}).on('error', error => {
  console.error(error.message || error);
  process.exitCode = 1;
}).connect({ host, port: 22, username, password, readyTimeout: 25000 });
