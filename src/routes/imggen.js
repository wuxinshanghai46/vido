const express = require('express');
const router = express.Router();

// POST /api/imggen/generate - 生成图片
router.post('/generate', async (req, res) => {
  try {
    const { prompt, negative, model, provider, size, count, style } = req.body;
    if (!prompt) return res.status(400).json({ error: 'prompt is required' });

    // 尝试通过 imageService 生成
    const { getApiKey } = require('../services/settingsService');
    const settings = require('../services/settingsService').loadSettings();

    // 查找 use='image' 的模型
    let targetProvider = null;
    let targetModel = null;

    if (provider && model && model !== 'auto') {
      targetProvider = (settings.providers || []).find(p => p.id === provider);
      targetModel = model;
    } else {
      // 自动查找
      for (const p of (settings.providers || [])) {
        const imgModel = (p.models || []).find(m => m.use === 'image');
        if (imgModel) {
          targetProvider = p;
          targetModel = imgModel.id;
          break;
        }
      }
    }

    if (!targetProvider || !targetModel) {
      return res.json({
        images: [],
        message: '未配置图像生成模型。请在 AI 配置页面添加支持 image 用途的模型。'
      });
    }

    const apiKey = getApiKey(targetProvider.id);
    if (!apiKey) {
      return res.json({ images: [], message: `供应商 ${targetProvider.name} 未配置 API Key` });
    }

    // 使用 OpenAI 兼容 API 生成图片
    const OpenAI = require('openai');
    const client = new OpenAI({
      apiKey,
      baseURL: targetProvider.baseURL || 'https://api.openai.com/v1'
    });

    const sizeMap = {
      '1:1': '1024x1024',
      '16:9': '1792x1024',
      '9:16': '1024x1792',
      '4:3': '1024x768',
      '3:4': '768x1024'
    };

    const result = await client.images.generate({
      model: targetModel,
      prompt: `${prompt}${style && style !== 'auto' ? `, ${style} style` : ''}${negative ? `. Avoid: ${negative}` : ''}`,
      n: Math.min(count || 1, 4),
      size: sizeMap[size] || '1024x1024',
    });

    const images = (result.data || []).map(d => d.url || d.b64_json);
    res.json({ images, model: targetModel, provider: targetProvider.id });
  } catch (err) {
    console.error('Image generation error:', err.message);
    res.status(500).json({ error: err.message, images: [] });
  }
});

module.exports = router;
