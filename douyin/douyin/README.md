# 音视频创作工作台

一站式短视频内容创作平台：抖音视频解析 -> 文案提取 -> AI 仿写 -> 声音克隆配音。

## 功能特性

### Step 1: 素材获取与解析
- 粘贴抖音分享链接或作者主页链接，自动解析视频信息
- 支持多条链接同时解析（视频链接 + 作者主页混合）
- 支持扫码登录抖音，获取作者全部视频列表（远程访问时通过网页显示二维码截图）
- 按播放量、点赞、评论、时长、发布时间排序筛选
- 多作者视频合并显示，支持按作者过滤
- 批量勾选下载视频，下载后自动加入转录队列
- 视频在线预览播放（优先播放本地已下载文件）
- 本地拖拽上传音视频文件
- 解析历史自动保存到数据库

### Step 2: 文案提取与 AI 引擎
- 基于 Whisper 的语音识别（支持 100+ 语言，带时间戳和标点符号）
- 双栏对比：原始文案 vs AI 生成文案
- 6 种风格预设（爆款口播、专业科普、幽默搞笑、口语带货、情感走心、新闻播报）
- 支持自定义 AI 指令
- AI 仿写保持原文长度（字数差异不超过 10%）
- 后台任务队列，自动转录，分页显示
- 下载视频后自动加入转录队列

### Step 3: 声音克隆与自动配音
- 阿里云 CosyVoice v3.5 Plus 声音克隆（上传参考音频即可复刻声音）
- 上传声音时自动用 Whisper 转写参考文本
- 4 种系统声音（edge-tts：云希、云健、晓晓、晓涵）
- AI 文案自动同步到配音文本
- 语速调节
- 音色库管理（播放、编辑参考文本、注册到云端）

### 素材库
- 按类型分类：下载的视频、文案、配音
- 搜索过滤功能
- 转录任务历史记录
- 配音文件播放、下载、删除
- 文案导出为 SRT 字幕格式

### 音色库
- 声音样本管理（播放、编辑参考文本、删除）
- CosyVoice 云端注册状态显示
- 上传时自动转写参考文本

### 龙虎榜与数据分析
- 视频热度排行（按点赞/评论/收藏/时长）
- 博主排行（视频数、总赞、均赞等）
- Chart.js 数据趋势图表（点赞/评论/收藏增长曲线）
- 关注博主定时自动抓取数据快照
- 手动触发一次抓取 / 启停定时任务
- 每位博主独立开关自动抓取

### UI 特性
- Google Material Design 风格界面
- 左侧边栏导航（可折叠）
- 响应式设计，支持移动端访问
- 远程扫码登录（二维码截图传输）
- 视频下载实时进度条（SSE 推送）

## 技术架构

```
前端: 原生 HTML/CSS/JS（模块化拆分，Google Material 风格）
后端: Node.js + Express 5 + TypeScript
数据库: SQLite (better-sqlite3)
语音识别: faster-whisper (Python)
AI 改写: 智谱 GLM-4.7
配音合成: 阿里云 CosyVoice / edge-tts
声音克隆: 阿里云 CosyVoice v3.5 Plus
视频解析: iesdouyin API（单视频） + Playwright（作者视频列表）
浏览器自动化: Playwright（扫码登录 + 视频列表抓取）
音视频处理: ffmpeg
```

## 系统要求

| 依赖 | 版本 | 说明 |
|------|------|------|
| Node.js | >= 22.0.0 | 运行后端服务 |
| Python | >= 3.9 | 运行 AI 模型和脚本 |
| ffmpeg | >= 4.0 | 音视频处理 |
| Chromium | - | Playwright 自动安装 |

## 快速开始

### macOS 一键安装

```bash
cd douyin
bash scripts/setup-mac.sh
cp .env.example .env  # 编辑填写 API 密钥
npm run dev
```

### Linux Ubuntu 22.04 一键安装

```bash
cd douyin
bash scripts/setup-linux.sh
cp .env.example .env  # 编辑填写 API 密钥
npm run dev
```

