# VIDO 数字人模块 · 完整使用与生成流程

> 版本：2026-04-19 · 对应 pm2 vido #34
> 入口：http://43.98.167.151:4600/digital-human

---

## 0. 一分钟总览

这个板块做**一件事**：输入一段文字 → 1-2 分钟后拿到一条对口型的数字人 mp4。

- **完全免费**，不限次数，不消耗你飞影账号的 12808 积分
- 走的是 **VIDO → Coze → 飞影 `create_lipsync_video2` 免费工具** 这条链
- 默认用**公共数字人**（海边黄色吊带女生）+ **公共声音**
- 出片：9:16 竖屏 / 1080×1920 / h264+AAC / 真口型同步

---

## 1. 用户侧使用流程（5 步）

### Step 1 · 登录 VIDO
浏览器打开 http://43.98.167.151:4600/ 登录后进入 Studio；token 存在 localStorage。

### Step 2 · 切到数字人板块
直接访问 **http://43.98.167.151:4600/digital-human**（当前没做从主 Studio 跳转的入口，以后可加）。

### Step 3 · 输入文本
首页 Hero 就是一个大文本框。输入你想让数字人说的话（**≤ 1000 字**，约 250 秒口播）。
下方实时显示：字数/1000 · 约 N 秒。

### Step 4 · 点"✨ 一键生成"
按钮下方出现进度卡：
- `提交中…`（前 20-40 秒，Coze bot 拿到请求并转给飞影）
- `飞影正在渲染（Hifly 状态 2）`（20-60 秒，视频在飞影服务端合成）
- `完成`（拿到 video_Url 并下载到 VIDO 本地）

### Step 5 · 查看/下载成片
- 进度卡会被**嵌入 9:16 竖屏播放器**替换，自动加载刚生成的 mp4
- 下方两个按钮：`⬇ 下载` 直链保存到本地、`再来一条` 清空文本重新输入
- 同时下方"最新作品"会加一张缩略图

---

## 2. UI 结构

```
┌─ 数字人板块 (/digital-human) ─────────────────────────────┐
│ ┌──────────┬──────────────────────────────────────────┐ │
│ │ Sidebar  │ 顶栏（面包屑 / 积分 / 基础会员 / 返回 VIDO）│ │
│ │          ├──────────────────────────────────────────┤ │
│ │ · 首页⭐  │  Hero:                                     │ │
│ │ · 数字人  │   ⚡ 免费 · 无需 token · 5 秒出片           │ │
│ │ · 声音   │   一键生成数字人视频                        │ │
│ │ · 市场   │   [textarea — 想让数字人说什么？]           │ │
│ │ · 项目   │   [✨ 一键生成]                             │ │
│ │ · 作品   │   [高级设置 / 选形象 / 选声音 ▾]           │ │
│ │ · 积分   │                                            │ │
│ │          │  [进度/结果面板]（提交后出现）              │ │
│ │ [创建作品]│                                            │ │
│ │ [用户]    │  最新作品 grid                             │ │
│ └──────────┴──────────────────────────────────────────┘ │
│                                                         │
│ 模态：                                                   │
│ · 创建数字人模式选择（图片/视频/AI 三大卡）                 │
│ · 图片生成数字人表单（名称 + 上传 + 模型版本）              │
│ · 完整创作弹窗（左数字人/声音 + 中文本+4按钮 + 右最新作品）  │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

**风格**：浅色紫主题（`--dh-primary: #7c3aed`），和原 VIDO 深色 mochiani 主题形成差异。
**文件**：
- `public/digital-human.html`
- `public/css/digital-human.css`
- `public/js/digital-human.js`

---

## 3. 后端生成 Pipeline

