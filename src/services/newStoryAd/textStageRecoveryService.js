function internallyRecoverable(error = null) {
  const code = String(error?.code || '');
  if (error?.retryable === true && !/PROVIDER|AUTH|BILLING|RATE_LIMIT|TIMEOUT|NETWORK/.test(code)) return true;
  return [
    'MODEL_JSON',
    'BLUEPRINT_OUTPUT_EMPTY',
    'BLUEPRINT_POLISH_QUALITY_FAILED',
    'BLUEPRINT_STRUCTURE_INVALID',
    'STORYBOARD_OUTPUT_EMPTY',
    'STORYBOARD_QUALITY_FAILED',
    'STORYBOARD_CONTINUITY_FAILED',
    'TEMPORAL_EVIDENCE_GRAPH_INVALID',
  ].includes(code);
}

function createTextStageRecovery(storage, cleanText) {
  return async function runTextStageWithRecovery(taskId, stage, execute, { maxAttempts = 2 } = {}) {
    let lastError = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        return await execute(attempt);
      } catch (error) {
        lastError = error;
        if (attempt >= maxAttempts || !internallyRecoverable(error)) throw error;
        storage.saveStage(taskId, `${stage}_auto_repair`, {
          status: 'running',
          input_summary: `自动恢复第 ${attempt + 1}/${maxAttempts} 次`,
          output_summary: '系统正在根据结构化诊断重新生成失败的文本阶段，无需用户重复点击',
          diagnostics: {
            source_error_code: String(error.code || 'UNKNOWN'),
            source_error: cleanText(error.message || '', 600),
            attempt,
            max_attempts: maxAttempts,
          },
        });
      }
    }
    throw lastError || new Error(`${stage} 自动恢复失败`);
  };
}

module.exports = { createTextStageRecovery, internallyRecoverable };
