/**
 * 知识库 seed 索引
 *
 * 按合集拆分到 seeds/ 子目录下维护，此文件只负责聚合。
 * 每次启动时 knowledgeBaseService.ensureSeeded() 会调用 bulkInsertKnowledgeDocs
 * 进行增量 insert（已存在 id 自动跳过），因此在子文件中新增条目即可。
 *
 * 原始参考素材说明（v1 部分条目基于以下素材 + 通用知识合成）：
 *   [1] 抖音 @阿拉赛博蕾《seedance2.0+seedream5.0高级玩法》(v.douyin.com/t-NglmOXMcM)
 *   [2] 抖音 @金枝玉叶带你AI出圈《AI漫剧选题公式：5个爆款基因=平台抢要》(v.douyin.com/hqdWtC4BJVs)
 *   [3] 抖音 @只关于Ai的学妹《轻松打造角色资产库！AI视频创作福音》(v.douyin.com/0NXzARIHed4)
 * 抖音页面代码为混淆态，正文无法抓取，内容基于分享文案标题 + 公开领域的 AI 视频
 * 创作知识合成。v2 扩充部分为行业公开知识再整理。
 */

const digitalHuman = require('./seeds/digital_human');
const drama        = require('./seeds/drama');
const storyboard   = require('./seeds/storyboard');
const atmosphere   = require('./seeds/atmosphere');
const production   = require('./seeds/production');
const engineering  = require('./seeds/engineering');

const seedDocs = [
  ...digitalHuman,
  ...drama,
  ...storyboard,
  ...atmosphere,
  ...production,
  ...engineering,
];

module.exports = seedDocs;
