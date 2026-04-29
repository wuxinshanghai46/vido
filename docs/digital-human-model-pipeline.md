# VIDO 数字人生成 · 全链路模型调用清单

> 一次"完整出片"（形象 → 验证 → 写稿 → 拆分 → 驱动 → 字幕）总共调 LLM/图像/语音/视频模型 **6~9 次**。
> 本文精准到"每步调哪个模型、调几次、走什么接口"。

---

## 总览（按用户 UX 顺序）

| 步骤 | 前端按钮 / 动作 | 后端路由 | 调用模型 | 次数 |
|---|---|---|---|---|
| 1a | Step1 · ✨ AI 补充描述（弹窗） | `POST /api/dh/describe/enhance` | **LLM**（DeepSeek `deepseek-chat` 或 settings 里 `use='story'` 的模型） | 1 |
| 1b | Step1 · ✨ 生成形象 | `POST /api/dh/images/generate` | **Ark Seedream 5.0**（`doubao-seedream-5-0-260128`） | 1 |
| 1c | Step1 · 📤 上传照片 → 自动识别性别 | `POST /api/dh/images/detect-gender` | **视觉 LLM**（智谱 `glm-4v-flash` ▶ 回退 OpenAI `gpt-4o-mini`） | 1 |
| 1d | Step1 · 🎬 生成动态预览（样片） | `POST /api/dh/samples/generate` → `/api/avatar/jimeng-omni/generate` | **Jimeng Omni v1.5**（火山 `jimeng_vgfm_t2v_l20`）+ **TTS** 1 次 | 1 Omni + 1 TTS |
| 2 | Step2 · 我的形象 · 🎬 生成视频素材（可选升级） | `POST /api/dh/my-avatars/:id/promote-to-video` | 同 1d | 1 Omni + 1 TTS |
| 3a | Step3 · ✨ AI 写稿（弹窗） | `POST /api/dh/scripts/write` | **LLM**（同 1a） | 1 |
| 3b | Step3 · 🧩 按秒拆分（AI 写稿完自动触发 / 或手动） | `POST /api/dh/scripts/segment` | **LLM** 返 JSON 分段 | 1 |
| 3c | Step3 · 🎬 生成数字人视频 | `POST /api/dh/videos/generate` → `/api/avatar/jimeng-omni/generate` | **Jimeng Omni v1.5**（驱动说话） + **TTS** 1 次 | 1 Omni + 1 TTS |
| 3d | 字幕烧录（开关 ON 时在 Omni 出片后叠加） | 内部 `_applyAvatarPostEffects` | **纯 FFmpeg drawtext**，不调模型 | 0 |

---

## 单路径总计

**路径 A · 快速路径**（文生图 → 跳过样片 → 直接写稿出片）  
= 1 LLM（描述） + 1 Seedream + 1 LLM（写稿） + 1 LLM（分段） + 1 Omni + 1 TTS  
≈ **6 次模型调用**

**路径 B · 完整路径**（含动态预览验证 + 促图转视频）  
= 路径 A + 1 Omni（样片）+ 1 TTS（样片） + 0~1 Omni（promote 升级）  
≈ **8~9 次模型调用**

**路径 C · 上传路径**（上传自己照片 → 不走 Seedream）  
= 1 视觉 LLM（性别）+ 1 Omni（样片）+ 1 TTS + 1 LLM（写稿）+ 1 LLM（分段）+ 1 Omni + 1 TTS  
≈ **7 次模型调用**

---

## 每一步详解

### 1a · AI 补充描述（可选）
- 走 `storyService.callLLM(sys, user, {kb:{scene:'digital_human_portrait'}})`
- 系统优先级：**settings 里 `use='story'` 的 provider** ▶ DEEPSEEK_API_KEY ▶ OPENAI ▶ CLAUDE
- 你生产上实配的是 DeepSeek `deepseek-chat`
- 耗时 2-5 秒，输入用户关键词，输出 180-260 字中文详细视觉描述

### 1b · 文生图（Seedream 5.0）
- Ark (火山引擎) endpoint: `https://ark.cn-beijing.volces.com/api/v3/images/generations`
- `model: 'doubao-seedream-5-0-260128'`（唯一可用版本，4.x 已下线）
- 图像尺寸必须 **≥ 3,686,400 像素**（9:16 用 1536×2688 = 4.13M 保证过审）
- `watermark:false` + `cropBottomPx:100` 裁掉底部水印条
- 耗时 10-20 秒，输出 1 张 PNG

