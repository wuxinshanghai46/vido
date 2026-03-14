# VIDO AI 视频生成平台

## 自动启动
每次对话开始时，**必须立即**在后台启动开发服务器（如果尚未运行）：
```
node src/server.js
```
端口：3007。启动后告知用户服务器已就绪，并附上访问地址 http://localhost:3007

## 项目说明
- 后端：Express.js，入口 src/server.js，端口 3007
- 数据库：JSON 文件（outputs/vido_db.json）
- 前端：原生 JS（public/）
