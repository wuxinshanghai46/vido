const domain = require('./domainContract');

const PRICE_CATALOG_VERSION = 'video-price-catalog-v2';

// User-facing authorization prices are route-specific and must not be inferred
// from another provider's internal cost for a similarly named model.
const ROUTE_PRICES = Object.freeze({
  'deyunai/doubao-seedance-2-0-260128': Object.freeze({
    currency: 'CNY',
    per_second: 1,
    source: 'deyunai_business_price',
    effective_from: '2026-07-22',
  }),
});

function normalizeRoute(providerId = '', modelId = '') {
  return `${domain.text(providerId).toLowerCase()}/${domain.text(modelId).toLowerCase()}`;
}

function findRoutePrice(providerId = '', modelId = '') {
  const route = normalizeRoute(providerId, modelId);
  const configured = ROUTE_PRICES[route];
  if (!configured) return {
    known: false,
    route,
    catalog_version: PRICE_CATALOG_VERSION,
    currency: '',
    per_second: 0,
    source: '',
    effective_from: '',
  };
  return {
    known: true,
    route,
    catalog_version: PRICE_CATALOG_VERSION,
    ...configured,
  };
}

module.exports = {
  PRICE_CATALOG_VERSION,
  ROUTE_PRICES,
  normalizeRoute,
  findRoutePrice,
};
