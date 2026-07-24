const PERSON_REALISM_PROMPT = [
  'Unretouched real-camera human realism is mandatory.',
  'Preserve distance-appropriate pores, fine skin grain, subtle local redness and color variation, faint vellus hair, natural nasolabial and under-eye folds, realistic lip lines, restrained oil highlights, eye moisture, individual hair strands, flyaways and slight facial asymmetry.',
  'Skin detail must follow lighting, focal distance and depth of field instead of appearing as a uniform roughness overlay; retain natural highlight roll-off and avoid over-sharpened pores.',
  'Avoid a standardized digital face: keep identity-specific bone structure, non-idealized proportions and small memorable asymmetries rather than the same high nose, narrow jaw and default influencer smile.',
  'Expression must be caused by the story action. Coordinate gaze, eyelids, brows, cheeks, mouth corners and jaw tension as one restrained micro-expression; no empty gaze, mouth-only smile or neutral ID-photo face during an emotional beat.',
  'Integrate the actor into the photographed location: match environmental key/fill direction, color temperature, edge light and contact shadows so hair and skin do not look pasted onto the background.',
  'Across shot distance, wardrobe and background changes, preserve the same actor identity, facial proportions, age impression and distinguishing traits.',
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

const PERSON_REALISM_COMPACT = 'Real distance-scaled pores, fine skin grain, local color, folds, lip lines and flyaway hair; no beauty filter or wax/plastic skin. Keep identity-specific bone structure and asymmetry, not a standardized influencer face. Match gaze, eyelids, brows, cheeks and mouth tension to story emotion; match skin/hair light, color temperature and contact shadows to the location.';
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
