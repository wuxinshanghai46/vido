# 微众 MaaS 接入合同

> 更新：2026-08-24。以供应商《一站式 AI 模型服务平台-接入文档（海外 maas）》为接口权威；密钥只能保存在本地/生产受保护配置中，不得写入本文档或 Git。

## 基础配置

- MaaS Base URL：`https://test-tk.iserviceapi.com/api/v1`
- Seedance/素材库 API Root：`https://test-tk.iserviceapi.com/api`
- 鉴权：`Authorization: Bearer ${WEBANG_MAAS_API_KEY}`
- 模型权限：以 `GET /v1/models` 对当前 Key 的返回为准；未在白名单的模型会返回 HTTP 403。

## 模型清单与启用状态

| 类别 | 模型 ID | 接口 | 项目状态 |
|---|---|---|---|
| OpenAI 文本 | `gpt-5.6-sol` | `POST /v1/chat/completions` / `POST /v1/responses` | 已登记 |
| OpenAI 文本 | `gpt-5.6-terra` | 同上 | 已登记 |
| OpenAI 文本 | `gpt-5.6-luna` | 同上 | 已登记 |
| OpenAI 图片 | `gpt-image-2` | `POST /v1/images/generations` / `POST /v1/images/edits` | 已接入 |
| Anthropic 文本 | `claude-opus-5` | `POST /v1/chat/completions` / `POST /v1/messages` | 供应商支持，商务待签约，默认禁用 |
| Google 文本 | `gemini-3.5-flash` | `POST /v1/chat/completions` | 供应商新增；生产启用前必须用 `GET /v1/models` 确认 Key 白名单 |
| Google 图片 | `gemini-2.5-flash-image` | `POST /v1/chat/completions` | 已登记（Nano Banana） |
| Google 图片 | `gemini-3.0-pro-image-preview` | `POST /v1/chat/completions` | 已登记 |
| Google 图片 | `gemini-3.1-flash-image-preview` | `POST /v1/chat/completions` | 已登记（Nano Banana 2 Lite） |
| 视频 | `doubao-seedance-2-0-260128` | `POST /v1/videos/generations` | 已接入 |
| 视频 | `doubao-seedance-2-0-fast-260128` | 同上 | 已接入，不支持 1080p |

`gemini-3.5-flash` 是本次供应商新增通知中的名称，当前 PDF 版本的模型表尚未列出它。项目可登记该 ID，但不得在 `GET /v1/models` 确认前让付费任务选中它。

## GPT Image 2 合同

### 文生图

`POST /v1/images/generations` 使用 JSON。项目发送 `model`、`prompt`、`n`、`size`、`quality`；还可按业务需要传 `background`、`output_format`、`output_compression`、`moderation`、`stream`、`partial_images` 和 `user`。

- `prompt` 最长 32,000 字符。
- `n` 范围 1–10。
- `size`：`1024x1024` / `1536x1024` / `1024x1536` / `auto` 或最大 3840x2160 的自定义尺寸。
- `quality`：`low` / `medium` / `high` / `auto`。
- 非流式响应图片在 `data[].b64_json`，用量在 `usage`。

### 图生图

`POST /v1/images/edits` 必须使用 `multipart/form-data`。

- `model=gpt-image-2`
- `prompt`
- 每张原图使用字段 `image[]`，只接受 PNG/JPG/WebP 文件，不接受图片 URL 或 Base64。
- 单图小于 10MB，最多 6 张。
- 可选 `mask` 必须是同尺寸 PNG，小于 4MB。
- 可选 `size`、`quality`、`background`、`output_format`、`output_compression`、`input_fidelity`。
- 响应同文生图：`data[].b64_json` + `usage`。

## Gemini 图片合同

Gemini/Nano Banana 不得走 OpenAI Images 端点，统一使用 `POST /v1/chat/completions`。

- 文生图：`model`、`messages`、`image_config.aspect_ratio`，可选 `image_config.image_size`、`temperature`、`top_p`、`top_k`、`stream`。
- 图生图：`messages[].content` 为数组，文字用 `{type:"text"}`，参考图用 `{type:"image_url", image_url:{url}}`；URL 可为公网 URL 或 data URL。
- 输出图片位于 `choices[0].message.images[].image_url.url`，通常是 Base64 data URI；`content` 可能为空，不得从 `content` 取图。

## Seedance 2.0 与素材库

- 创建：`POST /v1/videos/generations`；查询/列表/删除使用同路径及任务 ID。
- `content` 支持 `text`、`image_url`、`video_url`、`audio_url`。图片 0–9、视频 0–3、音频 0–3；音频必须与图片或视频共用。
- `duration` 4–15 或 `-1`；分辨率 480p/720p/1080p；画幅 16:9、4:3、1:1、3:4、9:16、21:9、adaptive。
- 任务状态：`queued` / `running` / `succeeded` / `failed` / `cancelled` / `expired`。每 10–20 秒轮询，终态立即停止。
- 人像参考必须先入素材库，等待 `Active`，然后用 `asset://<ASSET_ID>` 引用。跨用户引用返回 403。
- 创建素材组 `POST /v1/assets/groups`，上传素材 `POST /v1/assets`；素材是异步处理，每 5 秒查询至 `Active` / `Failed`。
- 视频下载 URL 24 小时有效，任务记录 7 天；素材 URL 12 小时有效。

## 错误与计费

- 网关内部错误使用 `{"error":{"message","type","code"}}`；上游错误原样透传。
- 常见状态：400 参数错误，401 鉴权错误，403 模型无权限/配额不足/内容或版权拦截，429 限流，5xx 上游或网关错误。
- 素材库上游可能 HTTP 200 但响应含 `Error`，客户端必须同时检查 HTTP 状态和 `Error`。
- 默认超时 300 秒。鉴权/配额/参数/上游错误/超时不计费；429 应指数退避。

## 供应商折扣记录

| 系列 | 结算系数 | 状态 |
|---|---:|---|
| Gemini / Nano Banana | 0.82 | 已签约；以实际账单为准 |
| GPT / GPT Image 2 | 0.65 | 已签约；以实际账单为准 |
| Seedance 2.0 | 1.03 | 原价基础 +3% |
| Claude | 0.89 | 尚未签约，不得启用生产付费路由 |
| xAI / Grok | — | 尚未接入 |

折扣只用于财务估算和对账，不是前端用户生成的价格上限，不得再用它阻断已获用户确认的正常生成。
