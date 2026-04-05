/**
 * Pipeline Service — DAG 工作流自动执行引擎
 *
 * 流程: 文本输入 → AI拆分分镜 → 并行生成(背景+人物) → 并行生成视频 → 合成
 *
 * 每一步通过 SSE 推送进度给前端
 */

const { generateStory, parseScript, callLLM } = require('./storyService');
const { generateCharacterImage, generateSceneImage } = require('./imageService');

// 活跃的 pipeline 任务
const activePipelines = new Map();

/**
 * 执行完整的自动化 pipeline
 * @param {object} config - 配置
 * @param {string} config.text - 输入文本/主题
 * @param {string} config.style - 画面风格: 2d / 3d / realistic
 * @param {number} config.sceneCount - 分镜数量
 * @param {string} config.genre - 类型
 * @param {string} config.aspectRatio - 图片比例
 * @param {string} config.resolution - 图片清晰度
 * @param {function} config.onProgress - 进度回调 (stage, detail, progress%)
 * @returns {object} 完整的 pipeline 结果
 */
async function executePipeline(config) {
  const {
    text, style = '2d', sceneCount = 6, genre = 'drama',
    aspectRatio = '16:9', resolution = '2K',
    onProgress = () => {}
  } = config;

  const pipelineId = 'pipe_' + Date.now();
  const result = { id: pipelineId, status: 'running', scenes: [], characters: [], errors: [] };
  activePipelines.set(pipelineId, result);

  try {
    // ═══ 阶段 1: AI 分析内容，拆分分镜 ═══
    onProgress('parsing', '正在分析内容，拆分分镜...', 5);

    const duration = sceneCount * 10;
    let parsed;
    try {
      parsed = await parseScript({ script: text, genre, duration });
    } catch (e) {
      // 如果 parseScript 失败，尝试 generateStory
      onProgress('parsing', '分镜拆分失败，尝试生成剧情...', 8);
      const story = await generateStory({ theme: text, genre, duration, scene_dim: style });
      parsed = { characters: story.characters || [], scenes: story.scenes || [] };
    }

    const scenes = parsed.scenes || parsed.custom_scenes || [];
    const characters = parsed.characters || [];

    if (scenes.length === 0) {
      throw new Error('AI 未能识别出场景，请尝试提供更详细的内容');
    }

    result.characters = characters;
    result.sceneData = scenes;
    onProgress('parsed', `已拆分 ${scenes.length} 个场景，${characters.length} 个角色`, 15);

    // ═══ 阶段 2: 生成角色参考图（用于后续一致性）═══
    onProgress('characters', '正在生成角色形象...', 18);

    const charResults = [];
    const dim = style === '3d' ? '3d' : style === 'realistic' ? 'realistic' : '2d';

    for (let i = 0; i < characters.length; i++) {
      const char = characters[i];
      onProgress('characters', `生成角色 ${i + 1}/${characters.length}: ${char.name}`, 18 + (i / characters.length) * 12);
      try {
        const charImg = await generateCharacterImage({
          name: char.name,
          role: char.role || 'main',
          description: char.appearance || char.description || '',
          dim,
          mode: 'portrait',
          aspectRatio: '3:4',
          resolution
        });
        charResults.push({
          name: char.name,
          imageUrl: `/api/story/character-image/${charImg.filename}`,
          filename: charImg.filename
        });
      } catch (e) {
        result.errors.push(`角色「${char.name}」生成失败: ${e.message}`);
        console.error(`[Pipeline] 角色生成失败:`, e.message);
      }
    }
    result.characterImages = charResults;
    onProgress('characters_done', `已生成 ${charResults.length} 个角色形象`, 30);

    // 收集参考图 URL（用于后续场景生成的角色一致性）
    const referenceImages = charResults
      .map(c => c.imageUrl)
      .filter(Boolean);

    // ═══ 阶段 3: 串行生成每个场景的背景和人物图（避免 API 限流）═══
    onProgress('scenes', '正在生成分镜图片...', 32);

    const sceneResults = [];
    const totalSceneSteps = scenes.length * 2;
    let completedSteps = 0;

    for (let i = 0; i < scenes.length; i++) {
      const scene = scenes[i];
      const sceneResult = { index: i, title: scene.title || `场景${i + 1}`, bg: null, char: null };

      // 背景
      const bgDesc = scene.background || scene.location || scene.description || scene.title;
      onProgress('scenes', `场景${i + 1}/${scenes.length} 生成背景...`, 32 + (completedSteps / totalSceneSteps) * 38);
      try {
        const bg = await generateSceneImage({
          title: (bgDesc || '').substring(0, 20),
          description: bgDesc + '。纯风景画，只有自然环境和建筑，绝对没有人物、没有眼睛、没有面孔。',
          dim, aspectRatio, resolution
        });
        sceneResult.bg = { imageUrl: `/api/story/character-image/${bg.filename}`, filename: bg.filename };
      } catch (e) {
        result.errors.push(`场景${i + 1}背景: ${e.message.substring(0, 80)}`);
      }
      completedSteps++;

      // 人物
      const charNames = (scene.characters_in_scene || []).join('、');
      const charAction = scene.characters_action || scene.action || '';
      const charDesc = charNames ? `${charNames}：${charAction}` : charAction;
      if (charDesc) {
        onProgress('scenes', `场景${i + 1}/${scenes.length} 生成人物...`, 32 + (completedSteps / totalSceneSteps) * 38);
        try {
          const ch = await generateCharacterImage({
            name: charNames || '角色',
            description: charDesc,
            dim,
            mode: 'portrait',
            aspectRatio: '3:4',
            resolution,
            referenceImages
          });
          sceneResult.char = { imageUrl: `/api/story/character-image/${ch.filename}`, filename: ch.filename };
        } catch (e) {
          result.errors.push(`场景${i + 1}人物: ${e.message.substring(0, 80)}`);
        }
      }
      completedSteps++;

      sceneResults.push(sceneResult);
    }
    result.scenes = sceneResults;
    onProgress('scenes_done', `已生成 ${sceneResults.length} 个分镜图片`, 70);

    // ═══ 阶段 4: 为每个场景生成专业视频提示词 ═══
    onProgress('video_prompts', '正在生成视频提示词...', 72);
    try {
      const videoPrompts = await generateVideoPrompts(scenes, characters, style, genre);
      result.videoPrompts = videoPrompts;
      onProgress('video_prompts_done', `已生成 ${videoPrompts.length} 条视频提示词`, 90);
    } catch (e) {
      console.warn('[Pipeline] 视频提示词生成失败，使用基础描述:', e.message);
      result.videoPrompts = scenes.map((s, i) => {
        const bg = s.background || s.location || s.description || '';
        const action = s.characters_action || s.action || '';
        const camera = s.camera || '';
        return { index: i, prompt: [bg, action, camera].filter(Boolean).join('。') };
      });
    }

    // ═══ 阶段 5: 完成（视频生成由用户在画布上触发）═══
    onProgress('done', `Pipeline 完成！${sceneResults.length} 个分镜已就绪`, 100);
    result.status = 'done';

  } catch (e) {
    result.status = 'error';
    result.error = e.message;
    onProgress('error', e.message, -1);
    console.error('[Pipeline] 执行失败:', e);
  }

  activePipelines.set(pipelineId, result);
  return result;
}

