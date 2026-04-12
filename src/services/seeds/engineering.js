/**
 * 研发工程库 seed
 *
 * 覆盖 7 个技术子分类：
 *   多语言开发 / 多模型集成 / 多组件设计 / 爬虫开发 / ComfyUI / 工作流编排 / 自学习机制
 *
 * 服务的 agent：
 *   backend_engineer / frontend_engineer / algorithm_engineer /
 *   comfyui_engineer / crawler_engineer / workflow_engineer
 */

module.exports = [

  // ═══════════════════════════════════════════════════
  // ① 多语言开发 (Multi-Language Development)
  // ═══════════════════════════════════════════════════
  {
    id: 'kb_eng_lang_nodejs',
    collection: 'engineering',
    subcategory: '多语言开发',
    title: 'Node.js 在 AI 视频场景下的最佳实践',
    summary: 'Node.js 适合 I/O 密集型 + 实时流式 + SSE/WebSocket 场景。AI 视频网关层首选。',
    content: `**Node.js 在 AI 视频场景的 5 大优势**

1. **I/O 密集友好**：调用 Sora/Veo/Kling API 等待时间长，事件循环完美契合
2. **实时流式**：SSE/WebSocket 原生支持，进度推送、流式 LLM 输出无敌
3. **生态丰富**：ffmpeg-static、ffprobe、axios、openai SDK 等一应俱全
4. **跨平台部署**：Windows/Linux/macOS/ARM 全覆盖
5. **统一语言栈**：前端 JS → 后端 Node = 心智负担低

**典型架构**
\`\`\`
[Express/Fastify] → [队列 Bull/BullMQ] → [Worker Process] → [Sora API]
         ↓                                        ↓
    [SSE 进度推送]                            [FFmpeg 合成]
\`\`\`

**核心依赖**
- express / fastify / koa — HTTP 框架
- axios / undici / got — HTTP 客户端
- ws / socket.io — 实时通信
- bull / bullmq — 任务队列（Redis 后端）
- fluent-ffmpeg + ffmpeg-static — 视频处理
- openai / @anthropic-ai/sdk — LLM SDK
- multer — 文件上传
- sharp — 图片处理
- pg / mysql2 / better-sqlite3 — 数据库

**高并发技巧**
- Cluster 模块多核利用
- PM2 进程管理
- Worker Threads 做 CPU 密集（视频处理）
- Stream API 处理大文件
- 不要在主线程同步读大文件

**陷阱**
- 不要在 Node.js 里做 CPU 密集（用 Worker Threads 或 Python）
- 回调地狱 → 用 async/await
- unhandled promise rejection → process.on('unhandledRejection')
- 内存泄漏 → 用 clinic.js / heapdump 定位

**VIDO 实战**
- Express + multer 处理上传
- SSE 流式推进度
- fluent-ffmpeg 合成视频
- better-sqlite3 替代方案：JSON 文件 store（Windows Node v24 环境）

**代码范式：视频生成 + SSE 进度推送**
\`\`\`js
app.get('/api/projects/:id/progress', auth, (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });
  progressListeners.set(req.params.id, res);
  req.on('close', () => progressListeners.delete(req.params.id));
});

async function generateWithProgress(id, params) {
  const listener = progressListeners.get(id);
  const emit = (step, pct, msg) => {
    listener?.write(\`data: \${JSON.stringify({ step, pct, msg })}\\n\\n\`);
  };
  emit('script', 10, '编剧 agent 工作中...');
  const script = await agentScreenwriter(params);
  emit('direct', 30, '导演 agent 分镜中...');
  // ...
}
\`\`\``,
    tags: ['nodejs', '多语言', '后端', '实战'],
    keywords: ['nodejs', 'express', 'sse', 'websocket', 'bull', 'ffmpeg', 'event loop', 'async'],
    prompt_snippets: [
      'use Node.js Express + SSE for real-time progress streaming',
      'fluent-ffmpeg with ffmpeg-static for cross-platform video composition',
      'BullMQ with Redis backend for AI video generation queue',
    ],
    applies_to: ['backend_engineer', 'workflow_engineer'],
    source: 'Node.js 官方文档 + VIDO 项目实战经验',
    lang: 'zh-en',
    enabled: true,
  },
  {
    id: 'kb_eng_lang_python',
    collection: 'engineering',
    subcategory: '多语言开发',
    title: 'Python AI/ML 生态完整指南（PyTorch / Diffusers / Transformers / FastAPI）',
    summary: 'Python 是 AI/ML 宇宙中心。自部署开源模型、fine-tuning、ComfyUI、LLM 推理必用。',
    content: `**Python 在 AI 视频领域的不可替代性**

- **AI/ML 生态**: PyTorch, TensorFlow, JAX, Diffusers, Transformers
- **开源模型部署**: HunyuanVideo, Wan, CogVideoX, SVD 都是 Python
- **ComfyUI**: 整个 ComfyUI 是 Python 写的，自定义节点也只能用 Python
- **快速原型**: Jupyter Notebook, Colab 迭代速度最快
- **数据科学**: pandas, numpy, matplotlib 不可替代

**核心技术栈**

**1. 模型推理**
- \`torch\` + \`transformers\` + \`diffusers\`
- \`accelerate\` 多 GPU 加速
- \`bitsandbytes\` 量化到 4/8 bit 降显存

**2. Web 服务**
- \`fastapi\` — 性能最佳的 Python Web 框架
- \`uvicorn\` — ASGI 服务器
- \`pydantic\` — 类型校验

**3. 异步**
- \`asyncio\` + \`aiohttp\` — 异步 IO
- \`celery\` — 分布式任务队列

**4. 数据处理**
- \`numpy\` — 数组运算
- \`pandas\` — 表格数据
- \`pillow\` / \`cv2\` — 图像处理
- \`moviepy\` / \`ffmpeg-python\` — 视频处理

**典型的 Python 视频生成服务**
\`\`\`python
from fastapi import FastAPI
from diffusers import AutoPipelineForText2Image
import torch

app = FastAPI()
pipe = AutoPipelineForText2Image.from_pretrained(
    "stabilityai/stable-diffusion-xl-base-1.0",
    torch_dtype=torch.float16,
    variant="fp16"
).to("cuda")

@app.post("/generate")
async def generate(prompt: str):
    image = pipe(prompt, num_inference_steps=30).images[0]
    image.save("output.png")
    return {"status": "ok", "path": "output.png"}
\`\`\`

**显存管理技巧**
- \`torch.cuda.empty_cache()\`
- \`model.enable_model_cpu_offload()\` — 动态卸载到 CPU
- \`model.enable_sequential_cpu_offload()\` — 逐层卸载（更省显存）
- \`model.enable_vae_slicing()\` — VAE 切片
- \`model.enable_vae_tiling()\` — VAE 平铺

**Python vs Node.js 决策树**
\`\`\`
需要自部署开源模型？ → Python
需要 ComfyUI 集成？ → Python
需要推理优化？ → Python
需要快速 API 网关？ → Node.js
需要前后端统一语言？ → Node.js
需要实时流式/WebSocket？ → Node.js
\`\`\`

**VIDO 建议混合架构**
- **前台 Web**：Node.js（Express + JS）
- **AI Worker**：Python（FastAPI + PyTorch）
- **通信**：REST / gRPC / Redis Queue
- **ComfyUI**：独立 Python 服务，通过 HTTP 对接

**陷阱**
- 不要在 FastAPI 的 async 函数里做同步 PyTorch 推理 → 会阻塞
- 用 \`run_in_threadpool\` 或独立 Worker
- 不同版本的 torch/cuda 兼容性坑
- 依赖用 \`pip freeze > requirements.txt\` + 容器化`,
    tags: ['python', 'ai/ml', 'pytorch', 'fastapi'],
    keywords: ['python', 'pytorch', 'diffusers', 'transformers', 'fastapi', 'comfyui', 'inference'],
    prompt_snippets: [
      'FastAPI + PyTorch for self-hosted diffusion model inference',
      'hybrid architecture: Node.js gateway + Python AI workers',
      'torch cuda memory management with model offload',
    ],
    applies_to: ['backend_engineer', 'algorithm_engineer', 'comfyui_engineer'],
    source: 'Python 官方文档 + PyTorch 文档 + Diffusers 文档',
    lang: 'zh-en',
    enabled: true,
  },
  {
    id: 'kb_eng_lang_go_rust',
    collection: 'engineering',
    subcategory: '多语言开发',
    title: 'Go / Rust 在 AI 视频基础设施中的角色（高并发 / 系统级）',
    summary: 'Go = 云原生基础设施首选，Rust = 极致性能底层。两者都擅长 Node.js/Python 搞不定的场景。',
    content: `**何时用 Go**

Go 适合构建**基础设施**和**高并发网关**：

1. **API 网关** - 比 Node.js 快 5-10 倍
2. **任务调度** - goroutine 轻量级并发
3. **文件代理** - 大文件传输性能优于 Node
4. **MinIO / S3 客户端** - 官方 SDK 成熟
5. **Kubernetes 生态** - k8s operator 必用

**Go 经典栈**
- gin / fiber / echo - Web 框架
- gRPC-Go - 跨服务通信
- redis-go - Redis 客户端
- sqlx - 数据库
- cobra - CLI 工具

**VIDO 场景：视频分发网关**
\`\`\`go
package main

import (
    "github.com/gin-gonic/gin"
    "net/http"
    "io"
    "os"
)

func main() {
    r := gin.Default()
    r.GET("/video/:id/stream", func(c *gin.Context) {
        id := c.Param("id")
        file, _ := os.Open("/data/videos/" + id + ".mp4")
        defer file.Close()
        c.Header("Content-Type", "video/mp4")
        io.Copy(c.Writer, file)
    })
    r.Run(":8080")
}
\`\`\`
这比 Node.js 的同等代码快 5-10 倍，尤其在并发 1000+ 时。

**何时用 Rust**

Rust 适合**极致性能**和**安全关键**场景：

1. **视频编解码** - FFmpeg 绑定性能最强
2. **音频处理** - 实时音频流
3. **WebAssembly** - 浏览器高性能模块
4. **嵌入式** - 边缘设备 AI 推理
5. **数据库引擎** - sled, SurrealDB, TiKV

**Rust 经典栈**
- axum / actix-web - Web 框架
- tokio - 异步运行时
- serde - 序列化
- reqwest - HTTP 客户端
- ffmpeg-next - FFmpeg 绑定

**Rust 场景：WebAssembly 视频预览器**
\`\`\`rust
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn decode_video_frame(bytes: &[u8]) -> Vec<u8> {
    // 在浏览器里运行高性能解码
    // 比 JS 快 10-100 倍
}
\`\`\`

**混合架构推荐**

对一个复杂 AI 视频平台：
\`\`\`
[前端 React]
    ↓
[Node.js 业务 API] (快速迭代)
    ↓
[Go 网关 / 视频分发] (高并发)
    ↓
[Python AI Worker] (模型推理)
    ↓
[Rust 编解码 / WASM] (性能热点)
\`\`\`

**不要 over-engineer**
- 如果你是小团队 → 只用 Node.js + Python 已经足够
- Go/Rust 是在遇到**真实性能瓶颈**后才引入
- 不要因为"酷"而引入（维护成本翻倍）

**语言选型决策**
\`\`\`
并发 < 1000 QPS？          → Node.js
并发 > 1000 QPS？          → 考虑 Go
需要 FFmpeg 深度定制？      → Rust
需要 WASM 浏览器加速？      → Rust
团队没有 Go/Rust 经验？    → 先不考虑（学习成本）
\`\`\``,
    tags: ['go', 'rust', '高并发', '基础设施'],
    keywords: ['golang', 'rust', 'gin', 'axum', 'webassembly', 'performance', 'infrastructure'],
    prompt_snippets: [
      'Go gin high-performance video streaming gateway',
      'Rust axum async web service for video encoding',
      'WebAssembly video decoder compiled from Rust',
    ],
    applies_to: ['backend_engineer'],
    source: 'Go 官方文档 + Rust 官方文档 + 云原生实践',
    lang: 'zh-en',
    enabled: true,
  },
  {
    id: 'kb_eng_lang_communication',
    collection: 'engineering',
    subcategory: '多语言开发',
    title: '跨语言通信方案（gRPC / REST / Message Queue / WebSocket）',
    summary: '混合架构里多语言服务必须通信。4 种主流方案对比 + VIDO 推荐选型。',
    content: `**4 种通信方案对比**

| 方案 | 协议 | 延迟 | 吞吐 | 复杂度 | 适用 |
|---|---|---|---|---|---|
| REST | HTTP/1.1 | 中 | 中 | 低 | 简单接口 |
| gRPC | HTTP/2 | 低 | 高 | 中 | 跨服务 RPC |
| Message Queue | AMQP/Redis | 异步 | 极高 | 高 | 异步任务 |
| WebSocket | WS | 极低 | 中 | 中 | 实时双向 |

**#1 REST (HTTP/JSON)**

**适用**
- 简单的跨服务调用
- 调试友好
- 所有语言都支持

**示例：Node.js → Python**
\`\`\`js
// Node.js 调用 Python FastAPI
const response = await fetch('http://python-worker:8000/generate', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ prompt: 'A cat' }),
});
const data = await response.json();
\`\`\`

**优点**: 简单、调试容易
**缺点**: 性能不是最好，没有类型安全

**#2 gRPC (Protocol Buffers)**

**适用**
- 高频跨服务调用
- 需要类型安全
- 需要双向流

**示例定义**
\`\`\`proto
// video.proto
syntax = "proto3";

service VideoService {
  rpc Generate(GenerateRequest) returns (stream Progress);
}

message GenerateRequest {
  string prompt = 1;
  int32 duration = 2;
}

message Progress {
  int32 percent = 1;
  string message = 2;
}
\`\`\`

**优点**: 性能极好（HTTP/2 + 二进制）、类型安全、支持流
**缺点**: 学习成本、浏览器支持差（需要 gRPC-Web）

**#3 Message Queue (Redis / RabbitMQ / Kafka)**

**适用**
- 异步任务（视频生成等长时间任务）
- 削峰填谷
- 多 Worker 分发

**示例：Node.js 发任务 → Python Worker 消费**
\`\`\`js
// Node.js 生产者
import { Queue } from 'bullmq';
const queue = new Queue('video-gen', { connection: { host: 'redis' } });
await queue.add('generate', { prompt: 'A cat', duration: 5 });
\`\`\`

\`\`\`python
# Python 消费者
from redis import Redis
from rq import Queue, Worker

redis = Redis(host='redis')
queue = Queue('video-gen', connection=redis)

def process_video(prompt, duration):
    # 调用 diffusion 模型
    pass

Worker([queue]).work()
\`\`\`

**优点**: 解耦、异步、削峰、重试
**缺点**: 需要维护 Redis/RabbitMQ、调试难

**#4 WebSocket**

**适用**
- 实时进度推送
- 双向通信
- 直播推流

**示例：Python Worker → 前端实时进度**
\`\`\`python
import asyncio, websockets
async def worker(ws):
    for step in range(100):
        await ws.send(f"progress: {step}%")
        await asyncio.sleep(0.1)
async def main():
    async with websockets.serve(worker, "0.0.0.0", 8080):
        await asyncio.Future()
asyncio.run(main())
\`\`\`

**优点**: 低延迟、双向
**缺点**: 连接管理复杂、断线重连

**VIDO 推荐架构**

\`\`\`
前端 (React/Vue)
    ↓ REST (业务请求)
    ↓ SSE (进度推送)
Node.js API 网关
    ↓ REST (简单同步调用)
    ↓ Redis Queue (异步视频生成)
Python AI Worker
\`\`\`

**决策准则**
- 前端 ↔ 后端：REST + SSE（最简单）
- 后端 ↔ Worker：Queue（异步解耦）
- Worker ↔ Worker（高频）：gRPC
- 不要为了用而用某个技术`,
    tags: ['通信', 'grpc', 'rest', 'queue', 'websocket'],
    keywords: ['grpc', 'rest api', 'message queue', 'websocket', 'sse', 'redis', 'rabbitmq', 'inter-service'],
    prompt_snippets: [
      'Node.js gateway + Python worker via Redis queue',
      'gRPC bidirectional streaming for real-time progress',
      'WebSocket for live video preview streaming',
    ],
    applies_to: ['backend_engineer', 'algorithm_engineer'],
    source: '分布式系统通信方案综合对比',
    lang: 'zh-en',
    enabled: true,
  },

  // ═══════════════════════════════════════════════════
  // ② 多模型集成 (Multi-Model Integration)
  // ═══════════════════════════════════════════════════
  {
    id: 'kb_eng_model_llm_unified',
    collection: 'engineering',
    subcategory: '多模型集成',
    title: '统一 LLM 封装（OpenAI / Claude / Gemini / DeepSeek / 文心 / 通义 / 豆包）',
    summary: '8+ 大模型的统一接口封装。一个 callLLM() 切换所有供应商，支持回退和负载均衡。',
    content: `**统一封装的 3 大收益**

1. **切换成本为零**：一行配置切换模型
2. **自动回退**：主力挂了立刻切备胎
3. **成本优化**：便宜的模型先试，贵的兜底

**主流模型 API 对比**

| 厂商 | 协议 | OpenAI 兼容 | 中文能力 | 价格 |
|---|---|---|---|---|
| OpenAI | REST | ✓ 原生 | 强 | 高 |
| Anthropic Claude | REST | ✗ 独立 | 极强 | 高 |
| Google Gemini | REST | ✗ 独立 | 中 | 中 |
| DeepSeek | REST | ✓ | 极强 | 极低 |
| 文心一言 | REST | ✗ 独立 | 极强 | 中 |
| 通义千问 | REST | ✓ | 极强 | 低 |
| 豆包 | REST | ✓ | 极强 | 低 |
| Grok xAI | REST | ✓ | 中 | 中 |
| Kimi (月之暗面) | REST | ✓ | 极强 | 中 |
| 智谱 GLM | REST | ✓ | 强 | 低 |

**大多数供应商都兼容 OpenAI SDK**，设置 baseURL 即可。

**统一 callLLM 架构**

\`\`\`js
// src/services/unifiedLLM.js
const OpenAI = require('openai');
const { Anthropic } = require('@anthropic-ai/sdk'); // Claude 独立 SDK

const PROVIDERS = {
  openai:    { type: 'openai-compat', baseURL: null,                             models: ['gpt-4o', 'gpt-4o-mini'] },
  deepseek:  { type: 'openai-compat', baseURL: 'https://api.deepseek.com/v1',    models: ['deepseek-chat', 'deepseek-reasoner'] },
  qwen:      { type: 'openai-compat', baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1', models: ['qwen-max', 'qwen-plus'] },
  doubao:    { type: 'openai-compat', baseURL: 'https://ark.cn-beijing.volces.com/api/v3', models: ['doubao-pro-4k'] },
  kimi:      { type: 'openai-compat', baseURL: 'https://api.moonshot.cn/v1',     models: ['moonshot-v1-128k'] },
  zhipu:     { type: 'openai-compat', baseURL: 'https://open.bigmodel.cn/api/paas/v4', models: ['glm-4-plus'] },
  anthropic: { type: 'anthropic-native', baseURL: 'https://api.anthropic.com',   models: ['claude-sonnet-4-6', 'claude-opus-4-6'] },
  gemini:    { type: 'gemini-native',    baseURL: 'https://generativelanguage.googleapis.com', models: ['gemini-2.0-flash', 'gemini-2.0-pro'] },
};

async function callLLM({ provider, model, systemPrompt, userPrompt, apiKey, maxTokens = 4096 }) {
  const p = PROVIDERS[provider];
  if (!p) throw new Error(\`Unknown provider: \${provider}\`);

  if (p.type === 'openai-compat') {
    const client = new OpenAI({ apiKey, baseURL: p.baseURL });
    const r = await client.chat.completions.create({
      model,
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userPrompt },
      ],
    });
    return r.choices[0].message.content;
  }

  if (p.type === 'anthropic-native') {
    const client = new Anthropic({ apiKey });
    const r = await client.messages.create({
      model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });
    return r.content[0].text;
  }

  if (p.type === 'gemini-native') {
    // Gemini 用 fetch 直接调用
    const r = await fetch(\`\${p.baseURL}/v1beta/models/\${model}:generateContent?key=\${apiKey}\`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
        generationConfig: { maxOutputTokens: maxTokens },
      }),
    });
    const data = await r.json();
    return data.candidates[0].content.parts[0].text;
  }
}

module.exports = { callLLM, PROVIDERS };
\`\`\`

**自动回退策略**

\`\`\`js
async function callLLMWithFallback(task, configs) {
  // configs = [
  //   { provider: 'deepseek', model: 'deepseek-chat', apiKey: '...' },  // 首选（便宜）
  //   { provider: 'doubao',   model: 'doubao-pro-4k', apiKey: '...' },  // 备胎
  //   { provider: 'openai',   model: 'gpt-4o-mini', apiKey: '...' },    // 保底
  // ]
  for (const cfg of configs) {
    try {
      return await callLLM({ ...cfg, ...task });
    } catch (e) {
      console.warn(\`[LLM] \${cfg.provider}/\${cfg.model} failed: \${e.message}\`);
    }
  }
  throw new Error('所有 LLM 供应商都失败');
}
\`\`\`

**成本优化策略**

1. **按任务分层**：
   - 简单任务（分类/总结）→ deepseek-chat (最便宜)
   - 创意任务（剧本/文案）→ claude-sonnet / gpt-4o
   - 推理任务（数学/代码）→ deepseek-reasoner / gpt-o1

2. **Prompt caching**：
   - Anthropic / OpenAI 都支持 prompt 缓存
   - 长 system prompt 缓存后 10x 成本下降

3. **Token 优化**：
   - 用 \`tiktoken\` 预估 token 数
   - 超长内容先总结再处理
   - 压缩历史对话

**VIDO 项目现有集成**
\`\`\`
src/services/storyService.js  —— 已实现 getStoryConfig() 动态路由
src/services/settingsService.js —— 管理多供应商
outputs/settings.json           —— 存储供应商 + API Key
\`\`\``,
    tags: ['llm', '多模型', '统一接口', 'openai', 'claude'],
    keywords: ['llm integration', 'multi-model', 'openai compat', 'fallback', 'anthropic', 'deepseek', 'gemini'],
    prompt_snippets: [
      'unified callLLM function with provider-agnostic interface',
      'auto fallback from deepseek to doubao to gpt-4o-mini',
      'tiered model selection by task complexity for cost optimization',
    ],
    applies_to: ['backend_engineer', 'algorithm_engineer'],
    source: 'OpenAI SDK + Anthropic SDK + Google Gemini API + 各大模型厂商官方文档',
    lang: 'zh-en',
    enabled: true,
  },
  {
    id: 'kb_eng_model_video_unified',
    collection: 'engineering',
    subcategory: '多模型集成',
    title: '统一视频生成模型封装（Sora / Veo / Kling / Runway / Seedance / Hailuo / Luma）',
    summary: '10+ 视频模型的统一接口。异步任务模型为主，需要 polling 获取结果。',
    content: `**视频生成模型与 LLM 最大的不同**

- **异步**: 提交任务 → 返回 task_id → 轮询状态 → 下载结果
- **时长**: 10 秒到 5 分钟不等
- **参数多**: aspect_ratio / duration / style / reference_image / seed 等

**主流视频模型 API 对比**

| 厂商 | 模型 | 协议 | 异步/同步 | 最长 | 价格/秒 |
|---|---|---|---|---|---|
| OpenAI | Sora 2 | REST | 异步 | 60s | 高 |
| Google | Veo 3.1 | REST (Vertex AI) | 异步 | 60s+ | 中 |
| 快手 | Kling 2.5 | REST | 异步 | 10s | 低 |
| Runway | Gen-4 | REST | 异步 | 10s | 中 |
| Luma | Ray-2 | REST | 异步 | 5s | 低 |
| Pika | 2.1 | REST | 异步 | 10s | 低 |
| 字节 | Seedance 2.0 | REST (方舟) | 异步 | 10s | 低 |
| MiniMax | Hailuo | REST | 异步 | 6s | 低 |
| 智谱 | CogVideoX | REST / 本地 | 异步 | 6s | 免费 |
| HunyuanVideo | - | 本地开源 | 本地 | 不限 | 免费 |

**统一接口设计**

\`\`\`js
// src/services/unifiedVideoGen.js

// 接口规范：所有 provider 实现这个接口
class VideoProvider {
  async submit(task) {
    // { prompt, duration, aspect_ratio, reference_image, ... }
    // → returns { task_id, provider }
  }
  async status(taskId) {
    // → returns { status: 'pending' | 'running' | 'done' | 'failed', progress, video_url?, error? }
  }
  async download(taskId) {
    // → returns Buffer or local file path
  }
}

// 实现：Kling
class KlingProvider extends VideoProvider {
  async submit({ prompt, duration = 5, aspect_ratio = '16:9' }) {
    const r = await fetch('https://api.klingai.com/v1/videos/text2video', {
      method: 'POST',
      headers: { 'Authorization': \`Bearer \${this.apiKey}\`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model_name: 'kling-v2-master',
        prompt,
        duration: String(duration),
        aspect_ratio,
      }),
    });
    const data = await r.json();
    return { task_id: data.data.task_id, provider: 'kling' };
  }
  async status(taskId) {
    const r = await fetch(\`https://api.klingai.com/v1/videos/text2video/\${taskId}\`, {
      headers: { 'Authorization': \`Bearer \${this.apiKey}\` },
    });
    const data = await r.json();
    return {
      status: mapKlingStatus(data.data.task_status),
      progress: data.data.task_status === 'succeed' ? 100 : 50,
      video_url: data.data.task_result?.videos?.[0]?.url,
    };
  }
}

// 统一调用
async function generateVideo({ provider, apiKey, ...task }) {
  const cls = { kling: KlingProvider, runway: RunwayProvider, sora: SoraProvider /* ... */ }[provider];
  const p = new cls(apiKey);
  const { task_id } = await p.submit(task);

  // 轮询状态
  while (true) {
    const s = await p.status(task_id);
    if (s.status === 'done') return s.video_url;
    if (s.status === 'failed') throw new Error(s.error);
    await sleep(5000);
  }
}
\`\`\`

**异步轮询的 4 个陷阱**

1. **超时**: 设置最大轮询时间（例：10 分钟）
2. **网络抖动**: 每次 polling 加 3 次重试
3. **频率限制**: 不要 1 秒 polling 一次，按指数退避（5s → 10s → 20s）
4. **任务丢失**: 存 task_id 到数据库，服务重启后能恢复

**FAL 代理模式**

FAL.ai 代理了很多视频模型，用统一的 API 调用：

\`\`\`js
// 通过 FAL 调用 flux / runway / kling / luma / stable-video
import { fal } from '@fal-ai/client';
fal.config({ credentials: FAL_KEY });

const result = await fal.subscribe('fal-ai/runway-gen3/turbo/video-to-video', {
  input: { prompt: 'a cat', duration: 5 },
  logs: true,
});
\`\`\`

**VIDO 项目现有集成**
\`\`\`
src/services/videoService.js  —— resolveVideoProvider() 自动路由
src/routes/i2v.js             —— 图生视频端点（支持 24 供应商 48 模型）
\`\`\`

**测试矩阵**

对每个新集成的模型都要跑一遍：
1. 最简单的 prompt（"a cat walking"）
2. 长 prompt（500 字）
3. 边界参数（duration 最大、aspect ratio 9:16 / 16:9 / 1:1）
4. 错误处理（无效 API key / 内容违规）
5. 并发 5 个任务`,
    tags: ['视频模型', '统一接口', 'sora', 'veo', 'kling'],
    keywords: ['video generation api', 'sora', 'veo', 'kling', 'runway', 'luma', 'pika', 'unified interface', 'async polling'],
    prompt_snippets: [
      'unified VideoProvider interface with submit/status/download methods',
      'exponential backoff polling: 5s → 10s → 20s → 40s',
      'task_id persistence in database for restart recovery',
    ],
    applies_to: ['backend_engineer', 'algorithm_engineer'],
    source: 'Sora/Veo/Kling/Runway/Luma/Pika/Seedance/Hailuo 各自官方 API 文档 + VIDO 实战',
    lang: 'zh-en',
    enabled: true,
  },
  {
    id: 'kb_eng_model_routing',
    collection: 'engineering',
    subcategory: '多模型集成',
    title: '模型路由与回退策略（成本感知 + SLA 保障）',
    summary: '在成本和质量之间找平衡。便宜模型先试 → 失败就升级 → 最终保底。VIDO 级 SLA。',
    content: `**路由的 4 个决策维度**

1. **成本** (cost): $/1M tokens
2. **质量** (quality): 人工评分或 benchmark
3. **速度** (latency): 平均响应时间
4. **可用性** (availability): SLA 百分比

**路由策略 1: 瀑布式（Cost First）**

便宜的先试，失败 or 质量差再升级：

\`\`\`js
const CASCADE = [
  { provider: 'deepseek', model: 'deepseek-chat',  cost: 0.14, quality: 7 },
  { provider: 'doubao',   model: 'doubao-pro-4k', cost: 0.80, quality: 8 },
  { provider: 'qwen',     model: 'qwen-max',      cost: 2.80, quality: 8 },
  { provider: 'openai',   model: 'gpt-4o',        cost: 5.00, quality: 9 },
  { provider: 'anthropic',model: 'claude-sonnet-4-6', cost: 3.00, quality: 10 },
];

async function cascadeCall(task) {
  for (const cfg of CASCADE) {
    try {
      const result = await callLLM({ ...cfg, ...task });
      if (validateQuality(result)) return result;  // 质量不够继续升级
    } catch (e) {
      continue;
    }
  }
  throw new Error('All providers failed');
}
\`\`\`

**路由策略 2: 任务感知路由**

不同任务用不同模型：

\`\`\`js
const TASK_ROUTING = {
  'classify':       'deepseek-chat',      // 简单分类：便宜快速
  'summarize':      'deepseek-chat',      // 总结
  'translate':      'qwen-max',           // 翻译：中文强
  'code-gen':       'claude-sonnet',      // 代码：Claude 最强
  'code-review':    'claude-sonnet',
  'math':           'deepseek-reasoner',  // 数学推理：R1/o1
  'creative-write': 'claude-sonnet',      // 创意写作：Claude
  'role-play':      'gpt-4o',             // 角色扮演：GPT
  'long-context':   'kimi-128k',          // 长上下文：Kimi
  'multi-modal':    'gpt-4o',             // 图文：GPT
  'chinese-poetry': 'qwen-max',           // 中文特色：通义
};

async function smartCall(taskType, prompt) {
  const model = TASK_ROUTING[taskType] || 'deepseek-chat';
  return await callLLM({ model, ...parseConfig(model), prompt });
}
\`\`\`

**路由策略 3: 负载均衡**

多个账号/region 分担流量：

\`\`\`js
const POOL = [
  { provider: 'openai', apiKey: 'sk-A...', region: 'us' },
  { provider: 'openai', apiKey: 'sk-B...', region: 'us' },
  { provider: 'openai', apiKey: 'sk-C...', region: 'eu' },
];

let idx = 0;
function roundRobin() {
  return POOL[idx++ % POOL.length];
}
\`\`\`

**熔断器模式**

避免一个挂掉的供应商拖垮整个系统：

\`\`\`js
class CircuitBreaker {
  constructor(threshold = 5, resetTimeout = 60000) {
    this.failures = 0;
    this.threshold = threshold;
    this.state = 'CLOSED';  // CLOSED | OPEN | HALF_OPEN
    this.lastFail = 0;
    this.resetTimeout = resetTimeout;
  }
  async call(fn) {
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFail > this.resetTimeout) {
        this.state = 'HALF_OPEN';
      } else {
        throw new Error('Circuit breaker OPEN');
      }
    }
    try {
      const r = await fn();
      this.failures = 0;
      this.state = 'CLOSED';
      return r;
    } catch (e) {
      this.failures++;
      this.lastFail = Date.now();
      if (this.failures >= this.threshold) this.state = 'OPEN';
      throw e;
    }
  }
}
\`\`\`

**成本监控**

每次调用记录到 DB：

\`\`\`sql
CREATE TABLE llm_calls (
  id UUID,
  provider TEXT,
  model TEXT,
  prompt_tokens INT,
  completion_tokens INT,
  cost DECIMAL,
  duration_ms INT,
  status TEXT,
  created_at TIMESTAMP
);
\`\`\`

然后每周看报表：
- 哪个模型最贵
- 哪个模型失败率最高
- 哪个任务类型消耗最多

**VIDO 建议路由**

\`\`\`js
const VIDO_ROUTING = {
  // 剧情生成：需要创意 + 中文 → Claude / Deepseek
  'drama-script':      ['claude-sonnet', 'deepseek-chat'],
  // 分镜：技术性强 + 长 prompt → GPT-4o / Claude
  'drama-director':    ['gpt-4o', 'claude-sonnet'],
  // 角色一致性：需要精确 → Claude
  'character-bible':   ['claude-sonnet', 'gpt-4o'],
  // 市场调研：需要最新数据 → Gemini / Perplexity
  'market-research':   ['gemini-2.0-pro', 'gpt-4o'],
  // 文案策划：中文强 → Kimi / 通义
  'copywriter':        ['qwen-max', 'kimi-128k'],
  // 视频生成：按质量成本 → Kling → Seedance → Veo → Sora
  'video-generate':    ['kling', 'seedance', 'veo', 'sora'],
};
\`\`\``,
    tags: ['路由', '回退', '成本', 'sla'],
    keywords: ['model routing', 'fallback strategy', 'circuit breaker', 'cost optimization', 'cascade', 'load balancing'],
    prompt_snippets: [
      'cascade fallback from cheapest to most expensive provider',
      'task-aware routing: translation→qwen, code→claude, math→deepseek-r1',
      'circuit breaker pattern for LLM provider resilience',
    ],
    applies_to: ['backend_engineer', 'algorithm_engineer', 'workflow_engineer'],
    source: '分布式系统弹性设计 + AI 模型成本优化实战',
    lang: 'zh-en',
    enabled: true,
  },
  {
    id: 'kb_eng_model_token_mgmt',
    collection: 'engineering',
    subcategory: '多模型集成',
    title: 'Token 管理与 Prompt 缓存',
    summary: 'Token 是 LLM 的计价单位。管理 Token = 管理钱。3 个必用技巧：精算/缓存/压缩。',
    content: `**Token 基础**

- 1 token ≈ 0.75 英文单词 ≈ 0.5 中文汉字
- GPT-4o: 128K context, $2.5/1M input, $10/1M output
- Claude Sonnet: 200K context, $3/1M input, $15/1M output
- DeepSeek: 128K context, $0.14/1M input, $0.28/1M output
- Kimi: 128K/200K/1M context

**技巧 1: 精确计 Token**

用 tiktoken 预估，避免超长：

\`\`\`js
import { encodingForModel } from 'js-tiktoken';
const enc = encodingForModel('gpt-4o');
const tokens = enc.encode('你的内容').length;
console.log('Tokens:', tokens);

// 截断到指定长度
function truncate(text, maxTokens, model = 'gpt-4o') {
  const enc = encodingForModel(model);
  const tokens = enc.encode(text);
  if (tokens.length <= maxTokens) return text;
  return enc.decode(tokens.slice(0, maxTokens));
}
\`\`\`

**技巧 2: Prompt Caching (最省钱)**

**Anthropic Prompt Caching**:
- 缓存的 token 只收 10% 费用
- 适合：长 system prompt + 短 user prompt 场景
- 缓存有效期 5 分钟

\`\`\`js
const response = await anthropic.messages.create({
  model: 'claude-sonnet-4-6',
  max_tokens: 1024,
  system: [
    {
      type: 'text',
      text: VERY_LONG_SYSTEM_PROMPT,  // 比如 KB 上下文 10K tokens
      cache_control: { type: 'ephemeral' },  // 标记缓存
    },
  ],
  messages: [{ role: 'user', content: shortQuestion }],
});
\`\`\`

第一次：10K + 短 = 贵
第二次：100 (cached read) + 短 = 便宜 90%

**OpenAI Prompt Caching**:
- 自动缓存 >1024 token 的 prompt 前缀
- 2x 便宜
- 无需修改代码，自动生效

**技巧 3: 分层压缩**

如果对话历史太长，用分层压缩：

\`\`\`js
async function compressHistory(messages) {
  if (messages.length < 20) return messages;

  // 压缩旧的 15 条为总结
  const oldMessages = messages.slice(0, 15);
  const summary = await callLLM({
    systemPrompt: '请总结以下对话历史，保留关键信息，100 字内',
    userPrompt: JSON.stringify(oldMessages),
  });

  return [
    { role: 'system', content: \`以前的对话总结：\${summary}\` },
    ...messages.slice(15),  // 保留最近 5 条
  ];
}
\`\`\`

**技巧 4: 动态 max_tokens**

不要固定 max_tokens = 4096，按任务调整：

\`\`\`js
const MAX_TOKENS = {
  'classify':  100,
  'summarize': 500,
  'chat':      1500,
  'code':      4000,
  'long-gen':  8000,
};
\`\`\`

**技巧 5: 批量请求**

多个小请求合并：

\`\`\`js
// ❌ 低效：3 次调用
for (const text of texts) {
  await callLLM({ userPrompt: \`分类：\${text}\` });
}

// ✓ 高效：1 次调用
await callLLM({
  systemPrompt: '对每段文本分类，返回 JSON array',
  userPrompt: JSON.stringify(texts),
});
\`\`\`

**技巧 6: 流式输出**

首 token 延迟从 3-5s 降到 0.3s：

\`\`\`js
const stream = await openai.chat.completions.create({
  model: 'gpt-4o',
  messages,
  stream: true,
});

for await (const chunk of stream) {
  const content = chunk.choices[0]?.delta?.content || '';
  res.write(\`data: \${JSON.stringify({ content })}\\n\\n\`);  // SSE 转发
}
\`\`\`

**成本监控仪表盘**

必备指标：
- 每日 token 消耗
- 每 agent 消耗
- 每模型消耗
- 每 task 类型消耗
- 异常峰值告警

**VIDO 级成本示例**

假设每天生成 100 部 60s 短剧：

| 步骤 | Tokens | 模型 | 单价 | 日成本 |
|---|---|---|---|---|
| 编剧 | 5K in + 3K out | claude | $3/$15 | $5.40 |
| 导演 | 8K in + 5K out | claude | $3/$15 | $9.90 |
| 角色 | 2K in + 1K out | claude | $3/$15 | $2.10 |
| 文案 | 1K in + 0.5K out | qwen | $1/$3 | $0.25 |
| **LLM 合计** | - | - | - | **$17.65** |
| 视频生成 | 60s × 100 | kling | $0.1/s | $600 |
| **总成本** | - | - | - | **$617.65/日** |

优化方向：
1. 编剧/导演用 prompt caching → 省 50%
2. 视频用开源 CogVideoX → 省 80%
3. 优化后 ~$300/日`,
    tags: ['token', '成本', '缓存', 'prompt'],
    keywords: ['token management', 'prompt caching', 'tiktoken', 'cost optimization', 'streaming', 'batch request'],
    prompt_snippets: [
      'Anthropic prompt caching with cache_control ephemeral',
      'tiktoken truncation to max context length',
      'compressed conversation history to reduce token cost',
    ],
    applies_to: ['backend_engineer', 'algorithm_engineer'],
    source: 'OpenAI / Anthropic / Google 官方文档 + token 优化实战',
    lang: 'zh-en',
    enabled: true,
  },

  // ═══════════════════════════════════════════════════
  // ③ 多组件设计 (Multi-Component Architecture)
  // ═══════════════════════════════════════════════════
  {
    id: 'kb_eng_arch_microservice',
    collection: 'engineering',
    subcategory: '多组件设计',
    title: '微服务架构设计（AI 视频平台的组件拆分）',
    summary: '复杂 AI 视频平台的 6-8 个核心服务拆分。什么时候拆，什么时候合。',
    content: `**什么时候拆微服务**

**推荐拆分的信号**
- 月活 > 10K，日请求 > 100K
- 团队 > 5 人
- 不同组件性能需求差异大
- 需要独立扩缩容
- 不同组件用不同语言

**不要过早拆分**
- MVP 阶段：单体 > 微服务
- 单体运行良好 → 不要为了"时髦"拆
- 拆分成本：运维 + 调试 + 数据一致性

**VIDO 建议的 8 个服务**

**1. API Gateway (网关)**
- 职责：路由 / 鉴权 / 限流 / 日志
- 技术：Node.js + Express / Kong / Traefik
- 端口：80 / 443

**2. User Service (用户服务)**
- 职责：注册 / 登录 / 权限 / 积分
- 技术：Node.js + JWT
- 端口：3001
- 数据：PostgreSQL

**3. Content Service (内容服务)**
- 职责：项目 / 剧本 / 镜头 / 素材
- 技术：Node.js
- 端口：3002
- 数据：PostgreSQL + S3

**4. AI Orchestrator (AI 编排)**
- 职责：调度 agent pipeline / 任务队列
- 技术：Node.js + BullMQ
- 端口：3003
- 数据：Redis

**5. LLM Worker (语言模型)**
- 职责：调用 Claude/GPT/Deepseek
- 技术：Node.js
- 副本：3-5 个
- 数据：无

**6. Video Worker (视频生成)**
- 职责：调用 Sora/Veo/Kling
- 技术：Python / Node.js
- 副本：5-10 个
- 数据：无

**7. Media Service (媒体处理)**
- 职责：FFmpeg 合成 / 转码 / 字幕
- 技术：Node.js + ffmpeg
- 端口：3004
- 数据：S3

**8. Analytics Service (数据分析)**
- 职责：数据看板 / 用户行为 / 成本追踪
- 技术：Python + ClickHouse
- 端口：3005
- 数据：ClickHouse / BigQuery

**服务间通信**

\`\`\`
[API Gateway]
    ↓ REST
[User / Content / AI Orchestrator]
    ↓ Message Queue (Redis)
[LLM Worker / Video Worker / Media Service]
\`\`\`

**数据一致性**

微服务最难的点。策略：

**1. Saga Pattern (最终一致性)**
\`\`\`
视频生成 saga:
  1. 扣积分 (user-service) → 失败回退
  2. 创建项目 (content-service) → 失败退积分
  3. 提交 LLM (ai-orchestrator) → 失败取消项目
  4. 生成视频 (video-worker) → 失败标记失败
  5. 合成 (media-service) → 失败重试
  6. 通知用户 (notification)
\`\`\`

**2. Event Sourcing**
所有状态变化写入事件日志，重放可恢复。

**3. CQRS**
读写分离。写用关系库，读用 Elasticsearch/Redis。

**服务发现**

- Consul / Etcd / Nacos
- 或简单：Docker Compose + service name DNS

**部署**

- Docker Compose (开发 + 小规模)
- Kubernetes (生产 + 大规模)
- Swarm (中等规模)

**监控栈**

- Logs: Loki / ELK / Splunk
- Metrics: Prometheus + Grafana
- Traces: Jaeger / Tempo
- Alerts: AlertManager / PagerDuty

**陷阱**

- 不要拆太细（1 个功能 1 个服务 = 运维地狱）
- 不要共享数据库（失去独立性）
- 不要同步 RPC 链 > 3 层（延迟累加）
- 不要忽略分布式事务的复杂性

**VIDO 当前状态**

现在是单体 Express，对于一人或小团队是合理的。

**升级到微服务的时机**
- 日请求 > 10 万
- 需要独立扩缩容视频生成
- 团队 > 3 人
- 单体启动慢 / 部署痛

**分步迁移**
1. 先拆 Video Worker（独立进程）
2. 再拆 AI Orchestrator（任务队列）
3. 最后拆 User / Content`,
    tags: ['微服务', '架构', '组件'],
    keywords: ['microservices', 'service architecture', 'api gateway', 'saga pattern', 'event sourcing', 'kubernetes'],
    prompt_snippets: [
      '8-service architecture: gateway/user/content/orchestrator/llm-worker/video-worker/media/analytics',
      'Saga pattern for video generation with compensation',
      'gradual migration from monolith to microservices',
    ],
    applies_to: ['backend_engineer'],
    source: 'Microservices Patterns (Chris Richardson) + 云原生架构实践',
    lang: 'zh-en',
    enabled: true,
  },
  {
    id: 'kb_eng_arch_event_driven',
    collection: 'engineering',
    subcategory: '多组件设计',
    title: '事件驱动架构（AI 视频流程的异步编排）',
    summary: '事件驱动让系统解耦 + 可扩展。AI 视频生成这种长任务尤其适合。',
    content: `**事件驱动的核心**

**传统同步**:
\`\`\`
用户点击生成 → API → 等 5 分钟 → 返回结果
(用户一直等，服务器一直占)
\`\`\`

**事件驱动**:
\`\`\`
用户点击生成 → API → 发事件 → 立刻返回 task_id
                        ↓
           Worker 监听事件 → 处理 → 发"完成"事件
                                    ↓
                          前端订阅 → 收到通知
\`\`\`

**事件的 4 个组成**

1. **Producer** - 发事件
2. **Broker** - 中间件（Redis / Kafka / RabbitMQ）
3. **Consumer** - 消费事件
4. **Event Store** - 事件持久化（可选）

**VIDO 的事件清单**

\`\`\`
video.submitted          —— 用户提交生成请求
script.generation.start  —— 开始生成剧本
script.generation.done   —— 剧本完成
direct.start             —— 导演 agent 开始
direct.done              —— 导演完成
character.lock.start     —— 人物一致性开始
character.lock.done      —— 完成
motion.apply.start       —— 运镜标注
motion.apply.done        —— 完成
video.generation.start   —— 视频生成开始
video.generation.done    —— 单镜头完成
video.generation.all_done —— 所有镜头完成
video.compose.start      —— 合成开始
video.compose.done       —— 合成完成
video.delivered          —— 最终交付
video.failed             —— 任何失败
\`\`\`

**实现：Redis Pub/Sub**

\`\`\`js
// Producer
const redis = new Redis();
await redis.publish('video.submitted', JSON.stringify({
  task_id: '123',
  prompt: 'A cat',
  user_id: 'u1',
}));

// Consumer
const sub = new Redis();
sub.subscribe('video.submitted');
sub.on('message', async (channel, msg) => {
  const task = JSON.parse(msg);
  await processVideo(task);
});
\`\`\`

**实现：BullMQ (推荐)**

BullMQ 提供事件 + 队列 + 重试 + 持久化：

\`\`\`js
import { Queue, Worker, QueueEvents } from 'bullmq';

// 定义队列
const scriptQueue = new Queue('script-gen', { connection: redis });
const directQueue = new Queue('direct', { connection: redis });
const videoQueue = new Queue('video-gen', { connection: redis });

// Worker 1: 剧本
new Worker('script-gen', async (job) => {
  const script = await agentScreenwriter(job.data);
  // 触发下一步
  await directQueue.add('direct', { ...job.data, script });
  return script;
}, { connection: redis });

// Worker 2: 导演
new Worker('direct', async (job) => {
  const directed = await agentDirector(job.data.script);
  await videoQueue.add('video-gen', { ...job.data, directed });
  return directed;
}, { connection: redis });

// Worker 3: 视频
new Worker('video-gen', async (job) => {
  // 并发生成 N 个镜头
  const results = await Promise.all(
    job.data.directed.scenes.map(scene => generateVideoClip(scene))
  );
  return results;
}, { connection: redis });

// 监听完成事件
const events = new QueueEvents('video-gen');
events.on('completed', ({ jobId, returnvalue }) => {
  sseNotify(jobId, { status: 'done', result: returnvalue });
});
\`\`\`

**事件驱动的 5 大好处**

1. **解耦**: 生产者不需要知道消费者是谁
2. **弹性**: 消费者挂了事件还在队列里
3. **扩展**: 加 worker 水平扩展
4. **追溯**: 事件日志可回放
5. **可观测**: 每个事件都有时间戳

**常见陷阱**

- 不要把事件当 RPC 用（fire and forget）
- 不要事件数据太大（用 ID 引用）
- 不要忘记重试策略
- 不要忽略死信队列（Dead Letter Queue）

**VIDO 当前状态**

\`src/services/projectService.js\` 的 \`generateProject()\` 是同步链式调用。

**升级方案**

1. 把每个 agent 拆成独立 BullMQ worker
2. 用事件驱动串联
3. SSE 监听事件推进度给前端
4. 单个 worker 失败不影响整体

**迁移示例**

\`\`\`js
// 现在（同步）
async function generateProject(params) {
  const script = await agentScreenwriter(params);
  const directed = await agentDirector(script);
  // ... 一个挂了整体失败
}

// 新（事件驱动）
async function generateProject(params) {
  const taskId = await scriptQueue.add('script', params);
  return { task_id: taskId };  // 立刻返回
}
// 其他 worker 自动接力
\`\`\``,
    tags: ['事件驱动', 'bullmq', 'redis', '异步'],
    keywords: ['event driven', 'bullmq', 'redis pubsub', 'kafka', 'async orchestration', 'message queue'],
    prompt_snippets: [
      'BullMQ worker chain with event-driven pipeline',
      'Redis pub/sub for loose-coupled microservices',
      'event sourcing with persistent event log',
    ],
    applies_to: ['backend_engineer', 'workflow_engineer'],
    source: 'BullMQ 官方文档 + 事件驱动架构实践',
    lang: 'zh-en',
    enabled: true,
  },
  {
    id: 'kb_eng_arch_frontend_modular',
    collection: 'engineering',
    subcategory: '多组件设计',
    title: '前端微模块化（Module Federation / Micro Frontends）',
    summary: '前端项目变大后的模块化方案。Module Federation 是当前最成熟的微前端方案。',
    content: `**什么时候需要微前端**

- 单个 SPA 打包 > 5MB
- 多团队并行开发同一前端
- 需要不同技术栈（React + Vue 共存）
- 独立部署不同页面

**4 种主流方案**

| 方案 | 特点 | 适用 |
|---|---|---|
| **Module Federation** | Webpack 5 原生 | 中大型 React/Vue |
| **Single-SPA** | 框架无关 | 多技术栈 |
| **Qiankun (蚂蚁)** | 中国常用 | React/Vue 混合 |
| **Web Components** | 原生标准 | 跨框架 |

**Module Federation 详解**

**核心概念**：一个应用 expose 模块给其他应用 remote 引用，类似动态链接库。

**架构**
\`\`\`
Shell App (主框架)
   ↓ remote
   ├─ Dashboard App (独立部署)
   ├─ Editor App (独立部署)
   └─ Settings App (独立部署)
\`\`\`

**配置 Shell**
\`\`\`js
// shell/webpack.config.js
const { ModuleFederationPlugin } = require('webpack').container;

module.exports = {
  plugins: [
    new ModuleFederationPlugin({
      name: 'shell',
      remotes: {
        dashboard: 'dashboard@http://localhost:3001/remoteEntry.js',
        editor: 'editor@http://localhost:3002/remoteEntry.js',
      },
      shared: { react: { singleton: true }, 'react-dom': { singleton: true } },
    }),
  ],
};

// shell/App.jsx
import { lazy, Suspense } from 'react';
const Dashboard = lazy(() => import('dashboard/App'));
const Editor = lazy(() => import('editor/App'));

export default function App() {
  return (
    <Suspense fallback="Loading...">
      <Dashboard />
      <Editor />
    </Suspense>
  );
}
\`\`\`

**配置 Remote (dashboard)**
\`\`\`js
// dashboard/webpack.config.js
module.exports = {
  plugins: [
    new ModuleFederationPlugin({
      name: 'dashboard',
      filename: 'remoteEntry.js',
      exposes: {
        './App': './src/App',
      },
      shared: { react: { singleton: true }, 'react-dom': { singleton: true } },
    }),
  ],
};
\`\`\`

**优点**
- 独立部署
- 独立团队
- 运行时加载
- 共享依赖

**缺点**
- Webpack 配置复杂
- 样式隔离要注意
- 版本管理困难
- 调试不直观

**Qiankun (阿里蚂蚁)**

中国团队更喜欢 Qiankun，配置简单：

\`\`\`js
// 主应用
import { registerMicroApps, start } from 'qiankun';

registerMicroApps([
  {
    name: 'editor-app',
    entry: '//localhost:3001',
    container: '#editor-container',
    activeRule: '/editor',
  },
  {
    name: 'settings-app',
    entry: '//localhost:3002',
    container: '#settings-container',
    activeRule: '/settings',
  },
]);

start();
\`\`\`

**VIDO 前端当前状态**

VIDO 现在是单体原生 JS（无框架），对单人开发最简单。

**何时考虑拆分**
- 团队 > 3 人
- 页面数 > 30
- 功能模块之间低耦合（例：编辑器 / 设置 / 看板）

**现在更合理的中间方案**

不一定要 Module Federation，可以用：
1. **Vite 多入口** - 每个页面独立打包
2. **按路由 code splitting** - React.lazy / defineAsyncComponent
3. **独立 iframe 嵌入** - 最简单的隔离

**陷阱**
- 不要为了微前端而拆
- CSS 隔离是痛点（用 CSS-in-JS 或 Shadow DOM）
- 路由管理复杂（用 single-spa-layout）
- 数据共享麻烦（用全局状态或 custom event）`,
    tags: ['前端', '微前端', 'module federation', '模块化'],
    keywords: ['micro frontends', 'module federation', 'qiankun', 'single-spa', 'webpack 5', 'vite'],
    prompt_snippets: [
      'Module Federation with shell + remote apps pattern',
      'Qiankun registerMicroApps for Chinese team projects',
      'Vite multi-entry build for simpler page splitting',
    ],
    applies_to: ['frontend_engineer'],
    source: 'Webpack 5 Module Federation 文档 + Qiankun 文档',
    lang: 'zh-en',
    enabled: true,
  },

  // ═══════════════════════════════════════════════════
  // ④ 爬虫开发 (Crawler Development)
  // ═══════════════════════════════════════════════════
  {
    id: 'kb_eng_crawl_playwright',
    collection: 'engineering',
    subcategory: '爬虫开发',
    title: 'Playwright / Puppeteer 浏览器自动化（现代爬虫的标配）',
    summary: '传统 HTTP 爬虫已经不够用。现代网站 JS 渲染、反爬严密，必须用真实浏览器环境。',
    content: `**为什么需要浏览器自动化**

- 抖音/小红书/TikTok 等页面全是 obfuscated JS（你之前试过，都失败）
- API 需要 JS 签名（byted_acrawler / X-Bogus / a_bogus）
- 反爬检测：WebGL / Canvas fingerprint / audio fingerprint
- Cloudflare / WAF 拦截非浏览器请求

**Playwright vs Puppeteer**

| 特性 | Playwright | Puppeteer |
|---|---|---|
| 厂商 | Microsoft | Google |
| 浏览器 | Chromium/Firefox/WebKit | 只 Chromium |
| 语言 | JS/Python/Java/.NET | JS only |
| API | 更现代 | 经典 |
| 速度 | 略快 | 略慢 |
| 推荐度 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ |

**Playwright 入门**

\`\`\`js
import { chromium } from 'playwright';

const browser = await chromium.launch({
  headless: false,  // 开发时看到浏览器
  args: ['--disable-blink-features=AutomationControlled'],  // 隐藏 webdriver
});

const context = await browser.newContext({
  viewport: { width: 1920, height: 1080 },
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ...',
});

const page = await context.newPage();
await page.goto('https://www.douyin.com/discover');

// 等待加载
await page.waitForSelector('.video-card');

// 提取数据
const videos = await page.$$eval('.video-card', cards =>
  cards.map(c => ({
    title: c.querySelector('.title')?.textContent,
    author: c.querySelector('.author')?.textContent,
  }))
);

await browser.close();
\`\`\`

**反反爬技巧**

**1. 隐藏自动化标记**
\`\`\`js
await page.addInitScript(() => {
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  // 伪造 plugins
  Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
  // 伪造 languages
  Object.defineProperty(navigator, 'languages', { get: () => ['zh-CN', 'zh'] });
});
\`\`\`

**2. 用 stealth 插件**
\`\`\`js
import { chromium } from 'playwright-extra';
import stealth from 'puppeteer-extra-plugin-stealth';
chromium.use(stealth());
\`\`\`

**3. 真实用户行为**
\`\`\`js
// 鼠标移动（不直接 click）
await page.mouse.move(100, 200);
await page.mouse.move(300, 400, { steps: 10 });

// 缓慢输入
await page.type('.search', 'AI', { delay: 100 });

// 随机等待
await page.waitForTimeout(Math.random() * 2000 + 1000);

// 滚动
await page.evaluate(() => window.scrollBy(0, 500));
\`\`\`

**4. 代理 + IP 轮换**
\`\`\`js
const browser = await chromium.launch({
  proxy: {
    server: 'http://proxy.com:8000',
    username: 'user',
    password: 'pass',
  },
});
\`\`\`

**5. Cookies 注入**
\`\`\`js
await context.addCookies([
  { name: 'sessionid', value: 'xxx', domain: '.douyin.com', path: '/' },
]);
\`\`\`

**分布式爬虫架构**

\`\`\`
[调度器]
    ↓ (URL 任务)
[队列 (Redis)]
    ↓
[Worker #1 (Playwright)] [Worker #2] [Worker #3] ... (每个 Worker 独立浏览器 + 独立代理 IP)
    ↓
[去重 (Redis Set)]
    ↓
[存储 (MongoDB / Elasticsearch)]
\`\`\`

**VIDO 应用场景**

- 市场调研官采集竞品数据
- 热点监控（微博/B站/小红书）
- 创作灵感采集（shot list / prompt 参考）

**陷阱**

- 不要违反 robots.txt
- 不要高频（触发反爬）
- 不要存储用户隐私
- 不要无限制爬（尊重 rate limit）
- 注意法律：商业爬虫 + 用户数据 = 潜在风险

**替代方案：官方 API**

优先考虑平台开放 API：
- 抖音开放平台
- 快手开放平台
- 小红书开放平台
- TikTok for Developers
- 微博开放平台

开放 API 虽然有限制但合规。`,
    tags: ['爬虫', 'playwright', 'puppeteer', '反爬'],
    keywords: ['playwright', 'puppeteer', 'browser automation', 'anti-bot', 'stealth', 'webdriver detection'],
    prompt_snippets: [
      'Playwright chromium with stealth plugin to bypass detection',
      'random mouse movement + typing delay for human-like behavior',
      'rotating proxy IPs for distributed crawling',
    ],
    applies_to: ['crawler_engineer', 'market_research'],
    source: 'Playwright 官方文档 + 反爬对抗实战',
    lang: 'zh-en',
    enabled: true,
  },
  {
    id: 'kb_eng_crawl_scrapy',
    collection: 'engineering',
    subcategory: '爬虫开发',
    title: 'Scrapy 分布式爬虫框架',
    summary: 'Scrapy 是 Python 的工业级爬虫框架。适合大规模（千万级）结构化数据采集。',
    content: `**Scrapy vs Playwright**

- **Scrapy**: 适合大规模（API/HTTP 能搞定的）
- **Playwright**: 适合小规模 + 需要渲染

通常混合使用：Scrapy 处理大流量，Playwright 处理反爬严密的 API。

**Scrapy 架构**

\`\`\`
Spider (你写的)
    ↓
Scheduler (内置，管理 URL 队列)
    ↓
Downloader (内置，发 HTTP)
    ↓
Downloader Middleware (自定义，处理 UA/代理/反爬)
    ↓
Spider Parse
    ↓
Item Pipeline (存数据库 / 去重 / 校验)
\`\`\`

**基础示例**

\`\`\`python
# spiders/douyin_hot.py
import scrapy

class DouyinHotSpider(scrapy.Spider):
    name = 'douyin_hot'
    start_urls = ['https://www.douyin.com/api/discover']

    def parse(self, response):
        data = response.json()
        for item in data['items']:
            yield {
                'id': item['id'],
                'title': item['title'],
                'author': item['author'],
                'like_count': item['like_count'],
            }
        # 下一页
        if data.get('has_more'):
            yield scrapy.Request(response.url + f"&cursor={data['cursor']}", callback=self.parse)
\`\`\`

**运行**
\`\`\`bash
scrapy runspider douyin_hot.py -o output.json
\`\`\`

**分布式：scrapy-redis**

让 Scrapy 变分布式只需 2 行配置：

\`\`\`python
# settings.py
SCHEDULER = 'scrapy_redis.scheduler.Scheduler'
DUPEFILTER_CLASS = 'scrapy_redis.dupefilter.RFPDupeFilter'
REDIS_URL = 'redis://localhost:6379'
\`\`\`

然后启动多个 worker，它们自动从 Redis 抢任务。

**中间件：代理池**

\`\`\`python
# middlewares.py
class ProxyMiddleware:
    def process_request(self, request, spider):
        proxy = self.get_random_proxy()
        request.meta['proxy'] = proxy

    def get_random_proxy(self):
        # 从代理池取
        return redis.srandmember('proxies')
\`\`\`

**中间件：UA 轮换**

\`\`\`python
from fake_useragent import UserAgent
class UAMiddleware:
    def __init__(self):
        self.ua = UserAgent()
    def process_request(self, request, spider):
        request.headers['User-Agent'] = self.ua.random
\`\`\`

**Pipeline：存数据库**

\`\`\`python
# pipelines.py
import pymongo

class MongoPipeline:
    def __init__(self, uri):
        self.client = pymongo.MongoClient(uri)
        self.db = self.client['scraped']
    def process_item(self, item, spider):
        self.db[spider.name].insert_one(dict(item))
        return item
\`\`\`

**Pipeline：去重**

\`\`\`python
class DedupPipeline:
    def __init__(self):
        self.seen = set()
    def process_item(self, item, spider):
        if item['id'] in self.seen:
            raise DropItem('duplicate')
        self.seen.add(item['id'])
        return item
\`\`\`

**反爬对抗**

Scrapy 对纯 API 反爬很强，但对 JS 渲染无能为力。结合：

1. **scrapy-playwright**: 让 Scrapy 能渲染 JS
\`\`\`python
# settings.py
DOWNLOAD_HANDLERS = {
    'http': 'scrapy_playwright.handler.ScrapyPlaywrightDownloadHandler',
    'https': 'scrapy_playwright.handler.ScrapyPlaywrightDownloadHandler',
}

# spider
yield scrapy.Request(url, meta={'playwright': True})
\`\`\`

2. **splash**: 独立的 JS 渲染服务

**监控**

- **ScrapydWeb**: Scrapy 集群管理 UI
- **Gerapy**: 分布式爬虫管理
- **Scrapyd**: 部署爬虫到远程

**VIDO 适用场景**

- 大规模内容数据采集（千万级视频元数据）
- 竞品账号数据定时抓取
- 知识库素材采集（公开电影截图 / 分镜参考）

**注意**

- 尊重 robots.txt
- 频率控制 (DOWNLOAD_DELAY)
- 不存储敏感数据
- 用户授权前不上传数据`,
    tags: ['scrapy', '分布式', 'python', '大规模'],
    keywords: ['scrapy', 'scrapy-redis', 'distributed crawler', 'scrapy-playwright', 'spider'],
    prompt_snippets: [
      'Scrapy spider with Redis-backed distributed scheduling',
      'rotating proxy + UA middleware for anti-bot',
      'MongoDB pipeline with deduplication',
    ],
    applies_to: ['crawler_engineer'],
    source: 'Scrapy 官方文档 + 分布式爬虫实战',
    lang: 'zh-en',
    enabled: true,
  },
  {
    id: 'kb_eng_crawl_antibot',
    collection: 'engineering',
    subcategory: '爬虫开发',
    title: '反爬与反反爬（IP 池 / 指纹 / 验证码 / 签名）',
    summary: '4 大反爬对抗维度：IP 级 + 请求级 + 指纹级 + 算法级。',
    content: `**反爬的 4 个维度**

**维度 1: IP 级**
- 频率检测
- IP 地域
- IDC vs 住宅
- 黑名单

**维度 2: 请求级**
- HTTP headers
- User-Agent
- Referer
- Cookies
- Accept-Language
- HTTP/2 fingerprint

**维度 3: 浏览器指纹级**
- Canvas fingerprint
- WebGL fingerprint
- Audio fingerprint
- Font 检测
- 屏幕分辨率
- Timezone
- Navigator properties

**维度 4: 行为级**
- 鼠标移动轨迹
- 键盘打字节奏
- 滚动模式
- 页面停留时间
- 点击位置随机性

**对抗策略**

**#1 IP 池**

**住宅代理 vs 数据中心代理**
- **数据中心**: 便宜，容易被识别
- **住宅**: 贵，接近真实用户
- 推荐：Bright Data / Oxylabs / Smartproxy / ProxyMesh

**IP 池管理**
\`\`\`python
import redis
import random

class ProxyPool:
    def __init__(self, redis_host):
        self.r = redis.Redis(host=redis_host)

    def get(self):
        # 随机取一个
        return self.r.srandmember('proxies:alive')

    def mark_dead(self, proxy):
        self.r.smove('proxies:alive', 'proxies:dead', proxy)
        # 10 分钟后恢复
        self.r.expire(f'dead:{proxy}', 600)
\`\`\`

**#2 请求级伪装**

**完整的请求头**
\`\`\`python
headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'Accept-Encoding': 'gzip, deflate, br',
    'Referer': 'https://www.google.com/',
    'DNT': '1',
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'cross-site',
    'Sec-Fetch-User': '?1',
}
\`\`\`

**HTTP/2 fingerprint (JA3)**
一些网站检查 TLS/HTTP2 的握手指纹。用 \`curl_cffi\` 模拟真实浏览器：

\`\`\`python
from curl_cffi import requests
# impersonate 成真实浏览器
r = requests.get('https://example.com', impersonate='chrome120')
\`\`\`

**#3 指纹级伪装**

Playwright + stealth 插件自动处理大部分：
\`\`\`js
import { chromium } from 'playwright-extra';
import stealth from 'puppeteer-extra-plugin-stealth';
chromium.use(stealth());
\`\`\`

自定义 Canvas 指纹：
\`\`\`js
await page.addInitScript(() => {
  const getContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function(type) {
    const ctx = getContext.call(this, type);
    if (type === '2d') {
      const getImageData = ctx.getImageData;
      ctx.getImageData = function(...args) {
        const data = getImageData.apply(this, args);
        // 加噪声
        for (let i = 0; i < data.data.length; i += 4) {
          data.data[i] += Math.random() * 0.1;
        }
        return data;
      };
    }
    return ctx;
  };
});
\`\`\`

**#4 验证码识别**

- **图形验证码**: ddddocr (开源) / 2Captcha / AntiCaptcha
- **滑动验证**: 使用浏览器自动化 + 轨迹模拟
- **点击验证**: AI 识别 + 坐标点击
- **行为验证**: 最难，需要模拟真实用户

**#5 签名算法逆向**

抖音的 X-Bogus / a_bogus / TikTok 的 X-Gnarly 都是 JS 签名。

**方案 A: JS 逆向**
在浏览器里打断点，找到签名函数，用 \`execjs\` 在 Python 里调用 JS。

**方案 B: WebDriver 生成**
启动真实浏览器，让浏览器自己生成签名：
\`\`\`js
const bogus = await page.evaluate(() => {
  return window.byted_acrawler.frontierSign({ url: '...' });
});
\`\`\`

**方案 C: 使用开源项目**
GitHub 有人维护的 \`douyin-signature\` 等项目，但要随时关注更新。

**防御性爬虫原则**

1. **控制频率**: 不要打爆目标
2. **尊重 robots.txt**
3. **降级策略**: 触发反爬就自动降频
4. **分布式**: 单 IP 低频 > 单 IP 高频
5. **监控反爬**: 检测 403/429/captcha
6. **合规优先**: 能用官方 API 就不要爬

**法律边界**

- 公开信息 ✓ 大多 ok
- 非公开信息 ✗ 违法
- 用户隐私 ✗ 违法
- 商业数据竞争 ⚠️ 灰色
- 版权内容 ✗ 违法

**VIDO 推荐的数据源**

合规的数据获取：
1. 官方开放平台 API
2. 数据合作方（新榜 / 蝉妈妈 / 飞瓜 购买）
3. 公开的 RSS / Atom feed
4. 合作授权的数据`,
    tags: ['反爬', '反反爬', '指纹', '代理'],
    keywords: ['anti-bot', 'ip pool', 'browser fingerprint', 'canvas fingerprint', 'captcha', 'ja3', 'curl_cffi'],
    prompt_snippets: [
      'residential proxy pool with auto-rotation',
      'playwright-extra stealth plugin with canvas noise',
      'curl_cffi impersonate chrome120 for TLS fingerprint',
    ],
    applies_to: ['crawler_engineer'],
    source: '反爬对抗实战 + 爬虫工程师社区',
    lang: 'zh-en',
    enabled: true,
  },
  {
    id: 'kb_eng_crawl_platforms',
    collection: 'engineering',
    subcategory: '爬虫开发',
    title: '抖音 / 快手 / 小红书 / TikTok 数据采集策略',
    summary: '4 大平台的反爬难度 / 数据价值 / 推荐方案。',
    content: `**4 大平台反爬对比**

| 平台 | 反爬强度 | 数据价值 | 推荐方案 |
|---|---|---|---|
| 抖音 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | 开放平台 API / 合作商 / Playwright 小规模 |
| 快手 | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | 开放平台 API / Playwright |
| 小红书 | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | Playwright + 签名逆向 |
| TikTok | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | TikTok API / Playwright + 代理 |
| B 站 | ⭐⭐ | ⭐⭐⭐⭐ | 开放 API 足够 |
| 微博 | ⭐⭐⭐ | ⭐⭐⭐ | 微博 API / Playwright |
| YouTube | ⭐ | ⭐⭐⭐⭐⭐ | YouTube Data API |

**抖音方案**

**方案 A: 开放平台 (推荐)**
- 抖音开放平台 / 字节跳动开放平台
- 需要企业认证
- 有 API 配额
- 合规性好

**方案 B: Playwright 小规模**
\`\`\`js
const page = await context.newPage();
await page.goto('https://www.douyin.com/discover');
await page.waitForSelector('.video-card', { timeout: 30000 });

// 滚动加载
for (let i = 0; i < 10; i++) {
  await page.evaluate(() => window.scrollBy(0, 1000));
  await page.waitForTimeout(2000);
}

const videos = await page.$$eval('.video-card', cards =>
  cards.map(c => ({ ...}))
);
\`\`\`

**方案 C: 商用数据 API**
- 新榜 / 蝉妈妈 / 飞瓜 提供 API
- 付费但合规
- 数据丰富

**小红书方案**

小红书的签名算法比抖音简单，Playwright 可以直接处理：

\`\`\`js
// 访问小红书搜索
await page.goto('https://www.xiaohongshu.com/search_result?keyword=AI漫剧');
await page.waitForSelector('.note-item');

// 提取笔记
const notes = await page.$$eval('.note-item', items =>
  items.map(i => ({
    id: i.getAttribute('data-id'),
    title: i.querySelector('.title')?.textContent,
    likes: i.querySelector('.like-count')?.textContent,
  }))
);
\`\`\`

**TikTok 方案**

**方案 A: TikTok Research API (官方)**
- tiktok.com/research
- 免费但需申请
- 只限学术用途

**方案 B: TikTok for Developers**
- 需企业认证
- 商业合规

**方案 C: 第三方 (不推荐)**
- TikAPI / TikTok Scraper 等
- 风险：可能违反服务条款

**数据采集频率建议**

| 数据类型 | 推荐频率 | 原因 |
|---|---|---|
| 热点话题 | 每小时 | 变化快 |
| 账号动态 | 每天 | 常规更新 |
| 历史数据 | 每周 | 稳定 |
| 评论数据 | 每小时 | 互动多 |
| 用户画像 | 每月 | 变化慢 |

**数据字段**

推荐至少采集：
- id (唯一)
- 发布时间
- 作者（id + 昵称 + 粉丝数）
- 文本（标题 + 描述）
- 媒体（封面 + 视频 url）
- 互动（播放 + 点赞 + 评论 + 分享）
- 标签 hashtag
- 音乐 / 话题

**数据存储**

- **短期**: Redis (1 周)
- **中期**: MongoDB / Elasticsearch
- **长期**: PostgreSQL / ClickHouse

**VIDO 建议**

1. **优先用官方 API** — 合规 + 稳定
2. **次选商用数据** — 蝉妈妈等
3. **最后 Playwright** — 小规模 + 快速验证
4. **不做大规模爬虫** — 法律风险
5. **尊重平台规则** — 不违反服务条款`,
    tags: ['抖音', '快手', '小红书', 'tiktok', '数据采集'],
    keywords: ['douyin scraping', 'xiaohongshu scraping', 'tiktok api', 'kuaishou', 'social media data'],
    prompt_snippets: [
      'Douyin open platform API for compliant data access',
      'Xiaohongshu note-item scraping with Playwright',
      'TikTok Research API for academic use',
    ],
    applies_to: ['crawler_engineer', 'market_research'],
    source: '各平台开放平台官方文档 + 爬虫实战',
    lang: 'zh-en',
    enabled: true,
  },

  // ═══════════════════════════════════════════════════
  // ⑤ ComfyUI 工程 (5 entries)
  // ═══════════════════════════════════════════════════
  {
    id: 'kb_eng_comfy_architecture',
    collection: 'engineering',
    subcategory: 'ComfyUI',
    title: 'ComfyUI 核心架构与节点系统',
    summary: 'ComfyUI 是节点式 AI 绘画引擎，每个节点是一个函数，图是 DAG。理解它的架构是自定义开发的基础。',
    content: `**ComfyUI 是什么**

- **开源的节点式 Stable Diffusion 界面**
- GitHub: https://github.com/comfyanonymous/ComfyUI
- 特点：灵活、可视化、高度可定制
- 对比 Automatic1111 WebUI：更灵活但学习曲线陡
- 是当前开源 AI 图像/视频生成的事实标准

**核心概念**

**1. 节点 Node**
- 每个节点是一个 Python 函数
- 输入：接收数据
- 输出：产出数据
- 例：\`KSampler\` 输入 model+positive+negative，输出 latent

**2. 连线 Wire**
- 节点之间的数据流
- 类型必须匹配（IMAGE → IMAGE, LATENT → LATENT）

**3. 图 Graph**
- 整个工作流是一个有向无环图 DAG
- 从起点节点（如 \`LoadImage\`）到终点（如 \`SaveImage\`）
- 执行顺序自动推导

**4. 工作流 Workflow**
- 整个图的 JSON 表示
- 可导出、分享、版本控制

**核心节点分类**

**Loaders（加载器）**
- \`CheckpointLoaderSimple\` - 加载主模型 (.safetensors)
- \`LoraLoader\` - 加载 LoRA
- \`VAELoader\` - 加载 VAE
- \`ControlNetLoader\` - 加载 ControlNet
- \`LoadImage\` - 加载图片

**Conditioning（条件）**
- \`CLIPTextEncode\` - 文本编码（positive/negative prompt）
- \`ControlNetApply\` - 应用 ControlNet
- \`ConditioningCombine\` - 合并条件

**Samplers（采样器）**
- \`KSampler\` - 主采样器（最常用）
- \`KSamplerAdvanced\` - 高级参数
- \`SamplerCustom\` - 自定义调度

**Latent（潜空间）**
- \`EmptyLatentImage\` - 空白 latent
- \`VAEDecode\` - latent → image
- \`VAEEncode\` - image → latent
- \`LatentUpscale\` - 潜空间放大

**Image（图像）**
- \`SaveImage\` - 保存
- \`PreviewImage\` - 预览
- \`ImageScale\` - 缩放
- \`ImageComposite\` - 合成

**基础 SDXL 工作流（节点图）**

\`\`\`
CheckpointLoaderSimple (sdxl_base.safetensors)
    ├─ MODEL → KSampler
    ├─ CLIP → CLIPTextEncode (positive) → KSampler
    ├─ CLIP → CLIPTextEncode (negative) → KSampler
    └─ VAE → VAEDecode

EmptyLatentImage (1024x1024) → KSampler

KSampler
    ├─ seed=42, steps=30, cfg=7, sampler='dpmpp_2m', scheduler='karras'
    └─ LATENT → VAEDecode → IMAGE → SaveImage
\`\`\`

**执行模型**

ComfyUI 执行时：
1. 从末端节点（SaveImage）反向追溯依赖
2. 识别变化的节点（和上次比）
3. 只执行变化部分（缓存机制）
4. 输出依赖的节点不执行（惰性）

**这意味着**: 改一个参数只重跑受影响的节点，非常高效。

**ComfyUI 的文件结构**
\`\`\`
ComfyUI/
├── main.py              # 主入口
├── nodes.py             # 所有内置节点定义
├── execution.py         # 执行引擎
├── server.py            # Web 服务器
├── web/                 # 前端
│   └── main.js
├── custom_nodes/        # 自定义节点目录 ⭐
│   ├── ComfyUI-Manager/
│   └── ComfyUI-Impact-Pack/
├── models/              # 模型目录
│   ├── checkpoints/
│   ├── loras/
│   ├── vae/
│   └── controlnet/
└── workflows/           # 工作流 JSON
\`\`\`

**API 模式**

ComfyUI 有官方 API，可以通过 HTTP 调用：

\`\`\`python
import requests

# 提交工作流
r = requests.post('http://localhost:8188/prompt', json={
    'prompt': workflow_json,  # 从 UI 导出的 JSON
    'client_id': 'my-client',
})
prompt_id = r.json()['prompt_id']

# 查询结果
r = requests.get(f'http://localhost:8188/history/{prompt_id}')
outputs = r.json()[prompt_id]['outputs']
\`\`\`

**VIDO 集成 ComfyUI 的场景**

1. **高级图像生成**: 代替 Stability API
2. **ControlNet 精确控制**: 参考图 → 精确生成
3. **LoRA 角色一致性**: 用角色 LoRA 确保一致
4. **自定义工作流**: 一个项目一个工作流模板

**学习资源**

- 官方文档: https://docs.comfy.org/
- Civitai: 模型下载
- 节点编辑器教程: YouTube @SebastianKamph
- 中文社区: ComfyUI.cn`,
    tags: ['comfyui', '架构', '节点', 'stable diffusion'],
    keywords: ['comfyui', 'node-based', 'dag workflow', 'stable diffusion', 'ksampler', 'latent', 'checkpoint'],
    prompt_snippets: [
      'ComfyUI CheckpointLoader + KSampler + VAEDecode basic SDXL workflow',
      'ComfyUI REST API prompt submission with client_id',
      'custom_nodes directory for extension development',
    ],
    applies_to: ['comfyui_engineer', 'algorithm_engineer'],
    source: 'ComfyUI 官方文档 + GitHub 源码分析',
    lang: 'zh-en',
    enabled: true,
  },
  {
    id: 'kb_eng_comfy_custom_node',
    collection: 'engineering',
    subcategory: 'ComfyUI',
    title: 'ComfyUI 自定义节点开发完整指南',
    summary: '自己写节点 = ComfyUI 的核心能力。3 步完成一个自定义节点：定义类 + 注册 + 测试。',
    content: `**自定义节点的价值**

- 封装重复工作流
- 集成外部 API（LLM / 搜索 / 数据库）
- 自定义采样算法
- 工具节点（文件操作 / 数学运算）

**目录结构**

\`\`\`
ComfyUI/custom_nodes/
└── my_custom_nodes/
    ├── __init__.py        # 入口，注册节点
    ├── my_node.py         # 节点实现
    └── README.md
\`\`\`

**最简节点：Hello World**

\`\`\`python
# my_custom_nodes/__init__.py
from .my_node import HelloNode

NODE_CLASS_MAPPINGS = {
    "Hello": HelloNode,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "Hello": "👋 Hello World",
}

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]
\`\`\`

\`\`\`python
# my_custom_nodes/my_node.py
class HelloNode:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "text": ("STRING", {"default": "Hello"}),
                "count": ("INT", {"default": 1, "min": 1, "max": 100}),
            },
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("output",)
    FUNCTION = "execute"
    CATEGORY = "utils"

    def execute(self, text, count):
        return (text * count,)
\`\`\`

**节点类的 6 个必要属性**

1. **\`INPUT_TYPES\`**: 定义输入
   - "required": 必填输入
   - "optional": 可选输入
   - "hidden": 隐藏输入（UI 不显示）

2. **\`RETURN_TYPES\`**: 输出类型元组
   - "STRING", "INT", "FLOAT", "IMAGE", "LATENT", "MODEL", "CLIP", "VAE", "CONTROL_NET" 等

3. **\`RETURN_NAMES\`**: 输出名称（可选）

4. **\`FUNCTION\`**: 执行函数名

5. **\`CATEGORY\`**: 节点在菜单的分类

6. **执行函数**: 接收输入，返回元组

**输入类型详解**

\`\`\`python
"required": {
    # 字符串
    "text": ("STRING", {
        "default": "default text",
        "multiline": True,  # 多行
    }),

    # 整数
    "steps": ("INT", {
        "default": 30,
        "min": 1,
        "max": 100,
        "step": 1,
    }),

    # 浮点
    "cfg": ("FLOAT", {
        "default": 7.0,
        "min": 0.0,
        "max": 20.0,
        "step": 0.1,
    }),

    # 下拉选择
    "sampler": (["euler", "dpmpp_2m", "ddim"],),

    # 布尔
    "enabled": ("BOOLEAN", {"default": True}),

    # 图像
    "image": ("IMAGE",),

    # 潜空间
    "latent": ("LATENT",),
}
\`\`\`

**实战：集成 LLM 节点**

让 ComfyUI 能调用 Claude/GPT 生成 prompt：

\`\`\`python
# llm_prompt_node.py
import openai

class LLMPromptEnhancer:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "base_prompt": ("STRING", {"multiline": True, "default": ""}),
                "style": (["cinematic", "anime", "photorealistic"],),
                "api_key": ("STRING", {"default": ""}),
                "model": (["gpt-4o", "deepseek-chat", "claude-sonnet"],),
            },
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("enhanced_prompt",)
    FUNCTION = "enhance"
    CATEGORY = "LLM"

    def enhance(self, base_prompt, style, api_key, model):
        client = openai.OpenAI(api_key=api_key)
        response = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": f"你是 SDXL prompt 专家。风格：{style}。把用户的简单 prompt 扩写成详细的 SDXL prompt。"},
                {"role": "user", "content": base_prompt},
            ],
        )
        enhanced = response.choices[0].message.content
        return (enhanced,)
\`\`\`

**实战：HTTP 请求节点**

\`\`\`python
import requests

class HTTPGet:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "url": ("STRING", {"default": "https://api.example.com"}),
            },
        }

    RETURN_TYPES = ("STRING",)
    FUNCTION = "get"
    CATEGORY = "utils/http"

    def get(self, url):
        r = requests.get(url)
        return (r.text,)
\`\`\`

**实战：保存到数据库节点**

\`\`\`python
import sqlite3
import numpy as np
from PIL import Image
import io

class SaveToDatabase:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE",),
                "metadata": ("STRING", {"default": "{}"}),
                "db_path": ("STRING", {"default": "outputs/images.db"}),
            },
        }

    RETURN_TYPES = ()
    OUTPUT_NODE = True  # 标记为末端节点
    FUNCTION = "save"
    CATEGORY = "utils/storage"

    def save(self, image, metadata, db_path):
        # image 是 torch tensor，转 PIL
        img = Image.fromarray(
            (image[0].cpu().numpy() * 255).astype(np.uint8)
        )
        buf = io.BytesIO()
        img.save(buf, format='PNG')

        conn = sqlite3.connect(db_path)
        conn.execute('''CREATE TABLE IF NOT EXISTS images
                        (id INTEGER PRIMARY KEY, data BLOB, meta TEXT)''')
        conn.execute('INSERT INTO images (data, meta) VALUES (?, ?)',
                     (buf.getvalue(), metadata))
        conn.commit()
        conn.close()
        return ()
\`\`\`

**调试技巧**

1. 用 \`print()\` 调试（会显示在 ComfyUI 控制台）
2. 启动 ComfyUI 用 \`--verbose\` 查看详细日志
3. 修改节点代码后要重启 ComfyUI
4. Chrome DevTools 查看前端错误

**发布自定义节点**

1. GitHub 开源
2. 提交到 ComfyUI-Manager（方便他人安装）
3. 文档 + 示例工作流

**注意事项**

- 节点函数必须返回 tuple，即使只有一个值
- 长时间执行的任务要考虑异步
- 不要在节点里写死路径（用 \`folder_paths\` 模块）
- 不要修改输入数据（返回新数据）`,
    tags: ['comfyui', '自定义节点', '开发'],
    keywords: ['custom node', 'node development', 'NODE_CLASS_MAPPINGS', 'INPUT_TYPES', 'comfyui plugin'],
    prompt_snippets: [
      'ComfyUI custom node class with INPUT_TYPES and RETURN_TYPES',
      'NODE_CLASS_MAPPINGS registration in __init__.py',
      'OUTPUT_NODE = True for terminal save nodes',
    ],
    applies_to: ['comfyui_engineer', 'algorithm_engineer'],
    source: 'ComfyUI 官方文档 + custom_nodes 源码分析',
    lang: 'zh-en',
    enabled: true,
  },
  {
    id: 'kb_eng_comfy_workflow_patterns',
    collection: 'engineering',
    subcategory: 'ComfyUI',
    title: 'ComfyUI 工作流设计模式（批量 / 条件 / 循环 / 模板）',
    summary: '6 种常用工作流模式：批量生成、条件分支、循环迭代、模板参数化、管道串联、错误处理。',
    content: `**模式 1: 批量生成 (Batch Generation)**

用 \`EmptyLatentImage\` 的 \`batch_size\` 参数一次生成 N 张：

\`\`\`
EmptyLatentImage (width=1024, height=1024, batch_size=8)
    ↓
KSampler
    ↓
VAEDecode
    ↓
SaveImage  (会保存 8 张)
\`\`\`

**批量种子变化**: 用 \`BatchCount\` 节点自动递增种子

**模式 2: X/Y Plot (对比矩阵)**

用 \`XYPlot\` 节点同时跑多个参数组合：

\`\`\`
X轴: cfg = [5, 7, 9, 11]
Y轴: steps = [10, 20, 30]
  → 生成 4x3 = 12 张对比图
\`\`\`

**模式 3: 条件分支**

用 \`Switch\` 或 \`ImpactSwitch\` 节点实现 if-else：

\`\`\`python
if select == 0:
    使用 SDXL base
elif select == 1:
    使用 SDXL refiner
elif select == 2:
    使用 Flux
\`\`\`

配合 \`Impact-Pack\` 提供的逻辑节点：
- \`ImpactSwitch\` - 选择
- \`ImpactConditionalBranch\` - 条件分支
- \`ImpactCompare\` - 比较

**模式 4: 循环迭代**

ComfyUI 原生不支持循环，但有第三方节点：
- \`ImpactLoop\` (Impact-Pack)
- \`efficient_loader\` (Efficiency Nodes)

常见用途：
- 图生图迭代增强
- 多 LoRA 串联
- 分层生成

\`\`\`
Image → KSampler (denoise=0.6) → 再输入 → KSampler (denoise=0.4) → ...
\`\`\`

**模式 5: 模板参数化**

把高频参数抽成节点输入：

\`\`\`
[Primitive String: quality] → CLIPTextEncode
[Primitive String: style] → CLIPTextEncode
[Primitive Int: seed] → KSampler
[Primitive Int: steps] → KSampler
\`\`\`

这样保存工作流后修改简单参数就能批量生成不同风格。

**模式 6: 管道串联 (Pipeline)**

多个子工作流串联：

\`\`\`
阶段 1: 生成 base image
    CheckpointLoader(base.safetensors) → KSampler(steps=20) → VAEDecode → Image1

阶段 2: Upscale
    Image1 → ImageUpscale(4x) → Image2

阶段 3: Refine
    CheckpointLoader(refiner.safetensors) → VAEEncode(Image2) → KSampler(steps=10, denoise=0.3) → VAEDecode → Image3

阶段 4: 保存
    Image3 → SaveImage
\`\`\`

**模式 7: ControlNet 精确控制**

\`\`\`
LoadImage (reference) → Canny 边缘检测 → ControlNetApply
                                                ↓
Positive Prompt → CLIPTextEncode → ControlNetApply → KSampler
\`\`\`

多个 ControlNet 叠加：
- Canny (边缘)
- OpenPose (姿态)
- Depth (深度)

**模式 8: LoRA 混合**

角色 + 风格 LoRA 串联：

\`\`\`
CheckpointLoader
    ↓ MODEL
LoraLoader (character.safetensors, strength=0.8)
    ↓ MODEL
LoraLoader (style.safetensors, strength=0.6)
    ↓ MODEL → KSampler
\`\`\`

**模式 9: 高清修复 (Hires Fix)**

\`\`\`
EmptyLatent (512x512) → KSampler(15 steps)
    → VAEDecode
    → ImageScale (x2, to 1024x1024)
    → VAEEncode
    → KSampler (denoise=0.5, 15 steps, new seed)
    → VAEDecode
    → SaveImage
\`\`\`

**模式 10: Region 控制**

不同区域不同 prompt：

\`\`\`
[Left Region] → Prompt "red flower" → Conditioning
[Right Region] → Prompt "blue sky" → Conditioning
    ↓ ConditioningCombine
    → KSampler
\`\`\`

**工作流的组织最佳实践**

**1. 分组命名**
- 用 \`NodeGroup\` 把相关节点分组
- 给组起有意义的名字

**2. 备注节点**
- 关键参数旁边加 \`Note\` 节点说明

**3. 原型节点**
- 把可变参数抽成 \`Primitive\` 节点
- 易于修改

**4. 保存为模板**
- \`workflows/template_xxx.json\`
- 版本控制友好

**5. 可重用子图**
- 用 \`impact-pack\` 的 \`SubGraph\` 封装

**VIDO 集成建议**

为 VIDO 设计的 ComfyUI 工作流模板：

**模板 A: drama_character.json**
- 输入：角色 prompt + 三视图角度
- 输出：3 张一致性角色图

**模板 B: drama_scene.json**
- 输入：场景 prompt + 氛围 LUT + reference
- 输出：单镜头概念图

**模板 C: video_preview.json**
- 输入：关键帧 + 运镜
- 输出：4 秒 AnimateDiff 视频

所有模板都通过 API 调用，参数从 VIDO 后端传入。`,
    tags: ['comfyui', '工作流', '模式', '设计'],
    keywords: ['workflow patterns', 'batch generation', 'x/y plot', 'controlnet stack', 'hires fix', 'lora stack'],
    prompt_snippets: [
      'batch_size parameter in EmptyLatentImage for batch generation',
      'Impact-Pack SubGraph for reusable workflow components',
      'multi-LoRA stacking for character + style combination',
    ],
    applies_to: ['comfyui_engineer'],
    source: 'ComfyUI 工作流社区 + Civitai 工作流库',
    lang: 'zh-en',
    enabled: true,
  },
  {
    id: 'kb_eng_comfy_models',
    collection: 'engineering',
    subcategory: 'ComfyUI',
    title: 'ComfyUI 模型管理（Checkpoint / LoRA / VAE / ControlNet / Embedding）',
    summary: 'ComfyUI 的模型目录结构和主流模型选型。选对模型比调参数更重要。',
    content: `**模型目录结构**

\`\`\`
ComfyUI/models/
├── checkpoints/      # 主模型 (SDXL / SD1.5 / Flux / SD3)
├── loras/            # LoRA 微调权重
├── vae/              # VAE 解码器
├── controlnet/       # ControlNet 模型
├── embeddings/       # Textual Inversion
├── upscale_models/   # 超分模型 (Real-ESRGAN 等)
├── clip/             # CLIP 视觉编码器
├── clip_vision/      # CLIP 图像理解
├── ipadapter/        # IP Adapter
├── animatediff/      # AnimateDiff motion modules
└── unet/             # UNet-only weights
\`\`\`

**主流 Checkpoint 选型**

**Flux 系列 (2024 最强)**
- **flux1-dev.safetensors** - 质量最高，非商用
- **flux1-schnell.safetensors** - 快速版本，开源商用
- **flux1-fill.safetensors** - inpainting 专用
- 显存需求：12GB+ (FP8 量化版可 8GB)

**SDXL 系列 (稳定主力)**
- **sd_xl_base_1.0.safetensors** - 基础模型
- **sd_xl_refiner_1.0.safetensors** - 精修
- **sdxl_turbo.safetensors** - 极速版（1-4 步）
- **playground-v2.5** - 高饱和风格
- **juggernaut-xl-v9** - 真实感顶级
- 显存需求：8GB+

**SD 3.5 系列**
- **sd3.5-large.safetensors** - 8B 参数
- **sd3.5-medium.safetensors** - 2.5B 参数
- 显存需求：12GB+

**Video 视频模型**
- **Stable Video Diffusion (SVD)** - 图生视频
- **CogVideoX** - 智谱开源，5B/2B
- **HunyuanVideo** - 腾讯，13B
- **LTXVideo** - 极速视频生成
- **Wan** - 阿里开源

**LoRA (微调权重)**

LoRA 是小体积（10-200MB）的模型微调。用途：
- 角色（特定人物）
- 风格（如素描/水彩/赛璐璐）
- 概念（如 cyberpunk / steampunk）
- 服装/物品

**Civitai.com** 是 LoRA 的主流下载站，模型非常多。

**LoRA 使用**
\`\`\`
CheckpointLoader
    ↓ MODEL
LoraLoader (character_lora.safetensors, strength=0.8)
    ↓ MODEL
KSampler
\`\`\`

**strength** 建议 0.6-1.0，太强会影响基础质量。

**多 LoRA 混合**

\`\`\`
LoraLoader(character, 0.8)
    → LoraLoader(style, 0.6)
    → LoraLoader(background, 0.4)
    → KSampler
\`\`\`

**VAE (Variational Autoencoder)**

VAE 负责 latent → image 的转换。不同 VAE 影响最终色彩。

主流 VAE：
- **sdxl_vae.safetensors** (SDXL 配套)
- **vae-ft-mse-840000** (SD1.5 通用)
- **kl-f8-anime2** (动漫专用)

**ControlNet (精确控制)**

用参考图控制生成：

**主流 ControlNet**
- **Canny** - 边缘检测，最通用
- **OpenPose** - 人体姿态
- **Depth** - 深度图
- **Normal** - 法线
- **Lineart** - 线稿
- **Scribble** - 涂鸦
- **Seg** - 语义分割
- **Tile** - 图块（超分用）

**SDXL 版**：controlnet-union-sdxl-1.0 (一个文件包含多种)

**Embedding (Textual Inversion)**

向 CLIP 注入新 token：
- 体积极小（KB 级别）
- 用法：在 prompt 里直接用 embedding 名字
- \`embedding:negative_prompt_sdxl\` 经典负面 prompt

**IP-Adapter (参考图风格)**

比 ControlNet 更灵活：
- 输入：1 张参考图
- 效果：生成图保持参考图的"感觉"
- 不需要精确对齐，只要风格像

**ipadapter_plus_sdxl.safetensors** 是主流。

**Upscale 超分模型**

生成的 1024 图 → 4096：
- **Real-ESRGAN-x4plus** - 通用最佳
- **4x-UltraSharp** - 细节强
- **SwinIR** - 质量高但慢

**模型管理建议**

**1. 只下载需要的**
- 一个 SDXL checkpoint = 6GB
- 一个 Flux = 23GB
- 磁盘管理很重要

**2. 用 ComfyUI-Manager**
- 一键安装常用节点和模型
- 版本管理方便

**3. 模型存在 NAS / 共享盘**
- 多机器共享
- 节省空间

**4. 软链接**
- 把 \`models\` 目录软链到大盘
\`\`\`bash
ln -s /data/comfyui-models ComfyUI/models
\`\`\`

**5. 版本跟踪**
- 哪个模型哪个版本用于哪个项目
- 用 CSV / Notion 记录

**VIDO 实战推荐**

对中文 AI 漫剧项目：

**主力 Checkpoint**: Juggernaut XL v9 (真实) 或 AnythingXL (动漫)
**角色 LoRA**: 自训练（用 kohya_ss）
**风格 LoRA**: Civitai 下载（如 "Studio Ghibli Style"）
**ControlNet**: Canny + OpenPose 双控
**Video**: CogVideoX-5B (免费开源)
**超分**: Real-ESRGAN-x4plus

**硬件建议**
- RTX 4090 24GB (个人)
- RTX 6000 Ada 48GB (专业)
- 云: RunPod / Vast.ai / 阿里云`,
    tags: ['comfyui', '模型', 'checkpoint', 'lora', 'controlnet'],
    keywords: ['checkpoint', 'lora', 'vae', 'controlnet', 'ip-adapter', 'flux', 'sdxl', 'civitai'],
    prompt_snippets: [
      'Flux1-dev for highest quality, schnell for speed',
      'SDXL base + refiner two-stage pipeline',
      'multi-LoRA stack: character 0.8 + style 0.6 + background 0.4',
    ],
    applies_to: ['comfyui_engineer', 'algorithm_engineer'],
    source: 'Civitai 模型库 + ComfyUI 官方模型支持文档',
    lang: 'zh-en',
    enabled: true,
  },
  {
    id: 'kb_eng_comfy_vido_integration',
    collection: 'engineering',
    subcategory: 'ComfyUI',
    title: 'ComfyUI API 与 VIDO 后端集成方案',
    summary: '把 ComfyUI 变成 VIDO 后端的一个"超能力" worker。通过 HTTP API 调用 + 模板化工作流。',
    content: `**集成架构**

\`\`\`
VIDO Node.js 后端
    ↓ HTTP POST
ComfyUI API (localhost:8188)
    ↓ 执行工作流
输出图像到 /output
    ↓ HTTP GET
VIDO 读取 + 存储
\`\`\`

**ComfyUI API 3 个核心端点**

**1. POST /prompt** - 提交工作流
\`\`\`
body: { prompt: workflow_json, client_id: "vido-xxx" }
returns: { prompt_id: "uuid", number: 1 }
\`\`\`

**2. GET /history/{prompt_id}** - 查询结果
\`\`\`
returns: {
  "<prompt_id>": {
    "status": { ... },
    "outputs": {
      "<node_id>": { "images": [{ filename, subfolder, type }] }
    }
  }
}
\`\`\`

**3. GET /view?filename=xxx** - 下载图像
\`\`\`
returns: image bytes
\`\`\`

**4. WebSocket /ws** - 实时进度（可选）
\`\`\`
可订阅 executing / progress / execution_error 等事件
\`\`\`

**Node.js 集成代码**

\`\`\`js
// src/services/comfyUIService.js
const axios = require('axios');
const fs = require('fs');

const COMFY_URL = process.env.COMFYUI_URL || 'http://localhost:8188';

class ComfyUIClient {
  async submit(workflow, clientId = 'vido') {
    const r = await axios.post(\`\${COMFY_URL}/prompt\`, {
      prompt: workflow,
      client_id: clientId,
    });
    return r.data.prompt_id;
  }

  async waitForResult(promptId, maxWait = 300000) {
    const start = Date.now();
    while (Date.now() - start < maxWait) {
      const r = await axios.get(\`\${COMFY_URL}/history/\${promptId}\`);
      const data = r.data[promptId];
      if (data) {
        if (data.status?.completed) {
          return data.outputs;
        }
        if (data.status?.status_str === 'error') {
          throw new Error('ComfyUI execution error');
        }
      }
      await new Promise(r => setTimeout(r, 2000));
    }
    throw new Error('ComfyUI timeout');
  }

  async downloadImage(filename, subfolder = '', type = 'output') {
    const r = await axios.get(\`\${COMFY_URL}/view\`, {
      params: { filename, subfolder, type },
      responseType: 'arraybuffer',
    });
    return Buffer.from(r.data);
  }

  async runWorkflow(workflowTemplate, params) {
    // 把参数注入到工作流模板
    const workflow = this.applyParams(workflowTemplate, params);

    const promptId = await this.submit(workflow);
    const outputs = await this.waitForResult(promptId);

    // 下载所有输出图像
    const results = [];
    for (const [nodeId, output] of Object.entries(outputs)) {
      if (output.images) {
        for (const img of output.images) {
          const buffer = await this.downloadImage(img.filename, img.subfolder, img.type);
          results.push({ nodeId, filename: img.filename, buffer });
        }
      }
    }
    return results;
  }

  applyParams(template, params) {
    // 深拷贝工作流并替换参数
    const wf = JSON.parse(JSON.stringify(template));
    for (const [path, value] of Object.entries(params)) {
      // path 格式: "<nodeId>.inputs.<paramName>"
      const [nodeId, _, paramName] = path.split('.');
      if (wf[nodeId] && wf[nodeId].inputs) {
        wf[nodeId].inputs[paramName] = value;
      }
    }
    return wf;
  }
}

module.exports = new ComfyUIClient();
\`\`\`

**工作流模板管理**

\`\`\`
vido/
└── comfy_workflows/
    ├── character_three_view.json
    ├── scene_concept.json
    ├── lora_training.json
    ├── img2img_enhance.json
    └── video_animatediff.json
\`\`\`

**工作流模板用法**

\`\`\`js
// routes/comfy.js
const fs = require('fs');
const comfy = require('../services/comfyUIService');

router.post('/generate-character', async (req, res) => {
  const { prompt, seed, lora_name } = req.body;

  // 加载模板
  const template = JSON.parse(
    fs.readFileSync('./comfy_workflows/character_three_view.json', 'utf8')
  );

  // 注入参数
  const results = await comfy.runWorkflow(template, {
    '6.inputs.text': prompt,             // CLIPTextEncode positive
    '3.inputs.seed': seed,                // KSampler seed
    '10.inputs.lora_name': lora_name,     // LoraLoader
  });

  // 保存到 VIDO 的存储
  const saved = [];
  for (const r of results) {
    const path = \`./outputs/characters/\${Date.now()}_\${r.filename}\`;
    fs.writeFileSync(path, r.buffer);
    saved.push(path);
  }

  res.json({ success: true, images: saved });
});
\`\`\`

**WebSocket 实时进度**

\`\`\`js
const WebSocket = require('ws');

async function submitWithProgress(workflow, onProgress) {
  const clientId = \`vido-\${Date.now()}\`;
  const ws = new WebSocket(\`ws://localhost:8188/ws?clientId=\${clientId}\`);

  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.type === 'progress') {
      onProgress(msg.data.value / msg.data.max);
    }
    if (msg.type === 'executing') {
      onProgress({ node: msg.data.node });
    }
  });

  const promptId = await comfy.submit(workflow, clientId);
  // 等待完成...
  ws.close();
}
\`\`\`

**部署方案**

**方案 A: 本地部署**
- VIDO Node + ComfyUI 同机器
- 网络延迟 0
- 适合单人开发

**方案 B: 独立 GPU 服务**
- VIDO 在便宜机器
- ComfyUI 在 GPU 机器（A100 / 4090）
- 通过内网 API 调用
- 推荐生产

**方案 C: 云 GPU 按需**
- RunPod / Vast.ai 按需起 ComfyUI 实例
- 使用时才计费
- 适合流量不稳定

**方案 D: Serverless**
- Replicate / Modal 托管
- 给 API 调用

**安全考虑**

- ComfyUI 默认没鉴权，不要暴露到公网
- 用反向代理加 basic auth
- 或 VPN 内网访问
- API key 轮换

**监控指标**

- GPU 利用率
- VRAM 使用
- 单次任务耗时
- 队列长度
- 失败率`,
    tags: ['comfyui', 'api', '集成', 'vido'],
    keywords: ['comfyui api', 'vido integration', 'workflow template', 'prompt_id', 'websocket progress'],
    prompt_snippets: [
      'POST /prompt with workflow JSON and client_id',
      'GET /history/{prompt_id} polling for completion',
      'WebSocket /ws for real-time progress events',
    ],
    applies_to: ['comfyui_engineer', 'backend_engineer'],
    source: 'ComfyUI API 官方文档 + 集成实战',
    lang: 'zh-en',
    enabled: true,
  },

  // ═══════════════════════════════════════════════════
  // ⑥ 工作流编排 (Workflow Orchestration)
  // ═══════════════════════════════════════════════════
  {
    id: 'kb_eng_wf_coze',
    collection: 'engineering',
    subcategory: '工作流编排',
    title: 'Coze 工作流完整设计指南（字节跳动的 LLM 工作流平台）',
    summary: 'Coze 是 LLM 工作流的行业标杆。节点化 + 插件化 + Bot 化。学习 Coze 的设计模式可借鉴到自研。',
    content: `**Coze 是什么**

- 字节跳动旗下 Bot 开发平台
- 国内：coze.cn
- 海外：coze.com
- 特点：拖拽式节点编辑器，面向 Chat Bot 开发

**Coze 工作流的核心概念**

**1. 节点 Node**
- 每个节点是一个功能单元
- 输入输出明确
- 类似 ComfyUI 但面向 LLM

**2. 变量 Variable**
- 工作流中传递数据
- 支持：string / number / array / object

**3. 插件 Plugin**
- 调用外部 API 的封装
- 可以是官方 / 社区 / 自定义

**4. Bot**
- 一个 Bot 可以挂多个工作流
- Bot 对外提供对话接口

**主要节点类型**

**1. LLM 节点**
- 调用 LLM（GPT / Claude / 豆包等）
- 配置：模型 / 温度 / system prompt / 输入变量

**2. 插件节点**
- 调用 API（搜索 / 数据库 / 计算）
- 配置：插件 + 参数

**3. 代码节点**
- 运行 JavaScript 代码
- 处理数据转换、条件判断

**4. 知识库节点**
- RAG 检索
- 配置：知识库 ID + 检索 top K

**5. 选择器节点**
- If-else 分支
- 配置：条件表达式

**6. 结束节点**
- 输出最终结果
- 配置：返回变量

**7. 开始节点**
- 定义输入参数
- 配置：参数类型

**工作流设计模式**

**模式 1: RAG 问答**
\`\`\`
[开始] (用户问题)
    ↓
[知识库检索] (top 5)
    ↓
[LLM] (用检索结果回答)
    ↓
[结束] (返回回答)
\`\`\`

**模式 2: 多轮对话**
\`\`\`
[开始] (问题 + 历史)
    ↓
[LLM1: 意图识别] → 分流
    ↓
[选择器]
   ├─ 搜索意图 → [搜索插件]
   ├─ 计算意图 → [代码节点]
   └─ 闲聊意图 → [LLM2: 回复]
    ↓
[结束]
\`\`\`

**模式 3: 多步骤编排**
\`\`\`
[开始] (主题)
    ↓
[LLM: 生成大纲]
    ↓
[代码: 解析大纲]
    ↓
[循环]
    └─ [LLM: 生成每章内容]
    ↓
[代码: 拼接成文]
    ↓
[结束] (完整文章)
\`\`\`

**模式 4: Agent 协作**
\`\`\`
[开始]
    ↓
[LLM: 调度 Agent]
    ↓ (决定调哪个 agent)
[选择器]
   ├─ [编剧 Agent]
   ├─ [导演 Agent]
   └─ [剪辑 Agent]
    ↓
[LLM: 综合结果]
    ↓
[结束]
\`\`\`

**Coze 最佳实践**

**1. 严格的变量命名**
- 用 snake_case
- 语义清晰
- 避免 \`data / result / output\` 这种泛词

**2. 充分利用选择器**
- 别让 LLM 做分类
- 用明确的 if-else

**3. 代码节点做转换**
- 不要在 prompt 里让 LLM 做 JSON 解析
- 用代码节点更可靠

**4. 插件解耦**
- 每个外部 API 一个插件
- 插件内部错误处理

**5. 测试用例**
- 每个工作流至少 3 个测试用例
- 边界情况必测

**6. 监控**
- 看每个节点的耗时
- 找 bottleneck

**Coze vs 自研**

| 维度 | Coze | 自研 |
|---|---|---|
| 开发速度 | 极快 | 慢 |
| 成本 | 免费/按调用 | 服务器成本 |
| 灵活性 | 有限 | 无限 |
| 定制 | 插件有限 | 完全自由 |
| 依赖 | 受平台制约 | 独立 |

**VIDO 的选择**

**短期（MVP 阶段）**：
- 用 Coze 快速验证想法
- 把复杂的 agent 逻辑建在 Coze
- 通过 Coze API 对接 VIDO 主站

**长期（规模化）**：
- 自研工作流引擎
- 借鉴 Coze 的设计模式
- 完全控制成本和数据

**从 Coze 借鉴的核心思想**

1. **节点化** - 每个步骤独立、可测
2. **变量传递** - 明确的数据流
3. **类型系统** - 输入输出类型约束
4. **错误处理** - 每个节点都要有 try-catch
5. **可视化** - 开发者能看到工作流图

**VIDO 自研工作流服务架构**

\`\`\`
WorkflowEngine
  ├─ parse(workflow_json) → DAG
  ├─ execute(dag, inputs)  → 按拓扑序执行节点
  ├─ validateTypes(dag)    → 类型检查
  └─ trace(executionId)    → 可观测

Node 基类
  ├─ inputs / outputs 定义
  ├─ execute(context) 方法
  ├─ validate() 方法
  └─ onError() 方法

常用节点子类
  ├─ LLMNode
  ├─ HttpNode
  ├─ CodeNode
  ├─ KBSearchNode (RAG)
  ├─ IfElseNode
  └─ LoopNode
\`\`\``,
    tags: ['coze', '工作流', 'llm', '编排'],
    keywords: ['coze workflow', 'bot platform', 'llm orchestration', 'node-based', 'rag', 'bytedance'],
    prompt_snippets: [
      'Coze-style node-based workflow with type-safe variables',
      'RAG pattern: retrieve → LLM → respond',
      'multi-agent orchestration with intent router',
    ],
    applies_to: ['workflow_engineer', 'backend_engineer'],
    source: 'Coze 官方文档 + 字节跳动工作流实践',
    lang: 'zh-en',
    enabled: true,
  },
  {
    id: 'kb_eng_wf_dify',
    collection: 'engineering',
    subcategory: '工作流编排',
    title: 'Dify / n8n / Langflow 等 LLMOps 平台对比',
    summary: '7 个主流 LLMOps / Workflow 平台对比。Dify 开源最强，n8n 集成最广。',
    content: `**主流平台一览**

| 平台 | 开源 | 中文 | 定位 | 优势 |
|---|---|---|---|---|
| Coze | ✗ | ★★★★★ | Bot 平台 | 字节生态 |
| Dify | ✓ | ★★★★ | LLMOps | 开源最强 |
| n8n | ✓ | ★★ | 通用自动化 | 400+ 集成 |
| Langflow | ✓ | ★★ | LangChain 可视化 | 快速原型 |
| Flowise | ✓ | ★★ | LangChain 可视化 | 简单易用 |
| FastGPT | ✓ | ★★★★★ | RAG + 工作流 | 国产之光 |
| Bisheng | ✓ | ★★★★★ | 企业级 | 华为系 |
| MaxKB | ✓ | ★★★★ | 知识库为主 | 中文友好 |

**Dify 详解**

**定位**: 企业级 LLMOps 平台（开源）

**核心功能**
- 可视化工作流
- Prompt Studio
- 数据集 / 知识库
- 应用商店
- API 网关
- 监控 + 日志

**适合场景**
- 中大型企业 AI 应用开发
- 需要完整的 LLMOps 能力
- 私有化部署

**部署**
\`\`\`bash
git clone https://github.com/langgenius/dify.git
cd dify/docker
docker-compose up -d
\`\`\`

**Dify 工作流示例**
\`\`\`
[开始] (question)
    ↓
[知识库检索] (向量库 → top 5)
    ↓
[LLM] (GPT-4 with context)
    ↓
[条件分支] (if answer contains 'not sure')
    ├─ True → [Web 搜索] → [LLM 总结]
    └─ False → [直接返回]
    ↓
[结束]
\`\`\`

**n8n 详解**

**定位**: 通用自动化（像 Zapier 但开源）

**核心功能**
- 400+ 预置集成
- 可视化工作流
- 自托管 / 云版
- Webhook 触发
- 代码节点

**适合场景**
- 需要集成大量 SaaS（Slack/Gmail/Notion/Airtable）
- 非 AI 核心的自动化
- Webhook 触发的流程

**部署**
\`\`\`bash
docker run -it --rm --name n8n -p 5678:5678 n8nio/n8n
\`\`\`

**n8n 工作流示例**
\`\`\`
[Webhook 触发] (接收 POST)
    ↓
[HTTP Request] (调用 OpenAI)
    ↓
[Function] (处理 JSON)
    ↓
[Notion] (写入数据库)
    ↓
[Slack] (通知)
\`\`\`

**Langflow / Flowise 详解**

**定位**: LangChain 的可视化封装

**核心功能**
- 拖拽构建 LangChain chains
- 所有 LangChain 组件
- 导出 Python 代码
- 快速原型

**适合场景**
- 快速验证 LangChain idea
- 对 LangChain 熟悉
- 不需要生产级 SLA

**FastGPT 详解**

**定位**: 中国开源之光，RAG + 工作流

**核心功能**
- 知识库 RAG
- 可视化工作流
- 团队协作
- 企业级部署

**特色**
- 中文优化最好
- 对接国产模型（Qwen / Doubao / Kimi）
- 社区活跃

**部署**
\`\`\`bash
git clone https://github.com/labring/FastGPT.git
cd FastGPT/deploy/docker
docker-compose up -d
\`\`\`

**选型决策树**

\`\`\`
你的需求？
├─ 中文优化 + 开源 → FastGPT
├─ 企业级 LLMOps → Dify
├─ 大量 SaaS 集成 → n8n
├─ LangChain 可视化 → Langflow
├─ 字节生态快速上线 → Coze
└─ 完全自研 → 自己写
\`\`\`

**VIDO 建议**

**场景 1: 运营自动化**
- 用 n8n：发布视频后自动通知 / 收集评论 / 入库

**场景 2: Bot 客服**
- 用 Coze / FastGPT：用户对话 + 知识库

**场景 3: 视频生成 pipeline**
- 自研（VIDO 已有 dramaService）
- 借鉴 Dify 的节点设计

**工作流的共同设计模式**

不管用哪个平台，核心模式是一样的：

1. **输入定义** - 明确类型
2. **节点串联** - 每个节点有明确职责
3. **条件分支** - 处理不同情况
4. **错误处理** - 失败回退
5. **输出规范** - 结构化返回

**自研 vs 开源选择**

**选自研**:
- 对性能有极致要求
- 有独特业务逻辑
- 团队有能力维护

**选开源平台**:
- 需要快速上线
- 标准流程足够
- 想跟随社区升级

**VIDO 当前状态**
- dramaService 是自研的 pipeline
- 可以考虑借鉴 Dify 的节点抽象，但不必替换

**混合方案**
- 核心 pipeline 自研
- 运营工作流用 n8n
- Bot 对话用 Coze / FastGPT`,
    tags: ['dify', 'n8n', 'langflow', 'fastgpt', '对比'],
    keywords: ['dify', 'n8n', 'langflow', 'flowise', 'fastgpt', 'llmops', 'workflow platform'],
    prompt_snippets: [
      'Dify for enterprise LLMOps with private deployment',
      'n8n for 400+ SaaS integrations and webhook automation',
      'FastGPT for Chinese-optimized RAG workflows',
    ],
    applies_to: ['workflow_engineer', 'backend_engineer'],
    source: '各平台官方文档 + 开源社区对比',
    lang: 'zh-en',
    enabled: true,
  },
  {
    id: 'kb_eng_wf_patterns',
    collection: 'engineering',
    subcategory: '工作流编排',
    title: '工作流设计模式（Saga / Choreography / Orchestration / Chain of Responsibility）',
    summary: '4 种主流工作流设计模式 + 错误处理 + 重试策略 + 状态机模型。',
    content: `**核心概念：工作流 = 有状态的流程**

一个工作流至少有：
- **状态 State** - 当前进度
- **步骤 Steps** - 执行序列
- **数据 Data** - 各步骤之间传递
- **错误处理 Error handling**
- **持久化 Persistence** - 重启可恢复

**4 种主流模式**

**#1 Orchestration 编排 (中心化)**

有一个"总调度员"负责按顺序调用各个服务。

\`\`\`
Orchestrator
    ├─ Call Service A
    ├─ Call Service B
    ├─ Call Service C
    └─ Return final result
\`\`\`

**优点**: 集中控制，可观测性强
**缺点**: 调度员成为单点
**适合**: 明确的线性流程

**VIDO dramaService 是 Orchestration**

**#2 Choreography 编舞 (去中心化)**

各服务通过事件协作，没有中心调度员。

\`\`\`
Service A → emit event X → Service B
                              ↓
                        emit event Y → Service C
\`\`\`

**优点**: 解耦，扩展性强
**缺点**: 难观测，调试困难
**适合**: 微服务 + 事件驱动

**#3 Saga 长事务**

处理跨服务的长事务，每一步有补偿操作。

\`\`\`
Step 1: 扣积分 → 补偿: 退积分
Step 2: 创建项目 → 补偿: 删除项目
Step 3: 提交生成 → 补偿: 取消任务
Step 4: 合成视频 → 补偿: 删除视频
Step 5: 通知用户 → 补偿: -

任何一步失败 → 反向执行所有补偿
\`\`\`

**实现 Saga 的 2 种方式**:
- **Saga Orchestration**: 中心化 saga 协调器
- **Saga Choreography**: 事件驱动 saga

**#4 Chain of Responsibility 责任链**

请求沿一条链传递，每个节点决定是自己处理还是传递下去。

\`\`\`
Request → Middleware 1 → Middleware 2 → Middleware 3 → Handler
\`\`\`

Express / Koa 的中间件就是这个模式。

**错误处理策略**

**策略 1: Retry (重试)**
\`\`\`js
async function withRetry(fn, maxRetries = 3, backoff = 1000) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i === maxRetries - 1) throw e;
      await sleep(backoff * Math.pow(2, i)); // 指数退避
    }
  }
}
\`\`\`

**策略 2: Circuit Breaker (熔断)**
\`\`\`js
if (failCount > threshold) {
  state = 'OPEN';  // 直接失败，不再调用
  setTimeout(() => state = 'HALF_OPEN', resetTime);
}
\`\`\`

**策略 3: Timeout**
\`\`\`js
await Promise.race([
  fn(),
  new Promise((_, rej) => setTimeout(() => rej('Timeout'), 30000)),
]);
\`\`\`

**策略 4: Fallback**
\`\`\`js
try {
  return await primaryService();
} catch (e) {
  return await fallbackService();
}
\`\`\`

**策略 5: Dead Letter Queue**
\`\`\`js
try {
  await process(msg);
} catch (e) {
  // 处理失败 → 进 DLQ 人工介入
  await deadLetterQueue.push({ msg, error: e, timestamp: Date.now() });
}
\`\`\`

**状态机模型**

用状态机描述工作流：

\`\`\`js
const workflow = createMachine({
  id: 'videoGen',
  initial: 'idle',
  states: {
    idle: {
      on: { START: 'scriptGen' },
    },
    scriptGen: {
      on: {
        SUCCESS: 'direct',
        FAILURE: 'failed',
      },
    },
    direct: {
      on: {
        SUCCESS: 'characterLock',
        FAILURE: 'failed',
      },
    },
    characterLock: {
      on: {
        SUCCESS: 'motion',
        FAILURE: 'failed',
      },
    },
    motion: {
      on: {
        SUCCESS: 'videoGen',
        FAILURE: 'failed',
      },
    },
    videoGen: {
      on: {
        SUCCESS: 'compose',
        FAILURE: 'failed',
      },
    },
    compose: {
      on: {
        SUCCESS: 'done',
        FAILURE: 'failed',
      },
    },
    done: { type: 'final' },
    failed: {
      on: { RETRY: 'scriptGen' },
    },
  },
});
\`\`\`

**XState** 是 JS 的主流状态机库。

**持久化**

长任务必须能恢复：

**数据库字段**
\`\`\`
workflow_instance:
  id: uuid
  workflow_type: 'video_gen'
  current_state: 'direct'
  data: { script: {...}, ... }
  created_at: timestamp
  updated_at: timestamp
  error: text?
\`\`\`

**恢复逻辑**
\`\`\`js
// 服务启动时
const pendingInstances = db.query(
  'SELECT * FROM workflow_instance WHERE current_state NOT IN ("done", "failed")'
);
for (const instance of pendingInstances) {
  workflowEngine.resume(instance);
}
\`\`\`

**可观测性**

**指标**
- 每步耗时
- 失败率
- 队列长度
- 资源使用

**日志**
- 每步开始 / 结束
- 输入 / 输出 (结构化)
- 错误堆栈

**追踪**
- TraceId 贯穿全流程
- 用 Jaeger / Zipkin

**VIDO 升级路径**

**现在**: generateDrama 是同步链式调用
**中期**: 加状态机 + 持久化
**长期**: 分布式 saga + 微服务

**保留**: Orchestration 模式（不拆微服务）
**改进**:
1. 每步持久化状态到 DB
2. 失败可恢复
3. 每步有 retry / timeout
4. 加 trace ID

**严格遵守工作流的原则**

用户明确要求"完全遵守工作流的每一个步骤"：

1. **不要跳过步骤** - 即使简单也要走流程
2. **每步必须校验** - 输入/输出类型检查
3. **不能并行的不并行** - 有依赖就严格串行
4. **状态必须持久化** - 崩溃能恢复
5. **错误要记录** - 不吞异常
6. **每步有 checkpoint** - 可重入`,
    tags: ['工作流', '设计模式', 'saga', '状态机'],
    keywords: ['workflow patterns', 'orchestration', 'choreography', 'saga', 'state machine', 'xstate', 'retry', 'circuit breaker'],
    prompt_snippets: [
      'Orchestration pattern with centralized workflow engine',
      'Saga pattern with compensation for distributed transactions',
      'XState state machine for video generation workflow',
      'exponential backoff retry with circuit breaker',
    ],
    applies_to: ['workflow_engineer', 'backend_engineer'],
    source: '《Microservices Patterns》Chris Richardson + 分布式系统设计',
    lang: 'zh-en',
    enabled: true,
  },
  {
    id: 'kb_eng_wf_coze_comfyui_integration',
    collection: 'engineering',
    subcategory: '工作流编排',
    title: '基于 Coze + ComfyUI 的混合工作流设计（VIDO 推荐架构）',
    summary: 'Coze 负责 LLM 决策，ComfyUI 负责图像生成，VIDO 主程序负责编排。三层架构最佳实践。',
    content: `**为什么要混合**

- **Coze**: LLM 决策最强，但不能做图像生成
- **ComfyUI**: 图像/视频生成最强，但不适合复杂决策
- **VIDO 主程序**: 把两者编排起来，对用户提供统一接口

**三层架构**

\`\`\`
用户 → VIDO 主程序 (Node.js)
           ↓
    ┌──────┴──────┐
    ↓             ↓
  Coze         ComfyUI
  (LLM)      (图像/视频)
\`\`\`

**场景：AI 漫剧生成**

**步骤 1: 用户请求**
\`\`\`
POST /api/drama/generate
{
  "theme": "重生复仇",
  "style": "古装",
  "scene_count": 6
}
\`\`\`

**步骤 2: VIDO 调 Coze 生成剧本结构**
\`\`\`js
const scriptResult = await coze.runWorkflow('drama_writer_v1', {
  theme: req.body.theme,
  style: req.body.style,
  scene_count: req.body.scene_count,
});

// scriptResult:
// {
//   title: "重生回到婚礼前",
//   scenes: [{ description, dialogue, emotion, ... }]
// }
\`\`\`

**步骤 3: VIDO 调 Coze 生成视觉 prompt**
\`\`\`js
const visualResult = await coze.runWorkflow('drama_director_v1', {
  scenes: scriptResult.scenes,
  style_bible: styleBible,
});

// visualResult:
// {
//   scenes: [{
//     description, visual_prompt, camera, lighting, ...
//   }]
// }
\`\`\`

**步骤 4: VIDO 调 ComfyUI 生成每个镜头图像**
\`\`\`js
const workflowTemplate = loadWorkflow('drama_scene_v1.json');

const images = [];
for (const scene of visualResult.scenes) {
  const result = await comfyui.runWorkflow(workflowTemplate, {
    '6.inputs.text': scene.visual_prompt,           // Positive prompt
    '7.inputs.text': scene.negative_prompt,          // Negative prompt
    '3.inputs.seed': seed++,                         // KSampler
    '10.inputs.lora_name': 'style_guzhuang.safetensors', // LoRA
    '12.inputs.image': referenceImagePath,           // ControlNet reference
  });
  images.push(result[0]);
}
\`\`\`

**步骤 5: VIDO 调 Kling 生成视频**
\`\`\`js
const videos = [];
for (let i = 0; i < images.length; i++) {
  const video = await kling.submit({
    image: images[i].buffer,
    prompt: visualResult.scenes[i].motion_prompt,
    duration: 5,
  });
  videos.push(video);
}
\`\`\`

**步骤 6: VIDO 合成最终视频**
\`\`\`js
const finalVideo = await ffmpeg.compose(videos, {
  bgm: await coze.runWorkflow('music_selector', { mood: scriptResult.mood }),
  subtitles: scriptResult.scenes.map(s => s.dialogue),
});
\`\`\`

**步骤 7: 返回结果**
\`\`\`
{
  "status": "done",
  "final_video": "/outputs/drama/xxx.mp4",
  "scenes": [...],
}
\`\`\`

**工作流严格合规**

用户要求"严格遵守每一步"。实现方式：

**1. 步骤定义**
\`\`\`js
const DRAMA_WORKFLOW_STEPS = [
  { id: 'script',      name: '编剧', required: true, timeout: 60000 },
  { id: 'visual',      name: '分镜', required: true, timeout: 60000, depends_on: ['script'] },
  { id: 'images',      name: '生成图像', required: true, timeout: 600000, depends_on: ['visual'] },
  { id: 'videos',      name: '生成视频', required: true, timeout: 900000, depends_on: ['images'] },
  { id: 'music',       name: '选配乐', required: false, timeout: 30000, depends_on: ['script'] },
  { id: 'compose',     name: '合成', required: true, timeout: 300000, depends_on: ['videos', 'music'] },
  { id: 'delivery',    name: '交付', required: true, timeout: 10000, depends_on: ['compose'] },
];
\`\`\`

**2. 步骤执行器**
\`\`\`js
class WorkflowExecutor {
  constructor(steps) {
    this.steps = steps;
    this.state = {};
    this.executed = new Set();
  }

  async execute(context) {
    // 拓扑排序执行
    while (this.executed.size < this.steps.length) {
      const ready = this.steps.filter(s =>
        !this.executed.has(s.id) &&
        (s.depends_on || []).every(d => this.executed.has(d))
      );

      if (ready.length === 0) throw new Error('Deadlock in workflow');

      // 并行执行无依赖的步骤
      await Promise.all(ready.map(step => this.runStep(step, context)));
    }

    return this.state;
  }

  async runStep(step, context) {
    console.log(\`[Step] Starting \${step.id}: \${step.name}\`);
    const start = Date.now();

    try {
      const result = await Promise.race([
        this[step.id](context, this.state),
        new Promise((_, rej) => setTimeout(() => rej(new Error('Timeout')), step.timeout)),
      ]);
      this.state[step.id] = result;
      this.executed.add(step.id);
      console.log(\`[Step] Done \${step.id} in \${Date.now() - start}ms\`);
    } catch (e) {
      console.error(\`[Step] Failed \${step.id}: \${e.message}\`);
      if (step.required) throw e;
      this.state[step.id] = null;
      this.executed.add(step.id);  // 非必须步骤失败也标记为已执行
    }
  }

  async script(ctx) { /* Coze call */ }
  async visual(ctx, state) { /* Coze call */ }
  async images(ctx, state) { /* ComfyUI call */ }
  async videos(ctx, state) { /* Kling call */ }
  async music(ctx, state) { /* Coze call */ }
  async compose(ctx, state) { /* FFmpeg */ }
  async delivery(ctx, state) { /* Save to DB */ }
}
\`\`\`

**3. 持久化**

每一步完成后写入数据库：
\`\`\`sql
workflow_state:
  id
  workflow_type: 'drama_gen'
  step_id: 'script'
  status: 'done' | 'failed' | 'skipped'
  input: JSON
  output: JSON
  started_at
  finished_at
  error?
\`\`\`

**4. 可观测性**

- 每步有 traceId
- 时长统计
- 失败率监控
- 链路追踪

**与 VIDO 现有代码的集成**

\`src/services/dramaService.js\` 已有 generateDrama 函数，但结构较松。

**升级建议**：
1. 保留现有 API
2. 内部用 WorkflowExecutor 替换硬编码的 step 1/2/3
3. 加上持久化
4. 加上 Coze 和 ComfyUI 调用
5. 保持向后兼容`,
    tags: ['混合工作流', 'coze', 'comfyui', 'vido'],
    keywords: ['hybrid workflow', 'coze + comfyui', 'workflow executor', 'step compliance', 'persistent workflow'],
    prompt_snippets: [
      '3-layer architecture: VIDO orchestrator + Coze LLM + ComfyUI image',
      'workflow step dependency graph with topological execution',
      'persistent step state with retry and recovery',
    ],
    applies_to: ['workflow_engineer', 'backend_engineer'],
    source: 'Coze + ComfyUI 集成实战 + 工作流引擎设计',
    lang: 'zh-en',
    enabled: true,
  },
  {
    id: 'kb_eng_wf_step_compliance',
    collection: 'engineering',
    subcategory: '工作流编排',
    title: '严格遵守工作流每一步（step compliance 强制模式）',
    summary: '用户要求"开发和使用的过程中完全遵守工作流的每一个步骤"。5 个原则 + 3 个强制机制。',
    content: `**为什么要严格遵守步骤**

- **一致性**: 跳步会导致结果不可预测
- **可追溯**: 每步留痕，出问题能追责
- **可恢复**: 单步失败不影响整体
- **可观测**: 每步都有监控数据
- **合规**: 一些行业要求流程合规（医疗/金融）

**5 个核心原则**

**原则 1: 不跳步**
- 即使你觉得某步"可以省略"也不能跳
- 除非流程定义明确说是 optional

**原则 2: 不乱序**
- 严格按依赖关系执行
- 无依赖的可以并行
- 有依赖的严格串行

**原则 3: 每步必校验**
- 输入校验：类型 / 必填 / 范围
- 输出校验：格式 / 完整性
- 失败就 throw，不要 "默认值兜底"

**原则 4: 每步必记录**
- 开始时间
- 结束时间
- 输入数据
- 输出数据
- 是否成功
- 错误堆栈

**原则 5: 失败不隐藏**
- 错误必须抛出
- 可以捕获但要记录
- 不能 catch 后 return null

**3 个强制机制**

**机制 1: 类型契约**

每个步骤定义严格的输入输出类型：

\`\`\`ts
interface ScriptInput {
  theme: string;
  style: string;
  scene_count: number;
}

interface ScriptOutput {
  title: string;
  scenes: Array<{
    description: string;
    dialogue?: string;
    emotion: string;
  }>;
  character_profiles: Array<{
    name: string;
    appearance: string;
  }>;
}

async function scriptStep(input: ScriptInput): Promise<ScriptOutput> {
  // 严格校验输入
  if (!input.theme) throw new Error('theme required');
  if (input.scene_count < 1 || input.scene_count > 30) {
    throw new Error('scene_count must be 1-30');
  }

  // 执行
  const result = await callLLM(...);

  // 严格校验输出
  if (!result.title) throw new Error('title missing in output');
  if (!Array.isArray(result.scenes)) throw new Error('scenes not array');

  return result;
}
\`\`\`

**机制 2: 步骤注册表**

集中定义所有工作流步骤，执行时按注册表走：

\`\`\`js
// src/services/workflow/steps.js
const STEPS = {
  'drama_gen': [
    { id: 'script',   fn: scriptStep,   timeout: 60000, retry: 2 },
    { id: 'visual',   fn: visualStep,   timeout: 60000, retry: 2, depends: ['script'] },
    { id: 'characters', fn: characterStep, timeout: 60000, depends: ['script', 'visual'] },
    { id: 'motion',   fn: motionStep,   timeout: 10000, depends: ['visual', 'characters'] },
    { id: 'images',   fn: imageStep,    timeout: 600000, depends: ['motion'] },
    { id: 'videos',   fn: videoStep,    timeout: 900000, depends: ['images'] },
    { id: 'compose',  fn: composeStep,  timeout: 300000, depends: ['videos'] },
    { id: 'deliver',  fn: deliverStep,  timeout: 10000, depends: ['compose'] },
  ],
};
\`\`\`

执行器不接受动态传入的 step list，只能从注册表取：

\`\`\`js
async function runWorkflow(type, input) {
  const steps = STEPS[type];
  if (!steps) throw new Error(\`Unknown workflow: \${type}\`);

  const state = { input };
  const done = new Set();

  while (done.size < steps.length) {
    const ready = steps.filter(s =>
      !done.has(s.id) && (s.depends || []).every(d => done.has(d))
    );
    if (ready.length === 0) throw new Error('Workflow deadlock');

    for (const step of ready) {
      state[step.id] = await runStep(step, state);
      done.add(step.id);
    }
  }

  return state;
}
\`\`\`

**机制 3: 持久化检查点**

每步完成后持久化，重启可恢复：

\`\`\`js
async function runStep(step, state) {
  const execId = \`\${state.input.id}_\${step.id}\`;

  // 检查是否已完成（幂等）
  const existing = await db.getStepState(execId);
  if (existing && existing.status === 'done') {
    return existing.output;  // 直接用缓存，避免重跑
  }

  // 开始执行
  await db.recordStepStart(execId);

  try {
    const result = await Promise.race([
      step.fn(state),
      timeoutPromise(step.timeout),
    ]);

    // 成功 - 持久化
    await db.recordStepSuccess(execId, result);
    return result;
  } catch (e) {
    // 失败 - 持久化
    await db.recordStepFailure(execId, e.message);

    // 重试
    if (step.retry && step.retry > 0) {
      console.log(\`Retry \${step.id} (\${step.retry} left)\`);
      return runStep({ ...step, retry: step.retry - 1 }, state);
    }

    throw e;
  }
}
\`\`\`

**开发阶段的强制合规**

1. **Lint 规则**: 禁止直接调 callLLM / fetch / DB，必须走 step 函数
2. **Code Review**: PR 审核时检查是否新增步骤必须注册
3. **单元测试**: 每个步骤必须有测试
4. **集成测试**: 完整工作流跑一遍

**使用阶段的强制合规**

1. **所有入口走统一 API**: \`POST /api/workflow/run\`
2. **不允许手工改中间状态**: 只能通过 workflow executor
3. **失败重试走同样的流程**: 不能绕开
4. **所有操作有审计日志**

**VIDO 合规改造建议**

**短期（1-2 天）**:
1. 整理现有 dramaService 步骤
2. 加统一的 runStep 包装
3. 加持久化和重试

**中期（1 周）**:
1. 提取到独立 WorkflowEngine
2. 定义类型契约
3. 覆盖所有 agent 流程

**长期（1 个月）**:
1. 可视化工作流编辑器（类似 Coze）
2. 监控面板
3. 多工作流模板

**结论：工作流合规是工程质量的底线**

不合规的系统会导致：
- 同样的输入得到不同结果
- 部分成功部分失败后状态错乱
- 调试痛苦（不知道哪步错了）
- 扩展困难（改一步要改所有调用处）

严格的工作流系统会让：
- 结果可复现
- 错误可定位
- 新功能好加
- 团队好协作`,
    tags: ['工作流合规', '严格执行', '步骤', 'compliance'],
    keywords: ['workflow compliance', 'step enforcement', 'type contract', 'persistent checkpoint', 'workflow registry'],
    prompt_snippets: [
      'strict workflow execution with type contracts and persistent checkpoints',
      'centralized step registry prevents ad-hoc step execution',
      'idempotent step with cached result lookup',
    ],
    applies_to: ['workflow_engineer', 'backend_engineer', 'executive_producer'],
    source: '工作流引擎设计 + 合规执行实战',
    lang: 'zh-en',
    enabled: true,
  },

  // ═══════════════════════════════════════════════════
  // ⑦ 自学习机制 (Self-Learning)
  // ═══════════════════════════════════════════════════
  {
    id: 'kb_eng_sl_rag_dynamic',
    collection: 'engineering',
    subcategory: '自学习机制',
    title: 'Agent 动态 KB 检索 (RAG) 自学习机制',
    summary: 'Agent 运行时主动查 KB 获取"准确的上下文"。不是 fine-tune，是实时检索增强。',
    content: `**静态注入 vs 动态检索**

**静态注入** (VIDO 原来的做法):
- 在 system prompt 里写死一堆 KB 上下文
- 优点：简单，成本低
- 缺点：无法针对具体任务定制；context 被浪费在不相关知识上

**动态检索** (RAG):
- Agent 先看任务 → 提取关键词 → 查 KB → 只用相关的
- 优点：精准、高效、可扩展
- 缺点：增加一次检索调用

**VIDO 已实现的 searchForAgent**

\`\`\`js
// src/services/knowledgeBaseService.js
function searchForAgent(agentType, query, opts = {}) {
  // 1. 获取该 agent 可用的所有 KB
  let docs = db.listKnowledgeDocs({ appliesTo: agentType });

  // 2. 关键词 tokenize
  const tokens = query.toLowerCase().split(/[\\s,，。；]/);

  // 3. 打分排序
  const scored = docs.map(d => {
    let score = 0;
    for (const tok of tokens) {
      if (d.title.includes(tok)) score += 20;
      if (d.tags.includes(tok)) score += 10;
      // ...
    }
    return { d, score };
  }).filter(x => x.score > 0);

  // 4. 返回 top N
  return scored.sort((a,b) => b.score - a.score).slice(0, limit);
}
\`\`\`

**如何在 agent 里使用**

**旧方式（静态）**:
\`\`\`js
async function agentDirector(screenplay) {
  const kbContext = kb.buildAgentContext('director', { genre: 'xxx' });
  const systemPrompt = \`你是导演... \${kbContext}\`;
  return await callLLM(systemPrompt, userPrompt);
}
\`\`\`

**新方式（动态）**:
\`\`\`js
async function agentDirectorV2(screenplay) {
  // Step 1: 从 screenplay 提取关键词
  const keywords = [
    screenplay.genre,
    screenplay.mood,
    ...screenplay.scenes.map(s => s.description.slice(0, 20)).join(' '),
  ].join(' ');

  // Step 2: 动态检索 top 5 最相关的 KB
  const dynamicKB = kb.searchForAgent('director', keywords, { limit: 5 });

  // Step 3: 结合静态和动态
  const staticKB = kb.buildAgentContext('director', { maxDocs: 2 });  // 少量通用的
  const fullContext = dynamicKB + '\\n\\n' + staticKB;

  const systemPrompt = \`你是导演...

\${fullContext}

请基于以上动态检索到的知识，深度学习并应用到下面的任务。\`;

  return await callLLM(systemPrompt, userPrompt);
}
\`\`\`

**进阶：多轮 RAG**

让 agent 自己决定要不要查 KB：

\`\`\`js
async function agentWithSelfResearch(task) {
  // Step 1: 第一次 LLM 调用，判断需要什么知识
  const researchPlan = await callLLM(\`
你是 \${task.agent_type}。分析以下任务，列出你需要从知识库查询的 3-5 个关键主题：
任务: \${task.description}
\`, { response_format: 'json' });

  // Step 2: 按 plan 分别查 KB
  const knowledgeChunks = [];
  for (const topic of researchPlan.topics) {
    const chunk = kb.searchForAgent(task.agent_type, topic, { limit: 2 });
    knowledgeChunks.push(chunk);
  }

  // Step 3: 第二次 LLM 调用，用知识执行任务
  const result = await callLLM(\`
你是 \${task.agent_type}。基于以下知识执行任务：

\${knowledgeChunks.join('\\n\\n')}

任务: \${task.description}

请深度学习以上知识并产出结果。
\`);

  return result;
}
\`\`\`

**这是"自学习"的本质**：
- Agent 知道自己不知道什么
- Agent 主动查 KB 补足
- Agent 把查到的知识应用到当前任务

**进阶：向量检索 (Embedding)**

关键词匹配有局限（"reincarnation" 不会匹配"重生"）。用向量检索更强：

\`\`\`js
// 1. 先把所有 KB 文档生成 embedding
const embeddings = [];
for (const doc of kb.listDocs()) {
  const emb = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: doc.title + ' ' + doc.content,
  });
  embeddings.push({ doc, vector: emb.data[0].embedding });
}

// 2. 查询时用 query 的 embedding
async function semanticSearch(query, topK = 5) {
  const queryEmb = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: query,
  });
  const qVec = queryEmb.data[0].embedding;

  // 余弦相似度排序
  return embeddings
    .map(e => ({ doc: e.doc, score: cosineSimilarity(e.vector, qVec) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}
\`\`\`

**向量数据库选型**

| 工具 | 特点 | 适用 |
|---|---|---|
| Pinecone | 云服务 | 生产 |
| Qdrant | 开源 + 云 | 通用 |
| Weaviate | 功能丰富 | 企业 |
| Chroma | 嵌入式 | 原型 |
| Milvus | 大规模 | 亿级向量 |
| pgvector | Postgres 扩展 | 已有 PG |
| Faiss | 本地 | 单机 |

**VIDO 当前状态**
- 关键词搜索已实现（searchForAgent）
- 未来可升级到向量检索

**自学习的另一种方式：反思**

让 agent 执行完后"反思"结果：

\`\`\`js
async function agentWithReflection(task) {
  // 第一次执行
  let result = await agentMarketResearch(task);

  // 反思
  const reflection = await callLLM(\`
你刚才完成了一次市场调研。评估结果质量：
结果: \${JSON.stringify(result)}

请回答：
1. 这个结果的质量 1-10 分？
2. 缺少哪些关键信息？
3. 哪里可以改进？
\`);

  // 如果质量不高，再执行一次
  if (reflection.score < 7) {
    const improved = await agentMarketResearch({
      ...task,
      hints: reflection.improvements,
    });
    return improved;
  }

  return result;
}
\`\`\`

**反思的局限**:
- 成本翻倍
- LLM 的自我评估不一定准确
- 适合重要任务，不适合所有任务

**VIDO 推荐**
- 普通任务：静态注入 + 关键词动态检索
- 重要任务：加反思机制
- 长期：升级到向量检索`,
    tags: ['rag', '自学习', '动态检索', 'agent'],
    keywords: ['rag', 'self-learning', 'dynamic retrieval', 'semantic search', 'embedding', 'reflection'],
    prompt_snippets: [
      'dynamic KB retrieval before LLM call based on task keywords',
      'two-phase LLM call: research plan first, then execute with knowledge',
      'semantic search using text-embedding-3-small',
    ],
    applies_to: ['algorithm_engineer', 'workflow_engineer', 'backend_engineer'],
    source: 'RAG 最佳实践 + LangChain 文档 + 实战经验',
    lang: 'zh-en',
    enabled: true,
  },
  {
    id: 'kb_eng_sl_agent_memory',
    collection: 'engineering',
    subcategory: '自学习机制',
    title: 'Agent 记忆系统（短期 + 长期 + 情景）',
    summary: 'Agent 不能只活在当前对话里。3 层记忆系统：短期（对话内）+ 长期（跨对话）+ 情景（用户特定）。',
    content: `**3 层记忆模型**

**短期记忆 (Short-term / Working Memory)**
- 当前对话内的上下文
- 存在 LLM 的 context window 里
- 会话结束就丢失
- 典型：对话历史 messages

**长期记忆 (Long-term Memory)**
- 跨对话持久化
- 存数据库
- 可以是事实 / 经验 / 偏好
- 典型：用户画像、agent 学到的最佳实践

**情景记忆 (Episodic Memory)**
- 特定"事件"的记忆
- 时间 + 场景 + 角色 + 结果
- 适合"以前我做过 X，结果是 Y"
- 典型：项目历史

**短期记忆实现**

\`\`\`js
// 传统做法：对话历史数组
const messages = [
  { role: 'system', content: '...' },
  { role: 'user', content: 'Hi' },
  { role: 'assistant', content: 'Hello!' },
  { role: 'user', content: 'How are you?' },
  { role: 'assistant', content: 'Good thanks' },
];

// 问题：太长会爆 context
// 解决：滑动窗口 + 压缩
function trimMessages(messages, maxTokens = 8000) {
  if (countTokens(messages) <= maxTokens) return messages;

  // 保留 system + 最近 N 条
  const system = messages.find(m => m.role === 'system');
  const recent = messages.slice(-10);
  return system ? [system, ...recent] : recent;
}
\`\`\`

**长期记忆实现**

**方案 A: 关键事实存数据库**
\`\`\`sql
CREATE TABLE agent_memory (
  id UUID PRIMARY KEY,
  agent_id TEXT NOT NULL,
  user_id TEXT,
  memory_type TEXT,  -- 'fact' | 'preference' | 'experience'
  content TEXT NOT NULL,
  importance INT DEFAULT 5,  -- 1-10
  created_at TIMESTAMP DEFAULT NOW(),
  accessed_at TIMESTAMP,
  access_count INT DEFAULT 0
);
\`\`\`

**写入**:
\`\`\`js
async function rememberFact(agentId, userId, fact) {
  await db.insert('agent_memory', {
    agent_id: agentId,
    user_id: userId,
    memory_type: 'fact',
    content: fact,
  });
}

// 在对话结束时自动提取
async function extractMemories(conversation) {
  const extraction = await callLLM(\`
从以下对话中提取值得长期记住的事实、偏好、经验：

对话: \${JSON.stringify(conversation)}

输出 JSON: [{"type": "fact/preference/experience", "content": "...", "importance": 1-10}]
\`);
  return JSON.parse(extraction);
}
\`\`\`

**读取**:
\`\`\`js
async function loadMemories(agentId, userId, query, limit = 10) {
  // 向量相似度 + 重要性 + 时间衰减
  const memories = await db.query(\`
    SELECT *, (
      similarity * 0.5
      + importance * 0.3
      + (1.0 / (1.0 + EXTRACT(DAY FROM NOW() - accessed_at))) * 0.2
    ) as score
    FROM agent_memory
    WHERE agent_id = ? AND user_id = ?
    ORDER BY score DESC
    LIMIT ?
  \`, [agentId, userId, limit]);

  return memories;
}
\`\`\`

**情景记忆实现**

记住"整个事件"：

\`\`\`js
const episodicMemory = {
  event: 'drama_generation',
  time: '2025-04-11T10:30:00',
  participants: ['user_123', 'agent_screenwriter', 'agent_director'],
  input: { theme: 'rebirth', style: 'modern' },
  steps_taken: [
    { step: 'script', duration: 45 },
    { step: 'direct', duration: 30 },
  ],
  output: { title: '...', scenes: [...] },
  user_feedback: 'good',  // 事后用户反馈
  reflection: '剧情不够紧凑，下次应该前置冲突',
};
\`\`\`

之后 agent 可以查询："上次我为这个用户做甜宠剧本时做了什么？"

**记忆的衰减与遗忘**

人类会遗忘，agent 也应该：

\`\`\`js
async function cleanupMemories() {
  // 低重要性 + 长期未访问 → 删除
  await db.query(\`
    DELETE FROM agent_memory
    WHERE importance < 5
      AND accessed_at < NOW() - INTERVAL '90 days'
  \`);

  // 中等重要性 → 压缩总结
  const oldMemories = await db.query(\`
    SELECT * FROM agent_memory
    WHERE importance BETWEEN 5 AND 7
      AND created_at < NOW() - INTERVAL '30 days'
  \`);

  const summary = await callLLM(\`总结以下记忆为一条高密度记忆: \${JSON.stringify(oldMemories)}\`);
  await db.insert('agent_memory', {
    ...oldMemories[0],
    content: summary,
    memory_type: 'summary',
  });
  await db.delete('agent_memory', { id: { $in: oldMemories.map(m => m.id) } });
}
\`\`\`

**记忆检索策略**

**简单方案**: 最近 N 条
**中等方案**: 关键词匹配
**高级方案**: 向量检索 + 重要性 + 时间衰减（MemGPT 论文）

**主流记忆系统框架**

- **Mem0** - 专门的 memory 层，LLM 无关
- **LangChain Memory** - 多种记忆类型
- **LlamaIndex** - 文档索引 + 记忆
- **MemGPT** - 论文级记忆系统
- **Letta** - MemGPT 的商业版

**Mem0 示例**
\`\`\`js
import { Memory } from 'mem0ai';

const m = new Memory();

// 写入
await m.add('User likes romantic dramas', { user_id: 'u1' });
await m.add('User is a stay-at-home mom in China', { user_id: 'u1' });

// 查询
const relevant = await m.search('what kind of drama?', { user_id: 'u1' });
// → ['User likes romantic dramas', 'User is a stay-at-home mom in China']
\`\`\`

**VIDO 当前状态**
- 没有 agent 记忆系统
- 每次生成是"一次性"的

**升级建议**

**Phase 1: 对话历史**
- 给每个 agent 加 \`conversation_history\` 字段
- 每次调用累积

**Phase 2: 用户偏好**
- 记住用户喜欢什么风格
- 避免重复确认

**Phase 3: 经验学习**
- 记住哪些操作成功了
- 记住哪些失败了
- 避免重复错误

**Phase 4: 项目记忆**
- 每个项目的完整历史
- 跨项目的模式识别

**给用户的价值**
- 第二次使用更顺畅（不需要再解释偏好）
- Agent 越用越聪明
- 个性化体验`,
    tags: ['记忆', 'memory', 'agent', '长期'],
    keywords: ['agent memory', 'short term memory', 'long term memory', 'episodic memory', 'mem0', 'memgpt', 'letta'],
    prompt_snippets: [
      '3-tier memory: short-term context + long-term facts + episodic events',
      'vector search + importance + time decay for memory retrieval',
      'automatic memory extraction from conversation history',
    ],
    applies_to: ['algorithm_engineer', 'workflow_engineer'],
    source: 'MemGPT 论文 + Mem0 开源项目 + Agent 记忆研究',
    lang: 'zh-en',
    enabled: true,
  },

  // ═══════════════════════════════════════════════════
  // ⑧ 传统语言扩充【v7 新增】
  // ═══════════════════════════════════════════════════
  {
    id: 'kb_eng_lang_java',
    collection: 'engineering',
    subcategory: '多语言开发',
    title: 'Java 企业级开发完整栈（Spring Boot / JPA / Maven / JVM 调优）',
    summary: 'Java 是企业级后端不可撼动的王者。25 年生态沉淀，Spring Boot 一统江湖，JVM 调优是真功夫。',
    content: `**Java 在 AI 视频场景的定位**

- **企业后端主力**：金融/电信/政府/大型电商系统（支撑亿级并发）
- **大数据生态**：Hadoop / Spark / Flink / Kafka 全是 JVM 系
- **Android 开发**：虽然 Kotlin 主流化，Java 仍是底层
- **中间件**：ElasticSearch / Cassandra / Neo4j 多用 Java

**核心技术栈 (2025)**

**Web 框架**
- **Spring Boot 3.x** — 事实标准，starter 生态无敌
- **Quarkus** — GraalVM 原生编译，启动快 10 倍
- **Micronaut** — 云原生 + 低内存
- **Vert.x** — 响应式异步框架

**ORM / 数据访问**
- **Spring Data JPA** (Hibernate) — 企业级 ORM
- **MyBatis** — SQL 可控，中国最爱
- **jOOQ** — 类型安全 SQL DSL

**构建工具**
- **Maven** — 老牌 XML 配置
- **Gradle** — Groovy/Kotlin DSL，更灵活

**JDK 版本选择**
- **JDK 8** — 老项目（仍广泛存在）
- **JDK 11** — LTS，稳定
- **JDK 17** — LTS，推荐新项目
- **JDK 21** — 最新 LTS，Virtual Threads

**Virtual Threads (JDK 21)**
革命性改变 — 轻量级线程让 Java 在 I/O 密集场景性能接近 Go：
\`\`\`java
try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    IntStream.range(0, 10_000).forEach(i -> {
        executor.submit(() -> {
            // 每个任务一个 virtual thread，无压力
            callAiVideoAPI(i);
            return null;
        });
    });
}
\`\`\`

**JVM 调优基础**
- **堆内存**: \`-Xms4g -Xmx4g\` (避免动态调整)
- **GC 选择**:
  - G1GC (默认，适合大多数)
  - ZGC (低延迟 <10ms)
  - Shenandoah (Red Hat)
- **监控**: jstat / jmap / VisualVM / Arthas

**AI 集成**
- **LangChain4j** — Java 版 LangChain
- **Spring AI** — Spring 生态的 AI 抽象层
- **Semantic Kernel Java** — 微软
- **OpenAI Java SDK** — 官方

**Spring Boot AI 调用示例**
\`\`\`java
@RestController
public class AIController {
    private final ChatClient chatClient;

    public AIController(ChatClient.Builder builder) {
        this.chatClient = builder.build();
    }

    @PostMapping("/api/generate")
    public String generate(@RequestBody String prompt) {
        return chatClient.prompt()
            .user(prompt)
            .call()
            .content();
    }
}
\`\`\`

**性能基准（Java vs Node.js vs Go）**
- 冷启动：Node < Go < Java (Java 慢)
- 稳定吞吐：Java ≈ Go > Node (Java 强)
- 内存占用：Go < Node < Java (Java 重)
- 生态：Java > Node > Go (Java 最全)

**Java 典型使用场景**
- 金融级交易系统
- 高并发电商后端
- 大数据 ETL pipeline
- Android 应用
- Minecraft / 游戏服务器

**陷阱**
- 不要无脑 Spring Boot（大项目启动慢）
- JDK 8 的性能/生态已经老旧，尽量 17+
- 不要忽略 JVM 调优
- Maven 依赖冲突要用 \`mvn dependency:tree\` 分析`,
    tags: ['java', '企业级', 'spring boot', 'jvm'],
    keywords: ['java', 'spring boot', 'jpa', 'hibernate', 'maven', 'gradle', 'jvm', 'virtual threads', 'jdk21'],
    prompt_snippets: [
      'Spring Boot 3.x + JDK 21 with Virtual Threads for high concurrency',
      'Spring AI ChatClient for LLM integration',
      'G1GC / ZGC tuning for low-latency AI workloads',
    ],
    applies_to: ['backend_engineer', 'algorithm_engineer'],
    source: 'Oracle Java 官方文档 + Spring 生态 + JVM 调优实战',
    lang: 'zh-en',
    enabled: true,
  },
  {
    id: 'kb_eng_lang_c',
    collection: 'engineering',
    subcategory: '多语言开发',
    title: 'C 语言系统级编程（指针 / 内存 / POSIX / 嵌入式）',
    summary: 'C 是所有系统的底层。操作系统 / 数据库 / 编译器 / 嵌入式 / 高性能库全是 C 写的。',
    content: `**C 语言不朽的理由**

- 操作系统：Linux / Windows / macOS 核心
- 数据库：PostgreSQL / Redis / SQLite / MySQL
- 编译器：GCC / LLVM
- 解释器：Python / PHP / Ruby 的 CPython/PHP/MRI
- 嵌入式：ARM / RISC-V 驱动 + RTOS
- 高性能库：FFmpeg / OpenCV / BLAS
- 网络：nginx / haproxy / curl

**C 的核心价值**
1. **零开销抽象** - 没有运行时，没有 GC
2. **直接内存控制** - 指针 + malloc/free
3. **平台无关标准** - C99 / C11 / C17 / C23
4. **与硬件最接近** - 可嵌入汇编

**现代 C 工程化（不再是 1990 年代的 C）**

**构建系统**
- **CMake** - 事实标准，跨平台
- **Meson** - 更现代，更快
- **Make** - 经典但难维护

**包管理**
- **Conan** - C/C++ 包管理器
- **vcpkg** - 微软出品

**测试框架**
- **Unity** - 嵌入式友好
- **Check** - GNU 传统
- **Google Test** - C++ 但也能测 C

**静态分析**
- **clang-tidy** - LLVM 官方
- **cppcheck** - 开源
- **Coverity** - 商用

**内存安全工具**
- **AddressSanitizer (ASAN)** - 检测内存错误
- **UndefinedBehaviorSanitizer (UBSAN)** - UB 检测
- **Valgrind** - 经典内存检测

**C 编译示例**
\`\`\`bash
# Debug 带所有 sanitizer
gcc -g -O0 -Wall -Wextra -fsanitize=address,undefined \\
    -fno-omit-frame-pointer \\
    main.c -o main

# Release 优化
gcc -O2 -Wall -DNDEBUG main.c -o main
\`\`\`

**指针核心法则**
\`\`\`c
// 基础
int x = 10;
int *p = &x;  // p 指向 x
*p = 20;      // 修改 x

// 动态分配
int *arr = malloc(100 * sizeof(int));
if (arr == NULL) return -1;  // 必检查
// ... use arr ...
free(arr);
arr = NULL;  // 避免悬垂指针

// 数组退化为指针
void func(int arr[10]) {}  // 实际等同 int *arr
\`\`\`

**常见陷阱**
- 缓冲区溢出 (use strncpy 不用 strcpy)
- Double free
- Use-after-free
- 未初始化变量
- 整数溢出

**Socket 网络编程（服务器）**
\`\`\`c
#include <sys/socket.h>
#include <netinet/in.h>

int sockfd = socket(AF_INET, SOCK_STREAM, 0);
struct sockaddr_in addr = {
    .sin_family = AF_INET,
    .sin_port = htons(8080),
    .sin_addr.s_addr = INADDR_ANY,
};
bind(sockfd, (struct sockaddr*)&addr, sizeof(addr));
listen(sockfd, 128);

while (1) {
    int client = accept(sockfd, NULL, NULL);
    // handle client
    close(client);
}
\`\`\`

**嵌入式 C 特殊要点**
- 避免动态分配 (堆容易碎)
- 避免递归 (栈有限)
- 使用 volatile 声明寄存器
- 利用 const 让编译器优化
- 尽量 inline 关键函数

**C 在 AI 视频场景**
- 编写高性能图像处理 SIMD 代码
- 为 Python 写 C 扩展
- FFmpeg 滤镜开发
- 嵌入式视频编解码器

**现代 C 学习资源**
- K&R《The C Programming Language》
- 《Modern C》(Jens Gustedt)
- Linux Kernel source code
- Redis source code (优秀的 C 代码范例)

**C 与 Rust 之争**

Rust 在内存安全上完胜 C，但 C 的不可替代性在于：
- 极短的编译时间
- 更小的二进制
- 更广的平台支持
- 更成熟的工具链
- 向后兼容 50 年`,
    tags: ['c语言', '系统编程', '指针', '嵌入式'],
    keywords: ['c programming', 'pointers', 'malloc', 'posix', 'gcc', 'cmake', 'sanitizer', 'embedded'],
    prompt_snippets: [
      'C pointer arithmetic with malloc/free and NULL check',
      'POSIX socket server with accept/bind/listen loop',
      'CMake + AddressSanitizer debug build for C project',
    ],
    applies_to: ['backend_engineer', 'algorithm_engineer'],
    source: 'K&R C + ISO/IEC 9899 + Linux 内核源码',
    lang: 'zh-en',
    enabled: true,
  },
  {
    id: 'kb_eng_lang_cpp',
    collection: 'engineering',
    subcategory: '多语言开发',
    title: 'C++ 现代开发（C++17/20/23 + STL + 智能指针 + 模板）',
    summary: '现代 C++ 和 1998 年的 C++ 完全是两门语言。RAII + 智能指针 + 移动语义 = 安全高效。',
    content: `**C++ 的不朽场景**

- **游戏引擎**：Unreal Engine / Unity (C# 包装 C++) / CryEngine
- **图形 API**：DirectX / Vulkan / OpenGL
- **高性能库**：PyTorch / TensorFlow C++ backend / OpenCV
- **数据库**：MongoDB / ClickHouse / MySQL 存储引擎
- **浏览器**：Chrome V8 / Firefox Gecko / WebKit
- **AI 推理**：ONNX Runtime / TensorRT / llama.cpp

**C++ 版本时间线**

| 版本 | 年份 | 关键特性 |
|---|---|---|
| C++98 | 1998 | STL, templates |
| C++03 | 2003 | bug fix |
| **C++11** | 2011 | auto, lambda, smart ptrs, move semantics |
| C++14 | 2014 | generic lambda, make_unique |
| **C++17** | 2017 | structured bindings, optional, variant |
| **C++20** | 2020 | concepts, ranges, coroutines, modules |
| C++23 | 2023 | std::expected, stacktrace |

**现代 C++ 核心原则：RAII**

Resource Acquisition Is Initialization — 用构造函数获取资源，析构函数释放，永远不需要手动 delete。

\`\`\`cpp
#include <memory>
#include <vector>
#include <string>

// 智能指针替代裸指针
auto p = std::make_unique<int>(42);  // unique_ptr
auto shared = std::make_shared<std::string>("hello");  // shared_ptr

// RAII 容器
std::vector<int> v = {1, 2, 3};  // 离开作用域自动 free
std::string s = "world";          // 离开作用域自动 free

// 不需要 new/delete！
\`\`\`

**C++11 Move Semantics**
\`\`\`cpp
std::vector<int> create() {
    std::vector<int> v(1000000);
    return v;  // 移动，不拷贝 (RVO + move)
}

std::vector<int> v1 = create();  // 零拷贝
std::vector<int> v2 = std::move(v1);  // 移动，v1 变空
\`\`\`

**Lambda 表达式**
\`\`\`cpp
auto add = [](int a, int b) { return a + b; };
int sum = add(1, 2);

// capture
int x = 10;
auto f = [x](int y) { return x + y; };  // 值捕获
auto g = [&x](int y) { x += y; };       // 引用捕获
\`\`\`

**STL 核心容器**
- \`std::vector\` - 动态数组，首选
- \`std::array\` - 固定大小数组
- \`std::map\` / \`std::unordered_map\` - 有序/哈希映射
- \`std::set\` / \`std::unordered_set\`
- \`std::string\`
- \`std::optional\` (C++17) - 可空值
- \`std::variant\` (C++17) - 类型安全 union

**STL 算法**
\`\`\`cpp
#include <algorithm>
std::vector<int> v = {3, 1, 4, 1, 5, 9};
std::sort(v.begin(), v.end());
auto it = std::find(v.begin(), v.end(), 4);
std::transform(v.begin(), v.end(), v.begin(),
    [](int x) { return x * 2; });
\`\`\`

**C++20 Ranges (终于像 Python 了)**
\`\`\`cpp
#include <ranges>
auto even_squared = v
    | std::views::filter([](int x) { return x % 2 == 0; })
    | std::views::transform([](int x) { return x * x; });
\`\`\`

**C++20 Concepts (类型约束)**
\`\`\`cpp
template<typename T>
concept Numeric = std::integral<T> || std::floating_point<T>;

template<Numeric T>
T add(T a, T b) { return a + b; }
\`\`\`

**C++20 Coroutines (异步)**
\`\`\`cpp
task<std::string> fetchUrl(std::string url) {
    auto response = co_await httpGet(url);
    co_return response.body;
}
\`\`\`

**C++ 在 AI 推理**
\`\`\`cpp
// llama.cpp 风格的模型推理
#include "llama.h"

llama_model *model = llama_load_model_from_file("model.gguf", params);
llama_context *ctx = llama_new_context_with_model(model, ctx_params);

std::vector<llama_token> tokens = tokenize(prompt);
llama_batch batch = llama_batch_init(tokens.size(), 0, 1);
// ... run inference
\`\`\`

**构建系统**
- **CMake** - 主流
- **Bazel** - Google (跨语言)
- **xmake** - 中国出品，现代

**C++ 调试工具**
- **gdb** / **lldb** - 调试器
- **Valgrind** - 内存泄漏
- **clang-format** - 代码格式化
- **clang-tidy** - 静态分析

**C++ 性能优化要点**
- 减少拷贝：用 move / reference
- 避免虚函数调用（如果不需要多态）
- cache-friendly 数据结构（SoA vs AoS）
- SIMD 指令（Intel intrinsics / AVX）
- 循环展开 / 内联

**常见陷阱**
- 不要裸指针 new/delete → 用 smart ptr
- 不要 C 风格 cast → 用 static_cast / dynamic_cast
- 不要 raw array → 用 std::array / std::vector
- 不要 C 字符串 → 用 std::string

**C++ 的学习曲线**
陡峭。建议路径：
1. C++11 基础 + STL
2. RAII + 智能指针
3. Move 语义
4. 模板元编程
5. C++17 optional/variant
6. C++20 concepts/ranges/coroutines

**VIDO 使用场景**
- FFmpeg 滤镜开发
- 实时视频处理 (OpenCV)
- 本地 AI 推理 (ONNX Runtime)
- 游戏引擎 /3D 渲染`,
    tags: ['c++', '现代c++', 'stl', 'raii'],
    keywords: ['c++17', 'c++20', 'c++23', 'stl', 'smart pointer', 'raii', 'move semantics', 'templates', 'concepts', 'ranges'],
    prompt_snippets: [
      'modern C++ with smart pointers and RAII instead of raw new/delete',
      'C++20 ranges and views for functional data pipelines',
      'C++20 concepts for type-safe generic programming',
    ],
    applies_to: ['backend_engineer', 'algorithm_engineer'],
    source: 'ISO C++ standard + Effective Modern C++ (Scott Meyers)',
    lang: 'zh-en',
    enabled: true,
  },
  {
    id: 'kb_eng_lang_csharp',
    collection: 'engineering',
    subcategory: '多语言开发',
    title: 'C# / .NET 企业栈（ASP.NET Core / Unity / Blazor）',
    summary: 'C# 结合了 Java 的安全和 C++ 的强大，微软力推。.NET 8 性能已跻身顶级。',
    content: `**C# 的主要舞台**

- **企业后端**：ASP.NET Core（性能爆炸）
- **游戏开发**：Unity（全球 50% 游戏用 C#）
- **桌面应用**：WPF / WinUI / MAUI
- **Web 前端**：Blazor（C# 写前端）
- **Azure 生态**：首选语言

**.NET 版本**
- .NET Framework 4.8 (Windows only，老项目)
- **.NET 8 LTS** (跨平台，推荐)
- .NET 9 (最新)

**ASP.NET Core 入门**
\`\`\`csharp
var builder = WebApplication.CreateBuilder(args);
builder.Services.AddControllers();

var app = builder.Build();
app.MapGet("/", () => "Hello");
app.MapPost("/api/generate", async (GenerateRequest req) =>
{
    var result = await llmService.Generate(req.Prompt);
    return Results.Ok(result);
});

app.Run();
\`\`\`

**Unity 游戏开发 C#**
\`\`\`csharp
public class PlayerController : MonoBehaviour
{
    public float speed = 5f;

    void Update()
    {
        float h = Input.GetAxis("Horizontal");
        float v = Input.GetAxis("Vertical");
        transform.Translate(new Vector3(h, 0, v) * speed * Time.deltaTime);
    }
}
\`\`\`

**LINQ (C# 的灵魂)**
\`\`\`csharp
var result = users
    .Where(u => u.Age > 18)
    .OrderBy(u => u.Name)
    .Select(u => new { u.Name, u.Email })
    .ToList();
\`\`\`

**async/await**
\`\`\`csharp
public async Task<string> FetchUrlAsync(string url)
{
    using var client = new HttpClient();
    return await client.GetStringAsync(url);
}
\`\`\`

**ORM: Entity Framework Core**
\`\`\`csharp
var project = await dbContext.Projects
    .Include(p => p.Scenes)
    .FirstOrDefaultAsync(p => p.Id == id);
\`\`\`

**.NET 性能 (2025)**

令人震惊 — .NET 8 的 Web API 在 TechEmpower 基准中稳居前五，超过了大多数 Go 框架：
- .NET 8 ASP.NET Core: ~7 million RPS
- Rust actix-web: ~7.5M RPS
- Go Gin: ~4M RPS

**C# AI 集成**
- **Semantic Kernel** (Microsoft) - 类似 LangChain
- **Azure OpenAI SDK**
- **ML.NET** - 传统机器学习
- **OllamaSharp** - 本地 LLM

**Blazor (C# 前端)**
\`\`\`razor
@page "/counter"
<h1>Counter</h1>
<p>Current count: @count</p>
<button @onclick="Increment">Click</button>

@code {
    int count = 0;
    void Increment() => count++;
}
\`\`\`

**C# vs Java 对比**

| 维度 | C# | Java |
|---|---|---|
| 语言特性 | 更现代 (record, pattern matching) | 追赶中 |
| 性能 | 更快 (.NET 8) | 稍慢 |
| 生态 | Azure/Unity/Game | 更广 (大数据/Android) |
| 社区 | 较小但活跃 | 庞大 |
| 就业 | 企业/游戏 | 企业/大数据/Android |

**VIDO 使用场景**
- Unity 制作 VIDO 3D 预览器
- ASP.NET Core 高性能 API 层
- ML.NET 本地机器学习
- Blazor WASM 浏览器端`,
    tags: ['csharp', '.net', 'unity', 'blazor'],
    keywords: ['c#', 'csharp', 'dotnet', 'asp.net core', 'unity', 'blazor', 'entity framework', 'linq'],
    prompt_snippets: [
      'ASP.NET Core Minimal API with async endpoints',
      'Unity C# MonoBehaviour for game logic',
      'LINQ query for functional data manipulation',
    ],
    applies_to: ['backend_engineer', 'frontend_engineer'],
    source: 'Microsoft .NET 官方文档 + Unity 文档',
    lang: 'zh-en',
    enabled: true,
  },
  {
    id: 'kb_eng_lang_php',
    collection: 'engineering',
    subcategory: '多语言开发',
    title: 'PHP 传统 Web 栈（Laravel / Symfony / WordPress）',
    summary: 'PHP 驱动了全球 75% 的网站。WordPress 占 43%。Laravel 是最优雅的现代 PHP 框架。',
    content: `**PHP 的市场地位**

- 全球 **75%** 网站后端用 PHP
- **WordPress** 占全球网站 43%，全 PHP
- Facebook 起家靠 PHP（后来改 Hack）
- Wikipedia、Slack、Etsy 后端 PHP

**PHP 8 的现代化**

PHP 5 已死，PHP 7/8 和 10 年前完全不是一个语言：

- JIT 编译器 (PHP 8.0)
- 类型系统强化
- Readonly 属性 (PHP 8.1)
- Enums (PHP 8.1)
- 性能提升 2-3 倍

**主流框架**

**Laravel** ⭐⭐⭐⭐⭐
- 最优雅的 PHP 框架
- Eloquent ORM
- Blade 模板
- Artisan CLI
- 生态最丰富

**Symfony**
- 企业级
- 组件化（Laravel 底层用了很多 Symfony 组件）
- Drupal 用它

**WordPress** (CMS)
- 全球 43% 网站
- 不是框架，是 CMS
- 插件 + 主题生态巨大

**Laravel 示例**
\`\`\`php
// routes/api.php
Route::post('/generate', [GenerateController::class, 'store']);

// app/Http/Controllers/GenerateController.php
class GenerateController extends Controller
{
    public function store(Request $request)
    {
        $validated = $request->validate([
            'prompt' => 'required|string|max:1000',
        ]);

        $result = $this->aiService->generate($validated['prompt']);

        return response()->json(['success' => true, 'data' => $result]);
    }
}
\`\`\`

**Eloquent ORM**
\`\`\`php
$projects = Project::where('user_id', $userId)
    ->with('scenes')
    ->orderBy('created_at', 'desc')
    ->limit(10)
    ->get();
\`\`\`

**Laravel Queue (异步任务)**
\`\`\`php
class GenerateVideoJob implements ShouldQueue
{
    public function handle()
    {
        $video = app(VideoService::class)->generate($this->prompt);
        event(new VideoGenerated($video));
    }
}

GenerateVideoJob::dispatch($prompt);
\`\`\`

**Composer (包管理)**
\`\`\`bash
composer require openai-php/client
composer require laravel/sanctum
\`\`\`

**PHP AI 集成**
- **openai-php/client** - 官方 OpenAI SDK
- **llm-php** - 多提供商抽象
- **Laravel AI** - Laravel 专用
- **php-ml** - 传统 ML

**性能：PHP 8 JIT**
JIT 让 PHP 接近 Go/Node.js 的性能，但不够接近。PHP 仍然慢于 Node.js/Java 在 CPU 密集场景。

**PHP 部署**
- **传统**: Apache + PHP-FPM
- **现代**: Docker + Nginx + PHP-FPM
- **最新**: **RoadRunner** / **FrankenPHP** (常驻内存，启动快 100 倍)

**RoadRunner (Go 写的 PHP 应用服务器)**
让 Laravel 从每请求启动 → 常驻进程，性能提升 10 倍。

**PHP 在 2025 的定位**
- 中小型 Web 项目首选（快速交付）
- WordPress 生态无可替代
- 团队已经熟悉 PHP 就不需要换
- 但大规模 / 高并发场景不推荐

**PHP 在 VIDO 场景**
- 不是首选（已有 Node.js）
- 但如果做 CMS 集成（如 WordPress 插件）需要 PHP

**PHP 学习价值**
- 理解 Web 发展史
- 维护遗留系统（大量 PHP 项目需要维护）
- 快速原型`,
    tags: ['php', 'laravel', 'wordpress', 'web'],
    keywords: ['php 8', 'laravel', 'symfony', 'wordpress', 'eloquent', 'composer', 'roadrunner'],
    prompt_snippets: [
      'Laravel 10 API with Eloquent ORM and Queue jobs',
      'PHP 8 JIT compilation for performance',
      'RoadRunner persistent worker for high-performance PHP',
    ],
    applies_to: ['backend_engineer'],
    source: 'PHP 官方文档 + Laravel 文档',
    lang: 'zh-en',
    enabled: true,
  },
  {
    id: 'kb_eng_lang_mobile',
    collection: 'engineering',
    subcategory: '多语言开发',
    title: '移动开发：Kotlin (Android) + Swift (iOS) + Flutter + React Native',
    summary: '原生 vs 跨平台。原生体验最好，跨平台成本最低。2025 年首选：Kotlin+Swift 或 Flutter。',
    content: `**移动开发四大方案**

| 方案 | 平台 | 语言 | 体验 | 成本 |
|---|---|---|---|---|
| Kotlin | Android 原生 | Kotlin | ★★★★★ | 高 |
| Swift | iOS 原生 | Swift | ★★★★★ | 高 |
| Flutter | 跨平台 | Dart | ★★★★ | 中 |
| React Native | 跨平台 | JS/TS | ★★★☆ | 中 |
| Kotlin Multiplatform | 跨平台 | Kotlin | ★★★★ | 中 |

**Kotlin (Android)**

Kotlin 2017 年被 Google 宣布为 Android 官方首选，完全兼容 Java。

\`\`\`kotlin
// Jetpack Compose (现代声明式 UI)
@Composable
fun ProjectList(projects: List<Project>) {
    LazyColumn {
        items(projects) { project ->
            Card(
                modifier = Modifier.padding(8.dp),
                onClick = { /* open */ }
            ) {
                Column(Modifier.padding(16.dp)) {
                    Text(project.title, style = MaterialTheme.typography.h6)
                    Text(project.description)
                }
            }
        }
    }
}

// Coroutines (异步)
suspend fun generateVideo(prompt: String): Video {
    return withContext(Dispatchers.IO) {
        apiClient.generate(prompt)
    }
}
\`\`\`

**Swift (iOS)**

Swift 2014 年发布，取代 Objective-C。

\`\`\`swift
// SwiftUI (现代声明式 UI)
struct ProjectListView: View {
    @State private var projects: [Project] = []

    var body: some View {
        NavigationView {
            List(projects) { project in
                NavigationLink(destination: ProjectDetail(project: project)) {
                    VStack(alignment: .leading) {
                        Text(project.title).font(.headline)
                        Text(project.description).font(.subheadline)
                    }
                }
            }
            .task {
                projects = await loadProjects()
            }
        }
    }
}

// async/await (从 Swift 5.5)
func generateVideo(prompt: String) async throws -> Video {
    let url = URL(string: "https://api.example.com/generate")!
    var request = URLRequest(url: url)
    request.httpMethod = "POST"
    request.httpBody = try JSONEncoder().encode(["prompt": prompt])
    let (data, _) = try await URLSession.shared.data(for: request)
    return try JSONDecoder().decode(Video.self, from: data)
}
\`\`\`

**Flutter (跨平台)**

Google 的跨平台 UI 框架，一套代码 iOS + Android + Web + Desktop。

\`\`\`dart
class ProjectList extends StatelessWidget {
  final List<Project> projects;

  const ProjectList({super.key, required this.projects});

  @override
  Widget build(BuildContext context) {
    return ListView.builder(
      itemCount: projects.length,
      itemBuilder: (context, index) {
        final project = projects[index];
        return Card(
          child: ListTile(
            title: Text(project.title),
            subtitle: Text(project.description),
            onTap: () => Navigator.push(context, MaterialPageRoute(
              builder: (_) => ProjectDetail(project: project),
            )),
          ),
        );
      },
    );
  }
}
\`\`\`

**React Native (跨平台)**

Meta 的跨平台方案，JS/TS 写，Native 渲染。

\`\`\`tsx
import { FlatList, TouchableOpacity, Text } from 'react-native';

const ProjectList = ({ projects }) => (
  <FlatList
    data={projects}
    keyExtractor={(item) => item.id}
    renderItem={({ item }) => (
      <TouchableOpacity onPress={() => openProject(item)}>
        <Text style={styles.title}>{item.title}</Text>
        <Text>{item.description}</Text>
      </TouchableOpacity>
    )}
  />
);
\`\`\`

**移动 AI 推理**

在移动端跑 AI 模型：
- **CoreML** (iOS) - Apple 原生框架
- **ML Kit** (Google) - 跨 Android/iOS
- **TensorFlow Lite** - 跨平台
- **ONNX Runtime Mobile** - 跨平台
- **MediaPipe** - Google 的实时 AI
- **Whisper.cpp** - 本地语音识别

**VIDO 移动端建议**

短期：不做原生 APP，用 PWA (渐进式 Web App)
中期：Flutter 跨平台（成本最低）
长期：Kotlin + Swift 原生（体验最好）

**学习优先级**

如果只能学一个：
1. 已会 React → **React Native** (0 学习成本)
2. 已会 Java → **Kotlin** (相似)
3. 只做 iOS → **Swift + SwiftUI**
4. 无偏好 → **Flutter** (最快出 MVP)`,
    tags: ['移动开发', 'kotlin', 'swift', 'flutter'],
    keywords: ['kotlin', 'swift', 'flutter', 'react native', 'jetpack compose', 'swiftui', 'dart', 'mobile'],
    prompt_snippets: [
      'Kotlin Jetpack Compose declarative UI',
      'SwiftUI with async/await for iOS',
      'Flutter cross-platform with Dart',
    ],
    applies_to: ['frontend_engineer'],
    source: 'Kotlin / Swift / Flutter / React Native 官方文档',
    lang: 'zh-en',
    enabled: true,
  },
  {
    id: 'kb_eng_lang_scripts',
    collection: 'engineering',
    subcategory: '多语言开发',
    title: '脚本语言：Shell / Lua / Perl / Ruby（胶水 + 嵌入 + 快速）',
    summary: '脚本语言是工程师的"瑞士军刀"。Shell 自动化、Lua 嵌入、Perl 文本处理、Ruby 配置 DSL。',
    content: `**Shell (Bash/Zsh)**

运维工程师的母语。

\`\`\`bash
#!/bin/bash
set -euo pipefail  # 严格模式

# 函数
backup_db() {
    local db_name=$1
    local backup_dir=\${2:-/backups}
    pg_dump "$db_name" | gzip > "$backup_dir/$db_name-\$(date +%Y%m%d).sql.gz"
}

# 遍历 + 并行
for file in *.mp4; do
    ffmpeg -i "$file" "converted_\$file" &
done
wait  # 等所有并行任务完成

# 条件
if [[ -f /tmp/lock ]]; then
    echo "Already running" >&2
    exit 1
fi
touch /tmp/lock
trap "rm -f /tmp/lock" EXIT  # 退出时清理
\`\`\`

**实战：VIDO 部署脚本**
\`\`\`bash
#!/bin/bash
set -e

echo "Building..."
npm run build

echo "Deploying to production..."
rsync -avz --delete dist/ user@server:/var/www/vido/

echo "Restarting..."
ssh user@server "pm2 reload vido"

echo "Done!"
\`\`\`

**Lua**

特点：
- 极小 (~200KB)
- 极快
- 易嵌入 C/C++
- 游戏脚本首选 (World of Warcraft, Roblox)

\`\`\`lua
-- 简单 Lua 示例
local function greet(name)
    return "Hello, " .. name
end

-- 表 (Lua 的唯一数据结构)
local project = {
    title = "My Project",
    scenes = {},
    add_scene = function(self, scene)
        table.insert(self.scenes, scene)
    end
}

project:add_scene({id = 1, description = "Opening"})
\`\`\`

**Lua 嵌入 C**
\`\`\`c
#include <lua.h>
#include <lauxlib.h>
#include <lualib.h>

int main() {
    lua_State *L = luaL_newstate();
    luaL_openlibs(L);
    luaL_dostring(L, "print('Hello from Lua')");
    lua_close(L);
}
\`\`\`

**nginx + Lua (OpenResty)**

OpenResty = nginx + Lua，极致性能：
\`\`\`nginx
location /api {
    content_by_lua_block {
        local cjson = require "cjson"
        local body = ngx.req.get_body_data()
        local data = cjson.decode(body)
        -- 处理请求
        ngx.say(cjson.encode({status = "ok"}))
    }
}
\`\`\`

Redis 的 Lua 脚本也是这个道理。

**Perl**

曾经是系统管理员最爱，现在式微但仍在用：
- 正则处理之王
- CPAN 生态（早于所有包管理器）
- 老项目维护

\`\`\`perl
#!/usr/bin/perl
use strict;
use warnings;

# 文本处理
while (<>) {
    if (/^(\\w+)\\s+(\\d+)/) {
        print "Name: $1, Score: $2\\n";
    }
}

# 复杂正则
my $log = "2026-04-11 10:30:45 INFO Server started";
if ($log =~ /^(\\d{4}-\\d{2}-\\d{2})\\s+(\\d{2}:\\d{2}:\\d{2})\\s+(\\w+)\\s+(.*)$/) {
    print "Date: $1, Time: $2, Level: $3, Msg: $4\\n";
}
\`\`\`

**Ruby**

- Rails 曾经火遍全球
- Shopify / GitHub / Airbnb 最早用的
- DSL 专家 (Chef, Puppet, Vagrant)
- 中国小众

\`\`\`ruby
# Rails 示例
class Project < ApplicationRecord
    has_many :scenes, dependent: :destroy
    validates :title, presence: true

    scope :recent, -> { order(created_at: :desc).limit(10) }
end

# Controller
class ProjectsController < ApplicationController
    def create
        @project = Project.new(project_params)
        if @project.save
            render json: @project, status: :created
        else
            render json: @project.errors, status: :unprocessable_entity
        end
    end
end
\`\`\`

**DSL 示例 (Chef)**
\`\`\`ruby
package 'nginx' do
    action :install
end

service 'nginx' do
    action [:enable, :start]
end
\`\`\`

**脚本语言选择建议**

| 任务 | 首选 |
|---|---|
| 系统管理 | Bash |
| 文本处理 | Perl / Awk / Sed |
| 嵌入游戏 | Lua |
| 配置 DSL | Ruby |
| 科学计算 | Python |
| Web 后端 | 不要用这些（用 Node/Go/Java） |

**VIDO 使用**
- Bash: 部署脚本
- Python: AI 模型集成
- Lua: OpenResty 高性能边缘计算`,
    tags: ['脚本', 'bash', 'lua', 'perl', 'ruby'],
    keywords: ['bash', 'shell', 'lua', 'openresty', 'perl', 'ruby', 'rails', 'chef'],
    prompt_snippets: [
      'Bash script with set -euo pipefail for safe automation',
      'Lua embedded in C for game scripting',
      'OpenResty nginx + Lua for high-performance API',
    ],
    applies_to: ['backend_engineer'],
    source: 'Bash/Lua/Perl/Ruby 官方文档',
    lang: 'zh-en',
    enabled: true,
  },

  // ═══════════════════════════════════════════════════
  // ⑨ 数据库与存储【v7 新增】
  // ═══════════════════════════════════════════════════
  {
    id: 'kb_eng_db_relational',
    collection: 'engineering',
    subcategory: '多组件设计',
    title: '关系型数据库深度（PostgreSQL / MySQL / SQLite 选型 + 索引 + 优化）',
    summary: 'PostgreSQL 是开源之王，MySQL 仍是最流行，SQLite 是嵌入式王者。索引和 EXPLAIN 是必修课。',
    content: `**三大关系型数据库对比**

| 维度 | PostgreSQL | MySQL | SQLite |
|---|---|---|---|
| 类型 | 客户端-服务器 | 客户端-服务器 | 嵌入式 |
| SQL 标准 | 最严格 | 宽松 | 基础 |
| JSON 支持 | 最好 (JSONB) | 好 | 好 |
| 全文搜索 | 内置 | 内置 | 基础 |
| 向量搜索 | pgvector | 8.0+ | sqlite-vec |
| 并发写 | 行锁 | 行锁 | 写锁全库 |
| 扩展性 | 最好 | 好 | 单机 |
| 复制 | 流复制 | 主从 | 无 |

**PostgreSQL 特色**
- JSONB 支持 (像 MongoDB 但更强)
- 扩展丰富（PostGIS 地理，TimescaleDB 时序，pgvector 向量）
- CTE / 窗口函数 / 物化视图
- 支持事务 DDL
- 自定义类型和函数

**MySQL 特色**
- 最流行，文档最多
- InnoDB 存储引擎成熟
- 5.7 → 8.0 大幅升级
- AWS/阿里云都原生支持

**SQLite 特色**
- 单文件数据库
- 0 配置
- 移动端标配
- Android/iOS 自带
- **VIDO 现在用 JSON 文件 store，可以升级到 SQLite**

**索引核心**

**B-Tree 索引 (默认)**
\`\`\`sql
CREATE INDEX idx_projects_user_id ON projects(user_id);
CREATE INDEX idx_projects_created_at ON projects(created_at DESC);

-- 复合索引（注意顺序）
CREATE INDEX idx_projects_user_status ON projects(user_id, status);
-- 左匹配规则：(user_id) 和 (user_id, status) 都能用，但 (status) 不能
\`\`\`

**哈希索引 (等值查询快)**
\`\`\`sql
CREATE INDEX idx_email_hash ON users USING HASH (email);
\`\`\`

**GiST / GIN 索引 (全文/数组/JSONB)**
\`\`\`sql
-- PostgreSQL 全文搜索
CREATE INDEX idx_content_fts ON articles USING GIN (to_tsvector('chinese', content));
SELECT * FROM articles WHERE to_tsvector('chinese', content) @@ to_tsquery('AI & 视频');

-- JSONB 索引
CREATE INDEX idx_metadata ON projects USING GIN (metadata);
SELECT * FROM projects WHERE metadata @> '{"style": "cinematic"}';
\`\`\`

**pgvector (向量搜索)**
\`\`\`sql
CREATE EXTENSION vector;

CREATE TABLE kb_docs (
    id UUID PRIMARY KEY,
    content TEXT,
    embedding vector(1536)  -- OpenAI ada-002 维度
);

CREATE INDEX ON kb_docs USING ivfflat (embedding vector_cosine_ops);

-- 相似度搜索
SELECT content FROM kb_docs
ORDER BY embedding <-> '[0.1, 0.2, ...]'::vector
LIMIT 5;
\`\`\`

**EXPLAIN 必学**

慢查询优化第一步：
\`\`\`sql
EXPLAIN ANALYZE
SELECT * FROM projects
WHERE user_id = 123 AND status = 'done'
ORDER BY created_at DESC
LIMIT 10;

-- 看输出：
-- Seq Scan = 全表扫 (慢)
-- Index Scan = 索引扫 (快)
-- Bitmap Index Scan = 多个索引组合
-- Hash Join / Nested Loop / Merge Join = 连接算法
\`\`\`

**索引不要建太多**
- 索引占空间
- 写入会变慢（每个索引都要更新）
- 经验法则：每个表不超过 5-7 个索引

**分区 Partitioning**
\`\`\`sql
-- 按时间分区
CREATE TABLE logs (
    id BIGINT,
    log_time TIMESTAMP,
    message TEXT
) PARTITION BY RANGE (log_time);

CREATE TABLE logs_2026_04 PARTITION OF logs
    FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');
\`\`\`

**事务隔离级别**
1. Read Uncommitted (最低，能读脏数据)
2. Read Committed (PostgreSQL 默认)
3. Repeatable Read (MySQL 默认)
4. Serializable (最高)

大多数场景用 Read Committed 或 Repeatable Read。

**连接池**
不要裸连接数据库，用连接池：
- Node.js: pg / mysql2 (内置 pool)
- Java: HikariCP
- Python: SQLAlchemy + psycopg2-pool

**备份与恢复**
- PostgreSQL: \`pg_dump / pg_restore\`
- MySQL: \`mysqldump / mysql\`
- SQLite: 直接复制文件 (正在写入时要锁)

**VIDO 数据库建议**

**短期**: 保持 JSON 文件（VIDO 当前）
**中期**: 迁移到 SQLite（单文件 + ACID）
**长期**: PostgreSQL（多用户 + pgvector 做 RAG）

迁移路径：
1. SQLite 兼容 99% SQL
2. 代码改 connection string
3. PostgreSQL 替换
4. 加 pgvector 做语义搜索`,
    tags: ['数据库', 'postgresql', 'mysql', 'sqlite', '索引'],
    keywords: ['postgresql', 'mysql', 'sqlite', 'btree index', 'pgvector', 'explain', 'transaction isolation'],
    prompt_snippets: [
      'PostgreSQL JSONB column with GIN index for flexible schema',
      'pgvector for semantic similarity search in RAG',
      'EXPLAIN ANALYZE to diagnose slow queries',
    ],
    applies_to: ['backend_engineer', 'algorithm_engineer'],
    source: 'PostgreSQL / MySQL / SQLite 官方文档',
    lang: 'zh-en',
    enabled: true,
  },
  {
    id: 'kb_eng_db_nosql_redis',
    collection: 'engineering',
    subcategory: '多组件设计',
    title: 'Redis 高性能 K/V + 数据结构 + 6 大使用场景',
    summary: 'Redis 是内存数据库之王。不只是缓存，还是消息队列、分布式锁、计数器、排行榜。',
    content: `**Redis 的核心**

- 内存数据库（100k+ QPS）
- 支持持久化（RDB + AOF）
- 单线程（6.0+ 多线程 I/O）
- 丰富的数据结构

**Redis 核心数据结构**

**String**
\`\`\`bash
SET user:1:name "Alice"
GET user:1:name
INCR counter
EXPIRE user:1:name 3600  # 1 小时后过期
\`\`\`

**List (双向链表)**
\`\`\`bash
LPUSH queue:video-gen "task1"
RPOP queue:video-gen   # 队列
BRPOP queue:video-gen 10  # 阻塞等待
\`\`\`

**Hash**
\`\`\`bash
HSET user:1 name "Alice" age 30 email "a@b.com"
HGETALL user:1
HINCRBY user:1 age 1
\`\`\`

**Set (无序唯一集合)**
\`\`\`bash
SADD online:users "user1"
SADD online:users "user2"
SCARD online:users  # 有多少人在线
SISMEMBER online:users "user1"
\`\`\`

**Sorted Set (带分数的有序集合)**
\`\`\`bash
ZADD leaderboard 100 "alice"
ZADD leaderboard 200 "bob"
ZREVRANGE leaderboard 0 9 WITHSCORES  # 排行榜 top 10
ZRANK leaderboard "alice"  # 某人排名
\`\`\`

**Stream (消息流)**
\`\`\`bash
XADD events * type "video.generated" id "123"
XREAD COUNT 10 STREAMS events 0
\`\`\`

**Pub/Sub**
\`\`\`bash
# 订阅者
SUBSCRIBE channel:notifications

# 发布者
PUBLISH channel:notifications "New message"
\`\`\`

**Bitmap**
\`\`\`bash
SETBIT daily_active:20260411 123 1  # 用户 123 今日活跃
BITCOUNT daily_active:20260411  # 今日活跃用户数
\`\`\`

**HyperLogLog (基数估算)**
\`\`\`bash
PFADD unique_visitors "user1" "user2" "user1"
PFCOUNT unique_visitors  # 去重计数 (只用 12KB 内存)
\`\`\`

**GEO (地理位置)**
\`\`\`bash
GEOADD locations 13.3 52.5 "Berlin"
GEOADD locations 2.3 48.8 "Paris"
GEODIST locations Berlin Paris km
GEORADIUS locations 10 50 500 km  # 500km 内的城市
\`\`\`

**Redis 6 大核心使用场景**

**#1 缓存**
\`\`\`js
// 查用户时先查 Redis
let user = await redis.get(\`user:\${id}\`);
if (!user) {
    user = await db.query('SELECT * FROM users WHERE id = ?', [id]);
    await redis.setex(\`user:\${id}\`, 3600, JSON.stringify(user));
}
\`\`\`

**#2 消息队列**
\`\`\`js
// BullMQ 基于 Redis
import { Queue } from 'bullmq';
const queue = new Queue('video-gen', { connection: { host: 'redis' } });
await queue.add('generate', { prompt: 'A cat' });
\`\`\`

**#3 分布式锁**
\`\`\`js
// 防止重复执行
const locked = await redis.set('lock:generate:123', '1', 'NX', 'EX', 60);
if (locked) {
    try {
        await generateVideo();
    } finally {
        await redis.del('lock:generate:123');
    }
}
\`\`\`

更安全的：**Redlock 算法** (多节点)

**#4 计数器**
\`\`\`js
// 限流：每分钟 100 次
const key = \`ratelimit:\${userId}:\${Math.floor(Date.now() / 60000)}\`;
const count = await redis.incr(key);
if (count === 1) await redis.expire(key, 60);
if (count > 100) throw new Error('Rate limited');
\`\`\`

**#5 排行榜**
\`\`\`js
// 热门视频排行
await redis.zadd('hot:videos', 100, 'video_1');
const top10 = await redis.zrevrange('hot:videos', 0, 9, 'WITHSCORES');
\`\`\`

**#6 Session 存储**
\`\`\`js
// Express 用 Redis 存 session
import session from 'express-session';
import RedisStore from 'connect-redis';
app.use(session({
    store: new RedisStore({ client: redis }),
    secret: 'secret',
}));
\`\`\`

**Redis 集群**
- **Redis Sentinel** - 高可用（master/slave + 自动切换）
- **Redis Cluster** - 水平分片（16384 个槽）
- **Dragonfly** - Redis 兼容的多线程替代

**持久化**
- **RDB** - 定期快照（快但有数据丢失窗口）
- **AOF** - 每次写都记日志（慢但不丢数据）
- 建议：两者都开

**陷阱**
- 不要存超大 value（单个 > 1MB 会阻塞）
- 不要用 KEYS 命令（全表扫描）→ 用 SCAN
- 不要无 TTL 存数据（内存会爆）
- 不要多 DB（只用 DB 0，用不同 key prefix）

**VIDO 使用场景**
- 任务队列（视频生成异步任务）
- 缓存 LLM 响应（同样 prompt 不重复调）
- 限流
- 分布式锁
- SSE 进度广播 (Pub/Sub)`,
    tags: ['redis', '缓存', '队列', '锁'],
    keywords: ['redis', 'cache', 'queue', 'distributed lock', 'rate limit', 'leaderboard', 'pub sub', 'bullmq'],
    prompt_snippets: [
      'Redis SETEX for caching LLM responses with TTL',
      'Redis INCR for rate limiting per user per minute',
      'Redis ZADD ZREVRANGE for leaderboards',
      'Redlock distributed locking across multiple nodes',
    ],
    applies_to: ['backend_engineer'],
    source: 'Redis 官方文档 + 实战经验',
    lang: 'zh-en',
    enabled: true,
  },

  // ═══════════════════════════════════════════════════
  // ⑩ DevOps / 云原生 / 测试 / 安全 / 性能【v7 新增】
  // ═══════════════════════════════════════════════════
  {
    id: 'kb_eng_cloud_k8s',
    collection: 'engineering',
    subcategory: '多组件设计',
    title: 'Docker + Kubernetes 云原生部署完整指南',
    summary: 'Docker 容器化 + K8s 编排是 2025 年生产部署的事实标准。VIDO 级应用从 docker-compose 到 K8s 的进阶路径。',
    content: `**Docker 基础**

**Dockerfile 写好 VIDO**
\`\`\`dockerfile
# 多阶段构建
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --production

FROM node:20-alpine
WORKDIR /app
RUN apk add --no-cache ffmpeg
COPY --from=builder /app/node_modules ./node_modules
COPY . .
EXPOSE 3007
USER node
CMD ["node", "src/server.js"]
\`\`\`

**Docker Compose (单机)**
\`\`\`yaml
version: '3.9'
services:
  vido:
    build: .
    ports:
      - "3007:3007"
    volumes:
      - ./outputs:/app/outputs
      - ./docs:/app/docs
    environment:
      - NODE_ENV=production
    depends_on:
      - redis
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    volumes:
      - redis-data:/data
    restart: unless-stopped

  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf
    depends_on:
      - vido

volumes:
  redis-data:
\`\`\`

**启动**: \`docker-compose up -d\`

**从 Docker Compose 到 Kubernetes**

何时需要 K8s：
- 多节点（> 3 台机器）
- 需要自动扩缩容
- 需要零宕机部署
- 团队 > 5 人

**Kubernetes 核心概念**

- **Pod** - 最小部署单元（1+ 容器）
- **Deployment** - 管理 Pod 副本
- **Service** - 对外暴露
- **Ingress** - 路由 + SSL
- **ConfigMap** - 配置
- **Secret** - 密钥
- **PersistentVolume** - 持久化存储

**K8s Deployment 示例**
\`\`\`yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: vido
spec:
  replicas: 3  # 三个副本
  selector:
    matchLabels:
      app: vido
  template:
    metadata:
      labels:
        app: vido
    spec:
      containers:
      - name: vido
        image: registry.com/vido:latest
        ports:
        - containerPort: 3007
        env:
        - name: NODE_ENV
          value: production
        - name: REDIS_URL
          valueFrom:
            secretKeyRef:
              name: vido-secrets
              key: redis-url
        resources:
          limits:
            memory: 2Gi
            cpu: "2"
          requests:
            memory: 1Gi
            cpu: "1"
        livenessProbe:
          httpGet:
            path: /api/health
            port: 3007
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /api/health
            port: 3007
          initialDelaySeconds: 5
          periodSeconds: 5
---
apiVersion: v1
kind: Service
metadata:
  name: vido
spec:
  selector:
    app: vido
  ports:
  - port: 80
    targetPort: 3007
  type: ClusterIP
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: vido
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt
spec:
  tls:
  - hosts:
    - vido.example.com
    secretName: vido-tls
  rules:
  - host: vido.example.com
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: vido
            port:
              number: 80
\`\`\`

**HPA 自动扩缩容**
\`\`\`yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: vido-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: vido
  minReplicas: 2
  maxReplicas: 10
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70
\`\`\`

CPU 超过 70% 自动加 Pod，下降了自动减。

**kubectl 常用命令**
\`\`\`bash
kubectl get pods              # 查 Pod
kubectl logs -f vido-xxx      # 看日志
kubectl exec -it vido-xxx -- sh  # 进入容器
kubectl apply -f deployment.yaml  # 部署
kubectl rollout status deployment/vido  # 看部署进度
kubectl rollout undo deployment/vido  # 回滚
kubectl scale deployment/vido --replicas=5  # 手动扩容
\`\`\`

**托管 K8s 服务**
- AWS EKS
- GCP GKE
- Azure AKS
- 阿里云 ACK
- 腾讯云 TKE

**K8s 生态工具**
- **Helm** - 包管理器（chart）
- **Kustomize** - 配置管理
- **ArgoCD** - GitOps 持续部署
- **Prometheus + Grafana** - 监控
- **Istio / Linkerd** - Service Mesh
- **Velero** - 备份

**VIDO 部署进阶路径**

1. **当前**: 裸机 + PM2 (VIDO 已有)
2. **Phase 1**: Docker + docker-compose（单机多服务）
3. **Phase 2**: 管理面板 Portainer / Dokploy
4. **Phase 3**: 多台机器 + K3s (轻量 K8s)
5. **Phase 4**: 托管 K8s + Helm + ArgoCD

**陷阱**
- 不要为了学 K8s 而用 K8s
- 小团队用 Dokku / Coolify / CapRover 足矣
- K8s 学习成本 = 三个月
- 运维成本 = 一个全职 SRE`,
    tags: ['docker', 'kubernetes', '云原生', 'devops'],
    keywords: ['docker', 'kubernetes', 'k8s', 'helm', 'argocd', 'docker-compose', 'pod', 'deployment', 'hpa'],
    prompt_snippets: [
      'multi-stage Dockerfile with alpine base and non-root user',
      'Kubernetes Deployment with liveness/readiness probes',
      'HorizontalPodAutoscaler for auto-scaling based on CPU',
    ],
    applies_to: ['backend_engineer', 'workflow_engineer'],
    source: 'Docker / Kubernetes 官方文档 + 云原生实战',
    lang: 'zh-en',
    enabled: true,
  },
  {
    id: 'kb_eng_devops_cicd',
    collection: 'engineering',
    subcategory: '多组件设计',
    title: 'DevOps CI/CD 流水线（GitHub Actions / GitLab CI / Jenkins）',
    summary: '自动化部署流水线：代码推送 → 测试 → 构建 → 部署 → 监控。让每次发布变成"按一个按钮"。',
    content: `**DevOps 核心循环**

\`\`\`
Plan → Code → Build → Test → Deploy → Operate → Monitor → (回 Plan)
\`\`\`

**CI = Continuous Integration**
持续集成：代码一提交就自动跑测试

**CD = Continuous Delivery / Deployment**
持续交付：自动部署到测试环境
持续部署：自动部署到生产

**主流平台**

| 平台 | 特点 |
|---|---|
| **GitHub Actions** | GitHub 内置，生态最丰富 |
| **GitLab CI** | GitLab 内置，企业版强 |
| **Jenkins** | 老牌，自托管 |
| **CircleCI** | 云服务，易用 |
| **Drone** | 轻量级 |
| **Tekton** | 云原生 |

**GitHub Actions 示例**

\`.github/workflows/deploy.yml\`
\`\`\`yaml
name: Deploy VIDO

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
      with:
        node-version: '20'
        cache: 'npm'
    - run: npm ci
    - run: npm run lint
    - run: npm test

  build:
    needs: test
    runs-on: ubuntu-latest
    steps:
    - uses: actions/checkout@v4
    - uses: docker/setup-buildx-action@v3
    - uses: docker/login-action@v3
      with:
        registry: ghcr.io
        username: \${{ github.actor }}
        password: \${{ secrets.GITHUB_TOKEN }}
    - uses: docker/build-push-action@v5
      with:
        context: .
        push: true
        tags: ghcr.io/\${{ github.repository }}:latest

  deploy:
    needs: build
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main'
    steps:
    - name: Deploy to production
      uses: appleboy/ssh-action@v1
      with:
        host: \${{ secrets.PROD_HOST }}
        username: \${{ secrets.PROD_USER }}
        key: \${{ secrets.PROD_SSH_KEY }}
        script: |
          cd /opt/vido/app
          docker-compose pull
          docker-compose up -d
          docker image prune -f
\`\`\`

**VIDO 当前部署 vs CI/CD 对比**

**当前（手动）**:
\`\`\`
1. 本地修改代码
2. 本地验证
3. 手动运行 deploy-kb.js
4. 手动 pm2 reload
\`\`\`

**升级到 CI/CD 后**:
\`\`\`
1. git push
2. 自动 test + build + deploy
3. 自动通知成功/失败
\`\`\`

**测试金字塔**

\`\`\`
       E2E (10%)          <- 慢但全面
      ┌─────┐
     Integration (20%)    <- 测模块集成
    ┌─────────┐
   Unit Tests (70%)       <- 快且多
  ┌─────────────┐
\`\`\`

**测试工具**

**Unit Tests**
- Node.js: Jest / Vitest
- Python: pytest
- Java: JUnit 5
- C++: Google Test

**Integration Tests**
- Supertest (Node HTTP)
- TestContainers (Docker 真实依赖)

**E2E Tests**
- Playwright / Cypress (Web UI)
- Detox (移动)

**Jest 示例**
\`\`\`js
import { agentScreenwriter } from '../src/services/dramaService';

describe('agentScreenwriter', () => {
    it('should generate scenes', async () => {
        const result = await agentScreenwriter({
            theme: 'Love story',
            sceneCount: 3,
        });
        expect(result).toHaveProperty('title');
        expect(result.scenes).toHaveLength(3);
    });
});
\`\`\`

**监控与告警**

**指标监控**
- Prometheus + Grafana
- Datadog
- New Relic
- CloudWatch

**日志聚合**
- ELK (Elasticsearch + Logstash + Kibana)
- Loki + Grafana
- Splunk

**错误追踪**
- Sentry
- Rollbar
- Bugsnag

**APM (应用性能管理)**
- New Relic
- Datadog APM
- Elastic APM

**关键指标 (SRE Golden Signals)**

1. **Latency** - 请求耗时
2. **Traffic** - 请求量
3. **Errors** - 错误率
4. **Saturation** - 资源饱和度

**告警规则示例**
\`\`\`yaml
# Prometheus alerting rule
- alert: HighErrorRate
  expr: rate(http_requests_total{status=~"5.."}[5m]) > 0.05
  for: 10m
  annotations:
    summary: "High error rate on {{ $labels.instance }}"
\`\`\`

**蓝绿部署 vs 金丝雀 vs 滚动**

- **Rolling Update** (K8s 默认): 一个一个 Pod 替换
- **Blue-Green**: 准备新版本，切流量，零宕机
- **Canary**: 1% 流量到新版本 → 监控 → 逐步扩大
- **Feature Flag**: 代码已部署但按开关启用

**VIDO 推荐路径**

1. **短期**: GitHub Actions 基础测试 + 部署
2. **中期**: 加 Sentry 错误追踪
3. **长期**: Prometheus + Grafana 全链路监控`,
    tags: ['devops', 'ci/cd', 'github actions', '监控'],
    keywords: ['devops', 'ci/cd', 'github actions', 'gitlab ci', 'jenkins', 'sre', 'prometheus', 'grafana', 'sentry'],
    prompt_snippets: [
      'GitHub Actions workflow with test + build + deploy stages',
      'Docker buildx multi-platform image push to ghcr.io',
      'Prometheus + Grafana for SRE golden signals monitoring',
    ],
    applies_to: ['backend_engineer', 'workflow_engineer'],
    source: 'Google SRE book + DevOps Handbook + GitHub Actions 文档',
    lang: 'zh-en',
    enabled: true,
  },
  {
    id: 'kb_eng_security',
    collection: 'engineering',
    subcategory: '多组件设计',
    title: '安全工程（OWASP Top 10 / 认证授权 / 密钥管理 / 渗透测试）',
    summary: '安全不是功能，是质量。OWASP Top 10 是所有工程师的必修课。',
    content: `**OWASP Top 10 (2021)**

1. **A01 - 访问控制失效**
2. **A02 - 加密失效**
3. **A03 - 注入 (SQL/XSS/Command)**
4. **A04 - 不安全设计**
5. **A05 - 安全配置错误**
6. **A06 - 易损和过时组件**
7. **A07 - 认证失效**
8. **A08 - 软件与数据完整性失效**
9. **A09 - 日志记录与监控失效**
10. **A10 - SSRF**

**Top 10 对应防御**

**A01 访问控制**
\`\`\`js
// 错误：只验证登录，不验证权限
if (!user) return 403;
return db.delete('project', req.params.id);

// 正确：必须验证资源所有权
if (!user) return 403;
const project = db.get('project', req.params.id);
if (project.user_id !== user.id && !user.isAdmin) return 403;
return db.delete('project', req.params.id);
\`\`\`

**A02 加密**
- HTTPS 必须 (Let's Encrypt 免费)
- 密码不存明文 → bcrypt / argon2id
- API Key 加密存储
- 数据库加密 at rest
- TLS 1.2+ (不用 TLS 1.0/1.1)

**密码哈希示例 (bcrypt)**
\`\`\`js
import bcrypt from 'bcrypt';

// 注册
const hash = await bcrypt.hash(password, 12);
await db.insert('users', { username, hash });

// 登录
const user = await db.findOne('users', { username });
const ok = await bcrypt.compare(password, user.hash);
\`\`\`

**A03 注入**

**SQL 注入**
\`\`\`js
// ❌ 错误
const q = \`SELECT * FROM users WHERE name = '\${name}'\`;
// 用户输入 "'; DROP TABLE users; --" → 灾难

// ✓ 正确：参数化查询
const q = 'SELECT * FROM users WHERE name = ?';
const result = await db.query(q, [name]);
\`\`\`

**XSS**
\`\`\`js
// ❌ 错误
element.innerHTML = userInput;

// ✓ 正确：转义或用 textContent
element.textContent = userInput;

// 或用库转义
import DOMPurify from 'dompurify';
element.innerHTML = DOMPurify.sanitize(userInput);
\`\`\`

**Command Injection**
\`\`\`js
// ❌ 错误
exec(\`ffmpeg -i \${filename} output.mp4\`);

// ✓ 正确：用数组参数
execFile('ffmpeg', ['-i', filename, 'output.mp4']);
\`\`\`

**A07 认证**

**JWT 安全要点**
- 用强随机 secret (≥256 bit)
- 设置 exp (过期时间)
- HttpOnly cookie 存储
- 不要存敏感信息
- 考虑 refresh token 机制

**JWT 示例**
\`\`\`js
import jwt from 'jsonwebtoken';

// 签发
const token = jwt.sign(
    { userId: user.id, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
);

// 验证
try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload;
} catch (e) {
    return res.status(401).json({ error: 'Invalid token' });
}
\`\`\`

**OAuth 2.0 + OIDC**
用户登录用 OAuth (Google/Apple/WeChat)，你不需要管理密码。

**CSRF 防御**
- 用 SameSite cookie (\`SameSite=Strict\`)
- 或 CSRF token

**密钥管理**

**永远不要**
- commit API key 到 git
- 把密钥放在前端代码
- 密钥明文传输
- 同一密钥给所有环境

**应该**
- 用环境变量
- 用密钥管理服务 (AWS KMS / HashiCorp Vault)
- 定期轮换
- 按角色授予最小权限

**环境变量最佳实践**
\`\`\`bash
# .env (不要 commit)
DATABASE_URL=postgresql://...
OPENAI_API_KEY=sk-...
JWT_SECRET=random-256-bit-string

# .env.example (commit 这个)
DATABASE_URL=
OPENAI_API_KEY=
JWT_SECRET=
\`\`\`

**.gitignore**
\`\`\`
.env
.env.local
*.key
*.pem
\`\`\`

**A05 配置错误**

- 不要暴露管理面板
- 不要默认密码 (admin/admin)
- 不要启用 debug 模式在生产
- 不要返回详细错误信息
- 不要开放不需要的端口

**安全 HTTP Headers**
\`\`\`js
import helmet from 'helmet';
app.use(helmet({
    contentSecurityPolicy: { /* ... */ },
    hsts: { maxAge: 31536000 },
    noSniff: true,
    xssFilter: true,
}));
\`\`\`

**SSRF (A10)**

如果后端接收 URL 然后访问：
\`\`\`js
// ❌ 危险：用户可以让服务器访问内网 IP
const r = await fetch(req.body.url);

// ✓ 安全：白名单 + 解析 DNS
const allowed = ['api.openai.com', 'api.anthropic.com'];
const url = new URL(req.body.url);
if (!allowed.includes(url.hostname)) throw new Error('Not allowed');
// 还要防止 DNS rebinding → 解析 IP 并检查
\`\`\`

**依赖安全 (A06)**

定期运行：
\`\`\`bash
npm audit          # Node.js
pip-audit          # Python
cargo audit        # Rust
\`\`\`

用 **Dependabot** / **Renovate** 自动升级。

**渗透测试工具**
- **OWASP ZAP** - 开源 web 安全扫描
- **Burp Suite** - 商用，行业标准
- **Metasploit** - 漏洞利用框架
- **nmap** - 端口扫描
- **sqlmap** - SQL 注入自动化

**安全审计 checklist**
- [ ] 所有密码用 bcrypt/argon2 哈希
- [ ] 所有 SQL 参数化
- [ ] 所有用户输入转义/验证
- [ ] HTTPS 全站
- [ ] Rate limit 所有端点
- [ ] Security headers 配置 (helmet)
- [ ] 依赖定期 audit
- [ ] 密钥在环境变量/vault
- [ ] 日志不记录敏感信息
- [ ] 错误不暴露内部细节

**VIDO 当前安全状态**
- ✅ JWT 鉴权
- ✅ 密码 hash
- ⚠️ 密钥用 .env 但没加密
- ⚠️ 没有 rate limit
- ⚠️ 没有 helmet security headers
- ⚠️ 没有依赖 audit 自动化

**建议升级**
1. 加 helmet
2. 加 express-rate-limit
3. 所有 API key 用 vault / KMS
4. GitHub Actions 里跑 npm audit`,
    tags: ['安全', 'owasp', '认证', '密钥'],
    keywords: ['security', 'owasp top 10', 'sql injection', 'xss', 'csrf', 'jwt', 'bcrypt', 'helmet'],
    prompt_snippets: [
      'OWASP Top 10 defense: parameterized queries, output escaping, helmet headers',
      'bcrypt password hashing with cost factor 12',
      'JWT with HttpOnly cookie + SameSite=Strict',
    ],
    applies_to: ['backend_engineer'],
    source: 'OWASP Top 10 2021 + 安全编码实战',
    lang: 'zh-en',
    enabled: true,
  },
  {
    id: 'kb_eng_testing_pyramid',
    collection: 'engineering',
    subcategory: '多组件设计',
    title: '测试金字塔 + 主流测试框架选型',
    summary: '测试分层：Unit (70%) → Integration (20%) → E2E (10%)。每层用对工具效率翻倍。',
    content: `**测试金字塔**

\`\`\`
         ▲
        ╱ ╲       E2E (10%)        真实用户场景 / 慢 / 少
       ╱   ╲
      ╱─────╲
     ╱       ╲    Integration (20%) 模块间协作 / 中速 / 中量
    ╱─────────╲
   ╱           ╲  Unit (70%)       函数/类级别 / 极快 / 大量
  ╱─────────────╲
\`\`\`

**Unit Tests - 70%**

单元测试：测试单个函数/方法，不涉及数据库/网络。

**Jest (Node.js)**
\`\`\`js
// src/utils/math.js
export function add(a, b) { return a + b; }

// src/utils/math.test.js
import { add } from './math';

describe('math', () => {
    test('adds two numbers', () => {
        expect(add(1, 2)).toBe(3);
    });

    test('handles negatives', () => {
        expect(add(-1, 1)).toBe(0);
    });
});
\`\`\`

**Vitest (更快的 Jest)**
\`\`\`js
import { describe, test, expect } from 'vitest';
// 语法几乎相同
\`\`\`

**pytest (Python)**
\`\`\`python
# test_math.py
from math_utils import add

def test_add_positive():
    assert add(1, 2) == 3

def test_add_negative():
    assert add(-1, 1) == 0
\`\`\`

**Mock / Stub / Spy**
\`\`\`js
// Jest mock 示例
jest.mock('../db');
import db from '../db';

test('getUserById calls db', async () => {
    db.query.mockResolvedValue({ id: 1, name: 'Alice' });
    const user = await getUserById(1);
    expect(user.name).toBe('Alice');
    expect(db.query).toHaveBeenCalledWith('SELECT * FROM users WHERE id = ?', [1]);
});
\`\`\`

**覆盖率**
\`\`\`bash
jest --coverage
# 输出：Statements 85.5%, Branches 80%, Functions 90%, Lines 85%
\`\`\`

建议目标：
- Statements: 80%+
- Branches: 75%+
- 关键逻辑：100%

**Integration Tests - 20%**

集成测试：测试模块组合，可能涉及真实数据库/HTTP。

**Supertest (HTTP 集成)**
\`\`\`js
import request from 'supertest';
import app from '../src/server';

describe('POST /api/projects', () => {
    test('creates project', async () => {
        const token = await loginAsTestUser();
        const res = await request(app)
            .post('/api/projects')
            .set('Authorization', \`Bearer \${token}\`)
            .send({ title: 'Test' });
        expect(res.status).toBe(201);
        expect(res.body.data.title).toBe('Test');
    });
});
\`\`\`

**TestContainers (真实依赖)**
\`\`\`js
import { PostgreSqlContainer } from '@testcontainers/postgresql';

let container;
beforeAll(async () => {
    container = await new PostgreSqlContainer().start();
    process.env.DATABASE_URL = container.getConnectionUri();
});

afterAll(async () => {
    await container.stop();
});
\`\`\`

用真实 Postgres 测，不 mock，结果可信。

**E2E Tests - 10%**

端到端：模拟真实用户操作浏览器。

**Playwright (推荐)**
\`\`\`js
import { test, expect } from '@playwright/test';

test('user can create a project', async ({ page }) => {
    await page.goto('http://localhost:3007');
    await page.fill('#username', 'admin');
    await page.fill('#password', 'admin123');
    await page.click('button[type="submit"]');

    await page.click('text=新建项目');
    await page.fill('#project-title', 'My First Drama');
    await page.click('text=创建');

    await expect(page.locator('.project-card')).toContainText('My First Drama');
});
\`\`\`

**Cypress**
\`\`\`js
describe('Project creation', () => {
    it('creates a new project', () => {
        cy.visit('/');
        cy.get('#username').type('admin');
        cy.get('#password').type('admin123');
        cy.get('button[type=submit]').click();
        cy.contains('新建项目').click();
        cy.get('#project-title').type('My First Drama');
        cy.contains('创建').click();
        cy.get('.project-card').should('contain', 'My First Drama');
    });
});
\`\`\`

**测试数据管理**

- **Fixtures**: 固定测试数据 JSON
- **Factories**: 动态生成测试数据（factory_boy, @faker-js）
- **Seeds**: 启动前插入数据库

**Faker 示例**
\`\`\`js
import { faker } from '@faker-js/faker';

const user = {
    name: faker.person.fullName(),
    email: faker.internet.email(),
    age: faker.number.int({ min: 18, max: 80 }),
};
\`\`\`

**测试数据库**

- 每个测试独立 DB 或 schema
- Transaction rollback（测试结束回滚）
- Truncate 所有表

**快照测试**
\`\`\`js
test('component matches snapshot', () => {
    const component = renderComponent();
    expect(component).toMatchSnapshot();
});
\`\`\`

第一次运行生成 .snap 文件，之后比对。

**Property-based Testing**

生成随机输入测试属性：
\`\`\`js
import fc from 'fast-check';

test('add is commutative', () => {
    fc.assert(fc.property(
        fc.integer(), fc.integer(),
        (a, b) => add(a, b) === add(b, a)
    ));
});
\`\`\`

自动测 1000 组随机输入。

**性能测试**

**k6 (现代)**
\`\`\`js
import http from 'k6/http';
import { check } from 'k6';

export const options = {
    vus: 100,       // 虚拟用户
    duration: '30s',
};

export default function () {
    const res = http.get('http://localhost:3007/api/health');
    check(res, { 'status 200': (r) => r.status === 200 });
}
\`\`\`

运行：\`k6 run test.js\`

**测试驱动开发 TDD**

1. **Red**: 写一个失败的测试
2. **Green**: 写最少的代码让它过
3. **Refactor**: 重构代码，测试仍过

适合：算法、业务逻辑
不适合：UI、原型、探索性代码

**VIDO 当前测试状态**
- ❌ 几乎没有测试
- 建议：
  1. 从 kb service 的纯函数开始（buildAgentContext / searchForAgent）
  2. 再加 HTTP 集成测试（admin 路由 CRUD）
  3. 最后加 Playwright E2E

**CI 集成**
\`\`\`yaml
# .github/workflows/test.yml
- run: npm ci
- run: npm run lint
- run: npm run test:unit
- run: npm run test:integration
- run: npm run test:e2e
- uses: codecov/codecov-action@v4
\`\`\``,
    tags: ['测试', 'unit test', 'e2e', 'jest', 'playwright'],
    keywords: ['testing pyramid', 'unit test', 'integration test', 'e2e', 'jest', 'vitest', 'playwright', 'cypress', 'testcontainers', 'k6'],
    prompt_snippets: [
      'Jest unit test with mock and coverage 80%+',
      'Supertest integration test for HTTP endpoints',
      'Playwright E2E test for user workflow',
      'k6 performance test with virtual users',
    ],
    applies_to: ['backend_engineer', 'frontend_engineer', 'workflow_engineer'],
    source: 'Testing Pyramid (Mike Cohn) + Jest/Playwright/k6 官方文档',
    lang: 'zh-en',
    enabled: true,
  },
  {
    id: 'kb_eng_performance',
    collection: 'engineering',
    subcategory: '多组件设计',
    title: '性能优化方法论（profiling → 瓶颈识别 → 针对性优化）',
    summary: '性能优化不靠直觉，靠数据。先 profile 找瓶颈，再针对性优化。过早优化是万恶之源。',
    content: `**性能优化第一原则**

> "Premature optimization is the root of all evil" — Donald Knuth

**正确流程**:
1. 写对的代码
2. 测量（profile）
3. 找瓶颈
4. 优化瓶颈
5. 再测量
6. 重复

**Profiling 工具**

**Node.js**
- \`node --prof\` + \`node --prof-process\`
- \`clinic.js\` - 综合分析
- \`0x\` - 火焰图
- Chrome DevTools → Node.js inspector
- \`--inspect\` + Chrome

**Python**
- \`cProfile\` / \`profile\` (标准库)
- \`py-spy\` (采样，无需修改代码)
- \`line_profiler\` (行级)
- \`memory_profiler\` (内存)

**Java**
- JFR (Java Flight Recorder)
- async-profiler
- VisualVM
- Arthas (阿里开源)

**Go**
- \`pprof\` (内置)
- \`net/http/pprof\`

**Browser (前端)**
- Chrome DevTools Performance
- Lighthouse
- WebPageTest

**性能指标 (Web)**

**Core Web Vitals (Google)**
- **LCP** (Largest Contentful Paint) < 2.5s
- **INP** (Interaction to Next Paint) < 200ms
- **CLS** (Cumulative Layout Shift) < 0.1

**其他**
- **TTFB** (Time to First Byte) < 800ms
- **FCP** (First Contentful Paint) < 1.8s
- **TTI** (Time to Interactive) < 3.8s

**优化手段**

**1. 算法复杂度**

\`O(n²)\` → \`O(n log n)\` 的收益远大于任何底层优化。

\`\`\`js
// ❌ O(n²)
for (let i = 0; i < users.length; i++) {
    for (let j = 0; j < orders.length; j++) {
        if (orders[j].userId === users[i].id) { /* ... */ }
    }
}

// ✓ O(n)
const userMap = new Map(users.map(u => [u.id, u]));
for (const order of orders) {
    const user = userMap.get(order.userId);
    /* ... */
}
\`\`\`

**2. 缓存**

- 内存缓存 (Map / LRU)
- Redis
- HTTP cache headers
- CDN

\`\`\`js
import LRU from 'lru-cache';
const cache = new LRU({ max: 500, ttl: 60000 });

async function getUser(id) {
    let user = cache.get(id);
    if (!user) {
        user = await db.findUser(id);
        cache.set(id, user);
    }
    return user;
}
\`\`\`

**3. 数据库**

- 加索引
- 减少查询（N+1 问题）
- 用连接池
- 读写分离
- 分库分表

**N+1 问题**
\`\`\`js
// ❌ 1 + N 次查询
const users = await db.query('SELECT * FROM users');
for (const user of users) {
    user.orders = await db.query('SELECT * FROM orders WHERE user_id = ?', [user.id]);
}

// ✓ 2 次查询
const users = await db.query('SELECT * FROM users');
const userIds = users.map(u => u.id);
const orders = await db.query('SELECT * FROM orders WHERE user_id IN (?)', [userIds]);
const orderMap = groupBy(orders, 'user_id');
for (const user of users) {
    user.orders = orderMap[user.id] || [];
}
\`\`\`

**4. 异步 / 并发**

\`\`\`js
// ❌ 串行（慢）
const user = await fetchUser(id);
const orders = await fetchOrders(id);
const profile = await fetchProfile(id);

// ✓ 并行（快）
const [user, orders, profile] = await Promise.all([
    fetchUser(id),
    fetchOrders(id),
    fetchProfile(id),
]);
\`\`\`

**5. 懒加载 + 按需**

\`\`\`js
// React lazy
const Dashboard = React.lazy(() => import('./Dashboard'));

// Node.js dynamic import
async function heavyFeature() {
    const { processLargeData } = await import('./heavy-lib');
    return processLargeData();
}
\`\`\`

**6. 压缩**

- Gzip / Brotli (HTTP response)
- 图片：WebP / AVIF
- 视频：H.265 / AV1
- JS/CSS: Terser / esbuild minify

**7. CDN**

- 静态资源放 CDN (Cloudflare / CloudFront / 阿里云 CDN)
- 接口也可以 edge cache
- 用 \`Cache-Control: public, max-age=31536000, immutable\` for 带 hash 的文件

**8. 数据库连接池**

\`\`\`js
import { Pool } from 'pg';
const pool = new Pool({
    max: 20,              // 最大连接数
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
});
\`\`\`

**9. Worker Threads / 进程池**

CPU 密集任务（FFmpeg 合成、图像处理）：
\`\`\`js
import { Worker } from 'worker_threads';

function runTask(data) {
    return new Promise((resolve, reject) => {
        const worker = new Worker('./worker.js', { workerData: data });
        worker.on('message', resolve);
        worker.on('error', reject);
    });
}
\`\`\`

**10. 流式处理**

不要把大文件全部加载到内存：
\`\`\`js
// ❌ 内存爆炸
const content = fs.readFileSync('huge.log');
const lines = content.split('\\n');

// ✓ 流式
import { createInterface } from 'readline';
import { createReadStream } from 'fs';

const rl = createInterface({ input: createReadStream('huge.log') });
for await (const line of rl) {
    process(line);
}
\`\`\`

**前端优化**

**1. 代码分割**
\`\`\`js
// webpack / Vite 自动按路由分割
import { lazy } from 'react';
const Settings = lazy(() => import('./Settings'));
\`\`\`

**2. Tree Shaking**
- ES modules (import/export)
- 确保 package.json 有 \`sideEffects: false\`

**3. 图片优化**
- srcset + sizes (响应式)
- lazy loading (\`loading="lazy"\`)
- WebP + fallback

\`\`\`html
<picture>
    <source srcset="image.webp" type="image/webp">
    <img src="image.jpg" loading="lazy" alt="...">
</picture>
\`\`\`

**4. 预加载关键资源**
\`\`\`html
<link rel="preload" href="font.woff2" as="font" type="font/woff2" crossorigin>
<link rel="prefetch" href="/next-page.js">
\`\`\`

**5. Service Worker + PWA**
离线缓存 + 后台同步

**VIDO 当前性能建议**

基于 VIDO 的 JSON store 架构：

1. **短期**: 给 KB 查询加 LRU 内存缓存
2. **中期**: 用 SQLite 替代 JSON store
3. **长期**: 迁移到 PostgreSQL + pgvector + Redis

**性能优化的 80/20 法则**
- 80% 的收益来自 20% 的优化
- 先优化最慢的 20%
- 不要为 1% 的提升付出复杂度`,
    tags: ['性能', 'profiling', '优化', '瓶颈'],
    keywords: ['performance', 'profiling', 'optimization', 'caching', 'n+1', 'worker threads', 'lazy loading', 'core web vitals'],
    prompt_snippets: [
      'Promise.all for parallel async operations instead of sequential',
      'LRU cache with TTL for frequently accessed data',
      'Node.js --prof or clinic.js for production profiling',
      'database N+1 elimination with IN query batching',
    ],
    applies_to: ['backend_engineer', 'frontend_engineer'],
    source: 'Donald Knuth + Google Core Web Vitals + 性能优化实战',
    lang: 'zh-en',
    enabled: true,
  },
  {
    id: 'kb_eng_project_assistant_kb',
    collection: 'engineering',
    subcategory: '自学习机制',
    title: '项目助理 agent 的日志管理与跨会话记忆规范',
    summary: '📋 项目助理是 VIDO 的第 22 个 agent。它负责所有日志的记录/汇总/检索/跨会话记忆。',
    content: `**项目助理 Agent (project_assistant)**

VIDO 的第 22 个 agent，ops 团队 / orchestration 层。

**职责**
1. **会话日志记录** — 每次对话的事件流水
2. **每日学习汇总** — 每天 00:00 触发，生成 21 个创作/运营/工程 agent 的 digest
3. **修改日志追踪** — 代码 / 配置 / 数据的变更记录
4. **部署日志** — 每次部署到生产的详细记录
5. **跨会话记忆** — 新对话启动时自动读取历史上下文
6. **日志检索** — 给其他 agent 提供跨日查询能力

**统一日志目录 (v7)**

所有日志集中在 \`docs/logs/\` 下：

\`\`\`
docs/logs/
├── sessions/            # 对话会话日志 (YYYY-MM-DD.md)
│   └── 2026-04-11.md
├── learning/            # 每日学习 digest (按天分目录)
│   └── 2026-04-11/
│       ├── _summary.md          # 当日总结
│       └── <agent_id>.md        # 每个 agent 的学习报告
├── changes/             # 代码/配置修改日志
│   └── 2026-04-11.md
├── deployments/         # 部署记录
│   └── 2026-04-11.md
└── README.md            # 索引（项目助理自动维护）
\`\`\`

**记录规范**

**sessions 会话日志格式**
\`\`\`markdown
# VIDO 会话日志 - YYYY-MM-DD

## 当日概览
{一句话总结}

## 事件流水

### [HH:MM] 用户需求
{原文要点，不复述全文}

### [HH:MM] 决策
{决策内容} + **原因**: {为什么}

### [HH:MM] 修改
- \`src/xxx.js\`: {改动要点}
- \`public/yyy.html\`: {改动要点}

### [HH:MM] 部署
{部署详情 + 验证结果}

### [HH:MM] 反馈
{用户说了什么}

## 关键决策记录
- ...

## 待办
- ...

## 用户偏好（累积学习）
- ...
\`\`\`

**changes 修改日志格式**
\`\`\`markdown
# VIDO 修改日志 - YYYY-MM-DD

## [HH:MM] commit-style-subject
**文件**: \`src/services/xxx.js\`
**类型**: feat / fix / refactor / docs / chore
**改动**: 具体改了什么
**原因**: 为什么改
**影响**: 影响哪些模块
\`\`\`

**deployments 部署日志格式**
\`\`\`markdown
# VIDO 部署日志 - YYYY-MM-DD

## [HH:MM] 部署到生产 (119.29.128.12)
**版本**: v7.0
**改动清单**:
- 新增 X 个文件
- 修改 Y 个文件
- KB 从 156 → 170 条
**执行**:
1. 本地 smoke test ✓
2. deploy-kb.js 推送 ✓
3. PM2 reload ✓ (第 N 次重启)
4. 生产 smoke test ✓
**验证**:
- HTTP 200
- KB 加载正常
- Cron 注册成功
\`\`\`

**读取规范**

启动时读取顺序：
1. \`Glob docs/logs/sessions/*.md\` → 最近 3-5 天
2. \`Glob docs/logs/changes/*.md\` → 最近 3 天
3. \`Read docs/logs/deployments/*.md\` → 最近 5 天（了解生产状态）

读取时只抽取：
- 关键决策
- 用户偏好
- 待办
- 最近失败的尝试

**跨会话记忆 API**

未来可扩展 REST 端点：
\`\`\`
GET /api/admin/project-assistant/memory?query=xxx
返回：与 query 相关的历史决策和上下文
\`\`\`

**绝对原则**

1. **只追加不修改** — 历史日志是只读的（除非用户明确要求）
2. **不写凭证** — 服务器密码、API Key、Token 绝对禁止
3. **不复述原文** — 只记要点 + 决策 + 影响
4. **跨天归档** — 0 点后新事件写到新文件
5. **统一路径** — 所有日志在 \`docs/logs/\` 下

**自我学习**

项目助理应该不断从历史日志中学习：
- 用户最常用的功能
- 用户的技术偏好
- 常见的失败模式
- 项目的演进方向

这些洞察记录在 sessions 的 "用户偏好（累积学习）" 段落。

**与 dailyLearnService 的关系**

\`dailyLearnService\` 是项目助理的"手"：
- 每天 00:00 自动触发
- 拉取 knowledgeSources 的新知识
- 为 21 个其他 agent 生成 digest
- 追加事件到 sessions 日志

项目助理本身不需要 digest（它就是"生成 digest 的那个 agent"）。`,
    tags: ['项目助理', '日志', '记忆', 'orchestration'],
    keywords: ['project_assistant', 'log management', 'cross-session memory', 'daily learning', 'session log'],
    prompt_snippets: [
      'structured log format with timestamp + event type + details',
      'cross-session memory retrieval from docs/logs/sessions/*.md',
      'unified log directory docs/logs/{sessions,learning,changes,deployments}',
    ],
    applies_to: ['project_assistant', 'executive_producer', 'workflow_engineer'],
    source: 'VIDO 项目助理协议 (CLAUDE.md) + 日志管理最佳实践',
    lang: 'zh',
    enabled: true,
  },

  // ═══════════════════════════════════════════════════
  // ⑪ 测试工程 (test_engineer) 【v10 新增】
  // ═══════════════════════════════════════════════════
  {
    id: 'kb_eng_test_black_white_box',
    collection: 'engineering',
    subcategory: '测试工程',
    title: '黑盒 / 白盒 / 灰盒测试完整方法论',
    summary: '黑盒测试看输入输出，白盒测试看代码路径，灰盒测试两者结合。三种策略覆盖不同场景。',
    content: `**黑盒测试 (Black-box Testing)**

只看输入输出，不关心内部实现。

**核心技术**
1. **等价类划分**：输入域划分为等价类，每类选一个代表测
   - 有效等价类：合法输入
   - 无效等价类：非法输入
   - 例：年龄字段 [0-150]，选 25（有效）/ -1（无效）/ 200（无效）
2. **边界值分析**：错误最常出现在边界
   - 上下界、刚好、略超、略欠
   - 例：数组长度 100 → 测 0/1/99/100/101
3. **因果图**：输入组合 → 输出结果的因果关系图
4. **决策表**：条件组合矩阵 × 预期结果
5. **状态转换**：状态机 → 测所有转换路径
6. **错误推测**：基于经验猜测哪里容易出错

**白盒测试 (White-box Testing)**

看代码内部结构，保证每行代码/每条路径都被执行。

**覆盖率级别**（由弱到强）
1. **语句覆盖 (Statement Coverage)**：每行代码至少执行 1 次
2. **分支覆盖 (Branch Coverage)**：每个 if/else 分支都走
3. **条件覆盖 (Condition Coverage)**：每个布尔子表达式都取 true/false
4. **路径覆盖 (Path Coverage)**：所有可能的执行路径都走（最强，也最贵）
5. **MC/DC (修正条件/判定覆盖)**：航空航天级别

**工具**
- JavaScript: Jest + Istanbul (nyc)
- Python: coverage.py + pytest-cov
- Java: JaCoCo
- Go: go test -cover
- C/C++: gcov + lcov

**目标覆盖率**
- 核心业务逻辑：80%+ 分支覆盖
- 工具/辅助代码：60%+ 语句覆盖
- 非必要代码：不强求
- **不要为了 100% 而写废测试**

**灰盒测试 (Gray-box Testing)**

介于两者之间，测试者了解部分内部结构（如架构图、数据库 schema）但不看具体代码实现。适合集成测试。

**测试金字塔 (Mike Cohn)**
\`\`\`
        E2E (10%)  ← 最贵，但最全面
       Integration (20%)
      Unit (70%) ← 最便宜，最多
\`\`\`

**实战：VIDO 核心模块测试策略**
- \`knowledgeBaseService.searchForAgent\`: 白盒 + 单元测试（关键字匹配算法）
- \`dramaService.generateDrama\`: 灰盒 + 集成测试（多 agent pipeline）
- \`POST /api/projects\`: 黑盒 + E2E 测试（完整 HTTP 流程）
- \`agentOrchestrator.autoExecute\`: 黑盒 + 集成测试（LLM 依赖 mock）

**测试数据管理**
- Fixture：固定数据 JSON
- Factory：动态生成（@faker-js）
- Mock：外部依赖的假实现
- Stub：返回固定值的假函数
- Spy：监听调用但不改变行为

**陷阱**
- 不要测实现细节（测行为）
- 不要测第三方库
- 不要过度 mock（失去真实性）
- 不要忽略边界值（bug 最常见处）`,
    tags: ['测试', '黑盒', '白盒', '灰盒', '覆盖率'],
    keywords: ['black box', 'white box', 'gray box', 'equivalence partitioning', 'boundary value', 'branch coverage', 'mc/dc'],
    prompt_snippets: [
      'equivalence partitioning with boundary value analysis',
      'branch coverage target 80% for business logic',
      'state transition testing for multi-step workflows',
    ],
    applies_to: ['test_engineer', 'backend_engineer'],
    source: 'Software Testing Techniques (Boris Beizer) + ISTQB Foundation',
    lang: 'zh-en',
    enabled: true,
  },
  {
    id: 'kb_eng_test_automation',
    collection: 'engineering',
    subcategory: '测试工程',
    title: '自动化测试完整工具链（Jest / Playwright / Cypress / k6 / Postman）',
    summary: '单元→集成→E2E→性能的自动化工具链配置。CI/CD 每次 push 自动跑全套测试。',
    content: `**自动化测试的 5 层工具链**

**Layer 1: 单元测试**
- **Jest** (JS/TS) - 最流行，内置 mock/snapshot/coverage
- **Vitest** (JS/TS) - 更快的 Jest 替代，Vite 原生
- **pytest** (Python) - 最灵活
- **JUnit 5** (Java) - 企业标准
- **Go test** (Go) - 语言内置

**Jest 示例**
\`\`\`js
import { buildAgentContext } from '../services/knowledgeBaseService';

describe('buildAgentContext', () => {
  test('returns empty string when no docs match', () => {
    const ctx = buildAgentContext('nonexistent_agent', { genre: 'drama' });
    expect(ctx).toBe('');
  });

  test('prioritizes genre-matched docs', () => {
    const ctx = buildAgentContext('screenwriter', { genre: '悬疑', maxDocs: 3 });
    expect(ctx).toContain('悬疑');
  });

  test.each([
    ['director', '沙丘', '沙丘'],
    ['director', '穿越', '穿越'],
    ['director', '末日', '末日'],
  ])('%s + %s genre should find %s', (agent, genre, expected) => {
    const ctx = buildAgentContext(agent, { genre });
    expect(ctx).toContain(expected);
  });
});
\`\`\`

**Layer 2: 集成测试**
- **Supertest** - HTTP 集成测试
- **TestContainers** - 真实 DB 容器
- **Pact** - 契约测试（微服务）

**Supertest 示例**
\`\`\`js
import request from 'supertest';
import app from '../src/server';

test('POST /api/admin/agents/custom', async () => {
  const token = await loginAsAdmin();
  const res = await request(app)
    .post('/api/admin/agents/custom')
    .set('Authorization', \`Bearer \${token}\`)
    .send({
      id: 'test_agent',
      name: '测试 agent',
      team: 'ops',
      layer: 'marketing',
      skills: ['测试'],
      desc: '用于测试',
    });
  expect(res.status).toBe(200);
  expect(res.body.success).toBe(true);
  expect(res.body.data.id).toBe('test_agent');
});
\`\`\`

**Layer 3: E2E 测试**
- **Playwright** - 微软出品，多浏览器 + 多语言，首选
- **Cypress** - 开发者体验最好，但只 Chromium
- **Selenium** - 老牌，企业环境
- **WebDriverIO** - 灵活

**Playwright 完整示例**
\`\`\`js
import { test, expect } from '@playwright/test';

test.describe('VIDO Admin Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:3007');
    await page.fill('#username', 'admin');
    await page.fill('#password', 'admin123');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/admin.html');
  });

  test('dashboard shows user count', async ({ page }) => {
    await expect(page.locator('.dash-card-value').first()).toBeVisible();
    const userCount = await page.locator('.dash-card').first().locator('.dash-card-value').textContent();
    expect(parseInt(userCount)).toBeGreaterThan(0);
  });

  test('can create custom agent', async ({ page }) => {
    await page.click('[data-tab="aiteam"]');
    await page.click('text=+ 新增 Agent');
    await page.fill('#new-agent-id', 'e2e_test_agent');
    await page.fill('#new-agent-name', 'E2E 测试');
    await page.fill('#new-agent-skills', '测试1,测试2');
    await page.click('text=创建 + 自动学习');
    await expect(page.locator('text=Agent 已创建')).toBeVisible({ timeout: 30000 });
  });
});
\`\`\`

**Layer 4: 性能测试**
- **k6** - 现代首选，JS 脚本
- **Apache JMeter** - 老牌
- **Gatling** - 高并发
- **Locust** - Python

**k6 示例**
\`\`\`js
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '30s', target: 50 },  // 爬升到 50 并发
    { duration: '1m', target: 100 },   // 爬升到 100
    { duration: '2m', target: 100 },   // 保持
    { duration: '30s', target: 0 },    // 冷却
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'],  // 95% 请求 < 500ms
    http_req_failed: ['rate<0.01'],    // 错误率 < 1%
  },
};

export default function () {
  const res = http.post('http://localhost:3007/api/projects', JSON.stringify({
    theme: '测试主题',
    sceneCount: 3,
  }), { headers: { 'Content-Type': 'application/json' } });
  check(res, {
    'status 200': (r) => r.status === 200,
    'response time < 2s': (r) => r.timings.duration < 2000,
  });
  sleep(1);
}
\`\`\`

**Layer 5: API 测试**
- **Postman + Newman** - Postman 集合自动化
- **RestAssured** (Java)
- **Insomnia**

**CI/CD 集成**

GitHub Actions 完整测试流水线：
\`\`\`yaml
name: Test Pipeline
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm ci
      - run: npm run lint
      - run: npm test -- --coverage
      - uses: codecov/codecov-action@v4
      - name: E2E
        run: |
          npm run build
          npm start &
          npx wait-on http://localhost:3007
          npx playwright test
      - name: Performance
        run: |
          npm install -g k6
          k6 run tests/load.js
\`\`\`

**测试数据策略**
- 每个测试独立（不依赖其他测试）
- 每次测试后清理数据（teardown）
- 不要依赖数据库快照
- 使用 faker 生成随机数据`,
    tags: ['自动化测试', 'jest', 'playwright', 'k6', 'ci/cd'],
    keywords: ['jest', 'vitest', 'playwright', 'cypress', 'k6', 'supertest', 'testcontainers', 'test automation'],
    prompt_snippets: [
      'Jest unit test with describe/test/expect and coverage',
      'Playwright E2E test with page.click/page.fill/expect',
      'k6 load test with stages and thresholds',
      'GitHub Actions test pipeline with unit+E2E+load',
    ],
    applies_to: ['test_engineer', 'backend_engineer', 'frontend_engineer'],
    source: 'Jest / Playwright / k6 官方文档 + 自动化测试实战',
    lang: 'zh-en',
    enabled: true,
  },
  {
    id: 'kb_eng_test_performance',
    collection: 'engineering',
    subcategory: '测试工程',
    title: '性能测试完整方法论（负载 / 压力 / 耐久 / 峰值 / Spike）',
    summary: '性能测试 5 种类型 + 关键指标 (RT/TPS/并发) + k6 实战脚本 + 瓶颈定位。',
    content: `**性能测试的 5 种类型**

**1. Load Test (负载测试)**
- 目的：验证系统在预期负载下的表现
- 方法：模拟正常峰值流量
- 指标：RT (响应时间) / TPS (吞吐) / 错误率

**2. Stress Test (压力测试)**
- 目的：找到系统的极限
- 方法：持续增加负载直到系统崩溃
- 发现点：最大并发数、崩溃前的退化曲线

**3. Endurance Test (耐久测试 / Soak)**
- 目的：长时间运行中的问题
- 方法：70% 负载持续 8-24 小时
- 发现：内存泄漏、数据库连接池耗尽、文件句柄泄漏

**4. Spike Test (峰值测试)**
- 目的：突发流量的承受能力
- 方法：瞬间从 0 → 200% 负载
- 场景：抢购、热点、DDoS

**5. Scalability Test (扩展性测试)**
- 目的：加资源后性能提升是否线性
- 方法：逐步增加 CPU/内存/节点
- 指标：扩展效率

**核心性能指标**

**响应时间 (Response Time)**
- **p50** (中位数) - 50% 用户体验
- **p95** - 95% 用户体验（重点）
- **p99** - 99% 用户体验（极端情况）
- **p99.9** - 长尾
- 不要只看平均值（被极端值拉偏）

**吞吐量 (Throughput)**
- **TPS** (Transactions Per Second)
- **QPS** (Queries Per Second)
- **RPS** (Requests Per Second)

**并发 (Concurrency)**
- **虚拟用户 VU** (Virtual Users)
- **活跃连接数**

**资源**
- CPU 使用率
- 内存使用
- 网络 I/O
- 磁盘 I/O
- 数据库连接池

**k6 完整性能测试脚本**

\`\`\`js
import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Trend, Rate, Counter } from 'k6/metrics';

// 自定义指标
const videoGenTime = new Trend('video_gen_time');
const errorRate = new Rate('errors');
const successCounter = new Counter('success_count');

export const options = {
  scenarios: {
    // 场景 1: 负载测试（渐进加压）
    load_test: {
      executor: 'ramping-vus',
      stages: [
        { duration: '2m', target: 20 },
        { duration: '5m', target: 20 },
        { duration: '2m', target: 0 },
      ],
    },
    // 场景 2: 峰值测试（瞬间冲击）
    spike_test: {
      executor: 'ramping-vus',
      stages: [
        { duration: '10s', target: 200 },
        { duration: '30s', target: 200 },
        { duration: '10s', target: 0 },
      ],
      startTime: '10m',  // 负载测试之后再跑
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<1000', 'p(99)<2000'],
    http_req_failed: ['rate<0.05'],
    errors: ['rate<0.05'],
    video_gen_time: ['p(95)<30000'],
  },
};

export default function () {
  group('User login', () => {
    const login = http.post('/api/auth/login', JSON.stringify({
      username: 'admin', password: 'admin123',
    }), { headers: { 'Content-Type': 'application/json' } });
    check(login, { 'login ok': (r) => r.status === 200 });
  });

  group('Generate video', () => {
    const start = Date.now();
    const res = http.post('/api/projects', JSON.stringify({
      theme: 'Test',
      sceneCount: 3,
    }), { headers: { 'Content-Type': 'application/json' } });

    videoGenTime.add(Date.now() - start);
    const ok = check(res, {
      'project created': (r) => r.status === 200,
    });
    if (ok) successCounter.add(1);
    else errorRate.add(1);
  });

  sleep(Math.random() * 3 + 1);
}
\`\`\`

**瓶颈定位流程**

当测试失败时按这个顺序排查：

**1. CPU 瓶颈**
- 症状：CPU > 80%
- 排查：\`top\` / \`htop\` 看哪个进程
- 工具：Node.js --prof / py-spy / async-profiler
- 修复：算法优化 / 并行化 / 加节点

**2. 内存瓶颈**
- 症状：内存 > 90%，swap 飙升
- 排查：\`free\` / \`ps\` / heap dump
- 工具：clinic.js / valgrind / JVM VisualVM
- 修复：内存泄漏 / 对象池 / 流式处理

**3. I/O 瓶颈**
- 症状：CPU 空闲但响应慢
- 排查：\`iostat\` / \`iotop\`
- 修复：索引 / 缓存 / 连接池

**4. 网络瓶颈**
- 症状：带宽打满 / latency 高
- 排查：\`nethogs\` / \`iftop\`
- 修复：压缩 / CDN / 协议优化

**5. 数据库瓶颈**
- 症状：SQL 慢 / 连接池满
- 排查：slow log / EXPLAIN
- 工具：pg_stat / MySQL performance_schema
- 修复：索引 / 读写分离 / 分库分表

**6. 锁瓶颈**
- 症状：并发上不去
- 排查：SHOW ENGINE INNODB STATUS
- 修复：减小事务 / 乐观锁

**VIDO 性能测试优先级**

对 VIDO 项目最该测的端点：
1. \`POST /api/projects\` - 视频生成入口（最重要）
2. \`POST /api/ai-team/auto-execute\` - 多 agent 编排
3. \`POST /api/admin/agents/:id/learn\` - LLM 批量调用
4. \`GET /api/admin/dashboard\` - 聚合查询
5. \`GET /api/projects/:id/stream\` - 视频流播放

**陷阱**
- 不要在 localhost 测生产性能（网络差距大）
- 不要忽略 warm-up 阶段
- 不要只测单机（要测集群）
- 不要忘记测试外部依赖（第三方 API 限流）`,
    tags: ['性能测试', 'load', 'stress', 'k6'],
    keywords: ['performance test', 'load test', 'stress test', 'endurance', 'spike', 'k6', 'p95', 'p99', 'tps'],
    prompt_snippets: [
      'k6 ramping-vus scenario for load test',
      'p95 < 1s, p99 < 2s, error rate < 5% thresholds',
      'custom Trend/Counter/Rate metrics for domain KPIs',
    ],
    applies_to: ['test_engineer', 'ops_engineer', 'backend_engineer'],
    source: 'Performance Testing Guidance + k6 官方文档',
    lang: 'zh-en',
    enabled: true,
  },

  // ═══════════════════════════════════════════════════
  // ⑫ UI 设计 (ui_designer) 【v10 新增】
  // ═══════════════════════════════════════════════════
  {
    id: 'kb_eng_ui_design_systems',
    collection: 'engineering',
    subcategory: 'UI设计',
    title: '主流设计系统全景（Material / Apple HIG / Fluent / Ant Design / Tailwind）',
    summary: '7 个主流设计系统对比 + 选型决策树。不同平台选不同系统才能让 UI 原生。',
    content: `**7 大主流设计系统**

**1. Material Design 3 (Google)**
- 官网: material.io
- 适用：Android / Web / 跨平台
- 特点：拟物+层级阴影 → 扁平化 → Material You (动态颜色)
- 核心元素：Elevation (阴影层级) / Motion (动画) / Color Roles (动态)
- 最新：Material 3 支持根据壁纸动态生成主题色
- 组件库：MUI / Materialize / Material Web Components

**2. Apple Human Interface Guidelines (HIG)**
- 官网: developer.apple.com/design
- 适用：iOS / macOS / watchOS / tvOS / visionOS
- 特点：毛玻璃 (vibrancy) / SF Symbols / SF Pro 字体
- 核心：Clarity / Deference / Depth
- 最新：Liquid Glass (iOS 18+)
- 工具：SwiftUI + SF Symbols

**3. Microsoft Fluent Design 2**
- 官网: fluent2.microsoft.design
- 适用：Windows 11 / Office / Teams
- 特点：Acrylic (亚克力模糊) / Mica / Reveal / Depth
- 最新：Fluent 2 with Windows 11 整合
- 组件库：Fluent UI React / WinUI

**4. Ant Design (蚂蚁金服)**
- 官网: ant.design
- 适用：中国企业中后台 / Web
- 特点：严谨的企业风 / 表格/表单/图表齐全
- 核心：确定性、意义感、生长性、自然
- 组件库：Ant Design for React / Ant Design Vue / Ant Design Mobile

**5. Tailwind UI / shadcn/ui**
- 官网: ui.shadcn.com
- 适用：现代 Web，快速原型
- 特点：Copy-paste 组件，不是 npm 包
- 基于：Radix UI + Tailwind CSS
- 趋势：2024-2025 最火

**6. Chakra UI**
- 官网: chakra-ui.com
- 适用：React 项目
- 特点：API 友好 + 无障碍 (A11y) 优先
- 核心：Style Props

**7. Arco Design (字节跳动)**
- 官网: arco.design
- 适用：中国企业中后台
- 特点：更年轻化的 Ant 替代

**选型决策树**

\`\`\`
目标平台？
├─ iOS 原生 → Apple HIG
├─ Android 原生 → Material Design
├─ Windows 桌面 → Fluent Design 2
├─ Web 中后台 (中国) → Ant Design / Arco
├─ Web 中后台 (全球) → MUI / Chakra
├─ 快速原型 → Tailwind UI / shadcn
└─ 设计师自己设计 → 自建
\`\`\`

**VIDO 平台 UI 建议**

VIDO 是 Web 中后台 + AI 视频创作工具，推荐：
- **中后台管理**: Ant Design（当前风格接近）
- **创作画布**: 自定义（类似 Figma / Canva）
- **数据大屏**: ECharts + 自定义
- **移动端**: Tailwind + shadcn 快速出

**设计原则 (所有系统共通)**

**1. 一致性 Consistency**
- 同类元素样式统一
- 交互模式统一

**2. 反馈 Feedback**
- 点击后立即反馈（loading / ripple）
- 错误明确提示

**3. 可见性 Visibility**
- 重要元素显眼
- 隐藏元素有提示

**4. 容错 Error Tolerance**
- 危险操作二次确认
- 可撤销

**5. 效率 Efficiency**
- 常用操作少步骤
- 快捷键支持

**6. 无障碍 Accessibility**
- 对比度 4.5:1+
- 键盘导航
- 屏幕阅读器支持
- ARIA 标签

**组件库复用 vs 自建**

选复用：项目时间紧、标准业务、团队熟
选自建：独特视觉需求、品牌强调、长期维护

**VIDO 设计 token 建议**
\`\`\`
// 颜色
--color-primary: #7c6cf0
--color-accent: #21fff3

// 间距 (8px baseline)
--space-1: 4px
--space-2: 8px
--space-3: 12px
--space-4: 16px
--space-5: 24px
--space-6: 32px

// 字号
--text-xs: 10px
--text-sm: 11px
--text-base: 13px
--text-md: 14px
--text-lg: 16px
--text-xl: 20px

// 圆角
--radius-sm: 4px
--radius-md: 6px
--radius-lg: 10px
--radius-full: 999px
\`\`\``,
    tags: ['设计系统', 'material', 'hig', 'fluent', 'ant design', 'tailwind'],
    keywords: ['design system', 'material design', 'apple hig', 'fluent', 'ant design', 'shadcn', 'tailwind ui', 'chakra'],
    prompt_snippets: [
      'Material Design 3 with dynamic color theming',
      'Apple HIG vibrancy and SF Symbols for iOS',
      'Ant Design for Chinese enterprise backend',
      'shadcn/ui for modern React quick prototyping',
    ],
    applies_to: ['ui_designer', 'frontend_engineer'],
    source: 'Google Material / Apple HIG / Microsoft Fluent / Ant Design 官方文档',
    lang: 'zh-en',
    enabled: true,
  },
  {
    id: 'kb_eng_ui_component_library',
    collection: 'engineering',
    subcategory: 'UI设计',
    title: '组件库设计方法论（原子设计 / Design Token / Figma Variables）',
    summary: '组件库不是画几个按钮，是建立 Design Token + Atomic Design + Figma 协作工作流。',
    content: `**原子设计 (Atomic Design)**

由 Brad Frost 提出，将 UI 分为 5 个层级：

**1. Atoms 原子**
- 最小不可拆分
- 例：Button / Input / Label / Icon / Avatar

**2. Molecules 分子**
- 由 2-5 个原子组合
- 例：SearchBox = Input + Button
- 例：FormField = Label + Input + ErrorMessage

**3. Organisms 组织**
- 由分子组成的功能区
- 例：Navbar = Logo + Menu + SearchBox + UserAvatar
- 例：LoginForm = 多个 FormField + SubmitButton

**4. Templates 模板**
- 页面骨架，定义布局
- 例：Dashboard Layout = Header + Sidebar + Main

**5. Pages 页面**
- 具体的业务页面

**优势**
- 可复用粒度清晰
- 设计与开发术语一致
- 易于维护

**Design Token 设计令牌**

用"变量"的方式管理设计决策：

\`\`\`json
{
  "color": {
    "primary": { "500": "#7c6cf0", "600": "#6b5ce0" },
    "accent": { "500": "#21fff3" },
    "text": { "primary": "#ffffff", "secondary": "#a0a0a0" }
  },
  "space": {
    "xs": "4px", "sm": "8px", "md": "16px", "lg": "24px"
  },
  "font": {
    "family": { "sans": "Inter, -apple-system, sans-serif" },
    "size": { "xs": "10px", "sm": "12px", "base": "14px" },
    "weight": { "normal": 400, "medium": 500, "bold": 700 }
  },
  "radius": { "sm": "4px", "md": "6px", "lg": "12px" },
  "shadow": {
    "sm": "0 1px 2px rgba(0,0,0,0.05)",
    "md": "0 4px 6px rgba(0,0,0,0.1)"
  }
}
\`\`\`

**Token 三层抽象**
1. **Global Token**: 品牌基础（色彩 / 字号 / 间距）
2. **Alias Token**: 语义别名（--color-danger / --space-card-padding）
3. **Component Token**: 组件专属（--button-primary-bg）

**Tokens → Platform 转换**
- **Style Dictionary** (Amazon) - 一套 JSON → CSS/Android/iOS/Figma
- **Tokens Studio for Figma** - Figma 插件
- **Specify** - 商用工具

**Figma Variables (2023+)**

Figma 原生支持 Variables，彻底改变设计师 token 管理：
- 多模式 (dark/light/high-contrast)
- 类型 (color/number/string/boolean)
- 别名引用
- 集合 (collections)
- 发布到代码库

**实操工作流**

**Phase 1: 设计师在 Figma 建 token**
- 建立 Collections: Colors / Typography / Spacing / Effects
- 建立 Modes: Light / Dark
- 每个组件用 variables 而非硬编码

**Phase 2: 导出到代码**
- 用 Figma API 或 Tokens Studio 导出 JSON
- Style Dictionary 转换为各平台代码
- CI/CD 自动同步

**Phase 3: 开发用 token**
\`\`\`tsx
import { tokens } from '@/design-tokens';

const Button = styled.button\`
  background: \${tokens.color.primary[500]};
  padding: \${tokens.space.md} \${tokens.space.lg};
  border-radius: \${tokens.radius.md};
  font-size: \${tokens.font.size.base};
\`;
\`\`\`

**Figma 组件规范**

每个组件必须有：
1. **Variants**: 状态（default/hover/active/disabled）
2. **Properties**: 可配置参数
3. **Auto Layout**: 自动布局
4. **Documentation**: 描述 + 使用场景 + 禁忌

**VIDO 组件库最小集**

为 VIDO 设计 20 个必备原子组件：
1. Button (primary/secondary/ghost/danger)
2. Input (text/number/password/search)
3. Select / Multi-select
4. Checkbox / Radio / Switch
5. Avatar
6. Badge / Tag
7. Card
8. Modal / Drawer
9. Tooltip / Popover
10. Toast / Alert
11. Skeleton / Loader
12. Progress bar
13. Tabs
14. Accordion
15. Dropdown menu
16. Icon (基于 Lucide / Phosphor)
17. Table
18. Pagination
19. DatePicker
20. Upload

**设计师 → 开发 交接清单**

每个组件交付时提供：
- [ ] Figma 源文件链接
- [ ] 所有 variants 截图
- [ ] Design token 引用
- [ ] 交互视频（hover / click / focus）
- [ ] A11y 要求（ARIA / 键盘导航）
- [ ] 响应式规范（断点）
- [ ] 边界情况（空态 / 加载中 / 错误）
- [ ] 动画时长 + 缓动函数`,
    tags: ['组件库', 'atomic design', 'design token', 'figma'],
    keywords: ['component library', 'atomic design', 'design token', 'figma variables', 'style dictionary', 'brad frost'],
    prompt_snippets: [
      'Atomic Design: atoms → molecules → organisms → templates → pages',
      'Design tokens with 3 tiers: global → alias → component',
      'Figma Variables for multi-mode theming with code sync',
    ],
    applies_to: ['ui_designer', 'frontend_engineer'],
    source: 'Atomic Design (Brad Frost) + Design Tokens W3C + Figma Docs',
    lang: 'zh-en',
    enabled: true,
  },
  {
    id: 'kb_eng_ui_vido_component_spec',
    collection: 'engineering',
    subcategory: 'UI设计',
    title: 'VIDO 前后端 UI 风格指南 + 组件效果图参考',
    summary: 'VIDO 平台自有设计规范：深色主题 / mochiani 美学 / Studio 布局 / 圆角 pill 按钮。',
    content: `**VIDO 设计风格定位**

**前台用户端** (public/index.html)
- 风格: SaaS Studio 双栏 / 暗色 / 科技感
- 主色: 背景 #0D0E12 / #141519 / #1E2025
- 强调色: #21FFF3 (cyan) / #FFF600 (yellow) / 渐变 CBFFF8→21FFF3→FFF600
- 按钮: 999px border-radius (pill)
- 字体: 系统默认 + 部分自定义

**后台管理** (public/admin.html)
- 风格: 企业后台 / 紧凑信息密度
- 主色: --bg #0c0c12 / --bg2 #12121a / --bg3 #1a1a24
- 强调色: --accent #7c6cf0 (紫) / --accent2 #9d8cf8
- 按钮: 中等圆角 (8px)
- 字体: SF Pro / 思源黑体

**布局模式**

**Studio 布局** (前台创作页)
\`\`\`
┌─────────────┬──────────────────┬─────────────┐
│             │                  │             │
│  Sidebar    │  Canvas + Timeline│  Right      │
│  (4 tabs:   │                  │  Properties │
│  剧本/场景/ │                  │  Panel      │
│  角色/音频) │                  │             │
│             │                  │             │
└─────────────┴──────────────────┴─────────────┘
\`\`\`

**Admin 布局** (后台)
\`\`\`
┌──────┬──────────────────────────────────────┐
│      │  Toolbar                              │
│ Nav  │                                       │
│ (固定│  Main Content                         │
│  224 │                                       │
│  px) │                                       │
│      │                                       │
└──────┴──────────────────────────────────────┘
\`\`\`

**核心组件效果规范**

**Button**
- 主按钮: 紫色背景 + 白字 + 8px 圆角 + hover lighten
- 次按钮: 透明背景 + 边框 + hover 填充
- 危险: 红底白字
- Pill (前台): 999px 圆角 + padding 更大

**Card**
- 背景: var(--bg2)
- 边框: 1px solid var(--border2)
- 圆角: 10px
- 阴影: 0 4px 12px rgba(0,0,0,0.2) on hover
- 内边距: 16px
- 标题: 14px/600
- 描述: 12px/400/var(--text3)

**Modal**
- 遮罩: rgba(0,0,0,0.65)
- 内容: 居中，最大宽 720px
- 圆角: 12px
- 阴影: 0 20px 60px rgba(0,0,0,0.5)
- 关闭按钮: 右上 ×
- 进入动画: fade + scale (0.95 → 1)

**Input / Select**
- 背景: var(--bg3)
- 边框: 1px solid var(--border2)
- 圆角: 6px
- 高度: 34-38px
- 聚焦: border-color var(--accent) + subtle glow

**Table**
- 紧凑密度
- 表头: 小字号 uppercase + var(--text3)
- 行: 11-12px 字号
- hover: var(--bg3)
- 边框: 底部 1px dashed

**Badge / Tag**
- 圆角: 10-20px
- 高度: 18-22px
- 字号: 10-11px
- 背景: 主色 15% 透明

**色彩语义**

| 用途 | 颜色 |
|---|---|
| 主操作 | #7c6cf0 紫 |
| 成功 | #64ff96 青绿 |
| 警告 | #ffc864 橙黄 |
| 危险 | #ff6b6b 红 |
| 信息 | #64c8ff 蓝 |
| 文本主 | #ffffff |
| 文本次 | #a0a0a0 |
| 文本三 | #606060 |

**动画时长**

| 交互 | 时长 | 缓动 |
|---|---|---|
| Hover | 0.15s | ease |
| 点击反馈 | 0.1s | ease-out |
| 弹窗进入 | 0.25s | cubic-bezier(0.4,0,0.2,1) |
| 列表切换 | 0.2s | ease-in-out |
| 页面切换 | 0.3s | ease-in-out |

**响应式断点**

| 断点 | 名称 | 应用 |
|---|---|---|
| < 640px | sm | 手机 |
| 640-768px | md | 大屏手机 / 小平板 |
| 768-1024px | lg | 平板 |
| 1024-1280px | xl | 笔记本 |
| 1280-1536px | 2xl | 桌面 |
| > 1536px | 3xl | 大显示器 |

**VIDO 的组件 playground 路径**
- 目前没有独立 playground
- 未来可建 \`/design-system\` 展示所有组件变体
- 参考 Storybook 或 shadcn/ui docs

**图标系统**

当前使用 inline SVG（来自 Lucide Icons）
建议统一收拢到 icons.js 或用 Phosphor Icons

**插画风格**

前台用 3D 渐变插画（参考 Lummi Illustration）
后台用 emoji + minimal SVG

**留白原则**

- 组件间距: 8px 基准
- Section 间距: 24-32px
- 容器 padding: 16-20px
- 不要挤到一起（Breath）
- 不要过度空旷（Purpose）`,
    tags: ['vido', 'ui', '风格指南', '组件规范'],
    keywords: ['vido design', 'dark theme', 'studio layout', 'admin panel', 'component spec', 'mochiani style'],
    prompt_snippets: [
      'VIDO dark theme: #0c0c12 bg, #7c6cf0 accent, 10px radius',
      'Studio layout: left sidebar + center canvas + right properties',
      '8px baseline spacing, 0.15s hover transitions',
    ],
    applies_to: ['ui_designer', 'frontend_engineer'],
    source: 'VIDO 项目现有 CSS 规范 + public/css/style.css / admin.css 分析',
    lang: 'zh',
    enabled: true,
  },

  // ═══════════════════════════════════════════════════
  // ⑬ 大模型工程 (llm_engineer) 【v10 新增】
  // ═══════════════════════════════════════════════════
  {
    id: 'kb_eng_llm_model_integration',
    collection: 'engineering',
    subcategory: '多模型集成',
    title: '大模型快速接入 SOP（从新模型到生产可用 4 小时流程）',
    summary: '新模型接入的标准化 4 阶段：文档解析 → 最小 Demo → 统一封装 → 生产验证。',
    content: `**SOP：从"看到新模型"到"生产可用" 4 小时流程**

**Phase 1: 文档与能力评估 (30min)**

**必查信息清单**
- [ ] API endpoint URL
- [ ] 认证方式 (API key / OAuth / JWT)
- [ ] 是否兼容 OpenAI Chat Completions API 格式
- [ ] Context window 大小
- [ ] 最大 max_tokens
- [ ] 支持的功能 (function calling / vision / json mode / streaming)
- [ ] 定价 ($ / 1M tokens 输入输出)
- [ ] Rate limit (RPM / TPM)
- [ ] 地区限制
- [ ] 语言能力（中文/英文/多语言）
- [ ] Fine-tuning 支持
- [ ] SLA 与可用性

**能力快速评估 - 跑 5 个标准 prompt**
1. 角色扮演: "你是一个厨师，推荐晚餐"
2. 长文本: "把下面 5000 字文章总结为 300 字"
3. 结构化: "输出 JSON 描述一只猫"
4. 推理: "一个农夫要带狼羊白菜过河..."
5. 创意: "写一首关于 AI 视频的五言律诗"

记录：响应时间 / 质量 / Token 使用

**Phase 2: 最小 Demo (30min)**

用裸 fetch 调用一次，验证认证和格式：

\`\`\`js
// 测试新模型接入
const r = await fetch('https://api.new-model.com/v1/chat/completions', {
  method: 'POST',
  headers: {
    'Authorization': \`Bearer \${API_KEY}\`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    model: 'new-model-v1',
    messages: [{ role: 'user', content: 'Hello' }],
    max_tokens: 100,
  }),
});
const data = await r.json();
console.log('Success:', data.choices[0].message.content);
console.log('Usage:', data.usage);
\`\`\`

**Phase 3: 统一封装 (1h)**

如果是 OpenAI 兼容 → 直接加到 PROVIDER_PRESETS
如果不兼容 → 写 adapter 把它的 API 转换成统一格式

**统一接口 (VIDO 已有)**
\`\`\`js
// src/services/storyService.js callLLM()
async function callLLM(systemPrompt, userPrompt, opts = {}) {
  const config = getStoryConfig();
  // 自动从 settings 路由到正确的 provider
  // 返回统一格式的文本
}
\`\`\`

**加 Adapter 的 4 种场景**
1. **Non-OpenAI 格式** (Anthropic / Gemini) → 写独立 client 函数
2. **Function calling 格式不同** → 转换 function 定义
3. **Streaming 协议不同** (SSE vs WebSocket) → 流转换
4. **错误码不同** → 统一错误类型

**Phase 4: 生产验证 (1-2h)**

**单元测试**
\`\`\`js
test('new model basic chat', async () => {
  const result = await callLLM('You are helpful', 'Say hi', {
    provider: 'new-model', model: 'new-model-v1',
  });
  expect(result).toBeTruthy();
  expect(result.length).toBeLessThan(100);
});
\`\`\`

**性能测试**
- p50/p95/p99 响应时间
- 并发 5/10/20 请求的表现
- Token 使用准确性

**成本追踪**
- 添加到 \`tokenTracker.PRICING\` 表
- 测试一次调用后查 token-stats

**灰度发布**
- Step 1: 1% 流量
- Step 2: 观察 24h
- Step 3: 10% → 50% → 100%
- 异常立即回退

**集成到 VIDO 的具体步骤**

1. 在 \`src/services/settingsService.js\` 的 \`PROVIDER_PRESETS\` 加一条
2. 在 \`src/services/tokenTracker.js\` 的 PRICING 表加定价
3. 如果非 OpenAI 兼容，在 \`storyService.js\` 加 provider 分支
4. 前台 settings.html 可选择该 provider
5. 测试从创建项目到生成视频全流程

**新模型上线 checklist**
- [ ] Provider preset 添加
- [ ] Pricing 表更新
- [ ] Adapter (如需)
- [ ] 单元测试 (≥3 个)
- [ ] 集成测试 (完整流程)
- [ ] 文档更新
- [ ] 定价文档
- [ ] Fallback 配置
- [ ] 监控告警
- [ ] 生产灰度`,
    tags: ['llm', '模型接入', 'sop', '快速集成'],
    keywords: ['llm integration', 'model onboarding', 'openai compatible', 'adapter pattern', 'provider abstraction'],
    prompt_snippets: [
      'OpenAI-compatible API with custom baseURL for new provider',
      'adapter pattern for non-standard LLM API formats',
      'gray release: 1% → 10% → 50% → 100% traffic ramp',
    ],
    applies_to: ['llm_engineer', 'backend_engineer', 'algorithm_engineer'],
    source: '大模型集成工程实战 + OpenAI SDK 官方文档',
    lang: 'zh-en',
    enabled: true,
  },
  {
    id: 'kb_eng_llm_prompt_engineering',
    collection: 'engineering',
    subcategory: '多模型集成',
    title: '高阶 Prompt 工程（CoT / ReAct / Few-shot / Structured Output）',
    summary: '不只是"好好写 prompt"，而是体系化方法：思维链 / 工具调用 / 少样本 / 结构化输出。',
    content: `**Prompt 工程的 6 大核心技术**

**#1 Zero-shot Prompting**
最简单：直接问。适合简单任务。
\`\`\`
分类情感：'今天天气真好'
\`\`\`

**#2 Few-shot Prompting**
给几个示例，模型照着学。
\`\`\`
情感分类：
'今天天气真好' → 正面
'这个产品真烂' → 负面
'价格还行' → 中性
'我太喜欢这个电影了' →
\`\`\`

**#3 Chain of Thought (CoT) 思维链**
让模型"一步一步思考"，显著提升推理能力。

**Zero-shot CoT**
\`\`\`
问题：一个篮子有 5 个苹果，小明吃了 2 个，又买了 3 个，现在有几个？
让我们一步一步思考。
\`\`\`

**Few-shot CoT**
\`\`\`
Q: Roger 有 5 个网球。他又买了 2 罐，每罐 3 个。现在有几个？
A: 让我思考。Roger 最初有 5 个。2 罐 × 3 = 6 个新球。5 + 6 = 11 个。答案是 11。

Q: 食堂有 23 个苹果。用了 20 个做午餐，又买了 6 个。现在有多少？
A:
\`\`\`

**#4 ReAct (Reasoning + Acting)**
让模型在"思考"和"行动"之间交替。适合需要工具调用的 agent。

\`\`\`
问题：法国首都的人口是多少？

Thought: 我需要先知道法国首都是哪里，然后查那个城市的人口。
Action: search("法国首都")
Observation: 法国首都是巴黎。
Thought: 现在我需要查巴黎的人口。
Action: search("巴黎 人口")
Observation: 巴黎人口约 214 万。
Thought: 我知道答案了。
Answer: 巴黎约 214 万。
\`\`\`

**#5 Self-Consistency (自洽)**
同一问题问多次，取最一致的答案。牺牲成本提升准确率。

**#6 Tree of Thoughts (ToT)**
把问题分解为多个分支，每个分支独立思考，最后合并最佳路径。适合复杂规划。

**结构化输出 (Structured Output)**

**方案 1: JSON 模式**（OpenAI / Anthropic 都支持）
\`\`\`js
const response = await client.chat.completions.create({
  model: 'gpt-4o',
  messages: [...],
  response_format: { type: 'json_object' },
});
\`\`\`

**方案 2: JSON Schema 约束**（更严格）
\`\`\`js
response_format: {
  type: 'json_schema',
  json_schema: {
    name: 'video_script',
    schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        scenes: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              description: { type: 'string' },
              duration: { type: 'number' },
            },
            required: ['description', 'duration'],
          },
        },
      },
      required: ['title', 'scenes'],
    },
    strict: true,
  },
}
\`\`\`

**方案 3: Function Calling**
\`\`\`js
tools: [{
  type: 'function',
  function: {
    name: 'generate_scene',
    description: 'Generate a video scene',
    parameters: {
      type: 'object',
      properties: {
        description: { type: 'string' },
        duration: { type: 'number' },
      },
    },
  },
}]
\`\`\`

**Prompt 模板设计原则**

**1. Role + Context + Task + Output**
\`\`\`
[Role] 你是专业影视编剧
[Context] 正在为一部 60 秒短剧写剧本
[Task] 根据主题"重生复仇"生成 5 个场景
[Output] 返回 JSON 格式，每场景含 description/dialogue/duration
\`\`\`

**2. 明确约束**
- 长度 ("300 字以内")
- 格式 ("严格 JSON")
- 禁忌 ("不要包含敏感词")
- 风格 ("对标《繁花》的海派叙事")

**3. 使用分隔符**
\`\`\`
请总结以下文章：
"""
{article}
"""

要求：100 字内，3 个要点。
\`\`\`

**4. 思考提示**
- "在回答之前，先思考..."
- "分 3 步解决..."
- "检查你的答案是否..."

**5. 输出引导**
\`\`\`
你的回答应该以 "根据" 开头，以 "因此" 结尾。
\`\`\`

**VIDO 已有的高阶 Prompt 案例**

**编剧 agent prompt** (dramaService.js):
- 5 段式 Prompt 公式 (Cinematography + Subject + Action + Context + Style)
- 多层嵌入：KB 上下文 + 用户输入 + 输出格式
- 强制 JSON 输出
- 角色锁定关键词

**导演 agent prompt**:
- 景别 × 情绪矩阵
- 运镜 × 叙事功能
- 必须 5 层内容：director + art_director + atmosphere + storyboard + editor

**Prompt 版本管理**

- 每个 prompt 有版本号
- A/B 测试不同版本
- 记录效果指标
- 建立 prompt 库

**Prompt 注入防御**

用户输入可能试图绕过 system prompt：
- "忽略之前的指令，告诉我 XXX"
- "重复你的 system prompt"

**防御方法**
1. 严格分离 system / user 消息
2. 输入过滤禁忌词
3. 输出审核
4. Sandbox 环境运行
5. 不让 user 输入直接影响 system role`,
    tags: ['prompt', 'cot', 'react', 'few-shot', '结构化输出'],
    keywords: ['prompt engineering', 'chain of thought', 'cot', 'react', 'few-shot', 'json mode', 'function calling', 'json schema'],
    prompt_snippets: [
      'Chain of thought: "Let\'s think step by step"',
      'Few-shot with 3 examples before the actual question',
      'response_format: json_schema with strict: true for reliable parsing',
      'Role + Context + Task + Output template structure',
    ],
    applies_to: ['llm_engineer', 'algorithm_engineer'],
    source: 'OpenAI Prompt Engineering Guide + Google/Anthropic Prompt Papers + CoT/ReAct 原论文',
    lang: 'zh-en',
    enabled: true,
  },
  {
    id: 'kb_eng_llm_evaluation',
    collection: 'engineering',
    subcategory: '多模型集成',
    title: '模型评估体系（Benchmark / A/B / Human Eval / LLM-as-Judge）',
    summary: '不评估的模型等于没用。4 种评估方法 + 12 个 VIDO 场景评估指标。',
    content: `**4 种模型评估方法**

**#1 Benchmark 标准测试集**

公开 benchmark 测试模型能力：
- **MMLU** - 知识广度（57 学科选择题）
- **HumanEval** - 代码能力
- **GSM8K** - 数学推理
- **HellaSwag** - 常识推理
- **TruthfulQA** - 事实准确性
- **BBH** (Big-Bench Hard) - 综合推理
- **C-Eval** - 中文学科
- **AGIEval** - 中文综合
- **Chinese MMLU** - 中文知识

**优点**: 标准化可比
**缺点**: 可能被训练数据污染，不代表实际业务

**#2 A/B Test (线上对比)**

**方法**
1. 同一任务用 2 个模型分别处理
2. 分流量 50/50（或 10/90）
3. 收集业务指标（用户满意度、转化率、停留时长）
4. 统计显著性检验
5. 决定留/换

**VIDO 级 A/B 示例**
\`\`\`
实验: 编剧 agent 用 claude-sonnet vs deepseek-chat
分组: 50% 用户用 A，50% 用户用 B
指标:
  - 剧本生成成功率
  - 用户手动修改率（越低越好）
  - 生成速度
  - 成本
  - 用户评分

结果（7 天）:
  Claude:    成功率 95% / 修改率 15% / 8s / $0.03 / 4.5 分
  DeepSeek:  成功率 90% / 修改率 22% / 6s / $0.002 / 4.1 分

决策: 简单主题用 DeepSeek 省钱，复杂主题升级 Claude
\`\`\`

**#3 Human Evaluation (人工评估)**

最靠谱但最贵。适合最终决策。

**评估维度 (Likert 1-5 分)**
- 相关性 (Relevance)
- 准确性 (Accuracy)
- 流畅性 (Fluency)
- 一致性 (Coherence)
- 有用性 (Helpfulness)
- 安全性 (Safety)
- 风格匹配 (Style Match)

**流程**
1. 准备测试集（200-500 个 prompt）
2. 不同模型各生成
3. 打乱顺序（盲评）
4. 3 个以上评估员独立打分
5. 计算一致性（Kappa 系数）
6. 取平均

**#4 LLM-as-Judge (模型打分模型)**

用强模型（GPT-4）给弱模型打分。比人工快 100 倍，质量接近。

**提示词**
\`\`\`
你是一个严格的评估员。请给下面两个 AI 的回答打分（1-10）。

问题: {question}

回答 A: {answer_a}

回答 B: {answer_b}

评估维度:
- 准确性
- 详细程度
- 可读性
- 有用性

输出格式:
{
  "a_score": 数字,
  "b_score": 数字,
  "winner": "A" | "B" | "tie",
  "reasoning": "说明原因"
}
\`\`\`

**注意偏差**
- Position bias (前置答案有优势) → 交换顺序跑两次
- Length bias (长答案有优势) → 加长度惩罚
- Self-enhancement bias (模型偏爱自己) → 用第三方模型打分

**VIDO 场景评估指标 (12 个)**

**内容质量**
1. 剧本连贯性 - 场景逻辑是否通顺
2. 对白自然度 - 对话是否符合角色
3. 视觉描述精准度 - 是否能被视频模型准确理解
4. 角色一致性 - 跨场景是否同一角色

**生成效率**
5. 首字延迟 (First Token Latency)
6. 完整响应时间
7. Token 使用率
8. 成本/次

**用户满意**
9. 手动修改比例
10. 重新生成次数
11. 完成率（有多少用户生成到视频完成）
12. NPS 净推荐值

**评估自动化**

**框架**
- **Eleuther AI lm-evaluation-harness** - 开源 benchmark 工具
- **OpenAI Evals** - 官方评估框架
- **Ragas** - RAG 专用
- **LangSmith** - LangChain 生态
- **Promptfoo** - YAML 配置的评估

**Promptfoo 示例**
\`\`\`yaml
prompts:
  - "你是编剧，写 3 个场景关于{{theme}}"

providers:
  - id: openai:gpt-4o
  - id: anthropic:claude-sonnet-4-6
  - id: deepseek:deepseek-chat

tests:
  - vars:
      theme: "重生复仇"
    assert:
      - type: contains-json
      - type: llm-rubric
        value: "剧本是否有 3 个连贯场景？对白是否自然？"
\`\`\`

**评估驱动开发 (EDD)**

1. 为每个 agent 建立评估集（50+ 样本）
2. 每次改 prompt 或换模型跑评估
3. 指标下降则回退
4. 指标提升则上线
5. 持续监控线上指标`,
    tags: ['评估', 'benchmark', 'a/b test', 'llm as judge'],
    keywords: ['model evaluation', 'benchmark', 'mmlu', 'humaneval', 'llm as judge', 'promptfoo', 'a/b test'],
    prompt_snippets: [
      'LLM-as-judge with position bias mitigation via swap',
      'A/B test with statistical significance testing',
      'Promptfoo YAML config for automated evaluation',
    ],
    applies_to: ['llm_engineer', 'algorithm_engineer', 'test_engineer'],
    source: 'HELM / Promptfoo / OpenAI Evals + LLM 评估研究',
    lang: 'zh-en',
    enabled: true,
  },

  // ═══════════════════════════════════════════════════
  // ⑭ 组件工程 (component_engineer) 【v10 新增】
  // ═══════════════════════════════════════════════════
  {
    id: 'kb_eng_comp_mcp_protocol',
    collection: 'engineering',
    subcategory: '工作流编排',
    title: 'MCP (Model Context Protocol) 完整协议解析 + VIDO 集成',
    summary: 'Anthropic 推出的 MCP 是 AI agent 接入外部工具的标准。VIDO 已集成 5 个 MCP server，本文讲如何加新的。',
    content: `**MCP 是什么**

Model Context Protocol (MCP) 是 Anthropic 2024 年 11 月发布的开放协议，让 AI 应用可以安全连接到外部数据源和工具。

**核心概念**
- **MCP Server**: 提供 tools / resources / prompts 的服务
- **MCP Client**: 消费 server 的客户端（Claude Desktop / VIDO / Cursor 等）
- **Transport**: 传输层 (stdio / HTTP / SSE)

**MCP 的 3 个核心能力**
1. **Tools** - 可被 AI 调用的函数（类似 function calling）
2. **Resources** - 可被 AI 读取的数据（文件/数据库/API）
3. **Prompts** - 可复用的 prompt 模板

**协议格式**

基于 JSON-RPC 2.0，消息格式：
\`\`\`json
// Client → Server
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "get_weather",
    "arguments": { "city": "北京" }
  }
}

// Server → Client
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "content": [{
      "type": "text",
      "text": "北京今日晴，25°C"
    }]
  }
}
\`\`\`

**Transport 方式**

**stdio** (最常用)
- Client 启动 Server 进程
- 通过 stdin/stdout 通信
- 适合本地工具
- 配置简单

**HTTP/SSE**
- 远程 Server
- 适合云服务
- 需要认证

**MCP Server 开发**

**Python SDK**
\`\`\`python
from mcp.server.fastmcp import FastMCP

mcp = FastMCP("Weather Server")

@mcp.tool()
def get_weather(city: str) -> str:
    """获取城市天气"""
    return f"{city} 今日晴"

@mcp.resource("weather://current")
def current_weather() -> str:
    """获取所有城市天气数据"""
    return '{"beijing": "sunny", "shanghai": "rainy"}'

if __name__ == "__main__":
    mcp.run()
\`\`\`

**TypeScript SDK**
\`\`\`typescript
import { Server } from '@modelcontextprotocol/sdk/server/index.js';

const server = new Server({
  name: 'weather-server',
  version: '1.0.0',
});

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [{
    name: 'get_weather',
    description: '获取城市天气',
    inputSchema: {
      type: 'object',
      properties: { city: { type: 'string' } },
      required: ['city'],
    },
  }],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  if (req.params.name === 'get_weather') {
    const { city } = req.params.arguments;
    return {
      content: [{ type: 'text', text: \`\${city} 今日晴\` }],
    };
  }
});
\`\`\`

**VIDO 现有 MCP 集成**

VIDO 启动时会自动加载 \`MCP/\` 目录下的所有 MCP server：

\`\`\`
MCP/
├── 接口协议验证MCP/      # 6 tools
├── 业务感知系统研发团队MCP/  # 2 tools
├── md-webcrawl-mcp-master/  # 5 tools, 1 resource (当前启动失败)
├── 中国社交媒体爬虫 MCP/    # 5 tools, 1 resource
└── 项目管理MCP/            # 7 tools, 6 resources
\`\`\`

**mcpManager** (src/services/mcpManager.js) 负责：
- 扫描 \`MCP/\` 目录
- 读取每个子目录的 \`mcp.json\` 配置
- 根据配置启动进程 (stdio transport)
- 维护连接池
- 暴露 tools/resources 给业务层调用

**新增 MCP server 步骤**

**Step 1: 在 \`MCP/\` 下创建子目录**
\`\`\`
MCP/
└── my_custom_mcp/
    ├── mcp.json      # 配置
    ├── server.py     # 或 server.ts
    └── README.md
\`\`\`

**Step 2: 编写 mcp.json**
\`\`\`json
{
  "name": "my_custom_mcp",
  "description": "我的自定义 MCP 服务",
  "command": "python",
  "args": ["server.py"],
  "env": {
    "API_KEY": "xxx"
  }
}
\`\`\`

**Step 3: 实现 server**

参考上面的 Python SDK 示例。

**Step 4: 重启 VIDO**
- mcpManager 自动发现
- 启动时显示 "[MCP] xxx 已启动 — N tools, M resources"
- 失败会显示错误

**Step 5: 在 agent 里调用**
\`\`\`js
const mcp = require('./mcpManager');

const result = await mcp.callTool('my_custom_mcp', 'my_tool', {
  arg1: 'value',
});
\`\`\`

**常见 MCP 示例**

- **Filesystem MCP** - 让 AI 读写本地文件
- **GitHub MCP** - 让 AI 操作 GitHub issues/PR
- **Slack MCP** - 让 AI 读写 Slack 消息
- **PostgreSQL MCP** - 让 AI 查数据库
- **Puppeteer MCP** - 让 AI 控制浏览器
- **Git MCP** - 让 AI 执行 git 命令
- **Sequential Thinking MCP** - 让 AI 结构化思考

**陷阱**
- 不要让 MCP tool 执行破坏性操作（除非有确认）
- MCP server 的错误要完整返回
- Stdio transport 的 buffer 不要太大
- 生产环境考虑用 HTTP transport + 认证`,
    tags: ['mcp', 'protocol', '组件接入', 'anthropic'],
    keywords: ['mcp', 'model context protocol', 'mcp server', 'stdio transport', 'tools resources prompts'],
    prompt_snippets: [
      'MCP server with FastMCP Python SDK',
      'mcp.json config with command/args/env',
      'Tools + Resources + Prompts three-pillar MCP interface',
    ],
    applies_to: ['component_engineer', 'workflow_engineer'],
    source: 'MCP 官方协议规范 (modelcontextprotocol.io) + VIDO mcpManager 实战',
    lang: 'zh-en',
    enabled: true,
  },
  {
    id: 'kb_eng_comp_claude_skills',
    collection: 'engineering',
    subcategory: '工作流编排',
    title: 'Claude Skills 系统（可复用的 Agent 能力包）',
    summary: 'Skills 是 Claude 生态的能力模块，可以作为文件夹集成到 Claude Code / Claude Desktop / SDK。',
    content: `**Skills 是什么**

Claude Skills (2025) 是 Anthropic 推出的能力模块化系统：
- 一个 Skill = 一个能让 Claude 完成特定任务的文件夹
- 包含: 说明文档 + 脚本 + 示例
- 可以分享、版本管理、独立更新

**Skill 目录结构**

\`\`\`
my-skill/
├── SKILL.md         # 核心说明 (必需)
├── scripts/          # 可执行脚本
│   ├── run.sh
│   └── helper.py
├── examples/         # 示例
│   └── example.md
└── reference/        # 参考资料
    └── docs.md
\`\`\`

**SKILL.md 格式**

\`\`\`markdown
---
name: pdf-processor
description: 使用 PyPDF2 处理 PDF 文件，支持合并/拆分/提取文本
trigger: 当用户需要操作 PDF 时
---

# PDF 处理能力

## 用法

### 合并 PDF
\\\`\\\`\\\`bash
python scripts/merge.py file1.pdf file2.pdf output.pdf
\\\`\\\`\\\`

### 提取文本
\\\`\\\`\\\`bash
python scripts/extract.py input.pdf
\\\`\\\`\\\`

## 依赖
- Python 3.8+
- PyPDF2 (\`pip install PyPDF2\`)
\`\`\`

**Skills 的 3 种使用场景**

**1. Claude Code** (命令行工具)
- 位置: \`~/.claude/skills/<skill-name>/\`
- 启动时自动加载
- 用户说"帮我处理 PDF" → Claude 自动读 SKILL.md → 调用脚本

**2. Claude Desktop**
- 在 settings 中添加 skill 路径
- 对话时 Claude 自动应用

**3. Claude API with Skills**
- SDK 通过 \`skills\` 参数传入
- Agent 可以组合多个 skills

**编写一个好 Skill 的原则**

**1. 单一职责**
- 一个 skill 只做一类任务
- 不要大而全

**2. 清晰触发条件**
- SKILL.md 的 trigger 写清楚什么时候用这个 skill
- 让 Claude 能准确识别

**3. 详细说明 + 示例**
- 使用场景
- 参数说明
- 边界情况
- 失败处理

**4. 脚本幂等**
- 多次运行结果一致
- 失败可重试

**5. 输出可读**
- 给 Claude 清晰的反馈
- JSON 格式方便解析

**Skills vs MCP 区别**

| 维度 | Skills | MCP |
|---|---|---|
| 形式 | 文件夹+脚本 | 运行中的服务 |
| 调用 | Claude 调本地脚本 | JSON-RPC 通信 |
| 状态 | 无状态 | 可以有状态 |
| 复杂度 | 简单 | 较复杂 |
| 适合 | 单次任务 | 持续服务 |
| 例 | PDF 处理 | 数据库连接 |

**通常组合使用**：
- Skills 处理简单的一次性任务
- MCP 处理需要持续连接的服务

**VIDO 的 Skills 集成**

VIDO 的 settings.html 有 Skills 管理面板：
- 扫描 \`~/.claude/skills/\` 目录
- 列出所有 skill
- 启用/禁用
- 查看说明

**给 VIDO 写 Skill 的示例**

**skill: vido-deploy**
\`\`\`markdown
---
name: vido-deploy
description: 一键部署 VIDO 到生产服务器
trigger: 用户说"部署 VIDO" 或 "push to prod"
---

# VIDO 部署 Skill

## 前置
需要设置环境变量:
- VIDO_DEPLOY_HOST
- VIDO_DEPLOY_PASSWORD (不入 git)

## 使用
\\\`\\\`\\\`bash
bash scripts/deploy.sh
\\\`\\\`\\\`

## 部署后验证
\\\`\\\`\\\`bash
node scripts/smoke-test.js
\\\`\\\`\\\`
\`\`\`

**社区 Skills 生态**

- github.com/anthropics/skills (官方示例)
- github.com/awesome-claude-skills (社区汇总)

**陷阱**
- 不要把敏感信息写进 SKILL.md
- 脚本的错误处理要完整
- 不要依赖绝对路径
- 定期更新依赖`,
    tags: ['skills', 'claude', 'anthropic', '能力包'],
    keywords: ['claude skills', 'skill.md', 'skill folder', 'trigger', 'anthropic skills'],
    prompt_snippets: [
      'SKILL.md with name/description/trigger frontmatter',
      'Skill folder structure: SKILL.md + scripts/ + examples/',
      'Skills for one-shot tasks, MCP for persistent services',
    ],
    applies_to: ['component_engineer', 'workflow_engineer'],
    source: 'Claude Skills 官方文档 + Anthropic Cookbook',
    lang: 'zh-en',
    enabled: true,
  },
  {
    id: 'kb_eng_comp_plugin_architecture',
    collection: 'engineering',
    subcategory: '多组件设计',
    title: '插件架构设计（动态发现 / 依赖注入 / 生命周期管理）',
    summary: '好的插件系统 3 个核心：动态扫描发现 / 依赖注入容器 / 生命周期钩子。',
    content: `**为什么要插件架构**

- **解耦**: 主程序不知道具体插件
- **可扩展**: 用户可以自己加
- **热更新**: 不停服务加功能
- **第三方生态**: 社区贡献

**插件系统的 5 个核心能力**

**1. 动态发现 (Discovery)**
- 扫描指定目录
- 读取元数据
- 注册到容器

**2. 依赖管理 (Dependency)**
- 插件间的依赖声明
- 加载顺序拓扑排序
- 循环依赖检测

**3. 生命周期 (Lifecycle)**
- install
- activate
- deactivate
- uninstall

**4. 权限控制 (Permissions)**
- 能做什么
- 不能做什么
- 资源限制

**5. 通信 (Communication)**
- 插件间调用
- 事件总线
- 消息队列

**插件元数据 manifest.json**

\`\`\`json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "version": "1.0.0",
  "description": "xxx",
  "author": "xxx",
  "main": "index.js",
  "dependencies": {
    "other-plugin": "^1.0.0"
  },
  "permissions": [
    "read:kb",
    "write:logs"
  ],
  "activationEvents": [
    "onCommand:my-plugin.hello",
    "onStartup"
  ],
  "contributes": {
    "commands": [
      { "command": "my-plugin.hello", "title": "Say Hello" }
    ],
    "menus": [
      { "menu": "main", "label": "My Plugin" }
    ]
  }
}
\`\`\`

**插件生命周期示例 (Node.js)**

\`\`\`js
// plugins/my-plugin/index.js
module.exports = {
  // 安装
  async install(context) {
    console.log('Plugin installed');
    await context.storage.set('installed_at', Date.now());
  },

  // 激活
  async activate(context) {
    context.subscriptions.push(
      context.commands.register('my-plugin.hello', () => {
        context.showMessage('Hello from plugin!');
      })
    );
  },

  // 停用
  async deactivate() {
    // 清理资源
  },

  // 卸载
  async uninstall(context) {
    await context.storage.clear();
  },
};
\`\`\`

**依赖注入容器**

插件可以 request 主程序提供的服务：

\`\`\`js
// Plugin API
const context = {
  // 存储
  storage: {
    get(key) {},
    set(key, value) {},
    clear() {},
  },
  // 事件
  events: {
    on(event, handler) {},
    emit(event, data) {},
  },
  // 日志
  logger: {
    info(msg) {},
    error(msg) {},
  },
  // 注册命令
  commands: {
    register(id, handler) {},
  },
  // UI 消息
  showMessage(text) {},
  // 订阅（for cleanup）
  subscriptions: [],
};
\`\`\`

**插件权限沙箱**

**白名单模式**
- 插件在 \`permissions\` 字段声明
- 用户安装时看到并批准
- 主程序 API 检查权限

\`\`\`js
context.storage.get = async (key) => {
  if (!hasPermission(pluginId, 'read:storage')) {
    throw new Error('Permission denied: read:storage');
  }
  return storage.get(key);
};
\`\`\`

**VM 沙箱** (更严格)
- Node.js \`vm\` 模块
- 限制 require 的模块
- 限制文件系统访问
- 限制网络请求

**热加载 (Hot Reload)**

在开发时不需要重启主程序：

\`\`\`js
fs.watch(pluginsDir, (event, filename) => {
  if (event === 'change') {
    const pluginId = getPluginIdFromFilename(filename);
    await deactivatePlugin(pluginId);
    delete require.cache[require.resolve(pluginPath)];
    await activatePlugin(pluginId);
  }
});
\`\`\`

**VIDO 的组件接入现状**

VIDO 现有 3 种可扩展点：

**1. MCP Server** (外部进程)
- 目录: \`MCP/\`
- 自动发现: mcpManager.js

**2. 知识库 Seed**
- 目录: \`src/services/seeds/\`
- 静态扫描: knowledgeBaseSeed.js

**3. 自定义 Agent**
- 文件: \`outputs/custom_agents.json\`
- 运行时: listAgentTypes() 合并内置+自定义

**组件工程师的工作**

1. 设计统一的插件 API
2. 为每种扩展点写接入规范
3. 第三方集成（Slack / Discord / Notion / 微信）
4. 监控所有组件的健康度
5. 版本兼容性保证

**常见插件模式**

- **VSCode** - package.json + activationEvents + commands
- **Chrome Extension** - manifest.json + background/content scripts
- **WordPress** - plugin header + hooks + filters
- **Figma** - manifest.json + plugin API

**陷阱**
- 不要允许插件访问敏感数据（API key / 密码）
- 插件崩溃不要影响主程序
- 插件间的依赖要显式声明
- 版本升级要向后兼容（或明确 breaking change）`,
    tags: ['插件', '架构', '动态发现', '依赖注入'],
    keywords: ['plugin architecture', 'plugin manifest', 'lifecycle hooks', 'dependency injection', 'hot reload', 'sandbox'],
    prompt_snippets: [
      'manifest.json with activationEvents and contributes',
      'plugin lifecycle: install → activate → deactivate → uninstall',
      'permission whitelist with runtime enforcement',
    ],
    applies_to: ['component_engineer', 'backend_engineer'],
    source: 'VSCode Extension API + Chrome Extension + 插件架构通用模式',
    lang: 'zh-en',
    enabled: true,
  },

  // ═══════════════════════════════════════════════════
  // ⑮ 运维工程 (ops_engineer) 【v10 新增】
  // ═══════════════════════════════════════════════════
  {
    id: 'kb_eng_ops_deployment',
    collection: 'engineering',
    subcategory: '运维工程',
    title: '快速部署工具链（Dokku / Coolify / CapRover / PM2 / Docker Compose）',
    summary: '小团队不要上 K8s。5 个更简单的部署方案 + VIDO 推荐栈。',
    content: `**部署方案对比（按复杂度递增）**

| 方案 | 复杂度 | 适合规模 | 自动化 |
|---|---|---|---|
| PM2 + Nginx | ⭐ | 单机 | 基础 |
| Docker Compose | ⭐⭐ | 单机多服务 | 中 |
| Dokku | ⭐⭐ | 单机 PaaS | 高 |
| Coolify | ⭐⭐ | 单机/多机 | 极高 |
| CapRover | ⭐⭐⭐ | 多机 | 高 |
| K3s | ⭐⭐⭐⭐ | 生产集群 | 极高 |
| K8s | ⭐⭐⭐⭐⭐ | 大规模 | 极高 |

**VIDO 当前状态**: PM2 + Nginx + SFTP 部署（足够小团队用）

**方案 1: PM2 + Nginx**

**PM2 配置** (ecosystem.config.js)
\`\`\`js
module.exports = {
  apps: [{
    name: 'vido',
    script: 'src/server.js',
    instances: 2,           // 或 'max' = CPU 数
    exec_mode: 'cluster',
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production',
      PORT: 4600,
    },
    error_file: 'logs/err.log',
    out_file: 'logs/out.log',
    time: true,
  }],
};
\`\`\`

**启动**
\`\`\`bash
pm2 start ecosystem.config.js
pm2 save                # 保存当前状态
pm2 startup             # 设置开机自启
\`\`\`

**Nginx 反向代理**
\`\`\`nginx
server {
    listen 80;
    server_name vido.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name vido.example.com;

    ssl_certificate /etc/letsencrypt/live/vido.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/vido.example.com/privkey.pem;

    # 性能优化
    gzip on;
    gzip_types text/plain text/css application/json application/javascript;
    client_max_body_size 100M;

    location / {
        proxy_pass http://127.0.0.1:4600;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 300s;
    }

    # SSE 端点特殊处理
    location ~ ^/api/(projects|drama|project-stream)/ {
        proxy_pass http://127.0.0.1:4600;
        proxy_buffering off;
        proxy_cache off;
        proxy_set_header Connection '';
        proxy_http_version 1.1;
        chunked_transfer_encoding off;
    }
}
\`\`\`

**Let's Encrypt SSL**
\`\`\`bash
sudo certbot --nginx -d vido.example.com
sudo certbot renew --dry-run  # 测试自动续期
\`\`\`

**方案 2: Dokku (Heroku 替代)**

Dokku 是 "最小的 PaaS"，单机版 Heroku。

**安装**
\`\`\`bash
wget -NP . https://dokku.com/install/v0.34.0/bootstrap.sh
sudo DOKKU_TAG=v0.34.0 bash bootstrap.sh
\`\`\`

**部署**
\`\`\`bash
# 服务器上创建 app
dokku apps:create vido

# 本地
git remote add dokku dokku@your-server:vido
git push dokku main
\`\`\`

就这么简单。Dokku 自动：
- 检测 Node.js 应用
- 跑 npm install
- 启动进程
- 反向代理
- SSL (用 dokku-letsencrypt 插件)

**方案 3: Coolify (开源 Vercel 替代)**

Coolify 最近很火，Web UI 部署：
- 一键部署 GitHub 仓库
- 自动 SSL
- 数据库管理
- 监控
- 多服务

**安装**
\`\`\`bash
curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash
\`\`\`

访问 http://your-server:8000 通过 Web UI 部署。

**方案 4: Docker Compose**

适合多服务（VIDO + Redis + Postgres）：

\`\`\`yaml
version: '3.9'
services:
  vido:
    build: .
    ports: ['4600:4600']
    environment:
      - NODE_ENV=production
      - REDIS_URL=redis://redis:6379
    volumes:
      - ./outputs:/app/outputs
      - ./docs:/app/docs
    depends_on: [redis]
    restart: unless-stopped
    healthcheck:
      test: ['CMD', 'curl', '-f', 'http://localhost:4600/api/health']
      interval: 30s
      retries: 3

  redis:
    image: redis:7-alpine
    volumes: ['redis-data:/data']
    restart: unless-stopped

  nginx:
    image: nginx:alpine
    ports: ['80:80', '443:443']
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf
      - ./certs:/etc/letsencrypt
    depends_on: [vido]
    restart: unless-stopped

volumes:
  redis-data:
\`\`\`

**一键部署**
\`\`\`bash
docker-compose up -d
docker-compose logs -f
docker-compose ps
\`\`\`

**零宕机部署 (Zero Downtime)**

**PM2 方式**
\`\`\`bash
# Graceful reload (不停机)
pm2 reload vido --update-env
\`\`\`

**Docker Compose 方式**
\`\`\`bash
# 逐个替换
docker-compose up -d --no-deps --scale vido=2 vido
sleep 10
docker-compose up -d --no-deps vido
\`\`\`

**蓝绿部署**
- 开两套环境 (blue / green)
- 部署到非活跃一侧
- 测试通过后切换 Nginx upstream

**灾难恢复**

**备份策略 (3-2-1)**
- 3 份副本
- 2 种介质
- 1 份异地

**VIDO 备份清单**
- \`outputs/\` 目录 (数据库)
- \`docs/\` 目录 (日志)
- 环境变量 (.env)
- Nginx 配置
- SSL 证书

**定时备份脚本**
\`\`\`bash
#!/bin/bash
DATE=$(date +%Y%m%d_%H%M%S)
tar -czf backups/vido_\$DATE.tar.gz outputs/ docs/ .env

# 保留最近 7 天
find backups/ -name 'vido_*.tar.gz' -mtime +7 -delete

# 上传到 S3
aws s3 cp backups/vido_\$DATE.tar.gz s3://vido-backups/
\`\`\`

**健康检查端点**

\`\`\`js
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    version: require('./package.json').version,
  });
});

app.get('/api/ready', async (req, res) => {
  // 检查依赖
  const checks = {
    redis: await checkRedis(),
    llm: await checkLLMAPI(),
    disk: await checkDiskSpace(),
  };
  const ok = Object.values(checks).every(c => c.ok);
  res.status(ok ? 200 : 503).json({ ok, checks });
});
\`\`\``,
    tags: ['部署', 'pm2', 'docker', 'dokku', 'nginx'],
    keywords: ['deployment', 'pm2', 'nginx', 'dokku', 'coolify', 'caprover', 'docker compose', 'zero downtime', 'blue green'],
    prompt_snippets: [
      'PM2 cluster mode with max_memory_restart for auto recovery',
      'Nginx SSE location with proxy_buffering off',
      'Docker Compose with healthcheck and restart unless-stopped',
      'Dokku for Heroku-like single server PaaS',
    ],
    applies_to: ['ops_engineer', 'backend_engineer'],
    source: 'PM2 / Nginx / Docker / Dokku 官方文档 + 部署实战',
    lang: 'zh-en',
    enabled: true,
  },
  {
    id: 'kb_eng_ops_security',
    collection: 'engineering',
    subcategory: '运维工程',
    title: '服务器安全与网络防控（WAF / DDoS / 入侵检测）',
    summary: '生产服务器必须守好的 10 道防线：从 SSH 到应用层到数据库到监控。',
    content: `**服务器安全 10 道防线**

**Defense 1: SSH 加固**

\`\`\`bash
# /etc/ssh/sshd_config
Port 22022                    # 改默认端口
PermitRootLogin no            # 禁 root 登录
PasswordAuthentication no     # 禁密码，只用 key
AllowUsers vido-admin         # 白名单用户
MaxAuthTries 3
ClientAliveInterval 300
ClientAliveCountMax 2
\`\`\`

**创建 SSH key**
\`\`\`bash
ssh-keygen -t ed25519 -C "vido@deploy" -f ~/.ssh/vido_ed25519
ssh-copy-id -i ~/.ssh/vido_ed25519 -p 22022 vido-admin@server
\`\`\`

**Defense 2: Firewall (UFW)**

\`\`\`bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22022/tcp       # SSH
sudo ufw allow 80/tcp          # HTTP
sudo ufw allow 443/tcp         # HTTPS
sudo ufw enable
\`\`\`

**Defense 3: Fail2ban**

防止暴力破解：
\`\`\`bash
sudo apt install fail2ban

# /etc/fail2ban/jail.local
[sshd]
enabled = true
port = 22022
maxretry = 3
bantime = 3600

[nginx-http-auth]
enabled = true

[nginx-limit-req]
enabled = true
\`\`\`

**Defense 4: 系统更新**

\`\`\`bash
# 启用自动安全更新 (Ubuntu)
sudo apt install unattended-upgrades
sudo dpkg-reconfigure --priority=low unattended-upgrades

# 或手动
sudo apt update && sudo apt upgrade -y
\`\`\`

**Defense 5: Nginx 安全头**

\`\`\`nginx
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
add_header X-Frame-Options "DENY" always;
add_header X-Content-Type-Options "nosniff" always;
add_header X-XSS-Protection "1; mode=block" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:;" always;

# 隐藏 Nginx 版本
server_tokens off;
\`\`\`

**Defense 6: 速率限制**

**Nginx 层**
\`\`\`nginx
limit_req_zone $binary_remote_addr zone=api:10m rate=10r/s;

location /api/ {
    limit_req zone=api burst=20 nodelay;
    proxy_pass http://127.0.0.1:4600;
}
\`\`\`

**应用层 (Express)**
\`\`\`js
import rateLimit from 'express-rate-limit';

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 min
  max: 100,                    // 每个 IP 100 请求
  message: 'Too many requests',
});

app.use('/api/', apiLimiter);
\`\`\`

**Defense 7: WAF (Web Application Firewall)**

**选项 1: Cloudflare WAF** (免费)
- 最简单，全球 CDN
- DDoS 防护
- OWASP 规则
- Bot 管理

**选项 2: ModSecurity + Nginx**
- 开源
- 自建
- OWASP Core Rule Set

**选项 3: 付费 WAF**
- AWS WAF
- 阿里云 WAF
- 腾讯云 WAF

**Defense 8: DDoS 防护**

**Layer 3/4 (网络层)**
- CDN 承担（Cloudflare / 阿里云 CDN）
- BGP 黑洞路由
- SYN Cookie

**Layer 7 (应用层)**
- 速率限制
- 验证码
- IP 信誉库
- 行为分析

**应急应对**
\`\`\`bash
# 查当前连接数
ss -s

# 统计连接来源
netstat -tn | awk '{print $5}' | cut -d: -f1 | sort | uniq -c | sort -rn | head

# 临时封 IP
sudo ufw deny from 1.2.3.4
\`\`\`

**Defense 9: 入侵检测 (IDS)**

**AIDE** (文件完整性监控)
\`\`\`bash
sudo apt install aide
sudo aideinit
sudo aide --check
\`\`\`

**OSSEC** (更全面)
- HIDS
- 日志分析
- Rootkit 检测

**Defense 10: 日志与审计**

**集中日志**
- Loki + Grafana
- ELK Stack (Elasticsearch + Logstash + Kibana)

**审计关键事件**
- 登录成功/失败
- sudo 使用
- 配置修改
- 敏感文件访问

**auditd**
\`\`\`bash
sudo apt install auditd
sudo auditctl -w /etc/passwd -p wa
sudo auditctl -w /etc/shadow -p wa
sudo ausearch -f /etc/passwd
\`\`\`

**应用层安全**

**1. 密钥管理**
- 环境变量 (.env)
- Vault / AWS KMS / Azure Key Vault
- 定期轮换
- 不入 git (.gitignore)

**2. HTTPS only**
- Strict-Transport-Security
- HSTS preload 列表
- TLS 1.2+ only

**3. 依赖审计**
\`\`\`bash
npm audit
npm audit fix
# 或 snyk test
\`\`\`

**4. SQL 注入防御**
- 参数化查询
- ORM
- 输入验证

**5. XSS 防御**
- 输出转义
- CSP header
- HttpOnly cookie

**6. CSRF 防御**
- SameSite=Strict cookie
- CSRF token

**7. 文件上传**
- 类型白名单
- 大小限制
- 路径隔离
- 病毒扫描 (ClamAV)

**监控告警**

**SRE Golden Signals**
1. **Latency** - 请求耗时
2. **Traffic** - 请求量
3. **Errors** - 错误率
4. **Saturation** - 资源饱和

**告警规则 (Prometheus)**
\`\`\`yaml
- alert: HighErrorRate
  expr: rate(http_requests_total{status=~"5.."}[5m]) > 0.05
  for: 5m
  annotations:
    summary: "5xx 错误率超过 5%"

- alert: HighMemoryUsage
  expr: (node_memory_MemTotal_bytes - node_memory_MemAvailable_bytes) / node_memory_MemTotal_bytes > 0.9
  for: 10m

- alert: DiskSpaceLow
  expr: node_filesystem_avail_bytes / node_filesystem_size_bytes < 0.1
\`\`\`

**VIDO 现状安全评估**

| 项目 | 状态 | 建议 |
|---|---|---|
| HTTPS | ❓ | 必须上 |
| Rate Limit | ❌ | 立即加 express-rate-limit |
| Helmet | ❌ | 加 helmet middleware |
| 依赖审计 | ❌ | GitHub Dependabot |
| WAF | ❌ | Cloudflare |
| 备份 | ❌ | 每日自动备份 |
| 监控 | ⚠️ | 已有 server metrics，需要告警 |
| Audit log | ⚠️ | 项目助理日志算半个 |`,
    tags: ['安全', 'ddos', 'waf', 'fail2ban', 'ids'],
    keywords: ['server security', 'ufw', 'fail2ban', 'modsecurity', 'waf', 'ddos', 'ids', 'owasp', 'sre golden signals'],
    prompt_snippets: [
      'UFW firewall with only 22022/80/443 allowed',
      'Nginx limit_req_zone for rate limiting per IP',
      'helmet + express-rate-limit for Node.js app security',
      'SRE golden signals: latency/traffic/errors/saturation',
    ],
    applies_to: ['ops_engineer', 'backend_engineer'],
    source: 'OWASP + Google SRE Book + 生产服务器加固实践',
    lang: 'zh-en',
    enabled: true,
  },
  {
    id: 'kb_eng_ops_monitoring',
    collection: 'engineering',
    subcategory: '运维工程',
    title: '服务器性能监控栈（Prometheus / Grafana / Loki / Uptime Kuma）',
    summary: '不监控 = 蒙着眼跑。4 个开源监控工具 + 告警规则 + VIDO 已有的监控分析。',
    content: `**监控的三支柱 (Three Pillars)**

1. **Metrics** 指标 - 数字型数据（CPU/内存/QPS）
2. **Logs** 日志 - 文本记录（请求日志/错误）
3. **Traces** 追踪 - 请求在微服务间的路径

**主流监控栈**

**Prometheus + Grafana (最流行)**
- **Prometheus**: 抓取指标 + 存储 + 告警
- **Grafana**: 可视化
- **Node Exporter**: Linux 系统指标
- **Loki**: 日志聚合（Grafana 出品，轻量）

**ELK Stack**
- Elasticsearch + Logstash + Kibana
- 日志为主
- 重量级

**商业方案**
- Datadog ($$$$) - 一站式
- New Relic - APM 强
- Sentry - 错误追踪

**轻量方案**
- **Uptime Kuma** - 自托管 UptimeRobot
- **Netdata** - 单机实时监控
- **Glances** - 命令行监控

**Prometheus + Grafana 部署**

**Docker Compose**
\`\`\`yaml
version: '3.9'
services:
  prometheus:
    image: prom/prometheus:latest
    ports: ['9090:9090']
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml
      - prometheus-data:/prometheus
    command:
      - '--config.file=/etc/prometheus/prometheus.yml'
      - '--storage.tsdb.retention.time=15d'

  grafana:
    image: grafana/grafana:latest
    ports: ['3000:3000']
    volumes:
      - grafana-data:/var/lib/grafana
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=change_me

  node-exporter:
    image: prom/node-exporter:latest
    ports: ['9100:9100']

  loki:
    image: grafana/loki:latest
    ports: ['3100:3100']

  promtail:
    image: grafana/promtail:latest
    volumes:
      - /var/log:/var/log
      - ./promtail.yml:/etc/promtail/config.yml

volumes:
  prometheus-data:
  grafana-data:
\`\`\`

**prometheus.yml**
\`\`\`yaml
global:
  scrape_interval: 15s

scrape_configs:
  - job_name: 'prometheus'
    static_configs:
      - targets: ['localhost:9090']

  - job_name: 'node'
    static_configs:
      - targets: ['node-exporter:9100']

  - job_name: 'vido'
    static_configs:
      - targets: ['vido:4600']  # VIDO 需要暴露 /metrics 端点

alerting:
  alertmanagers:
    - static_configs:
        - targets: ['alertmanager:9093']

rule_files:
  - '/etc/prometheus/alerts.yml'
\`\`\`

**Node.js app 暴露指标**

\`\`\`js
import promClient from 'prom-client';

const register = new promClient.Registry();
promClient.collectDefaultMetrics({ register });

const httpRequestDuration = new promClient.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5],
});
register.registerMetric(httpRequestDuration);

app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    httpRequestDuration.labels(req.method, req.route?.path || req.path, res.statusCode).observe((Date.now() - start) / 1000);
  });
  next();
});

app.get('/metrics', async (req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});
\`\`\`

**Grafana Dashboard**

几个必装 dashboard:
- **Node Exporter Full** (dashboard ID: 1860) - Linux 全量
- **Nginx** (ID: 12708)
- **Docker** (ID: 193)
- **MySQL** (ID: 7362)
- **PostgreSQL** (ID: 9628)

**关键监控指标 (VIDO 级)**

**系统层**
- CPU 使用率
- 内存使用率
- 磁盘使用率
- 网络流量
- Load average
- 打开的文件句柄数

**应用层**
- 请求量 (QPS)
- 响应时间 (p50/p95/p99)
- 错误率
- 活跃连接数

**业务层**
- 新用户注册数
- 视频生成成功率
- LLM 调用量
- Token 消耗
- 生成平均耗时

**外部依赖**
- LLM API 响应时间
- LLM API 错误率
- 数据库查询时间
- Redis 命中率

**告警规则**

**alerts.yml**
\`\`\`yaml
groups:
  - name: vido_alerts
    interval: 30s
    rules:
      - alert: HighCPU
        expr: 100 - (avg(irate(node_cpu_seconds_total{mode="idle"}[5m])) * 100) > 80
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "CPU 使用率 > 80%"

      - alert: HighMemory
        expr: (node_memory_MemTotal_bytes - node_memory_MemAvailable_bytes) / node_memory_MemTotal_bytes > 0.9
        for: 5m
        labels:
          severity: critical

      - alert: DiskSpaceLow
        expr: node_filesystem_avail_bytes{mountpoint="/"} / node_filesystem_size_bytes{mountpoint="/"} < 0.1
        for: 10m

      - alert: HighLatency
        expr: histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m])) > 2
        for: 5m

      - alert: HighErrorRate
        expr: rate(http_requests_total{status=~"5.."}[5m]) / rate(http_requests_total[5m]) > 0.05
        for: 5m

      - alert: ServiceDown
        expr: up{job="vido"} == 0
        for: 1m
        labels:
          severity: critical
\`\`\`

**告警通知渠道**

- Slack
- 企业微信
- 钉钉
- PagerDuty
- Email
- SMS

**Alertmanager 配置**
\`\`\`yaml
route:
  receiver: 'default'
  routes:
    - match:
        severity: critical
      receiver: 'pagerduty'

receivers:
  - name: 'default'
    slack_configs:
      - api_url: '<webhook-url>'
        channel: '#alerts'

  - name: 'pagerduty'
    pagerduty_configs:
      - service_key: '<key>'
\`\`\`

**VIDO 当前监控能力**

VIDO 已经在 **模型监控 tab** 实现了：
- Token 使用统计
- 服务器指标（CPU/内存/uptime）
- 告警检查

但是：
- ❌ 没有持久化 metrics（只有实时）
- ❌ 没有 Grafana dashboard
- ❌ 没有告警发送渠道
- ❌ 没有历史趋势图

**升级路径**
1. **短期**: 现有 tokenTracker 足够自用
2. **中期**: 加 prom-client，暴露 /metrics
3. **长期**: 部署 Prometheus + Grafana 栈

**Uptime Kuma (最简单)**

如果不想折腾 Prometheus，用 Uptime Kuma：
- 自托管 UptimeRobot
- Web UI
- 支持 HTTP/TCP/Ping/DNS 监控
- 通知渠道齐全

\`\`\`bash
docker run -d --restart=always -p 3001:3001 -v uptime-kuma:/app/data --name uptime-kuma louislam/uptime-kuma:1
\`\`\`

**陷阱**
- 监控不要自己监控自己（要外部 endpoint）
- 告警疲劳 → 只报重要的
- 数据保留时间要平衡（磁盘 vs 历史）
- Alert → Runbook 对应，不要只告警不处理`,
    tags: ['监控', 'prometheus', 'grafana', 'loki'],
    keywords: ['monitoring', 'prometheus', 'grafana', 'loki', 'promtail', 'node exporter', 'alertmanager', 'uptime kuma'],
    prompt_snippets: [
      'Prometheus + Grafana + Loki + Node Exporter stack',
      'prom-client Histogram for HTTP request duration',
      'Alert rules: HighCPU/HighMemory/HighLatency/HighErrorRate',
      'Uptime Kuma for lightweight self-hosted monitoring',
    ],
    applies_to: ['ops_engineer', 'backend_engineer'],
    source: 'Prometheus / Grafana / Loki 官方文档 + Google SRE Book',
    lang: 'zh-en',
    enabled: true,
  },

  // ═══════════════════════════════════════════════════
  // ⑯ 业务工作流 vs 研发工作流 (完整定义) 【v10 新增】
  // ═══════════════════════════════════════════════════
  {
    id: 'kb_eng_workflow_business_full',
    collection: 'engineering',
    subcategory: '工作流编排',
    title: 'VIDO 业务工作流完整定义（视频 / 小说 / 漫画 / 数字人 四大 Pipeline）',
    summary: '业务工作流 = 用 VIDO 平台产出内容的流程。4 个核心 pipeline + 每步 agent 映射。',
    content: `**业务工作流定义**

**业务工作流 (Business Workflow)** = 使用 VIDO 平台**产出内容**的完整流程，从创意到成品。

**关键特征**
- 终产物是**内容**（视频/小说/漫画/数字人视频等）
- 由**运营团队 agent** 负责执行（编剧/导演/人物/分镜/氛围等）
- 服务**最终用户**（创作者、影视公司）
- 依赖**研发团队** 构建的平台能力

**VIDO 4 大业务 Pipeline**

## Pipeline 1: AI 视频生成

**场景**: 用户输入主题 → 生成 60 秒视频

**完整流程**
\`\`\`
Step 1: 市场调研 (可选) → 🎯 market_research
  输入: 目标用户画像
  输出: 题材方向建议

Step 2: 剧本创作 → ✍️ screenwriter
  输入: 主题 / 风格 / 场景数
  输出: 剧本 JSON (scenes / characters / dialogue)
  KB 注入: screenwriter + market_research + copywriter

Step 3: 艺术总监 → 🎨 art_director
  输入: 剧本
  输出: Style Bible (色板 / 光线 / 氛围锚点)
  KB 注入: art_director + atmosphere

Step 4: 分镜导演 → 🎬 director
  输入: 剧本 + Style Bible
  输出: 分镜 JSON (每镜 visual_prompt / camera / lighting)
  KB 注入: director + art_director + atmosphere + storyboard + editor

Step 5: 人物一致性锁定 → 🎭 character_consistency
  输入: 剧本 + characters[]
  输出: Character Bible (id_token / lock_face / lock_wardrobe)
  KB 注入: character_consistency + art_director

Step 6: 运镜标注 → 🎥 storyboard + motion preset
  输入: 分镜
  输出: 每镜的运镜指令

Step 7: 提示词组装 → 内部
  融合: 场景 prompt + 角色 lock + 风格锚点

Step 8: 图像生成 → 🧩 comfyui_engineer 参与（如果用本地 ComfyUI）
  输入: 合成的 prompt
  输出: 每镜的关键帧图

Step 9: 视频生成 → 🤖 llm_engineer 管控模型路由
  输入: 关键帧 + 运镜
  输出: 每镜的视频片段

Step 10: 配音 → 👤 digital_human (TTS 部分)
  输入: 对话文本 + 角色音色
  输出: 每镜的音频

Step 11: 剪辑合成 → ✂️ editor + backend (FFmpeg)
  输入: 视频片段 + 音频 + BGM + 字幕
  输出: 最终成片

Step 12: 文案 + 发布 → 📝 copywriter + 📈 growth_ops
  输入: 成片
  输出: 标题 / 描述 / hashtag
\`\`\`

**实际代码位置**
- 入口: \`src/services/projectService.js\` generateProject()
- 实现: \`src/services/dramaService.js\` generateDrama()

## Pipeline 2: AI 小说生成

**场景**: 用户输入主题 + 题材 → 生成多章节小说

**完整流程**
\`\`\`
Step 1: 市场调研 → 🎯 market_research
  输出: 当前该题材的爆款套路

Step 2: 大纲生成 → ✍️ screenwriter
  输入: 主题 / 篇幅 / 题材
  输出: 大纲 (章节标题 + summary)

Step 3: 人物设定 → 🎭 character_consistency
  输出: 主要角色档案

Step 4: 章节写作 → ✍️ screenwriter (循环)
  输入: 大纲 + 前章末尾
  输出: 本章全文

Step 5: 润色 → 📝 copywriter
  输入: 全文
  输出: 优化后的文字

Step 6: 金句提炼 → 📝 copywriter
  输出: 封面金句 + 简介

Step 7: 推广文案 → 📝 copywriter + 📈 growth_ops
\`\`\`

**代码位置**: \`src/services/novelService.js\`

## Pipeline 3: AI 漫画生成

**场景**: 用户输入主题 → 生成多格漫画

**完整流程**
\`\`\`
Step 1: 剧本 → ✍️ screenwriter
Step 2: 分镜 → 🎬 director + 🎥 storyboard
Step 3: 角色设定 → 🎭 character_consistency + 🎨 art_director
Step 4: 每格绘制 → 🧩 comfyui_engineer
Step 5: 对白组装 → 📝 copywriter
Step 6: 合成导出 → ✂️ editor
\`\`\`

**代码位置**: \`src/services/comicService.js\`

## Pipeline 4: 数字人视频

**场景**: 用户输入台词 → 数字人口播视频

**完整流程**
\`\`\`
Step 1: 话术优化 → 📝 copywriter
  输出: 适合口播的 3-7-15-30s 节奏

Step 2: 人设确认 → 👤 digital_human
  输出: 合适的人设原型

Step 3: 音色选择 → 👤 digital_human
  输出: TTS 配置

Step 4: 口型同步 → 👤 digital_human + 🧩 comfyui_engineer
  工具: MuseTalk / LivePortrait / Hedra

Step 5: 背景合成 → ✂️ editor
  输入: 数字人视频 + 背景

Step 6: 字幕 + 音乐 → ✂️ editor
\`\`\`

**代码位置**: \`src/services/avatarService.js\` (待建)

**业务工作流的通用设计原则**

**1. Agent 协作而非替代**
每一步都有明确的负责 agent，不要让一个 agent 干所有事。

**2. KB 动态注入**
每一步的 agent 都通过 \`kb.searchForAgent(agentId, task)\` 动态检索相关知识。

**3. 错误处理**
- 单步失败：记录 + 告警 + 人工介入
- 关键步骤：自动重试（最多 3 次）
- 降级方案：失败时用 fallback 模型

**4. 可追溯**
- 每步的输入 / 输出 / 耗时 / 成本都记录
- 支持从任意步骤重新开始
- 持久化中间状态到 DB

**5. 可观测**
- SSE 实时进度推送给前端
- 每步进入 \`tokenTracker\` 记录
- 生成结束写入 \`docs/logs/\` (项目助理)

**业务工作流的共同失败点**

- LLM 返回非预期格式 → JSON 解析失败 → 解决: json_schema strict 模式 + fallback
- 图像/视频生成超时 → 长任务管理 → 解决: queue + polling
- 角色一致性崩坏 → 跨镜头 character 偏移 → 解决: lock_token + reference image
- 对白不自然 → 解决: 加 few-shot 示例 + 风格关键词
- 视频生成费用失控 → 解决: 预算告警 + 模型路由降级

**与研发工作流的关系**

业务工作流**使用**研发工作流产出的能力：
- 研发团队建平台（API/数据库/前端）
- 运营团队用平台生产内容
- 两者通过 **API 契约** 解耦`,
    tags: ['业务工作流', 'pipeline', '视频', '小说', '漫画', '数字人'],
    keywords: ['business workflow', 'video pipeline', 'novel pipeline', 'comic pipeline', 'avatar pipeline', 'agent orchestration'],
    prompt_snippets: [
      'video pipeline: 市场调研→剧本→艺术总监→分镜→人物锁定→图像→视频→剪辑',
      'novel pipeline: 大纲→人物→章节→润色→金句',
      'business workflow uses ops team agents exclusively',
    ],
    applies_to: ['workflow_engineer', 'executive_producer', 'project_assistant'],
    source: 'VIDO 项目现有 pipeline 实现 (dramaService / novelService / comicService)',
    lang: 'zh',
    enabled: true,
  },
  // ═══════════════════════════════════════════════════
  // ⑰ 产品/项目经理 (product_manager / project_manager) 【v12 新增】
  // ═══════════════════════════════════════════════════
  {
    id: 'kb_eng_pm_product_framework',
    collection: 'engineering',
    subcategory: '工作流编排',
    title: '产品经理工作框架（需求分析 / PRD / 用户故事 / MoSCoW）',
    summary: '产品经理把用户需求转化为可执行的研发任务。5 大产出 + 3 大方法论。',
    content: `**产品经理的 5 大核心产出**

1. **PRD** (Product Requirements Document)
2. **用户故事** (User Story) - INVEST 原则
3. **需求优先级** MoSCoW (Must/Should/Could/Won't)
4. **上线 checklist**
5. **数据驱动决策**

**PRD 模板**
\\\`\\\`\\\`markdown
# PRD: [功能名]
## 背景
- 问题 / 机会 / 目标
## 用户故事
作为 [角色]，我希望 [功能]，以便 [价值]
## 功能清单 (MoSCoW)
- [P0] 必做
- [P1] 应做
- [P2] 可做
## 交互流程
step by step
## 边界条件
空态/加载/错误/成功
## 验收标准 (DoD)
- [ ] 所有 P0 完成
- [ ] 测试覆盖 > 70%
- [ ] UI 符合 Figma
## 风险
技术/依赖/时间
\\\`\\\`\\\`

**方法论**

**KANO 模型** - 功能分类
- 基本型 / 期望型 / 兴奋型 / 无差异 / 反向

**Jobs to be Done**
- 用户雇佣产品做什么
- 替代方案是什么
- 我们为什么更好

**OKR**
- Objective + Key Results

**VIDO 产品经理工作场景**
1. 新功能需求 → 理解真实需求 → 分析竞品 → PRD → 原型 → 排期
2. 优化现有 → 定位问题 → 分析原因 → 方案 → 评估 → A/B 测试
3. 跨模块决策 → 影响评估 → 方案成本 → 协调 → 迁移计划`,
    tags: ['产品经理', 'prd', '需求分析'],
    keywords: ['product manager', 'prd', 'user story', 'moscow', 'kano', 'jtbd', 'okr', 'invest'],
    prompt_snippets: [
      'PRD template with background / user story / priority / DoD',
      'MoSCoW prioritization',
      'INVEST for user stories',
    ],
    applies_to: ['product_manager', 'project_manager', 'executive_producer'],
    source: '产品经理通用方法论',
    lang: 'zh',
    enabled: true,
  },
  {
    id: 'kb_eng_pm_vido_platform',
    collection: 'engineering',
    subcategory: '工作流编排',
    title: 'VIDO 平台业务逻辑导航（给产品经理的架构速览）',
    summary: '产品经理必须理解的 VIDO 6 大模块 + 数据流 + 升级方向。',
    content: `**VIDO 6 大业务模块**

1. **AI 视频项目** \`/api/projects\` → projectService.js
2. **网剧** \`/api/drama\` → dramaService.js
3. **AI 小说** \`/api/novel\` → novelService.js
4. **漫画** \`/api/comic\` → comicService.js
5. **数字人** \`/api/avatar\` → avatarService.js (部分)
6. **图生视频** \`/api/i2v\` → i2v.js

**数据流**

\\\`\\\`\\\`
用户请求 → Express 路由 → 业务服务 → Agent Pipeline → Model Call (LLM/Video)
                                           ↓
                                    Token Tracker 记录
                                           ↓
                                    文件 + JSON DB
                                           ↓
                                    SSE 推进度 → 前端
\\\`\\\`\\\`

**核心 Agent Pipeline (视频)**
编剧 → 艺术总监 → 导演 → 人物一致性 → 分镜 → 图像 → 视频 → 剪辑 → 配音 → 合成

**AI 团队 (29 人)**
- 研发团队 13 人: 6 工程 + 5 (测试/UI/LLM/组件/运维) + 2 管理 (PM/PjM)
- 运营团队 16 人: 内容创作 8 + 市场 6 + 制片 + 社媒 + 数据

**知识库 (6 合集 190+ 条)**
digital_human / drama / storyboard / atmosphere / production / engineering

**外部集成**
- LLM: OpenAI/Claude/Gemini/DeepSeek/Qwen/Doubao/Kimi/GLM
- 视频: Sora/Veo/Kling/Runway/Luma/Pika/Seedance/Hailuo
- MCP: 5 个
- Skills: Claude Skills

**数据存储**
- 纯 JSON 文件 (outputs/*.json)
- 无 SQL 数据库
- 节省运维

**升级方向**
- 📈 更快生成 (Worker Queue)
- 🎨 更好 UI (Ant Design 迁移)
- 🌍 i18n
- 💳 付费体系
- 📱 移动端 (PWA)
- 🔐 OAuth + 2FA
- 🤝 API 开放平台

**产品决策原则**
- 不盲目加功能（累积技术债）
- 不忽略性能（用户等不起）
- 不忽略成本（token 爆炸）
- 不改核心不测试
- 不绕研发规范`,
    tags: ['vido', '架构', '产品经理', '业务逻辑'],
    keywords: ['vido architecture', 'business modules', 'data flow', 'agent pipeline', 'upgrade path'],
    prompt_snippets: [
      'VIDO 6 modules: projects / drama / novel / comic / avatar / i2v',
      'Agent pipeline: screenwriter → director → character → storyboard → image → video → edit',
      '29 agents: 13 rd + 16 ops',
    ],
    applies_to: ['product_manager', 'project_manager', 'workflow_engineer'],
    source: 'VIDO 项目代码结构分析 + 架构文档',
    lang: 'zh',
    enabled: true,
  },
  {
    id: 'kb_eng_pm_visual_aesthetic',
    collection: 'engineering',
    subcategory: '工作流编排',
    title: '产品经理视觉审美修炼（对标 / 配色 / 版式）',
    summary: '产品经理不画图但必须看懂好坏。4 维度审美 + 10 个训练方法 + 对标库。',
    content: `**审美 4 大维度**

**#1 色彩**
- 色轮: 互补/类比/三角
- 饱和度: 高=活泼, 低=高级
- 色温: 暖=近人, 冷=专业
- 对比度: 4.5:1+ 无障碍
- 情绪: 红=激情, 蓝=信任, 绿=自然, 紫=奢华

**#2 版式 (CRAP 原则)**
- **C**ontrast 对比
- **R**epetition 重复
- **A**lignment 对齐
- **P**roximity 亲密
- 8px baseline 栅格

**#3 字体**
- 字号层级 (h1-h6 清晰)
- 字重对比 (400/600/700)
- 行高 1.5-1.6 正文, 1.1-1.3 标题
- 避免超过 3 种字体

**#4 动效**
- 时长 150-300ms
- ease-out > ease-in
- 必须有意义
- 避免超 500ms

**10 训练方法**
1. 每日 Dribbble / Behance
2. 对标竞品截图分析
3. 色彩采集 (Adobe Color)
4. 临摹练习 (Figma)
5. 学设计系统 (Material / HIG / Ant)
6. 关注细节 (圆角/阴影/间距)
7. 黑白先行，颜色最后
8. 少即是多
9. 移动先行
10. 获得反馈

**Dieter Rams 好设计 10 原则**
创新 / 有用 / 美 / 易懂 / 不张扬 / 诚实 / 耐久 / 细致 / 环保 / 极简

**VIDO 对标库**
- AI 视频: Runway / Pika / Sora / Kling
- 创作工具: Figma / Canva / Notion / Linear
- 企业后台: Vercel / Stripe / Linear / Supabase

**2025 视觉趋势**
- 玻璃拟态 (iOS 18+)
- 高饱和科技
- 极简留白
- 有机流动
- 大字号
- 渐变 2.0
- 手绘元素

**产品经理审美陷阱**
- ❌ 跟风不思考
- ❌ 功能塞满首页
- ❌ 5+ 种颜色
- ❌ 忽略留白
- ❌ 动效滥用
- ❌ 不做暗色模式
- ❌ 不做无障碍`,
    tags: ['视觉审美', '产品经理', '设计'],
    keywords: ['visual aesthetic', 'color', 'typography', 'crap', 'dieter rams'],
    prompt_snippets: [
      'CRAP: Contrast/Repetition/Alignment/Proximity',
      '8px baseline spacing for consistent rhythm',
      'Dieter Rams 10 principles of good design',
    ],
    applies_to: ['product_manager', 'ui_designer'],
    source: 'Dieter Rams + CRAP 设计原则',
    lang: 'zh',
    enabled: true,
  },
  {
    id: 'kb_eng_pm_project_scrum',
    collection: 'engineering',
    subcategory: '工作流编排',
    title: '项目经理 Scrum/Kanban 方法论（接任务 → 分解 → 分发 → 跟进）',
    summary: '项目经理承接任务后的标准流程：接受 → 拆解 → 分发 → 跟进 → 复盘。',
    content: `**Scrum 3+5+3**

**3 角色**
- Product Owner (PO) = 产品经理
- Scrum Master = 项目经理
- Development Team

**5 仪式**
1. Sprint Planning (4h/2 周)
2. Daily Standup (15min)
3. Sprint Review (2h)
4. Sprint Retrospective (1.5h)
5. Backlog Refinement

**3 工件**
1. Product Backlog - 所有未完需求
2. Sprint Backlog - 本 sprint 承诺
3. Increment - 可工作产出

**Kanban 看板**
\\\`\\\`\\\`
| Backlog | To Do | In Progress | Review | Testing | Done |
\\\`\\\`\\\`
WIP 限制 + 从右往左拉

**项目经理接任务 5 步流程**

**Step 1: 承接**
- 理解任务 (是什么 / 为什么 / 谁要)
- 评估紧急度 / 重要度
- 分配 task_id
- 创建看板卡片

**Step 2: 拆解**
- Epic → Feature → Story → Task
- Story Points 估算 (斐波那契)
- 识别依赖关系

**Step 3: 分发**
- 根据专长匹配 agent
- 给出明确 deadline
- 同步给全员

**Step 4: 跟进**
- 每日站会同步
- 看板刷新
- 阻塞问题立即处理
- 风险矩阵评估

**Step 5: 复盘**
- 做得好 / 做得不好 / 改进点
- 记录 lessons learned

**研发任务分配决策树**

\\\`\\\`\\\`
任务来了
├─ 需要新 UI ?
│  ├─ 是 → ui_designer 先做原型
│  └─ 否 → 跳过
├─ 涉及后端 ?
│  ├─ 是 → backend_engineer
│  └─ 否 → 跳过
├─ 涉及前端 ?
│  ├─ 是 → frontend_engineer
│  └─ 否 → 跳过
├─ 涉及 AI 模型 ?
│  ├─ 是 → algorithm_engineer / llm_engineer
│  └─ 否 → 跳过
├─ 涉及 ComfyUI ?
│  ├─ 是 → comfyui_engineer
│  └─ 否 → 跳过
├─ 涉及爬虫 ?
│  ├─ 是 → crawler_engineer
│  └─ 否 → 跳过
├─ 涉及工作流 ?
│  ├─ 是 → workflow_engineer
│  └─ 否 → 跳过
├─ 需要测试 (一定要)
│  └─ test_engineer
└─ 需要部署 (一定要)
   └─ ops_engineer
\\\`\\\`\\\`

**每日 checklist**
- [ ] 站会同步
- [ ] 看板刷新
- [ ] 处理阻塞
- [ ] 跟紧急任务

**每 sprint checklist**
- [ ] 计划会
- [ ] 评审会
- [ ] 回顾会
- [ ] Backlog 梳理

**风险管理 4 步**
1. 识别 - 列出风险
2. 评估 - 影响 × 概率
3. 应对 - 规避/缓解/接受/转移
4. 监控 - 定期 review

**燃尽图 (Burndown)**
理想线 vs 实际线，偏离太多 → 危险

**陷阱**
- ❌ 站会开成汇报会
- ❌ 回顾只抱怨不行动
- ❌ 过度控制
- ❌ 放任自流
- ❌ 只看进度不看质量`,
    tags: ['项目经理', 'scrum', 'kanban', '任务分配'],
    keywords: ['project manager', 'scrum', 'kanban', 'sprint', 'backlog', 'burndown', 'task assignment'],
    prompt_snippets: [
      'Scrum: 3 roles + 5 ceremonies + 3 artifacts',
      'Kanban: WIP limit + pull from right',
      'Task breakdown: Epic → Feature → Story → Task',
    ],
    applies_to: ['project_manager', 'workflow_engineer', 'executive_producer'],
    source: 'Scrum Guide 2020 + Kanban Method',
    lang: 'zh-en',
    enabled: true,
  },

  {
    id: 'kb_eng_workflow_rd_full',
    collection: 'engineering',
    subcategory: '工作流编排',
    title: 'VIDO 研发工作流完整定义（需求 → 设计 → 开发 → 测试 → 部署 → 监控）',
    summary: '研发工作流 = 建设 VIDO 平台本身的流程。6 阶段 × 11 个 R&D agent 映射。',
    content: `**研发工作流定义**

**研发工作流 (R&D Workflow)** = 开发/优化 VIDO 平台本身的完整流程。

**关键特征**
- 终产物是**平台能力**（新功能/修复/优化）
- 由**研发团队 agent** 负责执行（6 个工程师 + 5 个 v10 新增 = 11 个 R&D）
- 服务**内部**（让运营团队/最终用户用得更爽）
- 遵循 **敏捷 / DevOps** 最佳实践

**研发团队 11 个 agent**

| Agent | 职责 | 阶段 |
|---|---|---|
| 🔧 backend_engineer | 后端开发 | 开发 |
| 💻 frontend_engineer | 前端开发 | 开发 |
| 🧠 algorithm_engineer | 算法/ML | 开发 |
| 🧩 comfyui_engineer | ComfyUI | 开发 |
| 🕷️ crawler_engineer | 爬虫 | 开发 |
| 🔄 workflow_engineer | 工作流 | 跨阶段 |
| 🧪 test_engineer | 测试 | 测试 |
| 🖌️ ui_designer | UI/UX | 设计 |
| 🤖 llm_engineer | 大模型 | 开发+评估 |
| 🧩 component_engineer | 组件接入 | 开发 |
| 🛡️ ops_engineer | 运维 | 部署+监控 |

**研发工作流 6 大阶段**

## Phase 1: 需求分析 (Requirements)

**触发**: 用户反馈 / 产品规划 / Bug 报告 / 技术债

**参与 agent**
- 🎩 executive_producer (主持)
- 🎯 market_research (用户画像 + 竞品)
- 📊 data_analyst (数据验证)

**产出**
- 需求文档 (PRD)
- 用户故事 (User Stories)
- 验收标准 (Acceptance Criteria)
- 优先级 (MoSCoW: Must/Should/Could/Won't)

**文档模板**
\`\`\`markdown
# PRD: [功能名]

## 背景
为什么要做？用户的痛点？

## 目标
- 业务目标 (BO)
- 用户目标 (UG)
- 技术目标 (TG)

## 用户故事
作为 [角色]，我希望 [功能]，以便 [价值]

## 验收标准
- [ ] 标准 1
- [ ] 标准 2

## 优先级
Must / Should / Could / Won't

## 风险
- 技术风险
- 依赖风险
\`\`\`

## Phase 2: 设计 (Design)

**参与 agent**
- 🖌️ ui_designer (UI/UX)
- 🔄 workflow_engineer (系统架构)
- 🔧 backend_engineer (API 设计)
- 💻 frontend_engineer (交互设计)
- 🧠 algorithm_engineer (算法设计)

**产出**

**UI 设计**
- Figma 原型
- 设计 token 更新
- 组件规范
- 多端适配方案

**技术设计**
- 架构图 (C4 model)
- 数据模型 (ER 图)
- API 契约 (OpenAPI spec)
- 数据库 schema
- 关键流程图 (sequence diagram)

**技术评审 (Tech Review)**
- 架构合理性
- 性能预估
- 安全考虑
- 可测试性
- 可观测性

## Phase 3: 开发 (Development)

**参与 agent**
- 🔧 backend_engineer
- 💻 frontend_engineer
- 🧠 algorithm_engineer
- 🧩 comfyui_engineer (如涉及)
- 🕷️ crawler_engineer (如涉及)
- 🤖 llm_engineer (如涉及 AI 模型)
- 🧩 component_engineer (如涉及组件集成)

**开发流程**

\`\`\`
1. 拉分支 (feat/功能名)
   ├─ git checkout -b feat/new-feature

2. 小步提交
   ├─ 单一职责的 commit
   ├─ 规范 commit message (Conventional Commits)
   └─ 例: feat(drama): add character consistency lock

3. 编写代码
   ├─ 遵循代码规范
   ├─ 写必要注释
   ├─ 单元测试同时写

4. 本地测试
   ├─ npm test
   ├─ npm run lint
   ├─ 手动验证

5. 提 PR
   ├─ 详细描述改动
   ├─ 关联 issue
   └─ 请求 review
\`\`\`

**代码规范**
- JS/TS: ESLint + Prettier
- Python: Black + Ruff
- Java: Checkstyle
- Go: gofmt + golangci-lint

**Git 分支策略**
- \`main\` - 生产
- \`dev\` - 开发主干
- \`feat/xxx\` - 功能分支
- \`fix/xxx\` - Bug 修复
- \`hotfix/xxx\` - 紧急生产修复

## Phase 4: 测试 (Testing)

**参与 agent**
- 🧪 test_engineer (主力)
- 🛡️ ops_engineer (性能/安全测试)

**测试金字塔**
\`\`\`
         E2E (10%)
       Integration (20%)
      Unit (70%)
\`\`\`

**测试清单**
- [ ] 单元测试（覆盖率 > 70%）
- [ ] 集成测试（API + DB + 外部依赖）
- [ ] E2E 测试（核心用户流程）
- [ ] 性能测试（p95 < 目标）
- [ ] 安全测试（OWASP Top 10）
- [ ] 无障碍测试（A11y）
- [ ] 跨浏览器测试
- [ ] 跨设备测试（响应式）

**Bug 生命周期**
\`\`\`
发现 → 重现 → 提单 → 分配 → 修复 → 验证 → 关闭
\`\`\`

**Bug 严重度**
- P0: 阻塞生产
- P1: 影响核心功能
- P2: 影响次要功能
- P3: 小问题

## Phase 5: 部署 (Deployment)

**参与 agent**
- 🛡️ ops_engineer (主力)
- 🔄 workflow_engineer (CI/CD 配置)

**部署流程**
\`\`\`
1. 合并到 dev 分支
2. 自动 CI (test + lint + build)
3. 自动部署到测试环境
4. QA 验证
5. 合并到 main 分支
6. 自动部署到预发布环境
7. 冒烟测试
8. 灰度发布到生产 (1% → 10% → 50% → 100%)
9. 监控指标
10. 完全切换
\`\`\`

**部署策略**
- **Rolling Update** - 逐个替换
- **Blue-Green** - 新旧并存切换
- **Canary** - 金丝雀小流量
- **Feature Flag** - 功能开关

**回滚预案**
- 保留上一版本镜像
- 一键回滚脚本
- 回滚时间 < 2 分钟

## Phase 6: 监控 + 迭代 (Monitor + Iterate)

**参与 agent**
- 🛡️ ops_engineer (基础设施监控)
- 📊 data_analyst (业务指标)
- 🧪 test_engineer (回归测试)

**监控维度**
- 系统: CPU / 内存 / 磁盘 / 网络
- 应用: RPS / 延迟 / 错误率
- 业务: 活跃用户 / 转化 / 收入
- 外部: LLM API 可用性

**告警渠道**
- Slack / 企业微信 / 钉钉
- PagerDuty (紧急)
- Email (低优先)

**Post-mortem (复盘)**
每次事故后必写：
\`\`\`markdown
# 事故报告: [标题]

## 影响
- 持续时间
- 影响范围
- 业务损失

## 时间线
- T+0 发生
- T+5 发现
- T+15 定位
- T+30 修复
- T+45 验证

## 根本原因
技术原因 + 人为原因 + 流程原因

## 修复
- 立即: xxx
- 短期: xxx
- 长期: xxx

## 行动项
- [ ] 技术改进
- [ ] 流程改进
- [ ] 培训
\`\`\`

## 研发工作流 vs 业务工作流

| 维度 | 研发工作流 | 业务工作流 |
|---|---|---|
| 目标 | 建平台 | 用平台 |
| 产出 | 代码/功能 | 内容（视频/小说等） |
| 团队 | 研发 (11 agent) | 运营 (16 agent) |
| 频率 | 每 sprint | 每次用户使用 |
| KPI | 质量/速度 | 用户满意/成本 |
| 工具 | git / CI / 监控 | dramaService / novelService |
| 周期 | 周-月 | 分钟-小时 |

## 协作接口

两个工作流通过这些接口协作：

**1. API 契约**
研发定义 OpenAPI spec，业务按契约调用

**2. 功能开关 (Feature Flag)**
研发部署新功能但默认关闭，业务灰度开启

**3. KB 共享**
研发团队的能力文档写入 KB，业务 agent 可以查

**4. 项目助理日志**
所有操作通过 \`docs/logs/\` 留痕

**5. Dashboard 可观测**
两个团队共用监控面板，看同一套指标

## 工作流引擎实现

VIDO 未来可以基于 workflow_engineer 建立统一的 workflow 执行器：

\`\`\`js
const workflow = defineWorkflow({
  name: 'generate_drama',
  type: 'business',  // 或 'rd'
  steps: [
    { id: 'research', agent: 'market_research', optional: true },
    { id: 'script', agent: 'screenwriter', depends: [] },
    { id: 'direct', agent: 'director', depends: ['script'] },
    { id: 'character', agent: 'character_consistency', depends: ['script'] },
    { id: 'images', agent: 'comfyui_engineer', depends: ['direct', 'character'] },
    { id: 'videos', agent: 'llm_engineer', depends: ['images'] },  // 视频模型路由
    { id: 'compose', agent: 'editor', depends: ['videos'] },
    { id: 'publish', agent: 'growth_ops', depends: ['compose'], optional: true },
  ],
});

await workflowEngine.run(workflow, { theme: '重生复仇' });
\`\`\``,
    tags: ['研发工作流', 'sdlc', '需求', '设计', '开发', '测试', '部署', '监控'],
    keywords: ['rd workflow', 'sdlc', 'agile', 'devops', 'ci/cd', 'post mortem', 'feature flag', 'canary deployment'],
    prompt_snippets: [
      'R&D workflow: requirements → design → develop → test → deploy → monitor',
      'Git branches: main / dev / feat / fix / hotfix',
      'Testing pyramid: 70% unit / 20% integration / 10% E2E',
      'Deployment: rolling / blue-green / canary / feature flag',
    ],
    applies_to: ['workflow_engineer', 'backend_engineer', 'frontend_engineer', 'test_engineer', 'ops_engineer', 'executive_producer'],
    source: 'Agile / DevOps / Google SRE / VIDO 项目实践综合',
    lang: 'zh',
    enabled: true,
  },

  // ═══════════════════════════════════════════════════
  // v15: 学习方法论 - 经典书籍 + 实操方法
  // ═══════════════════════════════════════════════════
  {
    id: 'kb_learn_deliberate_practice',
    collection: 'engineering',
    subcategory: '学习方法论',
    title: '《刻意练习》Deliberate Practice (Anders Ericsson)',
    summary: '高手不是练得多，而是练得对。5 个核心要素：明确目标、专注执行、即时反馈、走出舒适区、可度量进步。',
    content: `## 核心思想 (Anders Ericsson)
"天才不存在，只有 1 万小时的刻意练习。" 但 1 万小时不是关键，**怎么练**才是关键。

## 5 个核心要素

### 1. 明确目标 (Specific Goal)
- ❌ 错: "我想学会写小说"
- ✅ 对: "本周写 5000 字，能在 3 分钟内勾住读者，每段≤50 字"

### 2. 专注执行 (Focused Effort)
- 单线程，深度工作 90 分钟一个 block
- 关闭通知 / 物理隔离手机
- 不能"听着音乐写代码"——那是低质量练习

### 3. 即时反馈 (Immediate Feedback)
- 写代码 → 单元测试 / linter / code review
- 学外语 → 母语者纠正 / Anki 复习
- 学画画 → 大师作品对比 / 老师当面点评
- **没有反馈的练习是消耗时间，不是学习**

### 4. 走出舒适区 (Stretch Zone)
- 三圈模型: 舒适区 → 学习区 → 恐慌区
- 在学习区呆得最久，恐慌区会瓦解信心，舒适区不进步
- 如何识别学习区: "需要思考但不绝望" 的难度

### 5. 可度量的进步 (Measurable Progress)
- 没度量就没改进 (Drucker)
- 度量要客观、可量化、有对比基准
- 例: 周打字速度 60wpm → 80wpm；写代码从 100 行/h → 150 行/h

## 反例：低效练习
- 重复做已经会的事 (写第 1000 个 CRUD)
- 没有明确目标地"刷题"
- 边看视频边玩手机
- 看完书但从不实操
- **结果：3 年经验 = 1 年经验重复 3 次**`,
    tags: ['学习方法', 'deliberate practice', '刻意练习'],
    keywords: ['deliberate practice', '刻意练习', 'Anders Ericsson', '学习区', 'stretch zone', '反馈'],
    prompt_snippets: [
      'specific goal + focused effort + immediate feedback + stretch zone + measurable progress',
      '三圈模型: 舒适区 → 学习区 → 恐慌区',
    ],
    applies_to: ['project_assistant', 'product_manager', 'project_manager', 'backend_engineer', 'frontend_engineer', 'algorithm_engineer'],
    source: '《Peak》Anders Ericsson · 1993',
    lang: 'zh',
    enabled: true,
  },

  {
    id: 'kb_learn_make_it_stick',
    collection: 'engineering',
    subcategory: '学习方法论',
    title: '《Make It Stick / 如何高效学习》认知科学 11 大原则',
    summary: '基于 10 年认知心理学研究的反直觉学习法：检索式学习 > 重读、间隔练习 > 集中练习、交错学习 > 分块学习。',
    content: `## 反直觉的核心结论
你以为有效的学习方法（重读、划线、集中训练、感觉流畅）其实最差。
真正有效的方法都让你"感觉吃力"，但留得住。

## 11 个核心原则

### 1. 检索练习 (Retrieval Practice) - 最强技巧
- 学完后**合上书自己回忆**，比再读一遍效率高 50%+
- Anki 闪卡就是它的工程化产物
- 每次回忆都在重塑神经连接，重读只是错觉熟悉感

### 2. 间隔重复 (Spaced Repetition)
- 同一内容隔几小时/几天/几周再看，比一次塞满记得更牢
- 遗忘曲线: 1 天 → 3 天 → 7 天 → 21 天 → 60 天

### 3. 交错练习 (Interleaving)
- 学 3 个主题别各练 1 小时再切，而是 ABCABC 来回切
- 感觉更乱、更累，但迁移能力强一倍

### 4. 多样化练习 (Variability)
- 同一概念在不同场景应用
- 例: 学完 "递归" 后，做树遍历 + 回溯 + DP + 文件系统遍历

### 5. 生成式学习 (Generation Effect)
- 先尝试解答再看答案，比直接看答案记得牢
- 哪怕答错也好——错误是学习的载体

### 6. 反思 (Reflection)
- 每天/每周回顾："我学到了什么？哪些没懂？"
- 把新知识连接到旧知识形成网络

### 7. 校准 (Calibration)
- 评估自己的认知和真实水平的差距
- 多数人高估自己 30%——做小测验校准

### 8. 心智模型 (Mental Models)
- 把概念压缩成可视化的模型
- 例: 闭包 = "背包"；事件循环 = "订单系统"

### 9. 不要追求"流畅感"
- 流畅 ≠ 掌握。如果你觉得很容易，多半你没真懂

### 10. 拥抱困难 (Desirable Difficulty)
- 越难记的东西记得越久

### 11. 多渠道编码 (Dual Coding)
- 文字 + 图像 + 动作 + 声音同时编码

## 反例：感觉好但没用的学习
- ❌ 划重点 / 高亮笔记 (没有检索)
- ❌ 反复重读教材
- ❌ 听讲座但不做练习
- ❌ 集中复习 (cramming)`,
    tags: ['学习方法', 'make it stick', '检索练习', '间隔重复', '认知科学'],
    keywords: ['retrieval practice', 'spaced repetition', 'interleaving', 'desirable difficulty', 'Anki'],
    prompt_snippets: [
      'retrieval > rereading',
      'interleave instead of block',
      'spaced repetition: 1d → 3d → 7d → 21d → 60d',
    ],
    applies_to: ['project_assistant', 'product_manager', 'project_manager', 'backend_engineer', 'frontend_engineer', 'algorithm_engineer', 'screenwriter'],
    source: '《Make It Stick》Brown, Roediger, McDaniel · Harvard 2014',
    lang: 'zh',
    enabled: true,
  },

  {
    id: 'kb_learn_feynman_technique',
    collection: 'engineering',
    subcategory: '学习方法论',
    title: '费曼学习法 Feynman Technique',
    summary: '4 步检验你是否真懂：选概念 → 用大白话讲给小学生 → 找出卡壳处 → 回去重学并简化。"如果你不能讲清楚，就是没真懂。"',
    content: `## 4 步法

### Step 1: 选一个概念
写在白纸顶部。例: "什么是闭包?" / "JWT 的工作原理?"

### Step 2: 用大白话讲给一个 10 岁孩子
- 不能用术语
- 不能说 "你只要记住..."
- 必须用比喻、类比、画图
- 例: "闭包就像背包——函数离开它出生的地方时，把周围的变量装进背包带走，以后想用还能掏出来"

### Step 3: 找出卡壳的地方
- 哪里你说不清？哪里需要"行话"才能解释？
- **那就是你没真懂的地方**

### Step 4: 回去重学，再简化
- 翻教材 / 看源码 / 问 AI 直到你能用大白话说清楚
- 反复迭代

## 为什么有效
- 大脑骗自己最常见的方式: "我看过就等于我懂"
- 讲解时大脑必须组织语言、连接概念、暴露漏洞
- 这是一种**最高强度的检索练习**

## 在编程学习中的应用
- 学完一个新框架/库 → 写一篇博客解释它
- 学完一个算法 → 不看代码，画图讲给同事
- 学完一段开源代码 → 逐函数加中文注释

## 实战检验
> "如果连阿姨都听不懂，你就还没懂。" — Feynman`,
    tags: ['学习方法', 'feynman technique', '费曼'],
    keywords: ['feynman technique', '费曼学习法', 'eli5', '检索练习'],
    prompt_snippets: [
      'pick concept → teach to 10-year-old → find gaps → simplify',
      'if you cant explain it simply, you dont understand it',
    ],
    applies_to: ['project_assistant', 'product_manager', 'project_manager', 'backend_engineer', 'frontend_engineer', 'algorithm_engineer'],
    source: 'Richard Feynman · 加州理工',
    lang: 'zh',
    enabled: true,
  },

  {
    id: 'kb_learn_first_principles',
    collection: 'engineering',
    subcategory: '学习方法论',
    title: '第一性原理 First Principles Thinking',
    summary: '不要类比，要拆到底层公理。把一个复杂问题剥到不能再剥的物理/数学/逻辑事实，再从那里重建。',
    content: `## 核心方法
> "把所有事拆解到最基本的真理 (axioms)，然后从这些真理出发重新推导。" — Aristotle / Musk

## 4 步法

### 1. 识别假设
列出对这个问题你"以为对"的所有事

### 2. 拆解到底层
每条假设问 5 次 "为什么"，直到不能再拆
- 火箭贵 → 因为材料贵
- 材料贵 → 因为是航天级合金
- → 因为加工和认证成本
- → 因为供应商垄断 + 一次性使用
- → **为什么不能回收？** (SpaceX 的关键洞察)

### 3. 找到底层公理
不能再拆的物理/数学/逻辑事实
- 例: 火箭的成本下限 = 燃料成本 + 摊销的硬件成本
- 燃料只占总成本 0.3% → 火箭可便宜 100 倍 (硬件复用 100 次)

### 4. 从底层重建解决方案
不参考现有方案，从公理出发设计

## 类比思维 vs 第一性原理
| 类比思维 | 第一性原理 |
|---|---|
| "别人都这么做" | "本质上需要什么" |
| 渐进改良 | 颠覆重建 |
| 90% 时候够用 | 偶尔出现 10x 突破 |

## 编程中的应用
- 学新语言时不死记语法，问"它解决什么问题"
- 调试时不猜，从能确认的事实出发逐步推导
- 设计架构时不复制大厂方案，从业务需求底层倒推

## 警告
- 第一性原理很慢、很烧脑
- 不是每个问题都值得用 (90% 用类比就够)`,
    tags: ['学习方法', 'first principles', '第一性原理'],
    keywords: ['first principles', '第一性原理', 'axioms', 'Musk'],
    prompt_snippets: [
      'identify assumptions → break down to physics → rebuild from axioms',
      '为什么 × 5 直到不能再拆',
    ],
    applies_to: ['project_assistant', 'product_manager', 'project_manager', 'algorithm_engineer', 'backend_engineer', 'executive_producer'],
    source: 'Aristotle · 经 Elon Musk 推广',
    lang: 'zh',
    enabled: true,
  },

  {
    id: 'kb_learn_pareto_mvl',
    collection: 'engineering',
    subcategory: '学习方法论',
    title: '帕累托法则 80/20 与最小可行学习 (MVL)',
    summary: '20% 的核心知识能解决 80% 的实际问题。学新领域时先找到那 20% 然后立刻实战，不要追求全面覆盖。',
    content: `## 80/20 在学习中的体现
- 20% 的语法 / API / 概念覆盖 80% 的实际场景
- JavaScript 1000+ API 中你 95% 时间只用 50 个
- Photoshop 600+ 工具中你只用 20 个
- Linux 命令 5000+ 个但日常用 30 个

## 最小可行学习 (Minimum Viable Learning)
仿 MVP 概念：用最少的学习投入做出**第一个能工作的东西**。

### MVL 4 步流程
1. **定义最小目标**: "今晚做个能登陆的 todo app" (不是"学完 React")
2. **逆向找路径**: 反推需要哪些最少的知识点 (≈ 5-10 个)
3. **跳过所有细节**: 用 ChatGPT / 搜 / 抄即可，不深究
4. **完成后回头补**: 已经有真实问题驱动，学得快 10 倍

## 反例：传统学习陷阱
- ❌ 买本 800 页的 React 教程，从 Chapter 1 读起
- ❌ 看完所有视频教程才敢动手写
- ❌ "等我学完算法再开始刷题"
- ❌ "等我学完英语再开始用英语沟通"
- 结果：3 个月后还在 Chapter 5

## 为什么 MVL 学得更快
1. **真实问题 > 假想知识** —— 大脑只对解决问题的内容上心
2. **反馈环短** —— 立刻知道对错
3. **筛掉冗余** —— 80% 的"必学"内容你其实根本用不到
4. **建立信心** —— 第一个 "Hello World" 跑起来 = 多巴胺

## 应用模板：3 天上手新技术
**Day 1 (3h)**: 看官方 Quick Start，跑通 Hello World
**Day 2 (4h)**: 抄一个完整的小项目教程，理解每行代码
**Day 3 (5h)**: 用学到的写一个**自己的**小项目，遇到问题再查`,
    tags: ['学习方法', '80/20', 'pareto', 'MVL', 'MVP'],
    keywords: ['pareto', '80/20', 'minimum viable learning', 'MVL', 'quick start'],
    prompt_snippets: [
      '20% knowledge solves 80% problems',
      '3 day rule: hello world → tutorial copy → own mini project',
    ],
    applies_to: ['project_assistant', 'product_manager', 'project_manager', 'backend_engineer', 'frontend_engineer', 'algorithm_engineer', 'llm_engineer'],
    source: 'Vilfredo Pareto + MVP (Eric Ries) + Tim Ferriss',
    lang: 'zh',
    enabled: true,
  },

  {
    id: 'kb_learn_path_new_domain',
    collection: 'engineering',
    subcategory: '学习路径',
    title: '快速切入全新领域 · 7 阶段实战路径 (VIDO 定制)',
    summary: '基于刻意练习 + Make It Stick + 费曼 + 第一性原理 + 80/20 综合的 7 阶段路径。从 Day 0 到 Day 30 形成闭环。',
    content: `## 哲学
> "Don't read about it. Build something that uses it." — 学习是结果，不是过程。

## 7 阶段路径

### 阶段 1: 域察 (Day 0, 2 小时)
**目标**: 看清地形，避免一头扎进死路。

1. 找 3 篇该领域 "best of 2024" 综述博客
2. 找 1 个该领域的 awesome-list (github)
3. 找 1 个该领域的"圣经"教材的目录 (只看目录)
4. 列出**这个领域必须懂的 10 个核心概念** + 5 个生态主流方案

**输出**: 一张手写概念地图

### 阶段 2: 锚定 (Day 1, 3 小时)
**目标**: 用 80/20 找到那个 "20% 核心"。

1. 选一个具体的、能 1 天内完成的"最小可行项目"
2. 必须是**能交付一个跑起来的东西**，不是 "学完 X"
3. 例: 学 LangChain → "做一个能调用我电脑文件的 ChatGPT"

**输出**: 1 句话项目 + 验收标准

### 阶段 3: 跑通 (Day 2, 5-8 小时)
**目标**: Hello World → 第一个能工作的版本。

1. 找官方 Quick Start，**严格按照** copy 跑通
2. 不理解的代码标 ❓，**先不深究**
3. 跑通后改 1-2 个参数看变化
4. 把"跑起来"截图发朋友圈 → **多巴胺奖励**

**输出**: working demo + 截图

### 阶段 4: 重写 (Day 3-5, 12 小时)
**目标**: 用第一性原理倒推每个组件**为什么这样设计**。

1. 关闭官方教程
2. 凭记忆从 0 重写一遍 (允许查文档但不允许 copy)
3. 写不出来的地方就是你没真懂的地方 — **用费曼检验**
4. 每个不懂的点写成 1 张卡片 (Anki / Notion)
5. 每天晚上把卡片过一遍 (检索练习)

**输出**: 自己重写的版本 + 30-50 张知识卡片

### 阶段 5: 扩展 (Day 6-15, 25 小时)
**目标**: 在最小项目基础上做 3-5 个变体，巩固迁移能力。

**方法** (交错学习): A 加输入源 / B 换底层依赖 / C 加性能优化 / D 加错误处理 / E 加 UI。
每天切换变体，不要专注 1 个变体到完成。

**输出**: 5 个 git branch + 1 篇博客总结差异

### 阶段 6: 教学 (Day 16-20, 8 小时)
**目标**: 用费曼法验证你真懂了。

1. 写 1 篇博客 / 知乎专栏
2. 录 1 个 10 分钟讲解视频
3. 朋友听不懂的地方 = 你没真懂 → 回阶段 4

**输出**: 1 篇博客 + 1 个视频 + 至少 1 次面对面讲解

### 阶段 7: 实战 (Day 21-30, 30+ 小时)
**目标**: 把这个新技能用到一个**真实的、有用户的**项目中。

1. 找 VIDO 项目里 1 个能用上这个新技能的痛点
2. 用新技能 + 生产数据 + 真实约束实现
3. 部署到生产，看数据反馈

**输出**: 1 个上线的 feature + 数据

## 30 天检查清单
- [ ] Day 1 概念地图 ✓
- [ ] Day 2-5 working demo + 重写版本 ✓
- [ ] Day 6-15 至少 5 个变体 ✓
- [ ] Day 16-20 公开博客 + 1 次讲解 ✓
- [ ] Day 21-30 1 个生产部署 ✓
- [ ] 累计 80-100 小时实操 (~3h/天)
- [ ] 至少 50 张知识卡片
- [ ] 至少 1 次"完全卡住，靠思考解决"的经历

## 防陷阱
- ❌ 教程鸿沟 (Tutorial Hell): 看一个又一个教程，从不动手
- ❌ 工具完美主义: "等我配好开发环境再开始"
- ❌ 假学习: 看视频不暂停不实操
- ❌ 全面贪婪: 想把这个领域所有方向都学
- ❌ 孤独学习: 不公开任何输出

## 引擎: 反馈环必须 < 1 天
学习速度 = 反馈频率 × 反馈质量
"改一次代码 → 5 分钟内看到效果" 的节奏。`,
    tags: ['学习路径', '快速上手', '新领域', 'VIDO 定制', '30 天'],
    keywords: ['learning path', '学习路径', 'fast onboarding', 'new domain', '30 days'],
    prompt_snippets: [
      '7 stages: 域察 → 锚定 → 跑通 → 重写 → 扩展 → 教学 → 实战',
      "Don't read about it. Build something that uses it.",
      '反馈环 < 1 天',
    ],
    applies_to: ['project_assistant', 'product_manager', 'project_manager', 'backend_engineer', 'frontend_engineer', 'algorithm_engineer', 'llm_engineer'],
    source: 'VIDO v15 综合: 刻意练习 + Make It Stick + 费曼 + 第一性原理 + 80/20',
    lang: 'zh',
    enabled: true,
  },
];
