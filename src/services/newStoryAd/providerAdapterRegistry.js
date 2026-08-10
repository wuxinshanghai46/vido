require('dotenv').config();
const https = require('https');
const OpenAI = require('openai');
const { loadSettings } = require('../settingsService');
const cancellation = require('./cancellationContext');

const DEYUNAI_C35_VENDOR = String(process.env.DEYUNAI_C35_VENDOR || '').trim();
const STRUCTURED_OUTPUT_MODES = new Set(['json_schema', 'json_object']);

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
  if (!providerId || !modelId) throw new Error('模型调用缺少供应商或模型配置。');
  const settings = loadSettings();
  const provider = (settings.providers || [])
    .find(p => p.enabled && p.api_key && providerMatches(p, providerId));
  if (!provider) throw new Error(`模型供应商 ${providerId} 当前不可用。`);
  const expectsVision = /(?:scene_vision|consistency_qa|vision)/i.test(String(model._stageId || ''));
  const providerModel = (provider.models || [])
    .find(m => String(m.id || '').trim() === modelId && m.enabled !== false
      && (expectsVision ? visionUseMatches(m) : storyUseMatches(m)));
  if (!providerModel) throw new Error(`文本模型 ${providerId}/${modelId} 未启用或类型不正确。`);
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

function normalizeStructuredOutput(value = null) {
  if (!value) return null;
  const input = value === true ? { mode: 'json_object' } : value;
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const embedded = input.json_schema && typeof input.json_schema === 'object' ? input.json_schema : {};
  const schema = input.schema || embedded.schema || null;
  let mode = String(input.mode || input.type || (schema ? 'json_schema' : 'json_object')).trim().toLowerCase();
  if (mode === 'auto') mode = schema ? 'json_schema' : 'json_object';
  if (!STRUCTURED_OUTPUT_MODES.has(mode)) return null;
  if (mode === 'json_schema' && (!schema || typeof schema !== 'object' || Array.isArray(schema))) {
    mode = 'json_object';
  }
  const rawName = String(input.name || embedded.name || 'structured_response').trim();
  const name = (rawName.replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'structured_response').slice(0, 64);
  return {
    mode,
    name,
    schema: mode === 'json_schema' ? schema : null,
    strict: input.strict !== false && embedded.strict !== false,
  };
}

function modesFromCapabilityDeclaration(value) {
  if (value === true) return ['json_schema', 'json_object'];
  if (!value || value === false) return [];
  if (Array.isArray(value)) {
    return [...new Set(value.map(item => String(item || '').toLowerCase()).filter(item => STRUCTURED_OUTPUT_MODES.has(item)))];
  }
  if (typeof value === 'string') {
    return modesFromCapabilityDeclaration(value.split(/[\s,|]+/));
  }
  if (typeof value === 'object') {
    const nested = value.modes || value.types || value.response_formats;
    if (nested) return modesFromCapabilityDeclaration(nested);
    return ['json_schema', 'json_object'].filter(mode => value[mode] === true || value[mode]?.enabled === true);
  }
  return [];
}

function declaredStructuredOutputModes(config = {}) {
  const declarations = [
    config.providerModel?.capabilities?.structured_output,
    config.providerModel?.capabilities?.structured_outputs,
    config.providerModel?.structured_output,
    config.providerModel?.response_formats,
    config.provider?.capabilities?.structured_output,
    config.provider?.capabilities?.structured_outputs,
    config.provider?.adapter_config?.structured_output,
    config.provider?.structured_output,
  ];
  for (const declaration of declarations) {
    if (declaration !== undefined) return modesFromCapabilityDeclaration(declaration);
  }
  const explicitFlags = {
    json_schema: config.providerModel?.supports_json_schema ?? config.provider?.supports_json_schema,
    json_object: config.providerModel?.supports_json_object ?? config.provider?.supports_json_object,
  };
  if (Object.values(explicitFlags).some(value => value !== undefined)) {
    return Object.entries(explicitFlags).filter(([, value]) => value === true).map(([mode]) => mode);
  }
  const officialOpenAI = /(?:^|\b)openai(?:\b|$)/i.test(String(config.providerId || ''))
    && (!config.baseURL || /api\.openai\.com/i.test(String(config.baseURL)));
  if (officialOpenAI && /^(?:gpt-4o|gpt-4\.1|gpt-5|o[1-9])(?:[.\-]|$)/i.test(String(config.modelId || ''))) {
    return ['json_schema', 'json_object'];
  }
  const deyunGeminiCompatible = (config.family?.includes('deyunai') || /deyunai|漫路/i.test(String(config.providerId || '')))
    && /^gemini-/i.test(String(config.modelId || ''));
  if (deyunGeminiCompatible) return ['json_object'];
  return [];
}

