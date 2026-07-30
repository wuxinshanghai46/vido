const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vido-local-vision-test-'));
process.env.OUTPUT_DIR = tempRoot;

const assetDir = path.join(tempRoot, 'new-story-ad-assets');
fs.mkdirSync(assetDir, { recursive: true });

async function main() {
  const filename = 'local-person-front.png';
  await sharp({
    create: { width: 1280, height: 960, channels: 3, background: '#6b7280' },
  }).png().toFile(path.join(assetDir, filename));

  const gateway = require('../src/services/newStoryAd/modelGateway');
  const captured = [];
  const result = await gateway.generateVision({
    taskId: 'local-vision-reference-test',
    stage: 'new_story_ad.person_consistency_qa',
    imageUrls: [`/api/new-story-ad/assets/${filename}`],
    systemPrompt: 'Inspect the image.',
    userPrompt: 'Return strict JSON.',
    maxCandidates: 1,
    _candidateModels: [{ provider_id: 'deyunai', model_id: 'gpt-4o', enabled: true }],
    _generateText: async request => {
      captured.push(request);
      return { text: '{"pass":true}', adapter: 'test', family: 'test' };
    },
  });

  const imagePart = captured[0].messages[1].content.find(item => item.type === 'image_url');
  assert.ok(imagePart.image_url.url.startsWith('data:image/jpeg;base64,'));
  assert.ok(imagePart.image_url.url.length > 100);
  assert.strictEqual(result.text, '{"pass":true}');
  console.log(JSON.stringify({
    passed: true,
    local_reference_embedded: true,
    candidate_attempts: captured.length,
  }));
}

main()
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    const resolved = path.resolve(tempRoot);
    if (resolved.startsWith(path.resolve(os.tmpdir()))) fs.rmSync(resolved, { recursive: true, force: true });
  });