安装脚本会自动：
- 检测并安装缺失的系统依赖（Node.js、Python、ffmpeg）
- 安装 Node.js 和 Python 项目依赖
- 安装 Playwright Chromium 浏览器
- 下载 Whisper medium 模型到 `openai/whisper-medium-ct2/`
- 从 `.env.example` 创建 `.env` 文件

### 手动安装

如果一键脚本不适用，可以按以下步骤手动安装。

## 部署指南

### macOS 部署

#### 1. 安装系统依赖

```bash
brew install node@22 python@3.12 ffmpeg
```

#### 2. 安装项目依赖

```bash
cd douyin
npm install
pip3 install -r python/requirements.txt
playwright install chromium
```

#### 3. 配置环境变量

```bash
cp .env.example .env
# 编辑 .env 填写 API 密钥
```

需要的 API 密钥：
- **智谱 AI**（文案改写）：https://open.bigmodel.cn
- **阿里云 DashScope**（声音克隆）：https://dashscope.console.aliyun.com

#### 4. 配置 Whisper 模型

`config.json5` 中使用相对路径，安装脚本会自动下载模型：

```json5
{
  "transcribe": {
    "modelPath": "openai/whisper-medium-ct2",
    "pythonPath": "python3"
  }
}
```

#### 5. 启动服务

```bash
npm run dev        # 开发模式
npm run build && npm run start  # 生产模式
```

访问 http://localhost:3000

---

### Linux Ubuntu 22.04 部署

#### 1. 安装系统依赖

```bash
sudo apt update
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs python3 python3-pip build-essential python3-dev ffmpeg
sudo apt install -y libglib2.0-0 libnss3 libnspr4 libdbus-1-3 libatk1.0-0 \
  libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 libatspi2.0-0 \
  libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libpango-1.0-0 \
  libcairo2 libasound2
```

#### 2. 安装项目依赖

```bash
cd douyin
npm install
pip3 install -r python/requirements.txt
playwright install chromium
```

#### 3. 配置并启动

```bash
cp .env.example .env && vim .env
npm run dev
```

#### 4. systemd 服务（生产环境）

```bash
npm run build

sudo tee /etc/systemd/system/douyin-studio.service << EOF
[Unit]
Description=Audio Video Creator Studio
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$(pwd)
ExecStart=$(which node) dist/index.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable douyin-studio
sudo systemctl start douyin-studio
```

#### 5. Nginx 反向代理（可选）

```nginx
server {
    listen 80;
    server_name your-domain.com;
    client_max_body_size 2048M;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_read_timeout 600s;
    }
}
```

---

## 项目结构

```
douyin/
├── src/                    # TypeScript 后端源码
│   ├── index.ts            # Express 服务入口（.env 加载、TTS 文件管理、任务取消/重试）
│   ├── config.ts           # 配置加载（支持环境变量覆盖、相对路径自动解析）
│   ├── api/                # API 路由
│   │   ├── douyin.ts       # 抖音解析、下载、登录、作者视频、批量下载、解析历史
│   │   ├── tasks.ts        # 转录任务 CRUD
│   │   ├── upload.ts       # 文件上传（中文文件名修复）
│   │   └── voice.ts        # 声音上传（自动转写）、克隆合成、注册云端
│   ├── services/           # 业务逻辑
│   │   ├── ai.ts           # AI 文案改写（6 种风格预设 + 自定义指令）
│   │   ├── audio.ts        # 音频处理（ffmpeg 提取/分割）
│   │   ├── douyin.ts       # 抖音视频信息解析（iesdouyin 直链下载）
│   │   ├── transcribe.ts   # Whisper 语音识别
│   │   ├── tts.ts          # edge-tts 配音（stdin 传文本）
│   │   ├── voice-clone.ts  # CosyVoice 声音注册 + 合成
│   │   ├── scheduler.ts    # 定时抓取博主视频数据
│   │   └── worker.ts       # 后台转录任务队列（事务化插入）
│   └── db/                 # 数据库
│       ├── index.ts        # SQLite 初始化
│       ├── schema.ts       # 表结构（tasks、segments、voices、douyin_videos）
│       ├── migrations.ts   # 版本化数据库迁移（自动升级字段）
│       └── helpers.ts      # 数据库操作共享函数（视频批量入库）
├── python/                 # Python 脚本
│   ├── transcribe.py       # faster-whisper 转录（中文标点、语言强制）
│   ├── tts.py              # edge-tts 配音（stdin 输入）
│   ├── cosyvoice.py        # 阿里云 CosyVoice 声音注册 + 合成
│   ├── douyin_login.py     # Playwright 扫码登录（二维码截图）
│   ├── douyin_videos.py    # Playwright 拦截 API 获取作者视频列表
│   └── requirements.txt    # Python 依赖
├── public/                 # 前端
│   ├── index.html          # HTML 结构
│   ├── css/style.css       # 样式表
│   └── js/app.js           # 应用逻辑（SRT 导出、Chart.js 图表等）
├── openai/                 # Whisper 本地模型
├── data/                   # 运行时数据（自动创建）
│   ├── transcriber.db      # SQLite 数据库
│   ├── uploads/            # 上传和下载的文件
│   └── douyin_cookies.txt  # 抖音登录 cookies
├── scripts/                # 安装脚本
│   ├── setup-mac.sh        # macOS 一键安装（自动检测依赖、下载模型）
│   └── setup-linux.sh      # Ubuntu 一键安装
├── config.json5            # 服务配置（使用相对路径）
├── .env                    # 环境变量（API 密钥，不提交 git）
├── .env.example            # 环境变量模板
├── .gitignore
├── package.json
└── tsconfig.json
```