function structuredOutputPlan(config = {}, request = null) {
  const normalized = normalizeStructuredOutput(request);
  if (!normalized) return { request: null, modes: ['prompt'], supported_modes: [] };
  const supported = declaredStructuredOutputModes(config);
  const modes = [];
  if (normalized.mode === 'json_schema' && supported.includes('json_schema')) modes.push('json_schema');
  if (supported.includes('json_object')
    && (normalized.mode === 'json_object' || normalized.schema?.type === 'object' || !normalized.schema?.type)) {
    modes.push('json_object');
  }
  modes.push('prompt');
  return { request: normalized, modes: [...new Set(modes)], supported_modes: supported };
}

function structuredPrompt(systemPrompt = '', request = null, { includeSchema = true } = {}) {
  const normalized = normalizeStructuredOutput(request);
  if (!normalized) return String(systemPrompt || '');
  const schemaInstruction = normalized.schema && includeSchema
    ? ` The JSON must conform to this schema: ${JSON.stringify(normalized.schema)}`
    : (normalized.mode === 'json_object' ? ' The root value must be a JSON object.' : ' Follow the supplied JSON schema exactly.');
  return `${String(systemPrompt || '').trim()}\n\nReturn JSON only: one valid JSON value, with no markdown fence, commentary, or text before or after it.${schemaInstruction}`.trim();
}

function structuredResponseFormat(request = null, mode = 'prompt') {
  const normalized = normalizeStructuredOutput(request);
  if (!normalized || mode === 'prompt') return null;
  if (mode === 'json_schema') {
    return {
      type: 'json_schema',
      json_schema: {
        name: normalized.name,
        strict: normalized.strict,
        schema: normalized.schema,
      },
    };
  }
  if (mode === 'json_object') return { type: 'json_object' };
  return null;
}

function providerStatus(error = {}) {
  return Number(error.status || error.statusCode || error.response?.status || error.response?.statusCode || 0) || 0;
}

