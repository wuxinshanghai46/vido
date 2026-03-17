/**
 * 社交媒体发布服务
 * 支持：微视(Weishi)、抖音(Douyin)、小红书(Xiaohongshu)、快手(Kuaishou)
 */
const fs = require('fs');
const path = require('path');
const axios = require('axios');

// 平台配置（仅保留小红书）
const PLATFORMS = {
  xiaohongshu: {
    name: '小红书',
    icon: 'xiaohongshu',
    color: '#FE2C55',
    authUrl: 'https://open.xiaohongshu.com/oauth/authorize',
    tokenUrl: 'https://open.xiaohongshu.com/oauth/token',
    uploadUrl: 'https://open.xiaohongshu.com/api/media/upload',
    publishUrl: 'https://open.xiaohongshu.com/api/note/publish',
    scopes: 'note.publish,media.upload',
    maxTitleLen: 20,
    maxDescLen: 1000,
    maxTags: 10
  }
};

// 社交账号文件路径
const ACCOUNTS_PATH = path.join(__dirname, '../../outputs/social_accounts.json');

function loadAccounts() {
  try {
    if (fs.existsSync(ACCOUNTS_PATH)) return JSON.parse(fs.readFileSync(ACCOUNTS_PATH, 'utf8'));
  } catch {}
  return [];
}

function saveAccounts(accounts) {
  fs.mkdirSync(path.dirname(ACCOUNTS_PATH), { recursive: true });
  fs.writeFileSync(ACCOUNTS_PATH, JSON.stringify(accounts, null, 2), 'utf8');
}

function getAccountsByUser(userId) {
  return loadAccounts().filter(a => a.user_id === userId);
}

function getAccount(userId, platform) {
  return loadAccounts().find(a => a.user_id === userId && a.platform === platform) || null;
}

function upsertAccount(userId, platform, data) {
  const accounts = loadAccounts();
  const idx = accounts.findIndex(a => a.user_id === userId && a.platform === platform);
  const record = {
    user_id: userId,
    platform,
    nickname: data.nickname || '',
    avatar_url: data.avatar_url || '',
    open_id: data.open_id || '',
    access_token: data.access_token || '',
    refresh_token: data.refresh_token || '',
    expires_at: data.expires_at || '',
    connected_at: new Date().toISOString()
  };
  if (idx >= 0) {
    accounts[idx] = { ...accounts[idx], ...record };
  } else {
    accounts.push(record);
  }
  saveAccounts(accounts);
  return record;
}

function removeAccount(userId, platform) {
  const accounts = loadAccounts();
  const filtered = accounts.filter(a => !(a.user_id === userId && a.platform === platform));
  saveAccounts(filtered);
}

/**
 * 用 AI 生成平台专属发布文案
 */
async function generateCopywriting(projectData, platform) {
  const platformInfo = PLATFORMS[platform];
  if (!platformInfo) throw new Error('未知平台: ' + platform);

  const storyService = require('./storyService');

  // 构建项目内容摘要
  let contentSummary = `视频标题：${projectData.title || '未命名'}`;
  if (projectData.theme) contentSummary += `\n主题：${projectData.theme}`;
  if (projectData.genre) contentSummary += `\n类型：${projectData.genre}`;
  if (projectData.story) {
    const story = typeof projectData.story === 'string' ? projectData.story : JSON.stringify(projectData.story);
    // 取前500字作为内容摘要
    contentSummary += `\n剧情内容：${story.substring(0, 500)}`;
  }

  const systemPrompt = `你是小红书平台的内容运营专家。请为以下视频生成小红书平台的发布笔记文案。
要求：
- 标题控制在${platformInfo.maxTitleLen}字以内，要有种草感和好奇心
- 正文控制在${platformInfo.maxDescLen}字以内，用分享种草的口吻
- 生成${platformInfo.maxTags}个小红书热门标签（带#号）
- 小红书用户偏好真实分享、干货推荐、审美类内容
- 多用emoji表情，营造亲切的社区氛围
- 适当分段，增加可读性`;
  const userPrompt = `请为以下视频内容生成发布文案：

${contentSummary}

请严格按以下 JSON 格式返回（不要添加任何其他内容）：
{
  "title": "视频标题",
  "description": "正文内容",
  "tags": ["#标签1", "#标签2", "#标签3"]
}`;

  try {
    const result = await storyService.callLLM(systemPrompt, userPrompt);
    // 提取 JSON
    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return { title: projectData.title || '', description: result, tags: [] };
  } catch (err) {
    console.error('生成文案失败:', err.message);
    // 降级：使用项目基本信息生成简单文案
    return {
      title: (projectData.title || '').substring(0, platformInfo.maxTitleLen),
      description: `${projectData.title || ''} ${projectData.theme || ''}`,
      tags: ['#AI视频', '#创意视频']
    };
  }
}

