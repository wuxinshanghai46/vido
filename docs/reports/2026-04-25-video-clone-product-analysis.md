# VIDO「视频克隆」功能产品需求分析报告

**版本**：v1.0  **日期**：2026-04-25  **作者**：product_manager agent
**触发**：用户参考抖音 @纳尼《原创视频克隆软件》（v.douyin.com/JmrzKWnn-go）希望在 VIDO 内复刻同款功能

---

## 一、核心能力清单（12 项）

| # | 能力名称 | 输入 → 输出 | 技术依赖 | 产品分类 |
|---|---|---|---|---|
| 1 | **视频转录提取** | 视频文件 → 字幕 JSON + 时间轴 | Whisper STT（或阿里 NLS） | 视频解析 |
| 2 | **画面语义分析** | 视频帧序列 → 场景描述文本 | GPT-4V / Claude Vision 逐帧描述 | 视频理解 |
| 3 | **叙事结构提炼** | 字幕文本 → 爆款结构（钩子/痛点/转折/CTA） | LLM 改写（DeepSeek/GPT/Claude） | 内容分析 |
| 4 | **脚本改写生成** | 原始结构 → 新口播稿（保留节奏，换词换例子） | LLM + 自定义 Prompt 模板 | 文本改写 |
| 5 | **TTS 声音合成** | 新脚本文本 → 全新配音音频 | ttsService（火山/讯飞/MiniMax/ElevenLabs） | 声音伪原创 |
| 6 | **声音克隆（可选）** | 参考人声 + 新脚本 → 克隆音色配音 | CosyVoice 2（阿里）/ MiniMax 声音复刻 | 声音迁移 |
| 7 | **字幕擦除** | 含字幕视频帧 → 干净帧 | FFmpeg + OpenCV inpaint / 百度抠图 | 视频净化 |
| 8 | **画面重新生成** | 场景描述 → 新视觉素材 | imageService（即梦/智谱/FAL）+ videoService（Kling/Seedance） | 视频伪原创 |
| 9 | **数字人口播合成** | 新脚本 + 数字人形象 → 口播视频 | hiflyService / jimengAvatarService / wanAnimateService | 口播替换 |
| 10 | **背景替换** | 原始帧 + 新背景 → 合成帧 | videoMattingPipeline（抠图）+ FFmpeg overlay | 画面改写 |
| 11 | **BGM 替换** | 原始音频 → 提取人声（人声保留/移除）+ 新 BGM | FFmpeg `-af` 人声分离 / musicService | 音频改写 |
| 12 | **最终合成输出** | 新视频片段 + 新配音 + 新字幕 + 新 BGM → 成片 | ffmpegService.mergeVideoClips + burnSubtitle + addAudioToVideo | 合成 |

---

## 二、MVP 最小可行版本

### Must Have

1. **视频上传 + 解析入口**（新路由 `/api/clone/upload`）
2. **STT 转录**（Whisper API 或阿里 NLS，输出带时间戳 SRT）
3. **画面关键帧描述**（每 2 秒抽帧，GPT-4V / Claude Vision 描述）
4. **脚本改写**（LLM 同结构新口播稿，保持段落节奏）
5. **TTS 重配音**（复用 ttsService）
6. **新视觉素材生成**（imageService / videoService）
7. **最终合成**（ffmpegService）
8. **进度 SSE 推送**（7 步透出）

### Nice to Have

- 声音克隆 / 数字人口播替换 / 背景替换 / 字幕样式 / 批量克隆 / 平台去重检测分

### Out of Scope

- 自动抓取他人平台视频
- 人脸替换（DeepFake 法律红线）
- 一键发布到抖音/小红书

---

## 三、在 VIDO 现有系统的集成路径

### 直接复用（零新增）

`ttsService.generateSpeech()` / `ttsService._cloneWithCosyVoice()` / `storyService.callLLM()` / `storyService.parseScript()` / `imageService` / `videoService.generateVideoClip()` / `ffmpegService.mergeVideoClips/burnSubtitle/addAudioToVideo` / `hiflyService` / `jimengAvatarService` / `videoMattingPipeline` / SSE 进度推送（参考 `project-stream.js`）

### 需要新增

| 新模块 | 路径 | 说明 |
|---|---|---|
| `cloneService.js` | `src/services/cloneService.js` | 主 pipeline，串联 STT→分析→改写→生成→合成 |
| `sttService.js` | `src/services/sttService.js` | 封装 Whisper API + 阿里 NLS，输出带时间戳 SRT |
| `frameAnalysisService.js` | `src/services/frameAnalysisService.js` | FFmpeg 抽帧 + Vision LLM 描述 → 场景 JSON |
| `subtitleEraseService.js` | `src/services/subtitleEraseService.js` | Phase 2，FFmpeg 字幕检测 + inpaint |
| `clone.js` 路由 | `src/routes/clone.js` | upload / analyze / rewrite / generate / merge / status |
| 前端克隆页 | `public/clone.html` + `public/js/clone.js` | 上传 + 实时进度 + 预览/下载 |

### 对接关系图

```
clone.js 路由
  ↓
cloneService.js（主 pipeline）
  ├── sttService.js          ← 新增，封装 Whisper/阿里 NLS
  ├── frameAnalysisService.js ← 新增，抽帧 + Vision 描述
  ├── storyService.callLLM() ← 复用，脚本改写
  ├── storyService.parseScript() ← 复用，结构化输出
  ├── ttsService.generateSpeech() ← 复用，TTS 配音
  ├── imageService / videoService.generateVideoClip() ← 复用，新素材
  └── ffmpegService（merge + burnSubtitle + addAudio）← 复用，最终合成
```