### 1c · 上传照片 → 识别性别
- 优先 **zhipu glm-4v-flash**（免费 quota 多）
- 回退 **openai gpt-4o-mini**
- 都没 key → 返回 unknown，前端用用户手选
- Prompt 是 `只回答 male/female/unknown`，0 温度
- 耗时 1-3 秒

### 1d / 2 / 3c · Jimeng Omni（核心驱动引擎）
- **火山即梦 Omni v1.5** —— `jimeng_vgfm_t2v_l20`（CVP 文档 85128/1773810）
- 输入：1 张形象图 + 1 段音频（或文本走内部 TTS）
- 输出：最长 60 秒的 9:16 视频，带真·口型同步
- 单次并发限制：1（免费账户）— 可在火山控制台升到 3+
- 耗时 1-3 分钟
- 附加：
  - Jimeng 有"文本即可"模式（内部先走 TTS 生成音频）
  - 支持 `speed` 参数、`doMatting` 后置抠像换背景
  - 成品存 24h，后台自动下载到 `outputs/jimeng-assets/omni_<taskId>.mp4` 永久化

### 1d / 2 / 3c 里的 TTS（多家回退链）
火山 → 智谱 → 讯飞 → 百度 → 阿里 → Fish Audio → MiniMax → ElevenLabs → OpenAI → SAPI
- `ttsService.generateSpeech()` 按 settings 的 `use='tts'` + `test_status!='error'` 过滤
- 克隆音色 (`custom_xxx`) 走 `_generateWithCustomVoice` 分支，对接火山 mega_tts 或 Fish ref_id
- 你生产实际用的 TTS 首选：**火山引擎 mega_tts**（247ms · 状态 ok）

### 3a · AI 写稿
- 同 1a，用 `scene:'avatar_script'` KB 提升相关度
- 根据 `duration_sec` 按 4 字/秒估算目标字数，±10 字裁切
- 风格：tutorial/promo/story/knowledge/news/daily 6 选 1

### 3b · 按秒拆分
- 同 LLM，要求返回严格 JSON：`[{text, expression, motion}]`
- 解析失败回退正则按句号/感叹号切
- 前端按 4 字/秒算 start/end 时间戳，展示成"时间轴"，可逐段编辑动作

### 3d · 字幕烧录
- **不调模型**，纯 FFmpeg `drawtext` 逐段叠文字
- `src/services/effectsService.js::applyEffects` → `buildDrawText`
- 支持用户传 fontSize / color / outlineColor（本次修复：`_applyAvatarPostEffects` 透传）

---

## 成本估算（一次完整出片）

| 模型 | 单次成本（2026-04 阿里/火山付费价） | 出现次数 | 小计 |
|---|---|---|---|
| DeepSeek chat（描述+写稿+分镜） | ¥0.001 / 千字 | 3 | 约 ¥0.01 |
| 智谱 GLM-4V-Flash | 免费额度 | 1 | ¥0 |
| Ark Seedream 5.0 | ¥0.18 / 张 | 1-2 | ¥0.18 ~ ¥0.36 |
| Jimeng Omni v1.5 | 约 ¥0.80 / 30s视频 | 1-2 | ¥0.80 ~ ¥1.60 |
| 火山 mega_tts | ¥0.0004 / 字 | 1-2 | ¥0.10 ~ ¥0.20 |
| FFmpeg 字幕 | 本地算力 | 1 | ¥0 |
| **合计·快速路径** | | | **≈ ¥1.10** |
| **合计·完整路径（含样片）** | | | **≈ ¥2.00 ~ ¥2.50** |

---

## 可切换的备用引擎

在 `/api/dh/status` 返回的 5 个引擎里：
- `seedream` = 主打文生图（唯一）
- `jimeng_omni` = 主打驱动（**本平台默认**）
- `wan_animate` = 阿里百炼 Wan 2.2-Animate（备用，需 DASHSCOPE_API_KEY），优势：带模板视频驱动，口型/动作/表情一体化
- `hifly_free` = 飞影免费（走 Coze bot，公共形象库，兜底）
- `hifly_paid` = 飞影 REST Token，备份通路

---

## 限制 / 踩坑

1. **火山 Omni 单并发**：1 个槽被占则排队，建议升至 3+
2. **Omni 60s 上限**：台词超 200 字（≈60s）要手动拆场景
3. **Seedream 尺寸门槛**：任意 9:16 必须 ≥ 3.68M 像素，1152×2048 已不够
4. **CDN 过期**：Jimeng 返回的 `video_url` 24h 过期，后台已自动拷贝本地
5. **字幕中文字体**：服务器 `/data/vido/app/outputs` 走 FFmpeg 内建字体，`抖音美好体` 不在服务器上会自动回退到思源黑体
