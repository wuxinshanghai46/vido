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

module.exports = { POLICY_VERSION, assertAssets, identityFingerprint, review };
