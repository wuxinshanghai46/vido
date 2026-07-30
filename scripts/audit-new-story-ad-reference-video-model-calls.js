const storage = require('../src/services/newStoryAd/storageService');
const referenceVideo = require('../src/services/newStoryAd/referenceVideoAnalysisService');

function sanitize(value = '') {
  return String(value)
    .replace(/\bBearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [redacted]')
    .replace(/\bsk-[A-Za-z0-9_-]{8,}/gi, '[redacted-key]')
    .replace(/\b[A-Za-z0-9_-]{48,}\b/g, '[redacted-long-secret]')
    .slice(0, 400);
}

function main(argv = process.argv.slice(2)) {
  const [userId, analysisId] = argv;
  if (!userId || !analysisId) throw new Error('缺少 userId 或 analysisId');
  const record = referenceVideo.get(analysisId, { id: userId });
  const calls = (storage.getTaskBundle(analysisId).model_calls || [])
    .slice()
    .sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')))
    .slice(-12)
    .map(item => ({
      id: item.id,
      created_at: item.created_at,
      provider_id: item.provider_id,
      model_id: item.model_id,
      status: item.status,
      error_code: item.error_code || '',
      error_message: sanitize(item.error_message || ''),
      fallback_rank: item.fallback_rank,
    }));
  console.log(JSON.stringify({
    record_status: record.status,
    record_error: record.error || null,
    calls,
  }));
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(sanitize(error.message || error));
    process.exitCode = 1;
  }
}

module.exports = { main, sanitize };
