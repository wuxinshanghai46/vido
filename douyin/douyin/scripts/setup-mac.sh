#!/bin/bash
# macOS 一键安装脚本
set -e

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"

echo "========== 音视频创作工作台 - macOS 安装 =========="
echo "项目目录: $PROJECT_DIR"
echo ""

# 1. Homebrew
if ! command -v brew &>/dev/null; then
    echo "[1/7] 安装 Homebrew..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
else
    echo "[1/7] Homebrew 已安装 ✓"
fi

# 2. Node.js
if ! command -v node &>/dev/null; then
    echo "[2/7] 安装 Node.js..."
    brew install node@22
elif [[ $(node -v | cut -d. -f1 | tr -d 'v') -lt 22 ]]; then
    echo "[2/7] Node.js 版本过低 ($(node -v))，升级中..."
    brew install node@22
else
    echo "[2/7] Node.js $(node -v) ✓"
fi

# 3. Python3
if ! command -v python3 &>/dev/null; then
    echo "[3/7] 安装 Python3..."
    brew install python@3.12
else
    echo "[3/7] Python $(python3 --version) ✓"
fi

# 4. ffmpeg
if ! command -v ffmpeg &>/dev/null; then
    echo "[4/7] 安装 ffmpeg..."
    brew install ffmpeg
else
    echo "[4/7] ffmpeg $(ffmpeg -version 2>&1 | head -1 | awk '{print $3}') ✓"
fi

# 5. Node.js 依赖
echo "[5/7] 安装 Node.js 依赖..."
npm install

# 6. Python 依赖
echo "[6/7] 安装 Python 依赖..."
pip3 install -r python/requirements.txt
playwright install chromium

# 7. Whisper 模型
MODEL_DIR="$PROJECT_DIR/openai/whisper-medium-ct2"
if [ -d "$MODEL_DIR" ] && [ -f "$MODEL_DIR/model.bin" ]; then
    echo "[7/7] Whisper medium 模型已存在 ✓"
else
    echo "[7/7] 下载 Whisper medium 模型（首次约 1.5GB）..."
    mkdir -p "$PROJECT_DIR/openai"
    python3 -c "
from faster_whisper import WhisperModel
import shutil, os
model = WhisperModel('medium', device='cpu', compute_type='int8')
print('Model downloaded to cache')
# 复制到项目目录
import glob
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
    else
        echo ""
        echo "⚠️  请创建 .env 文件："
        echo "    cp .env.example .env && vim .env"
    fi
else
    echo ""
    echo ".env 已存在 ✓"
fi

echo ""
echo "========== 安装完成 =========="
echo "启动服务: cd $PROJECT_DIR && npm run dev"
echo "访问地址: http://localhost:3000"
