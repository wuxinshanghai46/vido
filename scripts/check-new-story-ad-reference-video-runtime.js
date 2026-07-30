const modelGateway = require('../src/services/newStoryAd/modelGateway');
const pipeline = require('../src/services/pipelineModelService');

function main() {
  const stage = 'new_story_ad.reference_video_vision';
  const availability = modelGateway.visionAvailability(stage);
  const configured = pipeline.pickAllEnabledWithDefault(stage)
    .map(item => `${item.provider_id}/${item.model_id}`);
  const available = availability.models
    .filter(item => item.available)
    .map(item => `${item.provider_id}/${item.model_id}`);
  const report = {
    stage,
    db_enabled: process.env.DB_ENABLED === 'true' || process.env.DB_ENABLED === '1',
    db_read_primary: process.env.DB_READ_PRIMARY === 'true' || process.env.DB_READ_PRIMARY === '1',
    route_source: availability.source,
    configured,
    available,
    unavailable: availability.models
      .filter(item => !item.available)
      .map(item => ({
        provider_id: item.provider_id,
        model_id: item.model_id,
        reason: item.reason,
        retry_after_ms: item.retry_after_ms,
      })),
  };
  console.log(JSON.stringify(report));
  if (!report.db_enabled || !report.db_read_primary) {
    throw new Error('运行时核对没有继承生产 PM2 的 SQLite 主读配置');
  }
  if (!available.length) throw new Error('生产运行时没有可用的参考视频视觉模型');
  if (configured[0] !== 'deyunai/gemini-2.5-flash') {
    throw new Error(`参考视频视觉首选模型不正确: ${configured[0] || 'empty'}`);
  }
  if (availability.models.some(item => item.provider_id === 'openai')) {
    throw new Error('参考视频视觉路由仍混入 OpenAI 通用候选');
  }
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message || error);
    process.exitCode = 1;
  }
}

module.exports = { main };
