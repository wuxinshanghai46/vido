function stripMarkdown(raw = '') {
  let text = String(raw || '').trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) return fenced[1].trim();
  return text.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
}

function extractBalanced(text = '', open = '{', close = '}') {
  const raw = String(text || '');
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (start < 0) {
      if (ch === open) {
        start = i;
        depth = 1;
      }
      continue;
    }
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === open) depth += 1;
    else if (ch === close) {
      depth -= 1;
      if (depth === 0) return raw.slice(start, i + 1);
    }
  }
  return '';
}

function removeTrailingCommas(text = '') {
  return String(text || '').replace(/,\s*([}\]])/g, '$1');
}

function firstJsonTail(text = '', expected = 'any') {
  const raw = String(text || '');
  const arrayIdx = raw.indexOf('[');
  const objectIdx = raw.indexOf('{');
  if (expected === 'array') return arrayIdx >= 0 ? raw.slice(arrayIdx) : raw;
  if (expected === 'object') return objectIdx >= 0 ? raw.slice(objectIdx) : raw;
  const indexes = [arrayIdx, objectIdx].filter(i => i >= 0);
  return indexes.length ? raw.slice(Math.min(...indexes)) : raw;
}

function closeOpenJson(raw = '', expected = 'any') {
  const text = firstJsonTail(removeTrailingCommas(stripMarkdown(raw)), expected);
  const stack = [];
  let inString = false;
  let escaped = false;
  let out = '';
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    out += ch;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === '{') stack.push('}');
    else if (ch === '[') stack.push(']');
    else if ((ch === '}' || ch === ']') && stack[stack.length - 1] === ch) stack.pop();
  }
  if (inString) out += '"';
  while (stack.length) out += stack.pop();
  return removeTrailingCommas(out);
}

function parseJson(raw, expected = 'any') {
  const text = stripMarkdown(raw);
  const attempts = [text, removeTrailingCommas(text), closeOpenJson(text, expected)];
  if (expected === 'array' || expected === 'any') {
    const arr = extractBalanced(text, '[', ']');
    if (arr) attempts.push(arr, removeTrailingCommas(arr));
  }
  if (expected === 'object' || expected === 'any') {
    const obj = extractBalanced(text, '{', '}');
    if (obj) attempts.push(obj, removeTrailingCommas(obj));
  }
  let lastErr = null;
  for (const candidate of attempts) {
    if (!String(candidate || '').trim()) continue;
    try {
      const parsed = JSON.parse(candidate);
      if (expected === 'array') {
        if (Array.isArray(parsed)) return parsed;
        if (parsed && typeof parsed === 'object') {
          for (const key of ['items', 'data', 'shots', 'scenes', 'storyboard']) {
            if (Array.isArray(parsed[key])) return parsed[key];
          }
        }
      } else if (expected === 'object') {
        if (parsed && !Array.isArray(parsed) && typeof parsed === 'object') return parsed;
        if (Array.isArray(parsed)) return parsed[0] || {};
      } else {
        return parsed;
      }
    } catch (err) {
      lastErr = err;
    }
  }
  const error = new Error(`JSON_PARSE_FAILED: ${lastErr?.message || 'no valid JSON block'}`);
  error.code = 'JSON_PARSE_FAILED';
  throw error;
}

async function parseOrRepair({ raw, expected = 'any', modelGateway = null, taskId = '', stage = 'new_story_ad.json_repair' } = {}) {
  try {
    return parseJson(raw, expected);
  } catch (err) {
    if (!modelGateway) throw err;
    const systemPrompt = [
      '你是严格 JSON 修复器。只修复 JSON 语法，不新增事实，不改写业务内容。',
      expected === 'array' ? '输出必须是 JSON 数组。' : expected === 'object' ? '输出必须是 JSON 对象。' : '输出必须是合法 JSON。',
      '不要输出 markdown，不要解释，不要注释。字符串内部真实换行必须转义。',
    ].join('\n');
    const userPrompt = `修复以下 JSON 输出：\n${String(raw || '').slice(0, 24000)}`;
    const result = await modelGateway.generateText({
      taskId,
      stage,
      systemPrompt,
      userPrompt,
      maxTokens: 6000,
      maxCandidates: 1,
      stageBudgetMs: 60000,
      skipKb: true,
    });
    return parseJson(result.text, expected);
  }
}

module.exports = {
  stripMarkdown,
  extractBalanced,
  closeOpenJson,
  parseJson,
  parseOrRepair,
};
