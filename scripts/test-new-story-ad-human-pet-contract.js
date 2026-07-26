const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const contextBuilder = require('../src/services/newStoryAd/contextBuilder');
const personIdentity = require('../src/services/newStoryAd/personIdentityContractService');
const storyboard = require('../src/services/newStoryAd/storyboardTableService');
const keyframeContracts = require('../src/services/newStoryAd/keyframeContractService');
const storyAd = require('../src/services/newStoryAd/storyAdService');
const videoFrameQa = require('../src/services/newStoryAd/videoFrameQaService');
const revision = require('../src/services/newStoryAd/revisionService');

const mixed = contextBuilder.buildContext({
  brief: '一家三口和一只金毛犬在客厅互动，展示宠物食品',
  cast_mode: 'human_pet',
  expected_people: 3,
  expected_animals: 1,
  person_spec: {
    castMode: 'human_pet',
    expectedPeople: 3,
    expectedAnimals: 1,
    petType: '金毛犬',
    petDescription: '成年金毛，浅金色长毛，蓝色项圈，左耳尖有一小撮深色毛',
  },
}, { id: 'test-user' });

assert.strictEqual(mixed.cast_mode, 'human_pet');
assert.strictEqual(mixed.expected_people, 3);
assert.strictEqual(mixed.expected_animals, 1);
assert.strictEqual(mixed.pet_profiles.length, 1);
assert.strictEqual(mixed.pet_profiles[0].type, '金毛犬');
assert.strictEqual(mixed.pet_contract.expected_animals, 1);
assert.strictEqual(personIdentity.personRequired(mixed), true, 'human_pet must keep the person identity contract active');

const inferred = contextBuilder.buildContext({
  brief: '一家三口带着一只金毛犬在草地玩耍',
  person_spec: { petType: '金毛犬' },
}, { id: 'test-user' });
assert.strictEqual(inferred.cast_mode, 'human_pet', 'a family plus a pet must not collapse to animal-only mode');
assert.strictEqual(inferred.expected_people, 3);
assert.strictEqual(inferred.expected_animals, 1);

const animalOnly = contextBuilder.buildContext({
  brief: '一只英短猫在窗边玩猫粮包装',
  cast_mode: 'animal',
  expected_people: 4,
  person_asset: { id: 'stale-person-asset' },
}, { id: 'test-user' });
assert.strictEqual(animalOnly.expected_people, 0);
assert.strictEqual(animalOnly.expected_animals, 1);
assert.strictEqual(animalOnly.person_asset, null);
assert.strictEqual(personIdentity.personRequired(animalOnly), false);
assert.strictEqual(personIdentity.shotForbidsPerson(animalOnly, {}), true);

const ordinaryNonPet = contextBuilder.buildContext({
  brief: '企业知识库软件帮助团队整理和检索项目资料',
  cast_mode: 'single',
  expected_people: 1,
  expected_animals: 2,
  pet_profiles: [{ id: 'stale-pet', type: '金毛犬', appearance: '浅金色长毛' }],
  pet_contract: { expected_animals: 2, profiles: [{ id: 'stale-pet', type: '金毛犬' }] },
  person_spec: {
    castMode: 'single',
    expectedPeople: 1,
    expectedAnimals: 2,
    petType: '金毛犬',
    petDescription: '不应进入普通广告的陈旧宠物设定',
  },
}, { id: 'test-user' });
assert.strictEqual(ordinaryNonPet.cast_mode, 'single');
assert.strictEqual(ordinaryNonPet.expected_animals, 0, 'ordinary non-pet tasks must never inherit stale animal counts');
assert.deepStrictEqual(ordinaryNonPet.pet_profiles, [], 'ordinary non-pet tasks must never persist stale pet profiles');
assert.strictEqual(ordinaryNonPet.pet_contract, null, 'ordinary non-pet tasks must never persist a pet identity contract');
assert.strictEqual(ordinaryNonPet.person_spec.expectedAnimals, undefined, 'non-pet person_spec must not retain a hidden animal count');
assert.strictEqual(ordinaryNonPet.person_spec.petType, undefined, 'non-pet person_spec must not retain a hidden pet type');
assert.strictEqual(ordinaryNonPet.person_spec.petDescription, undefined, 'non-pet person_spec must not retain a hidden pet description');

const contextText = contextBuilder.contextPrompt(mixed);
assert.match(contextText, /精确人数：3/);
assert.match(contextText, /精确宠物\/动物数量：1/);
assert.match(contextText, /人物 \+ 宠物混合主体/);
assert.match(contextText, /宠物一致性合同/);