## API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| **上传与任务** | | |
| POST | /api/upload | 上传音视频文件 |
| GET | /api/tasks | 获取任务列表 |
| GET | /api/tasks/:id/result | 获取转录结果（带时间戳） |
| POST | /api/tasks/:id/cancel | 取消任务 |
| POST | /api/tasks/:id/retry | 重试任务 |
| DELETE | /api/tasks/:id | 删除任务 |
| **抖音相关** | | |
| POST | /api/douyin/parse | 解析分享链接（自动保存历史） |
| POST | /api/douyin/download | 下载视频（iesdouyin 直链） |
| POST | /api/douyin/transcribe-local | 转录已下载的视频 |
| POST | /api/douyin/add-task | 加入转录队列 |
| POST | /api/douyin/author-videos | 获取作者全部视频（Playwright） |
| POST | /api/douyin/batch-download | 批量下载视频 |
| POST | /api/douyin/login | 启动扫码登录 |
| GET | /api/douyin/login-status | 检查登录状态 |
| GET | /api/douyin/login-qrcode | 获取二维码截图（远程扫码） |
| GET | /api/douyin/cookie-status | 检查 cookies 有效性 |
| GET | /api/douyin/download-progress/:id | SSE 下载进度推送 |
| GET | /api/douyin/history | 获取解析历史 |
| GET | /api/douyin/styles | 获取 AI 风格预设列表 |
| POST | /api/douyin/rewrite | AI 文案改写 |
| POST | /api/douyin/tts | 系统声音配音 |
| **声音克隆** | | |
| GET | /api/voices | 获取音色列表 |
| POST | /api/voices/upload | 上传声音样本（自动转写参考文本） |
| POST | /api/voices/synthesize | 声音克隆合成 |
| POST | /api/voices/:id/enroll | 注册声音到 CosyVoice 云端 |
| PUT | /api/voices/:id/ref-text | 更新参考文本 |
| DELETE | /api/voices/:id | 删除声音 |
| **配音文件** | | |
| GET | /api/tts-files | 获取配音文件列表 |
| DELETE | /api/tts-files/:name | 删除配音文件（文件名安全校验） |
| **配置** | | |
| GET | /api/config/model | 获取当前 Whisper 模型 |
| POST | /api/config/model | 切换模型 |
| **博主管理** | | |
| GET | /api/douyin/bloggers | 获取关注的博主列表 |
| POST | /api/douyin/follow | 关注博主 |
| DELETE | /api/douyin/follow/:id | 取消关注 |
| PUT | /api/douyin/bloggers/:id/auto-fetch | 切换博主自动抓取 |
| **定时抓取** | | |
| POST | /api/douyin/scheduler/start | 启动定时抓取 |
| POST | /api/douyin/scheduler/stop | 停止定时抓取 |
| GET | /api/douyin/scheduler/status | 查询定时抓取状态 |
| POST | /api/douyin/scheduler/fetch-now | 手动触发一次抓取 |
| **龙虎榜** | | |
| GET | /api/douyin/ranking/videos | 视频热度排行 |
| GET | /api/douyin/ranking/bloggers | 博主排行 |
| GET | /api/douyin/ranking/snapshots | 数据快照趋势 |