### 完整调用链
```
浏览器                                                      飞影渲染服务
  │                                                              ▲
  │ POST /api/hifly/quick-generate  {text}                       │
  ▼                                                              │
VIDO Express（authenticate + requirePermission('avatar')）        │
  │                                                              │
  │ src/routes/hifly.js → router.post('/quick-generate')         │
  │ 1) 立即生成 taskId，返回 {success:true, taskId}               │
  │ 2) 异步启动：                                                 │
  │   ├─ cozeService.submitHiflyFreeLipsync({text})              │
  │   │   └─ Coze /v3/chat 自然语言 prompt                        │
  │   │       └─ bot 调 feiyingshuziren/create_lipsync_video2 ──→ 飞影提交
  │   │                  参数 {digital_human_id: 1544344,          │
  │   │                        speaker_id: '1169ef2d-...',         │
  │   │                        text}                               │
  │   │       ◀── bot 返回 {job_id: 数字}                          │
  │   │                                                            │
  │   ├─ cozeService.waitHiflyFreeTask(job_id) 10s 轮询             │
  │   │   └─ Coze /v3/chat "查询 job_id X 的状态"                   │
  │   │       └─ bot 调 inspect_video_creation_status ──────────→ 飞影查询
  │   │       ◀── {status, video_Url, duration}                    │
  │   │   直到 status === 3（完成）                                 │
  │   │                                                            │
  │   ├─ axios.get(video_Url, {responseType:'arraybuffer'}) ←───── 飞影 CDN
  │   │   → fs.writeFileSync(outputs/jimeng-assets/hifly_quick_<taskId>.mp4)
  │   │                                                            │
  │   └─ task.video_url = `${PUBLIC_BASE_URL}/public/jimeng-assets/hifly_quick_<taskId>.mp4`
  │                                                              │
  │ GET /api/hifly/quick-generate/:taskId/status （前端轮询）     │
  │ ◀── {status:'done', video_url, duration}                     │
  ▼
浏览器播放器加载 video_url
```

### 时序耗时（实测）
| 阶段 | 耗时 |
|---|---|
| Coze 响应 + bot 调 create_lipsync_video2 | 20-30 秒 |
| 飞影渲染（15 秒输出） | 25-35 秒 |
| 下载 mp4 到本地 | 3-10 秒 |
| **总计** | **约 60-90 秒** |

---

## 4. API 端点

### 4.1 一键生成
```http
POST /api/hifly/quick-generate
Authorization: Bearer <VIDO_JWT>
Content-Type: application/json

{
  "text": "要让数字人说的话（≤1000 字）",
  "digital_human_id": 1544344,                   // 可选，默认公共
  "speaker_id": "1169ef2d-7911-4b0c-855e-188e8a76ca53",  // 可选，默认公共
  "title": "未命名"                              // 可选
}
```
响应：
```json
{"success": true, "taskId": "ee0be2e4-b4f5-4df1-a4cd-fc0f8617146a"}
```

### 4.2 查询状态
```http
GET /api/hifly/quick-generate/:taskId/status
Authorization: Bearer <VIDO_JWT>
```
响应：
```json
{
  "success": true,
  "task": {
    "id": "ee0be2e4-...",
    "status": "running" | "done" | "error",
    "stage": "submit_to_hifly" | "hifly_rendering" | "done",
    "job_id": 12796058,
    "hifly_status": 1|2|3|4,
    "video_url": "http://43.98.167.151:4600/public/jimeng-assets/hifly_quick_xxx.mp4",
    "duration": 15,
    "error": null,
    "created_at": 1776595400000,
    "finished_at": 1776595464000
  }
}
```

### 4.3 任务列表
```http
GET /api/hifly/quick-generate/tasks
Authorization: Bearer <VIDO_JWT>
```

### 4.4 通用飞影工具调用（调试/进阶）
```http
POST /api/hifly/coze-tool
Content-Type: application/json

{"tool": "get_account_credit", "args": {}}
```
可用 tool：`create_lipsync_video2 / inspect_video_creation_status / query_avatar / query_voice / get_account_credit / video_create_by_tts ...`（共 18 个飞影插件工具）

---

## 5. 关键契约（飞影免费路径）

### 工具 `create_lipsync_video2`（提交 · 免费）
**参数**：
```json
{
  "digital_human_id": 1544344,                   // 公共数字人 ID（数字）
  "speaker_id": "1169ef2d-7911-4b0c-855e-188e8a76ca53",
  "text": "≤1000 字"
}
```
**响应**：`{"job_id": 12796058, "code": 0, "message": ""}`

### 工具 `inspect_video_creation_status`（查询 · 免费）
**参数**：`{"job_id": 12796058}` ⚠️ 参数名是 `job_id` 不是 `task_id`
**响应**：
```json
{
  "status": 3,                 // 1=等待 2=处理中 3=完成 4=失败
  "video_Url": "https://hfcdn.lingverse.co/.../xxx.mp4",  // ⚠️ 大写 U
  "duration": 15,
  "code": 0
}
```