/**
 * 发布视频到指定平台（模拟/真实）
 * 由于各平台 Open API 需要企业资质申请，此处提供完整的接口框架
 * 实际对接时替换 _simulatePublish 为真实 API 调用
 */
async function publishVideo(userId, projectId, platform, copywriting) {
  const db = require('../models/database');
  const project = db.getProject(projectId);
  if (!project) throw new Error('项目不存在');
  if (project.status !== 'done') throw new Error('项目尚未完成，无法发布');

  const account = getAccount(userId, platform);
  if (!account || !account.access_token) throw new Error(`未绑定${PLATFORMS[platform]?.name || platform}账号`);

  const videoPath = project.finalVideo?.file_path || path.join(__dirname, '../../outputs/projects', projectId + '_final.mp4');
  if (!fs.existsSync(videoPath)) throw new Error('视频文件不存在');

  // 记录发布任务
  const record = {
    id: require('uuid').v4(),
    user_id: userId,
    project_id: projectId,
    platform,
    title: copywriting.title || '',
    description: copywriting.description || '',
    tags: copywriting.tags || [],
    status: 'publishing',
    created_at: new Date().toISOString()
  };
  db.insertPublication(record);

  try {
    // 调用平台 API 发布
    const result = await _platformPublish(platform, account, videoPath, copywriting);
    db.updatePublication(record.id, {
      status: 'published',
      platform_post_id: result.post_id || '',
      platform_url: result.url || '',
      published_at: new Date().toISOString()
    });
    return { ...record, status: 'published', platform_url: result.url };
  } catch (err) {
    db.updatePublication(record.id, { status: 'failed', error: err.message });
    throw err;
  }
}

/**
 * 平台发布分发
 */
async function _platformPublish(platform, account, videoPath, copywriting) {
  if (platform !== 'xiaohongshu') throw new Error('暂不支持该平台');
  return await _publishXiaohongshu(account, videoPath, copywriting);
}

// ─── 小红书发布 ───
async function _publishXiaohongshu(account, videoPath, copywriting) {
  const cfg = PLATFORMS.xiaohongshu;
  try {
    const stat = fs.statSync(videoPath);
    // Step 1: 获取上传凭证
    const tokenRes = await axios.post(cfg.uploadUrl, {
      file_type: 'video',
      file_size: stat.size
    }, {
      headers: { 'Authorization': `Bearer ${account.access_token}`, 'Content-Type': 'application/json' }
    });

    // Step 2: 上传视频
    if (tokenRes.data?.data?.upload_url) {
      await axios.put(tokenRes.data.data.upload_url, fs.createReadStream(videoPath), {
        headers: { 'Content-Type': 'video/mp4', 'Content-Length': stat.size },
        maxContentLength: Infinity, maxBodyLength: Infinity
      });

      // Step 3: 发布笔记
      const publishRes = await axios.post(cfg.publishUrl, {
        title: copywriting.title,
        desc: copywriting.description,
        video_id: tokenRes.data.data.video_id,
        tags: (copywriting.tags || []).map(t => t.replace('#', ''))
      }, {
        headers: { 'Authorization': `Bearer ${account.access_token}`, 'Content-Type': 'application/json' }
      });
      return { post_id: publishRes.data?.data?.note_id || '', url: publishRes.data?.data?.url || '' };
    }
    throw new Error('获取上传凭证失败');
  } catch (err) {
    if (err.response?.status === 401) throw new Error('小红书授权已过期，请重新登录');
    throw new Error('小红书发布失败: ' + (err.response?.data?.message || err.message));
  }
}

module.exports = {
  PLATFORMS,
  loadAccounts,
  getAccountsByUser,
  getAccount,
  upsertAccount,
  removeAccount,
  generateCopywriting,
  publishVideo
};
