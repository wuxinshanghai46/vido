const PERSON_REALISM_PROMPT = [
  'Unretouched real-camera human realism is mandatory.',
  'Preserve distance-appropriate pores, fine skin texture, subtle local color variation, natural nasolabial and under-eye structure, realistic lip texture, restrained oil highlights, eye moisture, individual hair strands and slight facial asymmetry.',
  'Skin detail must follow lighting and focal distance instead of appearing as a uniform texture overlay.',
  'Use believable facial muscle tension and an imperfect natural commercial expression.',
  'No beauty filter, no face smoothing, no wax or plastic skin, no porcelain doll face, no perfect bilateral symmetry, no inflated lips, no glassy eyes, no excessive sharpening and no glamour retouching.',
].join(' ');

const SCENE_REALISM_PROMPT = [
  'The scene must look physically used and photographed, not procedurally perfected.',
  'Use task-relevant traces such as restrained wear, contact marks, fine dust, fingerprints, slight exposure variation, natural lens falloff and coherent sensor detail only where real use and lighting would produce them.',
  'Keep construction tolerances, reflections, material scale and object contact shadows physically consistent.',
  'Do not dirty every surface uniformly and do not add decorative defects unrelated to the task.',
  'No sterile virtual showroom, repeated procedural texture, perfect mirror staging, synthetic HDR, impossible glow, fake bokeh or CGI material response.',
].join(' ');

const IMAGE2_COMPLIANCE_PROMPT = [
  'Compliance preflight: depict adults only when people are requested; use an explicit adult age and a natural non-suggestive pose.',
  'Use only original synthetic identities or clearly authorized portrait references.',
  'Do not imitate celebrities, public figures, protected characters, named living artists, recognizable copyrighted styles, brands or logos unless the task includes verified rights.',
  'Do not include watermark removal, captcha bypass, privacy extraction or moderation-evasion instructions.',
].join(' ');

const PERSON_REALISM_COMPACT = 'No beauty filter or wax/plastic skin; keep real pores, local skin color variation, natural folds and slight asymmetry appropriate to camera distance; no face smoothing, doll symmetry or glassy eyes.';
const SCENE_REALISM_COMPACT = 'Physically photographed location with task-relevant wear, contact marks, fine dust, natural lens falloff, coherent sensor detail and grounded shadows; no sterile CGI showroom, repeated procedural texture, synthetic HDR or impossible glow.';
const IMAGE2_COMPLIANCE_COMPACT = 'Original synthetic or verified-authorized adult identity only, natural non-suggestive pose; no unlicensed celebrity, public figure, protected character, brand, logo, named living artist/style or moderation-evasion instruction.';

function personRealismPrompt() {
  return PERSON_REALISM_PROMPT;
}

function sceneRealismPrompt() {
  return SCENE_REALISM_PROMPT;
}

function image2CompliancePrompt() {
  return IMAGE2_COMPLIANCE_PROMPT;
}

function compactPersonRealismPrompt() {
  return PERSON_REALISM_COMPACT;
}

function compactSceneRealismPrompt() {
  return SCENE_REALISM_COMPACT;
}

function compactImage2CompliancePrompt() {
  return IMAGE2_COMPLIANCE_COMPACT;
}

module.exports = {
  PERSON_REALISM_PROMPT,
  SCENE_REALISM_PROMPT,
  IMAGE2_COMPLIANCE_PROMPT,
  personRealismPrompt,
  sceneRealismPrompt,
  image2CompliancePrompt,
  compactPersonRealismPrompt,
  compactSceneRealismPrompt,
  compactImage2CompliancePrompt,
};