---

## 四、技术架构图（Mermaid）

```mermaid
flowchart TD
    A[用户上传原始视频] --> B[/api/clone/upload]
    B --> C{解析阶段}
    C --> C1[sttService Whisper STT → 带时间戳字幕 JSON]
    C --> C2[frameAnalysisService 每2s抽帧 + Vision 场景描述]
    C1 --> D[storyService.callLLM 叙事结构提炼 钩子/痛点/转折/CTA]
    C2 --> D
    D --> E[storyService.callLLM 脚本改写 保留节奏 换词换例]
    E --> F[storyService.parseScript → 场景数组 JSON]
    F --> G{并行生成阶段}
    G --> G1[ttsService.generateSpeech → 新配音 MP3]
    G --> G2[imageService / videoService → 新视觉素材]
    G --> G3[musicService → BGM 替换 可选]
    G1 --> H[ffmpegService 合成]
    G2 --> H
    G3 --> H
    H --> H1[mergeVideoClips 拼接素材]
    H1 --> H2[addAudioToVideo 合入配音]
    H2 --> H3[burnSubtitle 烧录新字幕]
    H3 --> I[成片输出 MP4 下载]
    B -.SSE 实时进度.-> J[前端 clone.html 进度条 7 步透出]
    H3 -.-> J
```

---

## 五、商业价值与风险

### 商业价值

**直接受益**：抖音/小红书账号矩阵主、MCN、电商代运营、知识博主。

| 价值点 | 说明 |
|---|---|
| 内容产能放大 10x | 1 个爆款 → 10 个差异版本，矩阵账号同时铺 |
| 规避去重检测 | 音频指纹 / 画面哈希全换 |
| 跨平台搬运 | 抖音/小红书/B站/视频号分发 |
| 降低创作成本 | 继承已验证爆款的叙事结构 |
| 电商直播素材 | 持续测试不同话术 |

**变现路径**：基础按次（接 tokenTracker）+ 高级功能（克隆 + 数字人）月订阅 + MCN 企业版 API。

### 法律合规风险

| 风险 | 等级 | 规避 |
|---|---|---|
| **版权侵权** | 高 | 协议明确"只处理用户自有版权"；不内置爬虫；原始视频不保存超 24h |
| **平台识别 AI 生成** | 中 | 无法完全规避，建议用户配合真人元素降低 AI 特征 |
| **肖像权** | 极高 | MVP 不做换脸；声音克隆只允许克隆用户自己上传的参考音频 |
| **Deepfake 监管** | 高 | 遵 2023《生成式人工智能服务管理暂行办法》；生成内容加水印 |
| **抖音二创协议** | 中 | 引导用于自有内容再创作 |

---

## 六、4 周冲刺路线图

### Sprint 1（第 1-2 周）：解析 + 改写核心 · 4-9 天

- `sttService.js` 封装 Whisper STT（1.5 天）
- `frameAnalysisService.js` FFmpeg 抽帧 + Vision（2 天）
- `cloneService.js` pipeline 骨架（1 天）
- `src/routes/clone.js` upload/analyze/rewrite（1 天）
- 验收：上传视频 → 得到改写后脚本 JSON

### Sprint 2（第 2-3 周）：生成 + 合成 · 3-7 天

- 接 imageService + videoService 逐场景生成（1.5 天）
- 接 ttsService 全文 TTS（0.5 天）
- 接 ffmpegService 合成（1 天）
- SSE 进度推送 7 步（1 天）
- 验收：端到端跑通 60 秒视频克隆

### Sprint 3（第 3-4 周）：前端 + 声音克隆 · 3.5-7 天

- `public/clone.html` + `clone.js` 上传 + 进度（2 天）
- 声音克隆选项接 CosyVoice 2（1 天）
- tokenTracker 接入（0.5 天）
- 管理端：任务列表 + 成品管理（1 天）
- 验收：完整用户体验

### Sprint 4（Phase 2 备用）

- 数字人口播替换接 hiflyService（2 天）
- 背景替换接 videoMattingPipeline（3 天）
- 批量克隆队列（矩阵账号模式 3 天）

---

## 七、关键决策清单（需拍板）

| 问题 | 选项 A | 选项 B | 建议 |
|---|---|---|---|
| STT 用哪个？ | Whisper API（国际稳定 $0.006/min） | 阿里 NLS（国内快·有免费额度） | 先 Whisper，后可切 |
| 画面策略？ | 静态图 → 动效（便宜快） | 直接生视频（贵·质好） | MVP 静态图，Phase 2 接视频 |
| 声音克隆？ | MVP 包含（差异化卖点） | MVP 不含 | MVP 包含，CosyVoice 已集成 |
| 收费模式？ | 按次（1 次 = X Token） | 月订阅 | 按次+封顶，电商习惯按量 |

---

## 结论

4 周可交付完整 MVP，约 14-17 人天。核心竞争力在 VIDO 已有的多模型路由（TTS/视频/图像）+ FFmpeg 合成能力。新增工作集中在 STT + 帧分析两个 Service，其余全部复用现有代码。