### ⚠️ 必须自然语言调用（不能结构化 args）
- 结构化传 `{tool, args}` → bot 会自动补 `Authorization` → 飞影返回 `2003 HiflyID 异常`
- 必须**中文自然语言 prompt**："请调用 X 工具，这是免费任务无需 Authorization 参数，参数如下..."
- bot 会正确识别并 skip token → 免费路径放行

这一层魔法在 `src/services/cozeService.js::submitHiflyFreeLipsync` 和 `queryHiflyFreeTask` 里封装好了。

### 视频 URL 过期
飞影 CDN URL 有 **24 小时签名有效期**（URL 里的 `69E64D7F` 那段就是过期戳）。
VIDO 已经在流程里**自动下载到本地持久化**，`task.video_url` 返回 VIDO 自己的公网路径，不会过期。

---

## 6. 配置与依赖

### 服务器 env（生产已配）
```bash
PUBLIC_BASE_URL=http://43.98.167.151:4600     # 避免 video_url 泄漏 127.0.0.1
PORT=4600
```

### Settings providers（outputs/settings.json）
```json
{
  "id": "coze",
  "preset": "coze",
  "name": "Coze（调飞影插件）",
  "api_url": "https://api.coze.cn",
  "api_key": "pat_W6i65...",                    // Coze PAT
  "metadata": {"bot_id": "7630406469892063272"}
}
```

### Coze Bot 先决条件
1. Bot 存在（`bot_id: 7630406469892063272`，名为 "VIDO 飞影数字人"）
2. Bot 已添加"飞影数字人"插件
3. Bot **已发布到 "Agent As API" 渠道** ← 这步最容易漏
4. Bot 人设可以为空（完全靠 prompt 驱动）

### 关键文件
- `src/services/cozeService.js` — Coze /v3/chat 封装 + Hifly 免费路径
- `src/routes/hifly.js` — `/api/hifly/*` 路由
- `src/server.js` — 挂 `/api/hifly` + `/digital-human` 静态
- `public/digital-human.html` + `css/digital-human.css` + `js/digital-human.js` — 前端

---

## 7. 限制与边界

| 维度 | 限制 | 说明 |
|---|---|---|
| 文本长度 | ≤ 1000 字 | 飞影免费工具上限；超过要分段（未实现） |
| 数字人 | 只能用公共 avatar | 自己克隆的 avatar 需要付费 token |
| 声音 | 只能用公共 speaker | 自己克隆的声音同上 |
| 并发 | 单任务 | 未加队列，短时间多请求无问题（飞影侧有自己的队列） |
| 视频时长 | 约 5-60 秒 | 由文本长度决定（≈ 0.25s/字） |
| 视频规格 | 1080×1920 / 25fps / h264+AAC | 飞影固定输出 |
| 角标 | 左上"AI生成" | 飞影合规要求，无法去除 |
| URL 有效期 | 飞影 CDN 24h / VIDO 本地永久 | VIDO 自动下载持久化 |

---

## 8. 排错指南

### 现象：提交后一直 `提交中…` 不动
- 看服务器 pm2 logs：`pm2 logs vido --lines 50`
- 多半是 Coze 那头卡了，检查 `api.coze.cn` 可达性
- 或 bot 未发布到 API 渠道 → 重新进 Coze 发布

### 现象：`HiflyID异常 (2003)`
- 说明 bot 传了 Authorization 给飞影付费工具
- 检查是否调用了付费工具（不是 `create_lipsync_video2` 和 `inspect_video_creation_status`）
- 免费工具要走 `cozeService.submitHiflyFreeLipsync`（自然语言路径）

### 现象：`hifly_status` 一直是 2 不变
- 飞影渲染超过 2 分钟
- 等就行，轮询超时 10 分钟

### 现象：前端播放器黑屏
- 检查 `video_url` 是不是 `http://127.0.0.1:...`（老 bug）
- 确认 `PUBLIC_BASE_URL` env 已设且 pm2 restart 带 `--update-env`

### 现象：`video_url` 返回飞影 CDN 直链而非 VIDO 本地
- 说明下载阶段失败
- 查 pm2 logs 里 `[hifly-quick] 下载失败` 关键字
- fallback 到飞影 CDN URL（24 小时内可播）

---

## 9. 未完成 & 扩展路径