const normalizedShot = storyboard.normalizeShots([{
  index: 1,
  title: '家庭互动',
  duration: 3,
  visual: '三位家庭成员与金毛犬在客厅互动',
  action: '孩子抚摸金毛犬',
  characters: [{ name: '妈妈' }, { name: '爸爸' }, { name: '小乐' }],
  expected_people: 3,
  expected_animals: 1,
  pets: [{ id: 'pet_1', type: '金毛犬', action: '坐在孩子身边摇尾巴' }],
}], mixed)[0];
assert.strictEqual(normalizedShot.expected_people, 3);
assert.strictEqual(normalizedShot.expected_animals, 1);
assert.strictEqual(normalizedShot.pets[0].id, 'pet_1');

const [contract] = keyframeContracts.buildKeyframeContracts(mixed, [normalizedShot]);
assert.strictEqual(contract.pet_lock.expected_animals, 1);
assert.strictEqual(contract.pet_lock.pet_contract.profiles[0].type, '金毛犬');
assert(!contract.negative_prompt.includes('unrequested pet or robot'), 'required pet must not be forbidden by the same keyframe contract');

const prompt = storyAd.buildKeyframePrompt(mixed, normalizedShot, contract, 0);
assert.match(prompt, /Pet consistency lock: exactly 1 animal\/pet subject/);
assert.match(prompt, /金毛犬/);
assert.match(prompt, /Do not add, remove, replace, recolor, duplicate or merge a pet/);

assert.strictEqual(videoFrameQa.expectedPeopleForShot(mixed, normalizedShot), 3);
assert.strictEqual(videoFrameQa.expectedAnimalsForShot(mixed, normalizedShot), 1);
assert.strictEqual(videoFrameQa.expectedPeopleForShot(animalOnly, {}), 0);
assert.strictEqual(videoFrameQa.expectedAnimalsForShot(animalOnly, {}), 1);
assert.strictEqual(videoFrameQa.reviewDecision({
  pass: true,
  person_pass: true,
  product_pass: true,
  scene_pass: true,
  action_pass: true,
  people_count_pass: true,
  animal_count_pass: false,
  pet_identity_pass: true,
  text_watermark_pass: true,
}, [], {}).pass, false, 'pet count failure must block video QA');

const changedScope = revision.changeScope(mixed, {
  ...mixed,
  expected_animals: 2,
  pet_contract: { ...mixed.pet_contract, expected_animals: 2 },
});
assert.strictEqual(changedScope, 'person', 'pet contract changes must invalidate person/media downstream outputs');

const html = fs.readFileSync(path.join(root, 'public/digital-human.html'), 'utf8');
const ui = fs.readFileSync(path.join(root, 'public/js/new-story-ad-legacy-ui.js'), 'utf8');
const personPetUi = fs.readFileSync(path.join(root, 'public/js/new-story-ad/person-pet-spec.js'), 'utf8');
const bootstrap = fs.readFileSync(path.join(root, 'public/js/new-story-ad/bootstrap.js'), 'utf8');
const wizardCss = fs.readFileSync(path.join(root, 'public/css/digital-human-wizard.css'), 'utf8');
const storyboardSource = fs.readFileSync(path.join(root, 'src/services/newStoryAd/storyboardTableService.js'), 'utf8');
const qaSource = fs.readFileSync(path.join(root, 'src/services/newStoryAd/videoFrameQaService.js'), 'utf8');
assert(html.includes('<option value="human_pet">人物 + 宠物（混合主体）</option>'));
assert(html.includes('data-nsa-person-spec="expectedAnimals"'));
assert(html.includes('data-nsa-person-spec="petType"'));
assert(html.includes('data-nsa-person-spec="petDescription"'));
assert(ui.includes("pet_contract: petRequired ?"));
assert(ui.includes("el.hidden = !petRequired"), 'pet controls must be conditionally hidden outside animal and human_pet modes');
assert(
  ui.includes("if (!['animal', 'human_pet'].includes(spec.castMode))")
    && ui.includes('delete spec.expectedAnimals')
    && ui.includes('delete spec.petType')
    && ui.includes('delete spec.petDescription'),
  'the frontend payload must remove hidden pet-only values from every non-pet mode',
);
assert(
  /\.dh-luxgen-person-spec\s+\[data-nsa-pet-field\]\[hidden\]\s*\{\s*display:\s*none\s*!important;\s*\}/.test(wizardCss),
  'the form grid must not override the hidden state of pet-only controls',
);
assert(personPetUi.includes("human_pet: '人物 + 宠物（混合主体）'"));
assert(bootstrap.includes("'/js/new-story-ad/person-pet-spec.js'"));
assert(bootstrap.indexOf("'/js/new-story-ad/person-pet-spec.js'") < bootstrap.indexOf("'/js/new-story-ad-legacy-ui.js'"));
assert(storyboardSource.includes('expected_people, expected_animals, pets'));
assert(qaSource.includes('"animal_count_pass":boolean'));
assert(qaSource.includes('"pet_identity_pass":boolean'));

console.log('New Story Ad human + pet contract regression tests passed');
