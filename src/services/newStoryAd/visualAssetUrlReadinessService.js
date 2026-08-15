const axios = require('axios');

async function probe(url = '', options = {}) {
  const client = options.client || axios;
  try {
    const response = await client.get(String(url), {
      responseType: 'arraybuffer', timeout: Math.max(100, Number(options.timeoutMs) || 120000), signal: options.signal,
    });
    return { state: 'ready', status: Number(response.status || 200), data: response.data };
  } catch (error) {
    const status = Number(error?.response?.status || 0);
    if (status >= 400 && status < 500) return { state: 'missing', status, error };
    return { state: 'unknown', status, error };
  }
}

function readinessError(result = {}) {
  const missing = result.state === 'missing';
  const error = result.error instanceof Error ? result.error : new Error(missing ? '供应商图片地址不可用。' : '供应商图片地址状态未知。');
  error.code ||= missing ? 'PROVIDER_ASSET_URL_REJECTED' : 'PROVIDER_ASSET_URL_UNAVAILABLE';
  error.providerSubmissionState = missing ? 'submission_rejected' : 'submitted_unknown';
  error.billingState = missing ? 'not_billed' : 'unknown';
  return error;
}

module.exports = { probe, readinessError };