## 跨设备部署注意事项

### 路径处理
- `config.json5` 中的 `modelPath` 使用**相对路径**（如 `openai/whisper-medium-ct2`），程序会自动转为绝对路径
- 不要在配置文件中写死绝对路径（如 `/Users/xxx/...`），否则迁移到其他设备会失败
- 数据库中的文件路径是绝对路径，从其他设备拷贝数据库后需要清理旧任务或更新路径

### 从其他设备迁移

```bash
# 1. 运行安装脚本
bash scripts/setup-mac.sh   # 或 setup-linux.sh

# 2. 清理旧数据库（可选）
rm data/transcriber.db

# 3. 确认 API 密钥
cat .env

# 4. 启动服务
npm run dev
```

### Whisper 模型
- 安装脚本会自动下载 medium 模型到 `openai/whisper-medium-ct2/`
- 如果已有模型文件，脚本会跳过下载
- GPU 服务器可手动下载 large-v3 模型获得更好效果

## 常见问题

### Whisper 转录很慢？
- CPU 上 medium 模型处理 5 分钟音频约需 3-5 分钟
- 切换到 small 模型可加速 2-3 倍
- Linux 上有 NVIDIA GPU 可用 CUDA 加速

### 抖音视频解析失败？
- 单个视频解析不需要登录（通过 iesdouyin）
- 获取作者全部视频需要先扫码登录
- Cookies 有效期约 24 小时，过期需重新登录
- 远程访问时扫码：点击"登录抖音"按钮，页面会弹出二维码截图

### AI 仿写太慢或超时？
- 长文案（>1000 字）AI 生成需要 30-60 秒
- 超时设置为 3 分钟
- 原始文案中的时间戳会自动去掉再发给 AI，减少 token 消耗

### 声音克隆效果不好？
- 参考音频建议 5-30 秒清晰人声
- 上传时自动转写参考文本（也可手动编辑）
- 使用阿里云 CosyVoice Plus 模型效果最佳

### Python SSL 证书错误？
```bash
pip3 install certifi
export SSL_CERT_FILE=$(python3 -c "import certifi;print(certifi.where())")
```

### Linux 上 Playwright 报错？
```bash
sudo npx playwright install-deps chromium
```

### 视频播放加载慢？
- 已下载的视频会优先播放本地文件（秒加载）
- 未下载的视频通过抖音直链播放（需要网络）

## 更新日志

### v0.1.0 (2026-04-03)
- 初始版本
- 三步工作流：素材获取 -> 文案提取 -> 声音克隆配音
- 抖音视频解析（iesdouyin 免登录单视频 + Playwright 登录获取作者全部视频）
- Whisper 语音识别（中文标点、时间戳）
- 智谱 GLM-4.7 文案改写（6 种风格预设）
- 阿里云 CosyVoice 声音克隆（替代 F5-TTS）
- edge-tts 系统声音配音
- Google Material Design 风格 UI
- 响应式设计（移动端适配）
- 远程扫码登录（二维码截图传输）
- 侧边栏导航（工作台/素材库/音色库）
- 批量下载 + 自动加入转录队列
- 安全优化（API Key 环境变量、路径遍历防护、文件名校验）
- 一键安装脚本（macOS / Ubuntu）
- 跨设备部署支持（相对路径配置）