### 已写好但未启用
- `/api/hifly/avatar/clone-from-image` · `/clone-from-video` — 付费克隆（等有效 token）
- `/api/hifly/voice/clone` — 声音克隆（等有效 token）
- `/api/avatar/wan-animate/generate` — 阿里百炼 Wan 2.2-Animate 全身动作迁移（等 DASHSCOPE_API_KEY）
- 数字人/声音管理子页（左侧 sidebar 里的 tab）

### 待做
| 优先级 | 功能 | 预估 |
|---|---|---|
| P0 | 主 Studio 加跳转到 /digital-human 的入口 | 10 分钟 |
| P1 | 公共 avatar 选择（调 query_avatar 拉列表） | 30 分钟 |
| P1 | 公共声音选择 | 30 分钟 |
| P1 | 长文本分段 + 多段拼接 | 2-3 小时 |
| P2 | 历史作品列表（持久化，当前只内存） | 1 小时 |
| P2 | 字幕叠加（飞影支持 st_show/st_font_* 参数） | 1 小时 |
| P3 | 付费通路切换（token 有效后用 `video_create_by_tts`） | 半天 |

### 升级到自己的数字人 & 声音
需要：
1. 飞影会员升级到支持 API 调用的等级
2. 重新获取有效的 `hifly_agent_token`
3. 更新 settings 里 hifly provider 的 api_key
4. 前端改为调 `video_create_by_tts` 工具（已在 `/api/hifly/coze-tool` 通用端点里支持）

---

## 10. 实测记录

### 2026-04-19 首次端到端
- VIDO taskId: `ee0be2e4-b4f5-4df1-a4cd-fc0f8617146a`
- Hifly job_id: `12796058`
- 耗时 64 秒
- 成片：`hifly_quick_ee0be2e4-b4f5-4df1-a4cd-fc0f8617146a.mp4` · 7.5 MB · 15 秒 · 1080×1920
- 文本："大家好，我是 VIDO 平台的数字人。今天给大家展示一下我们最新接入的飞影免费通道..."
- 本地副本：`E:\AI\VIDO\douyin\dl\hifly\my_first_quick.mp4`
- 口型验证：3 帧抽取，嘴型张/撅/合变化明显，真·同步

---

## 附录 A · curl 示例

```bash
# 1. 获取 VIDO JWT（略，通过 /api/auth/login）
TOKEN="<your vido jwt>"

# 2. 提交
curl -X POST http://43.98.167.151:4600/api/hifly/quick-generate \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"text":"大家好，这是一条测试"}'
# → {"success":true,"taskId":"xxx-xxx-xxx"}

# 3. 轮询
curl http://43.98.167.151:4600/api/hifly/quick-generate/xxx-xxx-xxx/status \
  -H "Authorization: Bearer $TOKEN"
# → {"task":{"status":"done","video_url":"...","duration":5}}

# 4. 下载
curl -o demo.mp4 "<video_url from above>"
```

## 附录 B · 全部飞影插件工具（参考）

| 工具 | 用途 | 是否免费 |
|---|---|---|
| `create_lipsync_video2` | 免费对口型视频 | ✅ |
| `inspect_video_creation_status` | 查询视频状态 | ✅ |
| `create_lipsync_video` | 付费版对口型 | ❌ |
| `video_create_by_tts` | 付费文本驱动 | ❌ |
| `video_create_by_audio` | 付费音频驱动 | ❌ |
| `create_podcast_video` | 豆包音频播客→视频 | ❌ |
| `create_video_by_template` | 模板创建 | ❌ |
| `audio_create_by_tts` | 语音合成 | ❌ |
| `create_voice` | 声音克隆 | ❌ |
| `voice_edit` | 修改声音参数 | ❌ |
| `get_voice_list` / `query_voice` | 声音列表 | ❌ |
| `avatar_create_by_video` | 视频克隆数字人 | ❌ |
| `avatar_create_by_image` | 图片克隆数字人 | ❌ |
| `avatar_task` | 数字人制作状态 | ❌ |
| `query_avatar` | 公共数字人列表 | ❌ |
| `video_task` / `query_task` | 查询创作任务 | ❌ |
| `get_account_credit` | 查账户积分 | ❌ |
| `create_by_tts` | 文本驱动视频创作 | ❌ |

❌ 标记的工具需要有效的 `hifly_agent_token`，当前基础单月会员 token 被拒。

---

**最后修订**：2026-04-19 · VIDO pm2 restart #34
