const https = require('https');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const DEST_ZIP = path.join(process.env.USERPROFILE, 'ffmpeg2.zip');
const DEST_DIR = path.join(process.env.USERPROFILE, 'ffmpeg');

// FFmpeg Windows essentials build
const URL = 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip';

function download(url, dest, redirectCount = 0) {
  if (redirectCount > 5) throw new Error('Too many redirects');
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    let downloaded = 0;
    https.get(url, { headers: { 'User-Agent': 'Node.js' } }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        file.close();
        fs.unlinkSync(dest);
        return download(res.headers.location, dest, redirectCount + 1).then(resolve).catch(reject);
      }
      const total = parseInt(res.headers['content-length'] || '0');
      res.on('data', chunk => {
        downloaded += chunk.length;
        if (total) process.stdout.write(`\r下载中... ${(downloaded / 1024 / 1024).toFixed(1)}MB / ${(total / 1024 / 1024).toFixed(1)}MB (${Math.floor(downloaded/total*100)}%)`);
      });
      res.pipe(file);
      file.on('finish', () => { file.close(); console.log('\n下载完成'); resolve(); });
    }).on('error', reject);
  });
}

async function main() {
  console.log('下载 FFmpeg for Windows...');
  console.log('目标:', DEST_ZIP);
  await download(URL, DEST_ZIP);

  console.log('解压中...');
  fs.mkdirSync(DEST_DIR, { recursive: true });

  // 用 PowerShell 解压（Windows 内置）
  execSync(`powershell -Command "Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::ExtractToDirectory('${DEST_ZIP}', '${DEST_DIR}')"`, { stdio: 'inherit' });

  // 找 ffmpeg.exe
  function findExe(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { const r = findExe(full); if (r) return r; }
      if (entry.name === 'ffmpeg.exe') return path.dirname(full);
    }
  }

  const binDir = findExe(DEST_DIR);
  if (!binDir) { console.error('找不到 ffmpeg.exe'); process.exit(1); }

  console.log('FFmpeg 路径:', binDir);
  console.log('\n自动写入 .env ...');

  const envPath = path.join(__dirname, '.env');
  let envContent = fs.readFileSync(envPath, 'utf8');
  envContent = envContent.replace(/^FFMPEG_PATH=.*$/m, `FFMPEG_PATH=${path.join(binDir, 'ffmpeg.exe').replace(/\\/g, '\\\\')}`);
  fs.writeFileSync(envPath, envContent);

  console.log('完成！FFmpeg 已配置到 .env');
  console.log('现在可以运行: npm start');
}

main().catch(err => { console.error('错误:', err.message); process.exit(1); });
