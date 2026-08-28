const mediaAdapterDefault = require('./mediaAdapter');
const storageDefault = require('./storageService');
const productIdentityDefault = require('./productIdentityContractService');
const revisionServiceDefault = require('./revisionService');
const productAssetResolver = require('./productAssetResolverService');

function updateProgress(storage, taskId, generationId, patch = {}) {
  const task = storage.getTask(taskId) || {};
  const previous = task.generation_progress?.stage === 'product_asset' ? task.generation_progress : {};
  const total = Math.max(1, Number(patch.total || previous.total || 1) || 1);
  const completed = Math.max(0, Math.min(total, Number(patch.completed ?? previous.completed ?? 0) || 0));
  const percent = Math.max(0, Math.min(100, Number.isFinite(Number(patch.percent)) ? Number(patch.percent) : Math.round((completed / total) * 100)));
  const timestamp = new Date().toISOString();
  storage.updateTask(taskId, { generation_progress: {
    schema_version: 1, stage: 'product_asset', generation_id: generationId,
    status: patch.status || (percent >= 100 ? 'completed' : 'running'),
    phase: patch.phase || previous.phase || '正在准备', message: patch.message || previous.message || '',
    total, completed, processed: completed, percent,
    started_at: previous.started_at || task.generation_started_at || timestamp,
    updated_at: timestamp, ...(percent >= 100 ? { finished_at: timestamp } : {}),
  } });
}

