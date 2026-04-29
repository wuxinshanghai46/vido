#!/bin/bash
# Ubuntu 22.04 一键安装脚本
set -e

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"

echo "========== 音视频创作工作台 - Linux 安装 =========="
echo "项目目录: $PROJECT_DIR"
echo ""

# 1. 系统更新
echo "[1/8] 更新系统..."
sudo apt update -y

# 2. Node.js
if ! command -v node &>/dev/null; then
    echo "[2/8] 安装 Node.js 22..."
    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
    sudo apt install -y nodejs
elif [[ $(node -v | cut -d. -f1 | tr -d 'v') -lt 22 ]]; then
    echo "[2/8] Node.js 版本过低 ($(node -v))，升级中..."
    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
    sudo apt install -y nodejs
else
    echo "[2/8] Node.js $(node -v) ✓"
fi

# 3. Python3
if ! command -v python3 &>/dev/null; then
    echo "[3/8] 安装 Python3..."
    sudo apt install -y python3 python3-pip python3-venv
else
    echo "[3/8] Python $(python3 --version) ✓"
fi

# 4. 构建工具 + ffmpeg
echo "[4/8] 安装构建工具和 ffmpeg..."
sudo apt install -y build-essential python3-dev ffmpeg

# 5. Playwright 系统依赖
echo "[5/8] 安装 Playwright 系统依赖..."
sudo apt install -y libglib2.0-0 libnss3 libnspr4 libdbus-1-3 libatk1.0-0 \
    libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 libatspi2.0-0 \
    libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libpango-1.0-0 \
    libcairo2 libasound2 2>/dev/null || true

# 6. Node.js 依赖
echo "[6/8] 安装 Node.js 依赖..."
npm install

# 7. Python 依赖
echo "[7/8] 安装 Python 依赖..."
pip3 install -r python/requirements.txt
playwright install chromium

# 8. Whisper 模型
MODEL_DIR="$PROJECT_DIR/openai/whisper-medium-ct2"
if [ -d "$MODEL_DIR" ] && [ -f "$MODEL_DIR/model.bin" ]; then
    echo "[8/8] Whisper medium 模型已存在 ✓"
else
    echo "[8/8] 下载 Whisper medium 模型（首次约 1.5GB）..."
    mkdir -p "$PROJECT_DIR/openai"
    python3 -c "
from faster_whisper import WhisperModel
import shutil, os, glob
model = WhisperModel('medium', device='cpu', compute_type='int8')
print('Model downloaded to cache')
cache = glob.glob(os.path.expanduser('~/.cache/huggingface/hub/models--Systran--faster-whisper-medium/snapshots/*/'))
if cache:
    dst = '$MODEL_DIR'
    if os.path.exists(dst): shutil.rmtree(dst)
    shutil.copytree(cache[0], dst)
    print(f'Copied to {dst}')
"
fi

# 创建数据目录
mkdir -p data/uploads

# 检查 .env
if [ ! -f .env ]; then
    if [ -f .env.example ]; then
        cp .env.example .env
        echo ""
        echo "⚠️  已从 .env.example 创建 .env，请编辑填写 API 密钥："
        echo "    vim $PROJECT_DIR/.env"
    fi
else
    echo ""
    echo ".env 已存在 ✓"
fi

echo ""
echo "========== 安装完成 =========="
echo ""
echo "启动方式:"
echo "  开发模式: cd $PROJECT_DIR && npm run dev"
echo "  生产模式: cd $PROJECT_DIR && npm run build && npm run start"
echo ""
echo "访问地址: http://localhost:3000"
