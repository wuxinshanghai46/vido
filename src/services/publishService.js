/**
 * 社交媒体发布服务
 * 支持：微视(Weishi)、抖音(Douyin)、小红书(Xiaohongshu)、快手(Kuaishou)
 */
const fs = require('fs');
const path = require('path');
const axios = require('axios');

// 平台配置
const PLATFORMS = {
  weishi: {
    name: '微视',
    icon: 'weishi',
    color: '#FF4081',
    authUrl: 'https://open.weishi.qq.com/oauth2/authorize',
    tokenUrl: 'https://open.weishi.qq.com/oauth2/access_token',
    uploadUrl: 'https://open.weishi.qq.com/video/upload',
    publishUrl: 'https://open.weishi.qq.com/video/publish',
    scopes: 'video_upload,video_publish',
    maxTitleLen: 30,
    maxDescLen: 1000,
    maxTags: 5
  },
  douyin: {
    name: '抖音',
    icon: 'douyin',
    color: '#000000',
    authUrl: 'https://open.douyin.com/platform/oauth/connect',
    tokenUrl: 'https://open.douyin.com/oauth/access_token',
    uploadUrl: 'https://open.douyin.com/api/v2/video/upload',
    publishUrl: 'https://open.douyin.com/api/v2/video/create',
    scopes: 'video.create,video.data',
    maxTitleLen: 55,
    maxDescLen: 2000,
    maxTags: 10
  },
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
  },
  kuaishou: {
    name: '快手',
    icon: 'kuaishou',
    color: '#FF6600',
    authUrl: 'https://open.kuaishou.com/oauth2/authorize',
    tokenUrl: 'https://open.kuaishou.com/oauth2/access_token',
    uploadUrl: 'https://open.kuaishou.com/openapi/photo/upload',
    publishUrl: 'https://open.kuaishou.com/openapi/photo/publish',
    scopes: 'user_info,video_publish',
    maxTitleLen: 30,
    maxDescLen: 500,
    maxTags: 5
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

  const platformPrompts = {
    weishi: `你是微视平台的内容运营专家。请为以下视频生成微视平台的发布文案。
要求：
- 标题控制在${platformInfo.maxTitleLen}字以内，简洁有力
- 正文控制在${platformInfo.maxDescLen}字以内，注重娱乐性和传播性
- 生成${platformInfo.maxTags}个热门话题标签（带#号）
- 微视用户偏好短视频、搞笑、生活、技能展示类内容
- 加入合适的表情符号增强互动感`,

    douyin: `你是抖音平台的内容运营专家。请为以下视频生成抖音平台的发布文案。
要求：
- 标题控制在${platformInfo.maxTitleLen}字以内，要有话题引爆力
- 正文控制在${platformInfo.maxDescLen}字以内，注重热点话题和互动引导
- 生成${platformInfo.maxTags}个抖音热门话题标签（带#号）
- 抖音用户偏好节奏快、有视觉冲击力的内容
- 结尾加上互动引导语如"你觉得呢？"、"关注看更多"等
- 加入合适的表情符号`,

    xiaohongshu: `你是小红书平台的内容运营专家。请为以下视频生成小红书平台的发布笔记文案。
要求：
- 标题控制在${platformInfo.maxTitleLen}字以内，要有种草感和好奇心
- 正文控制在${platformInfo.maxDescLen}字以内，用分享种草的口吻
- 生成${platformInfo.maxTags}个小红书热门标签（带#号）
- 小红书用户偏好真实分享、干货推荐、审美类内容
- 多用emoji表情，营造亲切的社区氛围
- 适当分段，增加可读性`,

    kuaishou: `你是快手平台的内容运营专家。请为以下视频生成快手平台的发布文案。
要求：
- 标题控制在${platformInfo.maxTitleLen}字以内，接地气、易传播
- 正文控制在${platformInfo.maxDescLen}字以内，注重真实感和亲和力
- 生成${platformInfo.maxTags}个快手热门标签（带#号）
- 快手用户偏好真实、接地气、有才艺、生活化的内容
- 语言风格要朴实自然，不要太"营销感"`
  };

  const systemPrompt = platformPrompts[platform] || platformPrompts.douyin;
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
  const cfg = PLATFORMS[platform];
  if (!cfg) throw new Error('不支持的平台');

  // 真实 API 调用框架
  switch (platform) {
    case 'douyin':
      return await _publishDouyin(account, videoPath, copywriting);
    case 'xiaohongshu':
      return await _publishXiaohongshu(account, videoPath, copywriting);
    case 'kuaishou':
      return await _publishKuaishou(account, videoPath, copywriting);
    case 'weishi':
      return await _publishWeishi(account, videoPath, copywriting);
    default:
      throw new Error('暂不支持该平台');
  }
}