function getPipeline(id) {
  return activePipelines.get(id);
}

/**
 * 用 LLM 为每个场景生成专业的视频生成提示词
 */
async function generateVideoPrompts(scenes, characters, style, genre) {
  const styleMap = { '2d': '2D anime style', '3d': '3D CGI cinematic', 'realistic': 'photorealistic live-action' };
  const styleDesc = styleMap[style] || styleMap['2d'];

  const sceneSummary = scenes.map((s, i) => {
    const title = s.title || `Scene ${i + 1}`;
    const bg = s.background || s.location || '';
    const chars = (s.characters_in_scene || []).join(', ');
    const action = s.characters_action || s.action || '';
    const camera = s.camera || '';
    const dialogue = s.dialogue || '';
    return `[Scene ${i + 1}] ${title}\n  Background: ${bg}\n  Characters: ${chars}\n  Action: ${action}\n  Camera: ${camera}\n  Dialogue: ${dialogue}`;
  }).join('\n\n');

  const charSummary = characters.map(c =>
    `${c.name} (${c.role || 'character'}): ${c.appearance || c.description || ''}`
  ).join('\n');

  const systemPrompt = `You are a professional AI video prompt engineer. Generate precise, cinematic video generation prompts for each scene.

Rules:
- Each prompt must be self-contained (describe everything needed in one prompt)
- Include: visual style, lighting, camera movement, character appearance, action details, atmosphere
- For action/fighting scenes: emphasize dynamic motion, impact effects, speed lines, particle effects
- Style: ${styleDesc}
- Keep each prompt under 300 words, in English
- Output ONLY valid JSON array`;

  const userPrompt = `Characters:\n${charSummary}\n\nScenes:\n${sceneSummary}\n\nGenre: ${genre}\n\nGenerate a JSON array of video prompts. Each element: { "index": <scene number starting from 0>, "prompt": "<detailed video prompt in English>", "camera": "<camera movement description>", "duration_hint": <suggested seconds 5-10> }\n\nReturn ONLY the JSON array, no markdown.`;

  const raw = await callLLM(systemPrompt, userPrompt);
  // 解析 JSON
  const cleaned = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
  const jsonMatch = cleaned.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error('LLM 返回格式异常');
  return JSON.parse(jsonMatch[0]);
}

module.exports = { executePipeline, getPipeline };
