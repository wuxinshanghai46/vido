# 阿里百炼（DashScope）语音方案选型 · 面向 VIDO 语音克隆接入

## 结论一句话
**你要"生成自己的语音包"= CosyVoice 2.0 的【定制音色】（voice customization）**，不是 Sambert 也不是 Qwen-TTS。

---

## 阿里云语音三条技术线对比

| 产品族 | 代表模型 | 定位 | 能否复刻你的声音 |
|---|---|---|---|
| **Paraformer / Fun-ASR / Qwen3-ASR** | `fun-asr-v2`, `qwen3-asr-flash` | 语音识别（ASR/STT） | ❌ 不生成声音 |
| **Sambert** | `sambert-zhichu-v1` 等 | 老一代 TTS，预设音色库 | ❌ 不支持声音克隆 |
| **CosyVoice 2.0** ⭐ | `cosyvoice-v2`、`cosyvoice-v2-clone` | 新一代可控 TTS + **零样本/小样本声音克隆** | ✅ 这就是你要的 |
| Qwen-TTS | `qwen-tts` | 基础 TTS | ❌ 仅单向合成 |

> 你截图里看到的"Fun-ASR 多语言语音识别"是 **ASR（听）**，不是你要的 **TTS（说）+ 复刻**。切换到顶部那个**"语音合成"** tab，或者直接搜 "CosyVoice"。

---

## 接入路径（生产可用）

### 方案 A · 零样本克隆（cosyvoice-v2-clone）
**3 秒音频即可让模型模仿你的音色**，每次合成时把参考音频连同文本一起发。
- **优点**：不用提前训练，API 一问一答就能出
- **缺点**：每次请求都要上传参考音频（增加带宽/延迟），音色一致性略逊于"音库版"
- **场景**：一次性文案、临时复刻、Demo

### 方案 B · 定制音色（voice_customization）⭐ 推荐
**上传一段 10 秒-2 分钟音频 → 离线训练 → 返回永久 `voice_id` → 之后所有合成直接用 `voice_id`**
- **优点**：音色稳定、每次调用只传文本、音库可复用
- **缺点**：需要先跑一次训练（异步任务，几分钟到几十分钟）
- **场景**：你要做数字人主播/IP，给长期生产使用 ← **VIDO 应该走这条**

---

## 定制音色接入规范（CosyVoice 2.0）

### 1. 训练阶段
```
POST https://dashscope.aliyuncs.com/api/v1/services/audio/tts/customization
Headers:
  Authorization: Bearer ${DASHSCOPE_API_KEY}
  X-DashScope-Async: enable       # 必须异步
Body:
{
  "model": "cosyvoice-v2",
  "input": {
    "voice_name": "vido_zhang",   # 自己起名
    "audio_url": "https://.../sample.wav",   # 15s-2min，16kHz mono 最佳
    "text": "可选·对应文本提高准度"
  }
}
→ { output: { task_id: "xxx" } }
```

### 2. 查训练状态
```
GET /api/v1/tasks/{task_id}
→ { output: { task_status: "SUCCEEDED", voice_id: "cosyvoice-v2-vido-xxxxx" } }
```

### 3. 使用阶段（以后每次只传 voice_id + 文本）
```
POST /api/v1/services/audio/tts
{
  "model": "cosyvoice-v2",
  "input": { "text": "大家好，我是 VIDO 的数字人..." },
  "parameters": {
    "voice": "cosyvoice-v2-vido-xxxxx",   # ← 你的专属音色
    "format": "mp3",
    "sample_rate": 24000
  }
}
```

### 输入约束
- 采样率 ≥ 16kHz（推荐 24kHz WAV）
- 单声道 mono
- 长度：零样本 3-10s / 定制音色训练 15s-2min
- 背景安静（SNR ≥ 30dB）
- 支持中/英/粤/日/韩

---

## VIDO 集成建议

现有 `src/services/ttsService.js` 和 `src/routes/workbench.js` 已经抽象了"自定义声音"（custom_xxx 前缀）机制，支持火山/Fish Audio 两家后端。**加阿里**只需要：

1. `settingsService` 新增 `preset='aliyun-cosyvoice'` 供应商模板
2. `workbench.js` `createVoice` 分支：如果用户选的 provider 是 cosyvoice，走 A 定制音色训练链路，落库时 `aliyun_voice_id` 字段存返回的 voice_id
3. `ttsService._generateWithCustomVoice` 里加 aliyun 分支：读 aliyun_voice_id → 调 `/api/v1/services/audio/tts` 合成

**优先级**：先做"有 voice_id 直接合成"（1-2 小时），再补"新建自定义声音训练"（5-6 小时）。

---

## 现有栈的互补关系

| 引擎 | 定价 | 并发 | 上手速度 | 音质中文 |
|---|---|---|---|---|
| 火山 mega_tts（已接入） | 付费，按字数 | 5+ | 上传样本秒出 voice_id | 5 ⭐⭐⭐⭐⭐ |
| Fish Audio（已接入） | 付费，按请求 | 3 | 几秒 | 4 ⭐⭐⭐⭐ |
| 阿里 CosyVoice 2.0（推荐接入） | 付费，按字符 | 10+ | 定制音色几分钟 | 5 ⭐⭐⭐⭐⭐ |
| 百度 SDK TTS（已接入） | 付费，按字数 | 10+ | 不支持复刻 | 3 ⭐⭐⭐ |

**推荐策略**：火山复刻保持为"质量最稳首选"，阿里 CosyVoice 作为"并发兜底 + 多语言（粤/英/日/韩）覆盖"。

---

## 参考链接
- CosyVoice 2.0 产品介绍：https://help.aliyun.com/zh/dashscope/developer-reference/api-details-cosyvoice
- 定制音色接入：https://help.aliyun.com/zh/dashscope/developer-reference/voice-customization
- SDK 示例：https://github.com/modelscope/CosyVoice