function isStructuredOutputUnsupportedError(error, mode = '') {
  if (!STRUCTURED_OUTPUT_MODES.has(mode) || providerStatus(error) !== 400) return false;
  const message = [
    error?.message,
    error?.response?.data?.error?.message,
    error?.response?.data?.message,
  ].filter(Boolean).join(' ');
  const explicitlyUnsupported = /response[_\s-]?format|json[_\s-]?schema|json[_\s-]?object|structured[_\s-]?output/i.test(message)
    && /not\s+support|unsupported|unknown|unrecognized|invalid|not\s+allowed|does\s+not\s+support/i.test(message);
  // Some OpenAI-compatible gateways return only `400 status code (no body)`
  // when response_format is unsupported. The native structured request is the
  // only difference at this point, so retry the same call once in prompt mode.
  // If the request itself is invalid, the prompt-mode attempt still fails and
  // preserves the concrete provider rejection for the caller.
  const ambiguousEmpty400 = /(?:no|empty)\s+body|body\s+(?:is\s+)?empty/i.test(message);
  return explicitlyUnsupported || ambiguousEmpty400;
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
  if (content && typeof content === 'object') return JSON.stringify(content);
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

function bindAbort(req, signal) {
  if (!signal) return () => {};
  const abort = () => req.destroy(signal.reason instanceof Error ? signal.reason : new Error('Request aborted'));
  if (signal.aborted) abort();
  else signal.addEventListener('abort', abort, { once: true });
  return () => signal.removeEventListener('abort', abort);
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
    const unbind = bindAbort(req, opts.signal);
    req.on('close', unbind);
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
    const unbind = bindAbort(req, opts.signal);
    req.on('close', unbind);
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

  const client = opts._client || new OpenAI(sdkOpts);
  const maxTokenValue = Math.max(1024, Math.min(32000, Number(opts.maxTokens) || 4096));
  const plan = structuredOutputPlan(config, opts.structuredOutput);
  const structuredAttempts = [];
  const buildPayload = (tokenLimit, mode = 'prompt') => {
    const responseFormat = structuredResponseFormat(plan.request, mode);
    const effectiveSystemPrompt = plan.request
      ? structuredPrompt(systemPrompt, plan.request, { includeSchema: mode === 'prompt' })
      : systemPrompt;
    return {
      model: config.modelId,
      messages: Array.isArray(opts.messages) && opts.messages.length ? opts.messages.map((message, index) => (
        index === 0 && message?.role === 'system' && plan.request
          ? { ...message, content: structuredPrompt(message.content, plan.request, { includeSchema: mode === 'prompt' }) }
          : message
      )) : [
        { role: 'system', content: effectiveSystemPrompt },
        { role: 'user', content: userPrompt },
      ],
      ...(isGpt5FamilyModel(config.modelId)
        ? { max_completion_tokens: tokenLimit }
        : { max_tokens: tokenLimit }),
      ...(!isGpt5FamilyModel(config.modelId) && Number.isFinite(Number(opts.temperature))
        ? { temperature: Math.max(0, Math.min(2, Number(opts.temperature))) }
        : {}),
      ...(responseFormat ? { response_format: responseFormat } : {}),
    };
  };
  let completion;
  let appliedMode = 'prompt';
  for (let index = 0; index < plan.modes.length; index += 1) {
    const mode = plan.modes[index];
    try {
      completion = await client.chat.completions.create(buildPayload(maxTokenValue, mode), { signal: opts.signal });
      appliedMode = mode;
      structuredAttempts.push({ mode, status: 'success' });
      break;
    } catch (error) {
      const unsupported = isStructuredOutputUnsupportedError(error, mode);
      structuredAttempts.push({
        mode,
        status: 'failed',
        provider_status: providerStatus(error),
        code: unsupported ? 'STRUCTURED_OUTPUT_UNSUPPORTED' : String(error?.code || 'PROVIDER_REQUEST_FAILED'),
        message: String(error?.message || error).slice(0, 240),
      });
      if (unsupported && index < plan.modes.length - 1) continue;
      error.response_diagnostics = {
        ...(error.response_diagnostics || {}),
        kind: plan.request ? 'structured_output_request' : 'provider_request',
        requested_mode: plan.request?.mode || '',
        attempts: structuredAttempts,
      };
      throw error;
    }
  }
  if (typeof completion === 'string') {
    try { completion = JSON.parse(completion); } catch (_) {}
  }
  let text = textFromCompletion(completion);
  if ((!completion?.choices?.length || !text) && reasoningBudgetExhausted(completion, maxTokenValue)) {
    const retryTokenValue = Math.min(32000, Math.max(maxTokenValue + 6000, Math.ceil(maxTokenValue * 2)));
    if (retryTokenValue > maxTokenValue) {
      completion = await client.chat.completions.create(buildPayload(retryTokenValue, appliedMode), { signal: opts.signal });
      if (typeof completion === 'string') {
        try { completion = JSON.parse(completion); } catch (_) {}
      }
      text = textFromCompletion(completion);
    }
  }
  if (!completion?.choices?.length || !text) {
    const raw = (typeof completion === 'string' ? completion : JSON.stringify(completion || {})).slice(0, 300);
    const error = new Error(`模型 ${config.providerId}/${config.modelId} 没有返回可用内容。finish_reason=${completion?.choices?.[0]?.finish_reason || 'unknown'}；响应摘要=${raw}`);
    error.code = 'PROVIDER_EMPTY_RESPONSE';
    error.retryable = true;
    throw error;
  }
  return {
    text,
    usage: completion.usage || {},
    structured_output: plan.request ? {
      requested_mode: plan.request.mode,
      applied_mode: appliedMode,
      native: appliedMode !== 'prompt',
      degraded: appliedMode !== plan.request.mode,
      supported_modes: plan.supported_modes,
      attempts: structuredAttempts,
    } : null,
  };
}

async function generateText({ model, systemPrompt, userPrompt, messages = null, maxTokens = 4096, temperature = 0.3, timeoutMs = 90000, signal = cancellation.signal(), structuredOutput = null, _client = null } = {}) {
  const config = resolveTextAdapter(model);
  const effectiveSystemPrompt = structuredOutput ? structuredPrompt(systemPrompt, structuredOutput) : systemPrompt;
  let result;
  if (config.family.includes('anthropic') || config.providerId === 'anthropic') {
    result = await callAnthropicMessages(config, effectiveSystemPrompt, userPrompt, { maxTokens, temperature, timeoutMs, signal });
  } else if ((config.family.includes('deyunai') || /deyunai|漫路/i.test(config.providerId || '')) && /^claude-/i.test(config.modelId)) {
    result = await callDeyunaiClaudeMessages(config, effectiveSystemPrompt, userPrompt, { maxTokens, temperature, timeoutMs, signal });
  } else {
    result = await callOpenAICompatible(config, systemPrompt, userPrompt, {
      messages, maxTokens, temperature, timeoutMs, signal, structuredOutput, _client,
    });
  }
  return {
    text: result.text,
    usage: result.usage || {},
    adapter: config.adapter,
    family: config.family,
    provider_id: config.providerId,
    model_id: config.modelId,
    structured_output: result.structured_output || (structuredOutput ? {
      requested_mode: normalizeStructuredOutput(structuredOutput)?.mode || '',
      applied_mode: 'prompt',
      native: false,
      degraded: true,
      supported_modes: [],
      attempts: [{ mode: 'prompt', status: 'success' }],
    } : null),
  };
}

module.exports = {
  resolveTextAdapter,
  normalizeStructuredOutput,
  declaredStructuredOutputModes,
  structuredOutputPlan,
  structuredPrompt,
  structuredResponseFormat,
  isStructuredOutputUnsupportedError,
  callOpenAICompatible,
  generateText,
};
