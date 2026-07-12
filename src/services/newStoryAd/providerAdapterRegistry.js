require('dotenv').config();
const https = require('https');
const OpenAI = require('openai');
const { loadSettings } = require('../settingsService');

const DEYUNAI_C35_VENDOR = String(process.env.DEYUNAI_C35_VENDOR || '').trim();

function providerMatches(provider = {}, providerId = '') {
  const target = String(providerId || '').trim().toLowerCase();
  return [provider.id, provider.preset, provider.name]
    .filter(Boolean)
    .some(v => String(v).trim().toLowerCase() === target);
}

function storyUseMatches(model = {}) {
  return ['story', 'chat', 'llm'].includes(String(model.use || model.type || '').toLowerCase());
}

function visionUseMatches(model = {}) {
  const use = String(model.use || model.type || '').toLowerCase();
  const id = String(model.id || '').toLowerCase();
  return ['vision', 'vlm', 'multimodal'].includes(use)
    || (storyUseMatches(model) && /(?:gpt-4o(?:-mini)?|gemini-(?:2|3))/.test(id));
}

function adapterFamily(provider = {}) {
  return String(provider.adapter_config?.family || provider.adapter || provider.preset || provider.id || 'openai-compatible').toLowerCase();
}

function resolveTextAdapter(model = {}) {
  const providerId = String(model.provider_id || model.providerId || '').trim();
  const modelId = String(model.model_id || model.model || '').trim();
  if (!providerId || !modelId) throw new Error('new_story_ad adapter requires provider_id/model_id');
  const settings = loadSettings();
  const provider = (settings.providers || [])
    .find(p => p.enabled && p.api_key && providerMatches(p, providerId));
  if (!provider) throw new Error(`new_story_ad provider unavailable: ${providerId}`);
  const expectsVision = /(?:scene_vision|consistency_qa|vision)/i.test(String(model._stageId || ''));
  const providerModel = (provider.models || [])
    .find(m => String(m.id || '').trim() === modelId && m.enabled !== false
      && (expectsVision ? visionUseMatches(m) : storyUseMatches(m)));
  if (!providerModel) throw new Error(`new_story_ad model is not enabled text model: ${providerId}/${modelId}`);
  const adapter = provider.adapter || provider.preset || provider.id || providerId;
  return {
    adapter,
    family: adapterFamily(provider),
    provider,
    providerModel,
    providerId: provider.id || providerId,
    modelId,
    apiKey: provider.api_key,
    appId: provider.app_id || provider.aiapi_app_id || provider.key_id || '',
    baseURL: provider.api_url || provider.base_url || '',
    channel: providerModel.channel || '',
    vendor: providerModel.vendor || provider.vendor || DEYUNAI_C35_VENDOR,
  };
}

function isGpt5FamilyModel(modelId = '') {
  return /^gpt-5(?:[.\-\s]|$)/i.test(String(modelId || '').trim());
}

function deyunaiVendorHeader(config = {}) {
  const vendor = String(config.vendor || DEYUNAI_C35_VENDOR || '').trim();
  if (!vendor || vendor === 'API_VENDOR') return '';
  return vendor;
}

function textFromCompletion(completion) {
  const msg = completion?.choices?.[0]?.message;
  const content = msg?.content || msg?.reasoning_content || '';
  if (Array.isArray(content)) {
    return content.map(part => typeof part === 'string' ? part : (part?.text || '')).filter(Boolean).join('\n').trim();
  }
  return String(content || '').trim();
}

function reasoningBudgetExhausted(completion, tokenLimit) {
  const usage = completion?.usage || {};
  const details = usage.completion_tokens_details || usage.completionTokensDetails || {};
  const reasoningTokens = Number(details.reasoning_tokens || details.reasoningTokens || 0);
  const textTokens = Number(details.text_tokens || details.textTokens || 0);
  const completionTokens = Number(usage.completion_tokens || usage.completionTokens || 0);
  return reasoningTokens > 0
    && textTokens === 0
    && completionTokens >= Math.max(1, Math.floor(Number(tokenLimit || 0) * 0.9));
}

function callAnthropicMessages(config, systemPrompt, userPrompt, opts = {}) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: config.modelId,
      max_tokens: Math.max(1024, Math.min(16000, Number(opts.maxTokens) || 4096)),
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });
    const req = https.request({
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'x-api-key': config.apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
      },
      timeout: Math.max(30000, Math.min(180000, Number(opts.timeoutMs) || 120000)),
    }, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString();
        let data = null;
        try { data = JSON.parse(raw); } catch (_) {}
        if (res.statusCode >= 400) {
          return reject(new Error(`Anthropic HTTP ${res.statusCode}: ${data?.error?.message || raw.slice(0, 300)}`));
        }
        const text = (Array.isArray(data?.content) ? data.content : [])
          .map(part => typeof part === 'string' ? part : (part?.text || ''))
          .filter(Boolean)
          .join('\n')
          .trim();
        if (!text) return reject(new Error(`Anthropic returned empty content: ${raw.slice(0, 300)}`));
        resolve({ text, usage: data.usage || {} });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('Anthropic request timeout')));
    req.write(body);
    req.end();
  });
}