### v0.2.0 (2026-04-04)
- **博主关注系统**：关注/取关博主，素材库"博主"Tab 管理
- **加载博主**：登录栏下拉快速加载已关注博主的视频
- **龙虎榜**：视频热度排行（按点赞/评论/收藏/时长）、博主排行、数据快照趋势分析
- **数据快照**：每次解析/获取视频自动记录点赞、评论、收藏等数据，支持增长分析
- **下载记录 Tab**：素材库新增下载记录，展示已下载视频
- **解析记录优化**：封面图点击大图预览、获取全部视频时自动保存解析记录
- **扫码登录优化**：二维码裁剪显示、每 2 秒自动刷新、Cookie 检测必须有 sessionid
- **任务搜索**：Step 2 任务列表新增搜索框
- **页码跳转**：输入页码直接跳转，不用逐页翻
- **视频播放优化**：优先播放本地文件、关闭按钮、全屏支持
- **多作者支持**：多条链接同时解析、按作者筛选、作者标识
- **AI 仿写优化**：自动去除时间戳、3 分钟超时、明确等待提示
- **代码质量**：清除所有 CommonJS require()、统一 ES module 导入
- **移动端适配**：龙虎榜、音色库、登录弹窗等全部响应式

### v0.3.0 (2026-04-04)
- **前端模块化拆分**：index.html 拆分为 `css/style.css` + `js/app.js`，HTML 从 1756 行精简至 ~250 行
- **数据库迁移系统**：版本化迁移脚本 `migrations.ts`，启动自动执行，支持字段升级
- **Chart.js 数据趋势图表**：龙虎榜数据快照区域可视化折线图（点赞/评论/收藏增长曲线）
- **定时自动抓取**：关注博主支持定时自动抓取视频数据，可按博主独立开关
- **视频下载进度条**：流式下载 + SSE 实时推送，显示百分比和 MB 大小
- **字幕导出**：任务列表和文案面板均支持一键导出 SRT 字幕文件
- 自动解析时间戳格式，无时间戳时按句子智能分段

### v0.4.0 (2026-04-04)
- **Toast 提示系统**：全局替换 alert() 为非阻塞 Toast 通知（成功/错误/警告/信息），2-5 秒自动消失
- **ESC 关闭弹窗**：全局 ESC 键关闭二维码弹窗和图片预览
- **智能轮询**：任务列表 hash 变化检测，无变化不重绘 DOM，减少性能开销
- **批量下载总进度**：顶部进度条 + 预计剩余时间（"3/15 完成，预计还需 2 分钟"）
- **软删除+撤销**：任务删除先从 UI 移除，5 秒内可点"撤销"恢复
- **提取失败重试**：文案提取失败时直接显示"重试"按钮
- **合成覆盖确认**：已有合成结果时再次合成弹出确认
- **配音历史**：合成区域显示最近 3 条合成记录，可播放/下载
- **Shift+Click 范围选择**：视频列表支持 Shift 多选
- **网络错误区分**：区分网络断开 / 登录过期 / 服务器错误，给出针对性提示
- **龙虎榜表头排序**：视频和博主排行表格均支持点击列名排序（↑↓ 箭头切换）
- **图片预览增强**：左右箭头切换、键盘←→导航、滚轮缩放、底部页码计数
- **文案字数统计**：原始文案和 AI 文案下方实时显示字数，>1000 字橙色预警
- **键盘翻页**：工作台页面左右箭头键快速翻页
- **排序栏始终显示**：有视频数据时始终显示排序栏，筛选无结果时提示
- **作者筛选标识**：选中博主后显示"当前: 博主名"蓝色标签
- **登录成功提示**：Toast 提示 + cookie 栏闪绿反馈
- **博主下拉占位**：未关注博主时显示占位提示，不再隐藏
- **移动端按钮折叠**：768px 以下视频卡片按钮收进"..."菜单
- **移动端双栏切换**：窄屏下原始文案/AI 文案切换按钮
- **合成 loading 区分**：系统声音"约 10-30 秒" vs 克隆"可能 3-5 分钟"
- **封面悬停大图**：桌面端鼠标悬停缩略图显示 240×320 大图
- **checkbox 放大**：视频勾选框 20px + accent-color
- **自动抓取反馈**：toggle 后 toast 提示"已开启/已关闭"
- **相对时间**：博主关注/上次抓取显示为"3 小时前""2 天前"
- **作者卡片统计**：显示该作者已加载视频数和总赞数
- **操作反馈**：所有删除/取关/注册/切换操作均有 toast 反馈
- **字幕按钮命名**：SRT → 字幕，更易理解