async function generateProductAsset(taskId, body = {}, options = {}, deps = {}) {
  const storage = deps.storage || storageDefault;
  const mediaAdapter = deps.mediaAdapter || mediaAdapterDefault;
  const productIdentity = deps.productIdentity || productIdentityDefault;
  const revisionService = deps.revisionService || revisionServiceDefault;
  const generationId = String(options.generationId || body.generation_id || '');
  const task = storage.getTask(taskId);
  const ctx = storage.getOutput(taskId, 'context') || task?.request || {};
  const presentation = productAssetResolver.productPresentation(ctx);
  const referenceOnly = body.reference_only === true || body.referenceOnly === true;
  if (!presentation.standalone_generation_supported && !referenceOnly) {
    const error = new Error(`“${presentation.subject}”属于${presentation.label}，应从场景、成品细节和互动镜头呈现，不能生成虚假的影棚商品四视图`);
    error.code = 'STANDALONE_PRODUCT_GENERATION_NOT_APPLICABLE';
    error.status = 422;
    error.retryable = false;
    error.product_presentation = presentation;
    throw error;
  }
  const productName = String(body.product_name || body.productName || ctx.product_subject || '').trim();
  if (!productName) {
    const error = new Error('请先填写当前广告的商品或主体，再生成商品资产');
    error.code = 'PRODUCT_SUBJECT_REQUIRED';
    error.status = 422;
    throw error;
  }
  const revision = Math.max(1, Number(ctx.revisions?.product || ctx.product_contract?.product_revision || 0) + 1);
  updateProgress(storage, taskId, generationId, {
    percent: 5,
    phase: referenceOnly ? '正在整理展示主体、材质与使用边界' : '正在整理商品外观、材质与展示视角',
    message: referenceOnly ? `正在为“${productName}”建立可复用主体参考图` : `正在为“${productName}”建立商品资产`,
  });
  const description = String(body.description || body.prompt || '').trim();
  const atlas = await mediaAdapter.generateImage({
    taskId, stage: 'new_story_ad.product_asset',
    filename: `${referenceOnly ? 'subject_reference' : 'product'}_${String(taskId).replace(/[^a-z0-9_-]/ig, '_').slice(0, 40)}_r${revision}`,
    aspectRatio: '1:1', clientRequestId: generationId,
    imageModel: body.image_model || body.imageModel || 'auto',
    singleAttempt: body.single_attempt === true || body.singleAttempt === true,
    prompt: (referenceOnly ? [
      'Create one clean commercial visual reference image for an advertised display subject, material, surface finish, installed result, service carrier or spatial product.',
      `Advertised subject: ${productName}.`,
      description ? `User-confirmed description: ${description}.` : '',
      `Presentation mode: ${presentation.mode}. Preserve the exact category and do not turn it into an unrelated standalone package or generic studio prop.`,
      'Show the subject clearly enough to reuse as a visual lock in later scene, storyboard and keyframe generation.',
      'If it is a material or surface, show a clean representative sample or installed detail with truthful texture, scale and edge structure; no invented brand.',
      'If it is a spatial/display result, show the core installed subject without adding people, unrelated rooms, slogans, captions, labels, borders or watermark.',
      'Realistic premium commercial reference photography, neutral controlled light, no readable generated text.',
    ] : [
      'Create one clean 2 by 2 commercial product reference contact sheet.',
      'Exactly four equal cells in this order: front hero view, three-quarter view, side view, close detail view.',
      `Advertised product or subject: ${productName}.`,
      description ? `User description: ${description}.` : '',
      'The same exact product identity, shape, proportions, colors, materials, labels and details must be preserved in all cells.',
      'Neutral light-gray studio, realistic catalog photography, no people, no unrelated props, no added brand, no captions, borders or watermark.',
    ]).filter(Boolean).join('\n'),
    onProgress: event => updateProgress(storage, taskId, generationId, {
      percent: Math.max(10, Math.min(70, Number(event?.percent || 25))),
      phase: event?.phase || (referenceOnly ? '正在生成展示主体参考图' : '正在生成商品多视角参考'),
    }),
  });
  updateProgress(storage, taskId, generationId, { percent: 76, phase: referenceOnly ? '正在建立主体参考版本' : '正在拆分商品多视角并建立版本' });
  const atlasUrl = atlas.image_url || atlas.url || '';
  const views = referenceOnly ? [{ key: 'subject_reference', label: '展示主体参考图', image_url: atlasUrl }] : await mediaAdapter.splitReferenceSheet({
      source: atlas,
      filenamePrefix: `product_${String(taskId).replace(/[^a-z0-9_-]/ig, '_').slice(0, 40)}_r${revision}`,
      viewKeys: ['front', 'three_quarter', 'side', 'detail'], columns: 2, rows: 2,
      outputWidth: 1024, outputHeight: 1024, fit: 'contain', background: { r: 242, g: 244, b: 247, alpha: 1 },
    });
  const productAsset = {
    id: `product_${taskId}`, asset_id: `product_${taskId}`, name: productName,
    description: description || productName,
    type: referenceOnly && presentation.mode === 'material_surface' ? 'product_material' : 'product',
    role: 'product_reference', presentation_mode: presentation.mode, reference_only: referenceOnly,
    source: referenceOnly ? 'new_story_ad_subject_reference_generator' : 'new_story_ad_product_generator', revision,
    image_url: views[0]?.image_url || views[0]?.url || atlasUrl,
    view_images: views.map((view, index) => ({
      key: view.key || ['front', 'three_quarter', 'side', 'detail'][index],
      label: view.label || ['正面主视图', '三分之四视图', '侧面视图', '细节视图'][index],
      image_url: view.image_url || view.url || '',
    })),
    provider_used: atlas.provider_used || '', generated_at: new Date().toISOString(),
  };
  const nextContext = { ...ctx, product_subject: productName, product_asset: productAsset, product_contract: null, revisions: { ...(ctx.revisions || {}), product: revision } };
  const productContract = productIdentity.buildProductContract(nextContext, { revision });
  const committedContext = { ...nextContext, product_contract: productContract };
  revisionService.invalidateOutputs(storage, taskId, 'product');
  storage.saveOutput(taskId, 'context', committedContext);
  storage.saveOutput(taskId, 'product_contract', productContract);
  storage.updateTask(taskId, { request: committedContext, updated_at: new Date().toISOString() });
  updateProgress(storage, taskId, generationId, {
    percent: 100, completed: 1, status: 'completed',
    phase: referenceOnly ? '展示主体参考图已建立，等待一致性验证' : '商品多视角资产已建立，等待一致性验证',
  });
  return { product_asset: productAsset, product_contract: productContract };
}

module.exports = { generateProductAsset, updateProgress };