// ─── 抖音发布 ───
async function _publishDouyin(account, videoPath, copywriting) {
  const cfg = PLATFORMS.douyin;
  try {
    // Step 1: 上传视频
    const fileStream = fs.createReadStream(videoPath);
    const stat = fs.statSync(videoPath);

    const uploadRes = await axios.post(cfg.uploadUrl, fileStream, {
      headers: {
        'access-token': account.access_token,
        'Content-Type': 'video/mp4',
        'Content-Length': stat.size
      },
      maxContentLength: Infinity,
      maxBodyLength: Infinity
    });

    if (uploadRes.data?.data?.video?.video_id) {
      // Step 2: 创建视频
      const createRes = await axios.post(cfg.publishUrl, {
        video_id: uploadRes.data.data.video.video_id,
        text: `${copywriting.title}\n${copywriting.description}\n${(copywriting.tags || []).join(' ')}`
      }, {
        headers: { 'access-token': account.access_token, 'Content-Type': 'application/json' }
      });
      return { post_id: createRes.data?.data?.item_id || '', url: '' };
    }
    throw new Error(uploadRes.data?.data?.description || '上传失败');
  } catch (err) {
    if (err.response?.status === 401) throw new Error('抖音授权已过期，请重新登录');
    throw new Error('抖音发布失败: ' + (err.response?.data?.data?.description || err.message));
  }
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

// ─── 快手发布 ───
async function _publishKuaishou(account, videoPath, copywriting) {
  const cfg = PLATFORMS.kuaishou;
  try {
    const stat = fs.statSync(videoPath);
    const fileStream = fs.createReadStream(videoPath);

    // Step 1: 上传视频
    const uploadRes = await axios.post(cfg.uploadUrl, fileStream, {
      headers: {
        'access-token': account.access_token,
        'Content-Type': 'video/mp4'
      },
      maxContentLength: Infinity, maxBodyLength: Infinity
    });

    if (uploadRes.data?.result === 1 && uploadRes.data?.photo_id) {
      // Step 2: 发布
      const publishRes = await axios.post(cfg.publishUrl, {
        photo_id: uploadRes.data.photo_id,
        caption: `${copywriting.title}\n${copywriting.description}\n${(copywriting.tags || []).join(' ')}`
      }, {
        headers: { 'access-token': account.access_token, 'Content-Type': 'application/json' }
      });
      return { post_id: publishRes.data?.photo_id || '', url: '' };
    }
    throw new Error(uploadRes.data?.error_msg || '上传失败');
  } catch (err) {
    if (err.response?.status === 401) throw new Error('快手授权已过期，请重新登录');
    throw new Error('快手发布失败: ' + (err.response?.data?.error_msg || err.message));
  }
}

// ─── 微视发布 ───
async function _publishWeishi(account, videoPath, copywriting) {
  const cfg = PLATFORMS.weishi;
  try {
    const stat = fs.statSync(videoPath);
    const fileStream = fs.createReadStream(videoPath);

    const uploadRes = await axios.post(cfg.uploadUrl, fileStream, {
      headers: {
        'Authorization': `Bearer ${account.access_token}`,
        'Content-Type': 'video/mp4'
      },
      maxContentLength: Infinity, maxBodyLength: Infinity
    });

    if (uploadRes.data?.data?.video_id) {
      const publishRes = await axios.post(cfg.publishUrl, {
        video_id: uploadRes.data.data.video_id,
        desc: `${copywriting.title}\n${copywriting.description}\n${(copywriting.tags || []).join(' ')}`
      }, {
        headers: { 'Authorization': `Bearer ${account.access_token}`, 'Content-Type': 'application/json' }
      });
      return { post_id: publishRes.data?.data?.feed_id || '', url: '' };
    }
    throw new Error(uploadRes.data?.msg || '上传失败');
  } catch (err) {
    if (err.response?.status === 401) throw new Error('微视授权已过期，请重新登录');
    throw new Error('微视发布失败: ' + (err.response?.data?.msg || err.message));
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