### v0.4.1 (2026-04-04)
- **博主加载修复**：scheduler 接口失败不再阻塞博主列表渲染，错误隔离
- **桌面端按钮重复修复**：移动端折叠菜单按钮在桌面端不再显示
- **EventSource 内存泄漏修复**：页面切换时自动清理所有下载进度监听
- **登录轮询泄漏修复**：网络失败 5 次自动停止轮询，关闭弹窗清理 interval
- **任务轮询优化**：页面不可见时暂停 3 秒轮询，可见时恢复
- **XSS 防护加固**：所有 onclick 中的动态 ID 添加 esc() 转义
- **撤销功能修复**：多次快速删除时每个任务独立追踪，不互相覆盖
- **声音上传校验**：名称必填，空名称时提示
- **模型切换 loading**：防止重复点击，显示"切换中..."
- **视频标题溢出修复**：长英文 URL 标题不再撑破移动端布局
- **搜索空结果优化**：区分"暂无任务"和"未找到匹配任务"
- **AI 指令长度限制**：自定义指令输入框 maxlength=500
- **DB 代码重构**：视频入库逻辑提取到 `db/helpers.ts` 共享
- **CSS 合并**：两个重复的 768px 媒体查询合并为一个
- **QR 弹窗修复**：去掉重复的 `display:none` 内联样式

### v0.4.2 (2026-04-04)
- **数据修复**：视频描述字段入库时错误地写入了标题，已修正为 `description||title`
- **复制功能升级**：优先使用 Clipboard API（`navigator.clipboard.writeText`），不支持时回退 `execCommand`
- **EventSource 错误清理**：SSE 连接出错时也从追踪数组移除，防止泄漏
- **下载记录错误处理**：区分目录不存在（正常）和其他异常（打日志），不再静默吞掉错误
- **小屏布局修复**：textarea 添加 `max-width:100%`，320px 手机不再横向溢出

### v0.4.3 (2026-04-04)
- **博主加载修复**：旧开发进程占用端口导致新代码不生效，修复部署流程
- **龙虎榜博主头像修复**：SQL `LEFT JOIN bloggers` 表补充头像，解决前 3 名无头像问题
- **视频热度榜分页**：每页 20 条，底部翻页器
- **数据趋势图表分页**：每页 5 个视频趋势卡片，翻页只渲染当前页图表
- **解析记录分页**：素材库解析记录每页 10 条，底部翻页器
- **下载记录分页**：素材库下载记录每页 10 条，底部翻页器
- **作者卡片头像补全**：无头像时自动从已关注博主表获取
- **解析历史不再限制 50 条**：移除 API LIMIT，前端分页展示全部

### v0.4.4 (2026-04-06)
- **Toast 修复**：CSS 动画 bug 导致 toast 闪一下就消失，去掉初始 `toastOut` 动画
- **博主快捷入口**：登录栏旁显示已关注博主头像+名字 chips，点击直接加载视频，超过 5 个显示"更多"
- **龙虎榜博主排行置顶**：👑 博主排行移到 🔥 视频热度榜上方
- **任务列表显示日期**：每个任务前显示创建日期（如 2026/4/4）
- **获取视频错误提示优化**：Playwright 缺失时给出安装命令提示
- **部署用户修复**：从 root 切回 cykj 用户运行项目，修复 dist 目录权限问题
- **语速参数修复**：系统声音（edge-tts `--rate`）和克隆声音（CosyVoice `speech_rate`）语速滑块真正生效
- **转录超时保护**：Whisper Python 进程添加 10 分钟超时，防止卡死
- **Schema 补全**：`bloggers` 表初始建表加上 `auto_fetch_enabled`、`last_fetched_at` 字段
- **自动抓取智能化**：勾选自动抓取自动启动 scheduler；cookie 过期自动停止并记录原因；登录成功/服务器重启自动恢复
- **素材库悬停大图**：解析和下载记录的封面支持鼠标悬停显示大图
- **CSS 选择器修复**：`.vc-thumb-wrap` 去掉 `.video-card` 父级限定，素材库封面悬停生效
- **登录检查**：启动定时抓取、勾选自动抓取前检查抖音登录状态，未登录时提示
- **自动抓取行高亮**：已开启自动抓取的博主行显示蓝色背景
- **素材库 Tab 文案精简**：解析记录 → 解析，下载记录 → 下载