function callDeyunaiClaudeMessages(config, systemPrompt, userPrompt, opts = {}) {
  return new Promise((resolve, reject) => {
    const payload = {
      model: config.modelId,
      max_tokens: Math.max(1024, Math.min(16000, Number(opts.maxTokens) || 4096)),
      messages: [{ role: 'user', content: userPrompt }],
    };
    if (String(systemPrompt || '').trim()) payload.system = systemPrompt;
    const body = JSON.stringify(payload);
    const req = https.request({
      hostname: 'api.deyunai.com',
      path: '/c35/v1/messages',
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: Math.max(30000, Math.min(180000, Number(opts.timeoutMs) || 120000)),
    }, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString();
        let data = null;
        try { data = JSON.parse(raw); } catch (_) {}
        if (res.statusCode >= 400 || data?.error) {
          const msg = data?.error?.message || data?.message || raw.slice(0, 300) || `HTTP ${res.statusCode}`;
          return reject(new Error(`DeyunAI Claude Messages: ${msg}`));
        }
        const text = (Array.isArray(data?.content) ? data.content : [])
          .map(part => typeof part === 'string' ? part : (part?.text || ''))
          .filter(Boolean)
          .join('\n')
          .trim();
        if (!text) return reject(new Error(`DeyunAI Claude Messages returned empty content: ${raw.slice(0, 300)}`));
        resolve({ text, usage: data.usage || {} });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('DeyunAI Claude Messages request timeout')));
    req.write(body);
    req.end();
  });
}

async function callOpenAICompatible(config, systemPrompt, userPrompt, opts = {}) {
  const sdkOpts = {
    apiKey: config.apiKey,
    timeout: Math.max(30000, Math.min(180000, Number(opts.timeoutMs) || 90000)),
    maxRetries: 0,
  };
  if (config.baseURL) sdkOpts.baseURL = config.baseURL;
  const headers = {};
  if (config.family.includes('deyunai') || /deyunai|漫路/i.test(config.providerId || '')) {
    const m = String(config.modelId || '').toLowerCase();
    const overseas = config.channel === 'overseas' || /^gpt-|^o[1-9]|^claude-|^gemini-(?!3\.1-flash-lite-preview)|^grok-/i.test(m);
    if (overseas && sdkOpts.baseURL && !sdkOpts.baseURL.includes('/c35/')) {
      sdkOpts.baseURL = sdkOpts.baseURL.replace(/\/v1\/?$/, '/c35/v1');
      const vendor = deyunaiVendorHeader(config);
      if (vendor) headers.vendor = vendor;
    }
  }
  if (config.family.includes('aiapi') || /aiapi/i.test(config.providerId || '')) {
    headers['X-App-Key'] = config.apiKey;
    if (config.appId) headers['X-App-Id'] = config.appId;
  }
  if (Object.keys(headers).length) sdkOpts.defaultHeaders = headers;

  const client = new OpenAI(sdkOpts);
  const maxTokenValue = Math.max(1024, Math.min(32000, Number(opts.maxTokens) || 4096));
  const buildPayload = (tokenLimit) => ({
    model: config.modelId,
    messages: Array.isArray(opts.messages) && opts.messages.length ? opts.messages : [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    ...(isGpt5FamilyModel(config.modelId)
      ? { max_completion_tokens: tokenLimit }
      : { max_tokens: tokenLimit }),
  });
  let completion = await client.chat.completions.create(buildPayload(maxTokenValue));
  if (typeof completion === 'string') {
    try { completion = JSON.parse(completion); } catch (_) {}
  }
  let text = textFromCompletion(completion);
  if ((!completion?.choices?.length || !text) && reasoningBudgetExhausted(completion, maxTokenValue)) {
    const retryTokenValue = Math.min(32000, Math.max(maxTokenValue + 6000, Math.ceil(maxTokenValue * 2)));
    if (retryTokenValue > maxTokenValue) {
      completion = await client.chat.completions.create(buildPayload(retryTokenValue));
      if (typeof completion === 'string') {
        try { completion = JSON.parse(completion); } catch (_) {}
      }
      text = textFromCompletion(completion);
    }
  }
  if (!completion?.choices?.length || !text) {
    const raw = (typeof completion === 'string' ? completion : JSON.stringify(completion || {})).slice(0, 300);
    throw new Error(`new_story_ad adapter empty response (${config.providerId}/${config.modelId}): ${raw}`);
  }
  return { text, usage: completion.usage || {} };
}

async function generateText({ model, systemPrompt, userPrompt, messages = null, maxTokens = 4096, temperature = 0.3, timeoutMs = 90000 } = {}) {
  const config = resolveTextAdapter(model);
  let result;
  if (config.family.includes('anthropic') || config.providerId === 'anthropic') {
    result = await callAnthropicMessages(config, systemPrompt, userPrompt, { maxTokens, temperature, timeoutMs });
  } else if ((config.family.includes('deyunai') || /deyunai|漫路/i.test(config.providerId || '')) && /^claude-/i.test(config.modelId)) {
    result = await callDeyunaiClaudeMessages(config, systemPrompt, userPrompt, { maxTokens, temperature, timeoutMs });
  } else {
    result = await callOpenAICompatible(config, systemPrompt, userPrompt, { messages, maxTokens, temperature, timeoutMs });
  }
  return {
    text: result.text,
    usage: result.usage || {},
    adapter: config.adapter,
    family: config.family,
    provider_id: config.providerId,
    model_id: config.modelId,
  };
}

module.exports = {
  resolveTextAdapter,
  generateText,
};
