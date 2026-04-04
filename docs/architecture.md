# VIDO AI 视频生成平台 — 架构与产品设计文档

> 版本: 1.0 | 日期: 2026-03-19

---

## 目录

1. [产品概述](#1-产品概述)
2. [系统架构总览](#2-系统架构总览)
3. [技术栈](#3-技术栈)
4. [目录结构](#4-目录结构)
5. [后端架构](#5-后端架构)
6. [前端架构](#6-前端架构)
7. [核心业务流程](#7-核心业务流程)
8. [AI 供应商体系](#8-ai-供应商体系)
9. [数据模型](#9-数据模型)
10. [认证与权限](#10-认证与权限)
11. [API 设计](#11-api-设计)
12. [设计系统](#12-设计系统)
13. [部署与运维](#13-部署与运维)

---

## 1. 产品概述

### 1.1 产品定位

VIDO AI 是一个全栈 AI 视频创作平台，提供从剧本生成到视频合成的端到端自动化流程。用户只需输入主题和风格，平台即可自动完成故事创作、角色设计、场景绘制、视频生成、配音合成、字幕烧制和背景音乐混音。

### 1.2 核心功能模块

| 模块 | 说明 | 状态 |
|------|------|------|
| **AI 视频** | 全流程视频生成（剧本→视频） | 已上线 |
| **AI 数字人** | 数字人形象驱动的视频 | 已上线 |
| **图生视频 (I2V)** | 上传图片生成视频 | 已上线 |
| **AI 图片** | 独立图片生成工具 | 已上线 |
| **AI 小说** | AI 长篇小说生成 | 已上线 |
| **AI 形象** | AI 角色/人像形象生成 | 已上线 |
| **AI 漫画** | AI 漫画生成 | 已上线 |
| **视频编辑器** | 场景裁剪/重排/字幕/音乐 | 已上线 |
| **素材库** | 用户素材管理 | 已上线 |
| **社交发布** | 多平台发布（YouTube/TikTok 等） | 开发中 |
| **管理后台** | 用户/角色/供应商/积分管理 | 已上线 |

### 1.3 目标用户

- **内容创作者**：快速生产短视频内容
- **企业营销团队**：批量生产营销视频
- **个人开发者**：集成 AI 视频能力
- **教育从业者**：制作教学动画

---

## 2. 系统架构总览

```
┌──────────────────────────────────────────────────────────────────┐
│                        客户端 (Browser)                          │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐           │
│  │ Studio   │ │ Editor   │ │ Login    │ │ Admin    │           │
│  │ (SPA)    │ │          │ │          │ │          │           │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘           │
│       │ authFetch() │ fetch()    │             │                │
└───────┼─────────────┼────────────┼─────────────┼────────────────┘
        │ HTTP/SSE    │            │             │
┌───────┼─────────────┼────────────┼─────────────┼────────────────┐
│       ▼             ▼            ▼             ▼                │
│  ┌──────────────────────────────────────────────────┐           │
│  │              Express.js Server (:3007)            │           │
│  │  ┌─────────────────────────────────────────────┐  │           │
│  │  │           Middleware Layer                   │  │           │
│  │  │  CORS → CookieParser → Auth → Credits      │  │           │
│  │  └──────────────────┬──────────────────────────┘  │           │
│  │                     │                              │           │
│  │  ┌─────────────────────────────────────────────┐  │           │
│  │  │            Route Layer (15 routers)          │  │           │
│  │  │  auth│projects│story│editor│settings│i2v    │  │           │
│  │  │  avatar│imggen│novel│portrait│comic│assets  │  │           │
│  │  │  admin│publish│sync                         │  │           │
│  │  └──────────────────┬──────────────────────────┘  │           │
│  │                     │                              │           │
│  │  ┌─────────────────────────────────────────────┐  │           │
│  │  │          Service Layer (17 services)         │  │           │
│  │  │  story│video│image│tts│ffmpeg│project       │  │           │
│  │  │  settings│edit│motion│avatar│portrait       │  │           │
│  │  │  comic│novel│publish│sync│sora│slang        │  │           │
│  │  └──────────────────┬──────────────────────────┘  │           │
│  │                     │                              │           │
│  │  ┌─────────────────────────────────────────────┐  │           │
│  │  │           Model Layer (3 stores)             │  │           │
│  │  │  database.js │ authStore.js │ editStore.js   │  │           │
│  │  └──────────────────┬──────────────────────────┘  │           │
│  └─────────────────────┼──────────────────────────────┘           │
│                        │                                         │
│  ┌─────────────────────▼──────────────────────────────┐          │
│  │              File System Storage                    │          │
│  │  outputs/vido_db.json  │ outputs/auth_db.json      │          │
│  │  outputs/edit_db.json  │ outputs/settings.json     │          │
│  │  outputs/projects/     │ outputs/characters/       │          │
│  │  outputs/voice/        │ outputs/music/            │          │
│  └────────────────────────────────────────────────────┘          │
│                        Node.js Server                            │
└──────────────────────────────────────────────────────────────────┘
        │                    │                    │
        ▼                    ▼                    ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────────┐
│  LLM APIs    │  │  Video APIs  │  │  TTS / Image     │
│  DeepSeek    │  │  FAL.ai      │  │  火山/百度/阿里  │
│  OpenAI      │  │  Runway      │  │  讯飞/Fish/11Labs│
│  Claude      │  │  Luma/Kling  │  │  即梦/Replicate  │
│  Qwen        │  │  MiniMax     │  │  Stability/DALL-E│
│              │  │  Zhipu/Veo   │  │                  │
│              │  │  Pika/Sora   │  │                  │
└──────────────┘  └──────────────┘  └──────────────────┘
```

---

## 3. 技术栈

| 层级 | 技术 | 说明 |
|------|------|------|
| **运行时** | Node.js v24 | 无 native addon 依赖 |
| **Web 框架** | Express.js 4.18 | 路由、中间件、静态文件 |
| **数据库** | JSON 文件 | 零依赖，outputs/*.json |
| **视频处理** | fluent-ffmpeg + ffmpeg-static | npm 内置，无需手动安装 |
| **认证** | 自实现 JWT | crypto 模块，无外部依赖 |
| **AI SDK** | openai npm | 兼容 OpenAI 协议的供应商统一调用 |
| **HTTP 客户端** | axios | 非 OpenAI 协议的 API 调用 |
| **文件上传** | multer | 多文件上传处理 |
| **前端** | 原生 JS + CSS | 无框架、无构建工具 |
| **实时通信** | SSE (Server-Sent Events) | 进度推送 |

**关键约束**：
- Windows 环境，无 Visual Studio，禁止 native addon
- 无 `@anthropic-ai/sdk`，Claude 通过原生 HTTPS 调用
- 无前端构建步骤，直接 serve 静态文件

---

## 4. 目录结构

```
vido/
├── src/
│   ├── server.js                  # Express 入口，路由注册，端口 3007
│   ├── middleware/
│   │   ├── auth.js                # JWT 认证、角色权限、Token 刷新
│   │   └── credits.js             # 积分检查与扣减
│   ├── models/
│   │   ├── database.js            # 主 JSON 数据库（项目/故事/视频/任务）
│   │   ├── authStore.js           # 用户/角色/积分/Token 管理
│   │   └── editStore.js           # 编辑器数据存储
│   ├── routes/                    # 15 个路由文件
│   │   ├── auth.js                # 登录/注册/Token 刷新/登出
│   │   ├── projects.js            # 项目 CRUD + 全流程管理
│   │   ├── story.js               # 故事生成/脚本解析/角色图生
│   │   ├── editor.js              # 视频编辑（裁剪/字幕/音乐）
│   │   ├── settings.js            # AI 供应商配置（25+ 预设）
│   │   ├── i2v.js                 # 图生视频任务管理
│   │   ├── avatar.js              # 数字人视频
│   │   ├── imggen.js              # 图片生成
│   │   ├── portrait.js            # AI 形象
│   │   ├── comic.js               # 漫画生成
│   │   ├── novel.js               # AI 小说
│   │   ├── assets.js              # 素材库
│   │   ├── admin.js               # 管理后台
│   │   ├── publish.js             # 社交发布
│   │   └── sync.js                # 数据同步
│   └── services/                  # 17 个业务服务
│       ├── storyService.js        # LLM 故事生成（DeepSeek/OpenAI/Claude）
│       ├── videoService.js        # 48 个视频模型代理
│       ├── imageService.js        # 角色/场景图生成
│       ├── ttsService.js          # 9 层优先级 TTS
│       ├── ffmpegService.js       # 视频合成 + 后处理特效
│       ├── projectService.js      # 全流程 Pipeline + SSE 推送
│       ├── settingsService.js     # 供应商配置 + API Key 管理
│       ├── editService.js         # 编辑器后端逻辑
│       ├── motionService.js       # FBX 动作资源索引
│       ├── avatarService.js       # 数字人服务
│       ├── portraitService.js     # 形象生成
│       ├── comicService.js        # 漫画生成
│       ├── novelService.js        # 小说生成
│       ├── publishService.js      # 社交发布
│       ├── syncService.js         # 数据同步
│       ├── soraService.js         # Sora 特化
│       └── slangService.js        # 网络用语库
├── public/                        # 前端 SPA
│   ├── index.html                 # 主应用（Studio 布局）
│   ├── login.html                 # 登录注册页
│   ├── admin.html                 # 管理后台
│   ├── editor.html                # 视频编辑器
│   ├── js/
│   │   ├── app.js                 # 核心 UI 逻辑（5000+ 行）
│   │   ├── auth.js                # 认证流程
│   │   ├── admin.js               # 管理后台
│   │   └── editor.js              # 编辑器交互
│   └── css/
│       ├── style.css              # 主样式（204KB）
│       ├── login.css              # 登录样式
│       ├── admin.css              # 管理样式
│       └── editor.css             # 编辑器样式
├── outputs/                       # 数据与媒体存储
│   ├── vido_db.json               # 主数据库
│   ├── auth_db.json               # 用户数据库
│   ├── edit_db.json               # 编辑数据库
│   ├── settings.json              # 供应商配置
│   ├── projects/                  # 生成的视频
│   ├── characters/                # 角色形象图
│   ├── scenes/                    # 场景图
│   ├── music/                     # 上传的音乐
│   ├── voice/                     # TTS 语音
│   ├── avatar/                    # 数字人文件
│   ├── portraits/                 # 生成的形象
│   ├── i2v_images/                # 图生视频上传图
│   └── i2v_videos/                # 图生视频结果
├── .env                           # 环境变量
├── package.json                   # 依赖
└── CLAUDE.md                      # 开发说明
```

---

## 5. 后端架构

### 5.1 分层设计

```
Request → Middleware → Route → Service → Model/External API → Response
```

**四层职责分离**：

| 层 | 职责 | 示例 |
|---|------|------|
| **Middleware** | 认证、权限、积分预检 | `authenticate`, `requireRole`, `requireCredits` |
| **Route** | 请求解析、参数校验、响应格式化 | `routes/projects.js` |
| **Service** | 业务逻辑、外部 API 调用、流程编排 | `projectService.runFullPipeline()` |
| **Model** | 数据读写、CRUD | `database.insertProject()` |

### 5.2 路由注册与访问控制

路由在 `server.js` 中按权限级别分层注册：

```
公开路由（无需认证）
├── /api/auth          登录/注册/刷新
├── /api/health        健康检查
├── /api/showcase/*    登录页展示
└── 媒体文件流          img/audio 标签直接访问

认证路由（authenticate 中间件）
├── /api/projects      项目管理
├── /api/story         故事/脚本
├── /api/editor        编辑器
├── /api/assets        素材库
└── /api/publish       社交发布

权限路由（requirePermission 中间件）
├── /api/i2v           图生视频（权限: i2v）
├── /api/avatar        数字人（权限: avatar）
├── /api/imggen        图片生成（权限: imggen）
├── /api/novel         小说（权限: novel）
├── /api/comic         漫画（权限: comic）
└── /api/portrait      形象（权限: portrait）

管理路由（requireRole('admin') 中间件）
├── /api/settings      供应商配置
├── /api/sync          数据同步
└── /api/admin         管理后台
```

### 5.3 中间件链

```
CORS → express.json → express.static → cookieParser
  → [公开路由]
  → authenticate → [认证路由]
  → authenticate → requirePermission → [权限路由]
  → authenticate → requireRole('admin') → [管理路由]
  → SPA 回退 (index.html)
```

### 5.4 SSE 实时进度

视频生成等长时间任务通过 SSE 推送进度：

```javascript
// 后端 — projectService.js
emitProgress(projectId, { step: 'video_gen', progress: 0.4, message: '生成场景 3/5...' });

// 前端 — app.js
const sse = new EventSource(`/api/projects/${id}/progress?token=${token}`);
sse.onmessage = (e) => updateUI(JSON.parse(e.data));
```

进度步骤：`story_gen → image_gen → video_gen → audio_gen → merge → music_mix → subtitle → done`

### 5.5 异步任务模式

长时间运行的 AI 任务（视频生成、I2V、数字人）统一采用：

```
POST /generate → 返回 {taskId}
           ↓ (后台异步处理)
GET /tasks/:id → 轮询 {status, progress}
GET /tasks/:id/stream → 结果流播放
```

---

## 6. 前端架构

### 6.1 页面组成

| 页面 | 文件 | 用途 |
|------|------|------|
| **Studio** | index.html + app.js | 核心创作工作台 |
| **Login** | login.html + auth.js | 登录注册 |
| **Editor** | editor.html + editor.js | 视频二次编辑 |
| **Admin** | admin.html + admin.js | 后台管理 |

### 6.2 Studio 布局

```
┌─────────────────────────────────────────────────────────┐
│  TOPNAV: Logo │ 导航菜单 │ 积分 │ 主题切换 │ 用户      │
├─────────┬──────────────────────────────────┬─────────────┤
│ SIDEBAR │  STUDIO                          │  RIGHT      │
│ (224px) │  ┌────────────────────────────┐  │  PANEL      │
│         │  │     Canvas (画布)          │  │  (属性编辑) │
│ 导航菜单 │  │   进度展示 / 视频播放      │  │             │
│         │  └────────────────────────────┘  │  选中角色时: │
│ AI 视频  │  ┌────────────────────────────┐  │  · 名字     │
│ AI 数字人│  │    Timeline (时间轴)       │  │  · 描述     │
│ 图生视频 │  │   场景片段可视化           │  │  · 形象     │
│ AI 图片  │  └────────────────────────────┘  │             │
│ AI 小说  │                                  │  选中场景时: │
│ AI 形象  │  LEFT PANEL (4 tabs):            │  · 标题     │
│ AI 漫画  │  ┌────┬────┬────┬────┐          │  · 动作类型  │
│ ──────── │  │脚本│场景│角色│音讯│          │  · VFX      │
│ 我的素材 │  └────┴────┴────┴────┘          │  · 对白     │
│ 我的项目 │                                  │             │
└─────────┴──────────────────────────────────┴─────────────┘
```

### 6.3 状态管理

前端采用全局变量管理状态（无框架）：

```javascript
// 核心状态
currentProjectId       // 当前项目 ID
creationMode           // ai | episodic | batch
characters[]           // 角色数组
customScenes[]         // 自定义场景数组

// 配置状态
selectedVideoProvider  // 视频供应商
selectedVideoModelId   // 视频模型
animStyle              // 动画风格 (14 种)
aspectRatio            // 画面比例
sceneDim / charDim     // 2D / 3D

// 音频状态
voiceEnabled, voiceGender, voiceSpeed, selectedVoiceId
subtitleEnabled, subtitleSize, subtitlePosition, subtitleColor

// 同步函数
syncCharProp(field, value)   // 角色属性实时同步到 UI
syncSceneProp(field, value)  // 场景属性实时同步到 UI
```

### 6.4 认证流程

```javascript
async function authFetch(url, options = {}) {
  const token = localStorage.getItem('access_token');
  headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(url, { ...options, headers });
  if (res.status === 401) {
    const refreshed = await refreshAccessToken();
    if (refreshed) return authFetch(url, options); // 重试
    else window.location.href = '/login';          // 跳转登录
  }
  return res;
}
```

### 6.5 动画风格系统

14 种预设风格，影响角色图和视频生成的提示词：

| 风格 ID | 中文名 | 说明 |
|---------|--------|------|
| anime | 日系动漫 | 日本动画风格 |
| realistic | 电影写实 | 真实质感 |
| 3dcg | 3D CG | 三维渲染 |
| concept | 概念艺术 | 游戏/电影概念画 |
| battle | 战斗动漫 | 热血战斗风 |
| ink | 水墨 | 中国传统水墨 |
| cyberpunk | 赛博朋克 | 未来科技风 |
| ghibli | 吉卜力 | 宫崎骏风格 |
| xianxia | 仙侠 | 中国仙侠 |
| wuxia | 武侠 | 中国武侠 |
| guoman | 国漫 | 中国动漫 |
| guofeng_3d | 3D 国风 | 三维中国风 |
| ink_battle | 水墨战斗 | 水墨 + 战斗 |

---

## 7. 核心业务流程

### 7.1 视频生成全流程 Pipeline

```
用户输入 (主题/风格/时长/角色...)
        │
        ▼
┌─ 1. 故事生成 [5%] ──────────────────────────────────┐
│  storyService.generateStory()                        │
│  LLM (DeepSeek / OpenAI / Claude) → JSON 故事结构    │
│  输出: title, synopsis, scenes[], characters[]       │
└──────────────────────────────────────────────────────┘
        │
        ▼
┌─ 2. 角色/场景图生成 [15%] ──────────────────────────┐
│  imageService.generateCharacterImage() (并行)        │
│  imageService.generateSceneImage() (并行)            │
│  即梦 / Replicate / Stability / OpenAI               │
│  输出: outputs/characters/*.png, outputs/scenes/*.png│
└──────────────────────────────────────────────────────┘
        │
        ▼
┌─ 3. 视频片段生成 [60%] ─────────────────────────────┐
│  FOR EACH scene:                                     │
│    buildMotionPrompt() → 融合动作描述 + VFX          │
│    videoService.generateVideoClip()                  │
│    → 异步调用视频 API → 轮询状态 → 下载              │
│    ffmpegService.applyPostVFX() → 后处理特效         │
│  输出: 每场景一个 .mp4                                │
└──────────────────────────────────────────────────────┘
        │
        ▼
┌─ 4. TTS 配音 [10%] ─────────────────────────────────┐
│  FOR EACH scene.dialogue:                            │
│    ttsService.generateSpeech()                       │
│    9 层优先级自动选择供应商                            │
│  输出: outputs/voice/*.wav                            │
└──────────────────────────────────────────────────────┘
        │
        ▼
┌─ 5. 合成与混音 [10%] ───────────────────────────────┐
│  a) 视频 + TTS → addAudioToVideo()                   │
│  b) 所有场景 → mergeVideoClips() → 合并              │
│  c) 背景音乐 → mixMusicIntoVideo()                   │
│  d) 字幕 → burnSubtitle()                            │
│  输出: outputs/projects/{id}_final.mp4               │
└──────────────────────────────────────────────────────┘
        │
        ▼
    完成 [100%] → 前端播放/下载
```

### 7.2 故事生成子流程

```
输入: theme, genre, duration, language
        │
        ├─ mode: 'quick'   → AI 自动生成完整故事
        ├─ mode: 'custom'  → 用户提供大纲，AI 扩展
        └─ mode: 'script'  → 用户粘贴剧本，AI 解析为结构化场景
                │
                ▼
        LLM 调用（带 JSON Schema 约束）
                │
                ▼
        输出 JSON:
        {
          title, synopsis,
          scenes: [{
            index, title, duration, location, time_of_day,
            characters, action, action_type, vfx[],
            dialogue, mood, camera, visual_prompt
          }]
        }
```

**action_type 分类**：normal, combat, ranged, chase, explosion, power, stealth, aerial
**vfx 标签**：shockwave, sparks, fire, lightning, smoke, blood, glow, energy_beam...

### 7.3 视频编辑流程

```
编辑器打开 → GET /api/editor/:id → 加载 project + clips + edit data
        │
        ├─ 调整场景顺序 (scenes_order)
        ├─ 裁剪场景 (scene_trims)
        ├─ 删除场景 (deleted_scenes)
        ├─ 添加字幕 (dialogues)
        ├─ 上传音乐 (music)
        └─ 静音原始音频 (muted_audio)
        │
        ▼ (实时保存: PUT /api/editor/:id)
        │
渲染 → POST /api/editor/:id/render → FFmpeg 重新合成
```

---

## 8. AI 供应商体系

### 8.1 供应商管理架构

```
.env (初始 API Key)
    │ seedFromEnv()
    ▼
outputs/settings.json (运行时配置)
    │ settingsService
    ▼
┌────────────────────────────────┐
│  Provider                      │
│  ├─ id, name, api_url, api_key │
│  ├─ enabled, last_tested       │
│  └─ models[]                   │
│     ├─ id, name, type          │
│     ├─ use: story|image|video  │
│     │       |tts|avatar        │
│     └─ enabled                 │
└────────────────────────────────┘
```

### 8.2 视频模型全景 (48 个模型)

| 供应商 | 模型 | 特点 |
|--------|------|------|
| **FAL.ai** | Wan 2.2/2.1, Kling 1.6, LTX-2, HunyuanVideo | 代理路由，多模型聚合 |
| **Runway** | Gen-4.5, Gen-4, Gen-3 Turbo | 好莱坞级画质 |
| **Luma AI** | Ray-3, Ray-2 | 光影细腻 |
| **Vidu** | Q3, Q3 写实 | 极快生成 |
| **MiniMax** | Hailuo 2.3, Video-01 Director | 动漫最佳 |
| **Kling** | v3 (4K/60fps), v2 Master, v2.5 Turbo | 高分辨率 |
| **Zhipu** | CogVideoX-Flash | 国内免费 |
| **即梦** | 文/图生视频 3.0 Pro/标准/Lite | 中文理解强 |
| **Pika** | 2.1, 2.0, 1.5 | 风格化 |
| **Seedance** | 1.x, 2.0 | 角色一致性最强 |
| **Google Veo** | 3.1, 3.0 | Google 视频模型 |
| **OpenAI Sora** | 2-Pro, 2, 2-Mini | OpenAI 视频模型 |
| **Demo** | FFmpeg 占位 | 无需 API，本地测试 |

### 8.3 TTS 供应商优先级

```
1. 火山引擎 (豆包) — 中文最自然，丰富音色
2. 百度语音         — 国内稳定
3. 阿里 CosyVoice   — 声音克隆
4. Fish Audio        — 开源社区
5. MiniMax TTS       — 海螺
6. 科大讯飞          — WebSocket 实时
7. ElevenLabs        — 多语言最佳
8. OpenAI TTS        — 通用英文
9. Windows SAPI      — 本地免费兜底
```

### 8.4 故事生成 LLM 优先级

```
settings.json 中 use='story' 的模型 (最高优先级)
    ↓ 未配置
.env DEEPSEEK_API_KEY → deepseek-chat
    ↓ 未配置
.env OPENAI_API_KEY → gpt-4o
    ↓ 未配置
.env CLAUDE_API_KEY → claude-sonnet-4-6 (原生 HTTPS)
```

### 8.5 图片生成供应商

```
即梦 AI (推荐，中文) → Replicate (Flux.1) → Stability (SD 3.5)
→ OpenAI (DALL-E 3) → HuggingFace → Zhipu (CogView) → Demo (占位)
```

---

## 9. 数据模型

### 9.1 数据库文件

| 文件 | 用途 | 管理层 |
|------|------|--------|
| `outputs/vido_db.json` | 项目/故事/视频/任务 | database.js |
| `outputs/auth_db.json` | 用户/角色/积分 | authStore.js |
| `outputs/edit_db.json` | 编辑器数据 | editStore.js |
| `outputs/settings.json` | AI 供应商配置 | settingsService.js |

### 9.2 核心实体

#### Project (项目)
```javascript
{
  id: UUID,
  user_id: UUID,
  type: 'original',
  title: String,
  theme: String,
  genre: 'drama|action|comedy|horror|scifi|...',
  duration: Number,           // 秒
  mode: 'quick|custom|script',
  status: 'pending|processing|done|failed',
  anim_style: String,         // 14 种风格
  aspect_ratio: '16:9|9:16|1:1',
  scene_dim: '2d|3d',
  char_dim: '2d|3d',
  video_provider: String,
  video_model: String,
  // 音频
  voice_enabled: Boolean,
  voice_gender: 'female|male',
  voice_speed: Number,
  music_path: String,
  music_volume: Number,
  // 字幕
  subtitle_enabled: Boolean,
  subtitle_size: Number,
  subtitle_position: String,
  subtitle_color: String,
  // 多集
  creation_mode: 'ai|episodic|batch',
  episode_count: Number,
  episode_index: Number,
  previous_summary: String,
  // 时间戳
  created_at: ISO8601,
  updated_at: ISO8601
}
```

#### Story (故事)
```javascript
{
  id: UUID,
  project_id: UUID,
  title: String,
  synopsis: String,
  full_script: String,
  scenes_json: [{
    index: Number,
    title: String,
    duration: Number,
    location: String,
    time_of_day: String,
    characters: [String],
    action: String,
    action_type: 'normal|combat|ranged|chase|explosion|power|stealth|aerial',
    vfx: [String],
    dialogue: String,
    mood: String,
    camera: String,
    visual_prompt: String    // 英文 Cinematic 提示词
  }],
  created_at: ISO8601
}
```

#### User (用户)
```javascript
{
  id: UUID,
  username: String,
  email: String,
  password_hash: String,     // scrypt
  password_salt: String,
  role: 'admin|vip|user',
  credits: Number,
  status: 'active|disabled',
  allowed_models: [String],  // 模型白名单
  theme: 'purple|cyan|...',
  created_at, updated_at, last_login
}
```

#### Role (角色)
```javascript
{
  id: String,
  label: String,
  permissions: ['create', 'generate', 'edit', 'i2v', 'avatar', ...],
  default_credits: Number,
  allowed_models: ['*'] | [String],
  max_projects: Number
}
```

### 9.3 内置角色

| 角色 | 权限 | 积分 | 可用模型 | 项目数 |
|------|------|------|----------|--------|
| admin | * | 99999 | 全部 | 无限 |
| vip | 除管理外全部 | 5000 | 全部 | 100 |
| user | create/generate/edit/novel | 100 | demo/deepseek/cogvideox/cogview | 10 |

---

## 10. 认证与权限

### 10.1 认证流程

```
注册 → scrypt(password + salt) → 存储 hash
登录 → 验证 hash → 签发 JWT (24h) + Refresh Token (7d)
请求 → Authorization: Bearer <JWT> → authenticate 中间件验证
过期 → 前端自动 refresh → 新 JWT
```

### 10.2 权限模型 (RBAC)

```
User ──has──▶ Role ──has──▶ Permissions[]
  │                            │
  └── allowed_models[]         ├── 'create'
                               ├── 'generate'
                               ├── 'edit'
                               ├── 'i2v'
                               ├── 'avatar'
                               ├── 'imggen'
                               ├── 'novel'
                               ├── 'comic'
                               ├── 'portrait'
                               └── '*' (全部)
```

### 10.3 积分系统

| 操作 | 基础消耗 | 高级模型消耗 |
|------|----------|-------------|
| 故事生成 | 5 | — |
| 图片生成 | 10 | — |
| 视频生成 | 50 | 100 |
| TTS 配音 | 5 | — |
| 图生视频 | 50 | — |
| 数字人 | 30 | — |
| 小说 | 5 | — |

**高级模型**：sora-2-pro, gen4.5-turbo, veo-3.1, kling-v3, luma-ray-3 等

---

## 11. API 设计

### 11.1 统一响应格式

```javascript
// 成功
{ success: true, data: { ... } }

// 失败
{ success: false, error: "错误描述", code: 400|401|403|404|500 }
```

### 11.2 端点总览 (50+)

#### 认证 `/api/auth`
| Method | Path | 说明 | 权限 |
|--------|------|------|------|
| POST | /login | 登录 | 公开 |
| POST | /register | 注册 | 公开 |
| POST | /refresh | 刷新 Token | 公开 |
| POST | /logout | 登出 | 公开 |
| POST | /change-password | 修改密码 | 认证 |

#### 项目 `/api/projects`
| Method | Path | 说明 | 权限 |
|--------|------|------|------|
| POST | / | 创建项目+启动全流程 | 认证 |
| GET | / | 项目列表 | 认证 |
| GET | /:id | 项目详情 | 认证 |
| GET | /:id/progress | SSE 实时进度 | 认证 |
| GET | /:id/stream | 视频流播放 | 认证 |
| GET | /:id/download | 下载视频 | 认证 |
| GET | /:id/clips/:clipId/stream | 片段播放 | 认证 |
| POST | /upload-music | 上传音乐 | 认证 |

#### 故事 `/api/story`
| Method | Path | 说明 | 权限 |
|--------|------|------|------|
| POST | /generate | 预览故事 | 认证 |
| POST | /parse-script | 解析剧本 | 认证 |
| POST | /refine-scene | 优化场景 | 认证 |
| POST | /generate-character-image | 单个角色图 | 认证 |
| POST | /generate-character-images | 批量角色图 | 认证 |
| GET | /character-image/:filename | 获取角色图 | 认证 |
| GET | /voices | TTS 音色列表 | 认证 |
| POST | /preview-voice | 语音试听 | 认证 |

#### 编辑器 `/api/editor`
| Method | Path | 说明 | 权限 |
|--------|------|------|------|
| GET | /:id | 编辑数据 | 认证 |
| PUT | /:id | 保存编辑 | 认证 |
| POST | /:id/music | 上传音乐 | 认证 |
| POST | /:id/render | 渲染视频 | 认证 |
| GET | /:id/stream | 播放渲染结果 | 认证 |
| GET | /:id/download | 下载渲染结果 | 认证 |

#### 设置 `/api/settings`
| Method | Path | 说明 | 权限 |
|--------|------|------|------|
| GET | / | 全部设置 | Admin |
| GET | /presets | 预设模板 | Admin |
| POST | /providers | 新增供应商 | Admin |
| PUT | /providers/:id | 更新供应商 | Admin |
| DELETE | /providers/:id | 删除供应商 | Admin |
| POST | /providers/:id/models | 添加模型 | Admin |
| DELETE | /providers/:id/models/:mid | 删除模型 | Admin |
| POST | /providers/:id/test | 测试连接 | Admin |
| POST | /providers/refresh-all | 批量刷新 | Admin |

#### 图生视频 `/api/i2v`
| Method | Path | 说明 | 权限 |
|--------|------|------|------|
| POST | /upload-image | 上传图片 | i2v |
| POST | /generate | 启动任务 | i2v |
| GET | /tasks | 任务列表 | i2v |
| GET | /tasks/:id | 任务详情 | i2v |
| GET | /tasks/:id/stream | 结果播放 | i2v |
| GET | /tasks/:id/download | 下载结果 | i2v |
| DELETE | /tasks/:id | 删除任务 | i2v |

#### 其他模块
- `/api/avatar` — 数字人（上传形象/音频、生成、任务管理）
- `/api/imggen` — 图片生成
- `/api/novel` — AI 小说
- `/api/portrait` — AI 形象
- `/api/comic` — AI 漫画
- `/api/assets` — 素材库
- `/api/admin` — 管理后台（用户/角色 CRUD）
- `/api/publish` — 社交发布
- `/api/sync` — 数据同步

---

## 12. 设计系统

### 12.1 色彩体系 (Mochiani 风格)

```css
/* 背景层级 */
--bg:      #0D0E12    /* 最深，全局背景 */
--bg2:     #141519    /* 次级，面板背景 */
--bg3:     #1E2025    /* 三级，卡片/输入框 */

/* 文字 */
--text:    #FFFFFF
--text2:   #A0A0A0    /* 次级文字 */

/* 强调色 */
--cyan:    #21FFF3    /* 主强调 */
--yellow:  #FFF600    /* 辅助强调 */

/* 渐变 */
--gradient: linear-gradient(135deg, #CBFFF8, #21FFF3, #FFF600)

/* 边框 */
--border:  rgba(255,255,255,0.08)
```

### 12.2 组件规范

| 组件 | 规范 |
|------|------|
| **按钮** | border-radius: 999px (Pill 形), 渐变背景 |
| **卡片** | bg3 背景, 12px 圆角, 1px border |
| **输入框** | bg3 背景, 8px 圆角, 无 outline |
| **Sidebar** | 固定 224px 宽, bg2 背景 |
| **面板** | 可收起, 带标题栏 |

### 12.3 主题系统

支持多套主题色切换，存储在用户 profile 中：
- Purple (紫色)
- Cyan (青色，默认)
- 其他自定义主题

---

## 13. 部署与运维

### 13.1 系统要求

| 项目 | 最低要求 |
|------|----------|
| Node.js | v24+ |
| 内存 | 4GB（视频处理） |
| 磁盘 | 20GB+（视频存储） |
| 网络 | 高速（AI API 调用） |

### 13.2 启动

```bash
npm install          # 安装依赖
node src/server.js   # 启动服务
# 访问 http://localhost:3007
```

### 13.3 环境变量

```bash
# 必需
PORT=3007
JWT_SECRET=your_secret_here

# AI 供应商 (至少配一个)
DEEPSEEK_API_KEY=sk-...    # 故事生成
ZHIPU_API_KEY=...          # 免费视频

# 可选
OPENAI_API_KEY=sk-...
CLAUDE_API_KEY=sk-...
REPLICATE_API_KEY=...
VOLCENGINE_TTS_KEY=...
# ... 更多供应商
```

### 13.4 数据备份

所有数据存储在 `outputs/` 目录：
- JSON 数据库文件 → 直接复制
- 媒体文件 → 按目录备份
- 配置文件 → settings.json

### 13.5 安全注意事项

- 生产环境必须修改 `JWT_SECRET`
- 修改默认 admin 密码
- API Key 在前端接口中自动掩码
- 文件上传限制 50MB
- 文件路径使用 basename 防注入

---

*文档生成时间: 2026-03-19*
