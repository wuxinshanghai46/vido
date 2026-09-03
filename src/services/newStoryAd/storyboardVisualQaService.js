'use strict';

const storage = require('./storageService');
const personIdentity = require('./personIdentityContractService');
const productIdentity = require('./productIdentityContractService');

const POLICY_VERSION = 1;

function assertAssets(ctx) {
  personIdentity.assertVerifiedPerson(ctx);
  productIdentity.assertVerifiedProduct(ctx);
}

function identityFingerprint(ctx = {}) {
  const person = ctx.person_contract || ctx.person_asset?.person_contract || {};
  return storage.canonicalFingerprint({
    person: person.reference_fingerprint || personIdentity.contractFingerprint(person),
    product: ctx.product_contract || ctx.product_asset?.product_contract || null,
  });
}

async function review(input, dependencies = {}) {
  const service = dependencies.service || require('./storyAdService');
  const reviews = await service.runKeyframeQaReviews(input);
  const qa = service.combineKeyframeQa({ ...input, ...reviews });
  return { ...qa, policy_version: POLICY_VERSION, identity_fingerprint: identityFingerprint(input.ctx) };
}

function combineKeyframeQa({ ctx = {}, shot = {}, contract = {}, sceneReference = '', sceneQa = {}, personQa = {}, productQa = {} } = {}) {
  const shotNeedsPerson = personIdentity.shotPersonRequired(ctx, shot, contract);
  const personForbidden = personIdentity.shotForbidsPerson(ctx, shot);
  const productRequired = productIdentity.shotProductProofRequired(ctx, shot, contract);
  const conflicts = [
    ...(sceneQa.mismatch_reasons || []),
    ...(sceneQa.forbidden_new_elements || []),
    ...(personQa.conflicts || []),
    ...(productQa.conflicts || []),
    personQa.retry_instruction || '',
    productQa.retry_instruction || '',
  ].filter(Boolean);
  const scenePass = !sceneReference || (sceneQa.pass === true && sceneQa.status === 'passed');
  const personPass = !(shotNeedsPerson || personForbidden) || (personQa.pass === true && personQa.status === 'verified');
  const productPass = !productRequired || (productQa.pass === true && productQa.status === 'verified');
  return {
    pass: scenePass && personPass && productPass,
    status: scenePass && personPass && productPass ? 'verified' : 'rejected',
    scene: sceneQa,
    person: personQa,
    product: productQa,
    mismatch_reasons: conflicts,
    checked_at: new Date().toISOString(),
  };
}

module.exports = { POLICY_VERSION, assertAssets, identityFingerprint, review, combineKeyframeQa };