## 自动抓取机制

### 业务流程

```
用户勾选"自动抓取" ──→ 检查登录状态
                         ├── 未登录 → 提示"请先登录抖音"，恢复 checkbox
                         └── 已登录 → 设置 auto_fetch_enabled=1
                                       ├── 行底色变蓝
                                       └── 自动启动 scheduler（每小时）
                                             │
                                             ├── 每60分钟执行 fetchAllBloggers()
                                             │     ├── 遍历 auto_fetch_enabled=1 的博主
                                             │     ├── 调用 python/douyin_videos.py 抓取
                                             │     ├── saveVideosToDB() 保存视频+快照
                                             │     └── 更新 last_fetched_at
                                             │
                                             ├── Cookie 过期 → 自动停止，记录原因
                                             │                    └── 用户重新登录
                                             │                          └── 自动恢复
                                             │
                                             └── 服务器重启 → 自动检测并恢复
```

### 自动停止的 3 种情况

| 触发条件 | 停止原因 |
|---------|---------|
| cookie 文件不存在 | "cookie 文件不存在，请重新登录抖音" |
| Python 返回 `cookies_expired` | "抖音登录已过期，请重新登录" |
| 所有博主全部抓取失败 | "全部抓取失败，可能是登录已过期" |

停止后前端博主页面的状态栏变红底，显示具体原因。

### 自动恢复的 3 个触发点

| 时机 | 代码位置 | 条件 |
|------|---------|------|
| 服务器启动 | `index.ts` → `autoResumeScheduler()` | cookie 有效 + 有 `auto_fetch_enabled=1` 的博主 |
| 用户扫码登录成功 | `douyin.ts` → `login-status` 接口 | cookie age < 10s + 有自动抓取博主 |
| 前端检查登录状态 | `douyin.ts` → `cookie-status` 接口 | cookie 有效 + scheduler 未运行 + 有自动抓取博主 |

### 相关代码文件

| 文件 | 职责 |
|------|------|
| `src/services/scheduler.ts` | 核心：`startScheduler`、`stopScheduler`、`fetchAllBloggers`、`getStopReason` |
| `src/api/douyin.ts` | API 端点：`/scheduler/start`、`/stop`、`/status`；登录时自动恢复逻辑 |
| `src/index.ts` | 服务器启动时 `autoResumeScheduler()` 自动恢复 |
| `src/db/helpers.ts` | `saveVideosToDB()` 视频批量入库共享函数 |
| `public/js/app.js` | 前端：`toggleAutoFetch`、`toggleScheduler`、`loadBloggers`、`checkDouyinLogin` |

### 防护机制

- **重复启动防护**：`startScheduler` 内 `if (intervalId) return` 防止重复创建定时器
- **并发抓取防护**：`fetchAllBloggers` 内 `if (isRunning) return` 防止上一次未完成时重复执行
- **登录前置检查**：勾选自动抓取和手动启动前均检查 cookie 状态
- **过期自动停止**：3 种检测机制确保 cookie 失效后及时停止无效抓取

## 部署注意

服务器上应使用 `cykj` 用户编译和运行项目（不要用 root），因为 Playwright、Python 依赖等都装在 cykj 用户下：

```bash
# SSH 登录后切换用户
su - cykj

# 编译并启动
cd /Users/cykj/Downloads/douyin
npm run build
nohup node dist/index.js > /tmp/douyin.log 2>&1 &
```

如果 rsync 以 root 同步了文件，需要先修复权限：
```bash
chown -R cykj:staff /Users/cykj/Downloads/douyin/
```

## 待优化项

- [ ] 多用户支持（登录系统）
