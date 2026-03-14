'use strict';

// 中文网络术语、游戏角色、小说人物知识库
// 用于识别用户输入中的专有名词，为故事生成提供准确背景上下文
const SLANG_DB = [
  // ─ 英雄联盟 (League of Legends) ─
  { terms: ['刀盾狗','刀盾','潘森'], name: '潘森（英雄联盟）', desc: '英雄联盟中的英雄潘森，使用长矛和盾牌战斗的斯巴达战士，擅长跳跃突击和近身格斗', category: 'game', tags: ['战斗', '英雄联盟', '斯巴达', '盾牌', '长矛'] },
  { terms: ['比比拉布','比比'], name: '比比拉布（Bibibraplap）', desc: '一个具有独特格斗风格的虚构角色，善用爆炸性攻击', category: 'game', tags: ['格斗', '爆炸'] },
  { terms: ['蜘蛛','伊莱丝'], name: '伊莱丝（英雄联盟蜘蛛女皇）', desc: '英雄联盟中的蜘蛛女皇伊莱丝，可变形为蜘蛛形态，擅长单杀和丛林', category: 'game', tags: ['蜘蛛', '英雄联盟', '变形'] },
  { terms: ['盖伦','德玛西亚之力'], name: '盖伦（英雄联盟）', desc: '英雄联盟中的德玛西亚将军，持巨剑旋转斩击，代表正义与荣耀', category: 'game', tags: ['战斗', '英雄联盟', '旋风斩'] },
  { terms: ['瑞文','破败之刃'], name: '瑞文（英雄联盟）', desc: '英雄联盟中的流亡之刃，使用破损的符文大剑战斗，速攻型近战英雄', category: 'game', tags: ['战斗', '英雄联盟', '剑士'] },
  { terms: ['亚索','浪子剑豪'], name: '亚索（英雄联盟）', desc: '英雄联盟中的浪子剑豪，使用风之剑术和龙卷风攻击，流浪武士风格', category: 'game', tags: ['战斗', '英雄联盟', '剑豪', '风'] },
  { terms: ['卡莎','卡西奥佩娅'], name: '卡莎（英雄联盟）', desc: '英雄联盟中的虚空之女，穿着虚空生物护甲，远程射手', category: 'game', tags: ['英雄联盟', '虚空', '射手'] },
  { terms: ['劫','血港鬼影'], name: '劫（英雄联盟）', desc: '英雄联盟中的血港鬼影，使用太刀和忍者技能，极速近战刺客', category: 'game', tags: ['忍者', '英雄联盟', '刺客'] },
  // ─ 王者荣耀 ─
  { terms: ['貂蝉','王者貂蝉'], name: '貂蝉（王者荣耀）', desc: '王者荣耀中的法师刺客貂蝉，使用月轮技能飞舞攻击，美丽而致命', category: 'game', tags: ['王者荣耀', '法师', '刺客', '月亮'] },
  { terms: ['铠','王者铠'], name: '铠（王者荣耀）', desc: '王者荣耀中的英雄铠，黑暗骑士，身穿暗甲挥动巨剑，力量型战士', category: 'game', tags: ['王者荣耀', '战士', '骑士'] },
  { terms: ['孙悟空','大圣'], name: '孙悟空（王者荣耀/西游记）', desc: '中国经典神话角色孙悟空，齐天大圣，使用金箍棒，身怀七十二变神通', category: 'game', tags: ['神话', '西游记', '金箍棒', '变身'] },
  // ─ 原神 ─
  { terms: ['刻晴','原神刻晴'], name: '刻晴（原神）', desc: '原神中的璃月七星之一，使用长剑和雷元素，短发女性战士，身手矫捷', category: 'game', tags: ['原神', '雷元素', '剑士'] },
  { terms: ['胡桃','原神胡桃'], name: '胡桃（原神）', desc: '原神中的往生堂堂主，使用长枪和火元素，活泼爱闹的少女形象', category: 'game', tags: ['原神', '火元素', '长枪'] },
  { terms: ['芙宁娜','原神芙宁娜'], name: '芙宁娜（原神）', desc: '原神枫丹的水神，表演者般的战斗风格，使用水元素和召唤物战斗', category: 'game', tags: ['原神', '水元素', '神明'] },
  // ─ 小说人物 ─
  { terms: ['陈平安','剑来陈平安','小镇陈平安'], name: '陈平安（小说《剑来》）', desc: '小说《剑来》男主角，出身龙窑贫苦少年，性格坚韧内敛，后成为剑仙，行走江湖、修炼剑道', category: 'novel', tags: ['剑来', '修仙', '剑仙', '古代', '仙侠'] },
  { terms: ['苏姑娘','苏展颜','剑来苏展颜'], name: '苏展颜（小说《剑来》）', desc: '小说《剑来》中与陈平安有深厚情谊的女子，前世今生跨越轮回', category: 'novel', tags: ['剑来', '修仙', '女主'] },
  { terms: ['宁姚','剑来宁姚'], name: '宁姚（小说《剑来》）', desc: '小说《剑来》中的剑仙宁姚，被誉为最适合剑道的人，冷静强大', category: 'novel', tags: ['剑来', '修仙', '剑仙', '女侠'] },
  { terms: ['齐玄桢','老秀才'], name: '老秀才（小说《剑来》）', desc: '小说《剑来》中陈平安的老师，实为圣人级别的存在，亲切幽默', category: 'novel', tags: ['剑来', '修仙', '圣人'] },
  { terms: ['萧炎','斗破苍穹'], name: '萧炎（小说《斗破苍穹》）', desc: '小说《斗破苍穹》主角，曾是天才少年后沦为废材，奋发向上最终成为炎帝', category: 'novel', tags: ['斗破苍穹', '修炼', '火焰', '玄幻'] },
  { terms: ['唐三','斗罗大陆'], name: '唐三（小说《斗罗大陆》）', desc: '小说《斗罗大陆》主角，拥有蓝银草和八爪白蛛两种武魂，精通暗器，最终成为斗罗大陆最强魂师', category: 'novel', tags: ['斗罗大陆', '魂师', '玄幻'] },
  { terms: ['林动','武动乾坤'], name: '林动（小说《武动乾坤》）', desc: '小说《武动乾坤》主角，出身小家族，机缘之下得到神秘石符，踏上强者之路', category: 'novel', tags: ['武动乾坤', '修炼', '玄幻'] },
  { terms: ['夜华','三生三世'], name: '夜华（《三生三世十里桃花》）', desc: '仙侠小说《三生三世十里桃花》男主，天族太子，英俊冷傲，与白浅跨越三生三世', category: 'novel', tags: ['三生三世', '仙侠', '天族', '爱情'] },
  { terms: ['白浅','三生三世白浅'], name: '白浅（《三生三世十里桃花》）', desc: '仙侠小说《三生三世十里桃花》女主，上神白浅，强大而洒脱', category: 'novel', tags: ['三生三世', '仙侠', '上神'] },
  // ─ 动漫人物 ─
  { terms: ['鸣人','火影鸣人','漩涡鸣人'], name: '漩涡鸣人（《火影忍者》）', desc: '《火影忍者》主角，九尾人柱力，热血少年，最终成为火影，擅长影分身和螺旋丸', category: 'anime', tags: ['火影忍者', '忍者', '热血', '九尾'] },
  { terms: ['佐助','宇智波佐助'], name: '宇智波佐助（《火影忍者》）', desc: '《火影忍者》主角之一，宇智波一族复仇者，使用写轮眼和雷遁千鸟，与鸣人是宿命对手', category: 'anime', tags: ['火影忍者', '忍者', '写轮眼', '雷遁'] },
  { terms: ['悟空','龙珠悟空','孙悟空龙珠'], name: '孙悟空（《龙珠》）', desc: '《龙珠》主角，赛亚人战士，超级赛亚人变身，气功波攻击，保护地球', category: 'anime', tags: ['龙珠', '赛亚人', '超级赛亚人', '热血'] },
  { terms: ['路飞','草帽路飞'], name: '蒙奇·D·路飞（《海贼王》）', desc: '《海贼王》主角，草帽海贼团船长，吃了橡皮果实，梦想成为海贼王', category: 'anime', tags: ['海贼王', '海贼', '热血', '橡皮'] },
  { terms: ['鬼灭','炭治郎','竈門炭治郎'], name: '竈門炭治郎（《鬼灭之刃》）', desc: '《鬼灭之刃》主角，鬼杀队成员，使用水之呼吸和日之呼吸，为救回妹妹而战', category: 'anime', tags: ['鬼灭之刃', '剑士', '热血', '日本'] },
  // ─ 网络流行梗/词 ─
  { terms: ['yyds','永远的神'], name: 'YYDS（永远的神）', desc: '中文网络流行语，表示极度赞美某人或某物，可用于视频旁白或字幕', category: 'slang', tags: ['网络用语', '赞美'] },
  { terms: ['内卷','卷'], name: '内卷', desc: '指过度竞争、内部消耗的社会现象，常见于学习工作压力相关剧情', category: 'slang', tags: ['社会', '现代', '职场'] },
  { terms: ['躺平'], name: '躺平', desc: '放弃竞争、选择低欲望生活的生活态度，与内卷相对', category: 'slang', tags: ['社会', '现代', '生活态度'] },
  { terms: ['打工人'], name: '打工人', desc: '指普通工薪阶层，含自嘲意味，常见于现代都市题材', category: 'slang', tags: ['现代', '职场', '都市'] },
  { terms: ['凡尔赛'], name: '凡尔赛文学', desc: '以低调方式炫耀，表面谦虚实则显摆的行为，来自网络流行语', category: 'slang', tags: ['网络用语', '幽默'] },
  // ─ 游戏/电竞术语 ─
  { terms: ['上分','上王者','冲击王者'], name: '上分（电竞术语）', desc: '在排位赛中提升排名段位，常见于电竞/游戏题材剧情', category: 'esports', tags: ['电竞', '游戏', '排位'] },
  { terms: ['打野','野区'], name: '打野（电竞术语）', desc: '在野区击杀野怪刷新经济的游戏位置，英雄联盟/王者荣耀常见角色定位', category: 'esports', tags: ['电竞', '英雄联盟', '游戏'] },
  { terms: ['团战'], name: '团战（电竞术语）', desc: '多名角色/英雄集体对战的战斗场面，适合制造激烈视觉效果', category: 'esports', tags: ['战斗', '电竞', '集体'] },
];

/**
 * 检测输入文本中的专有名词
 * @param {string} text
 * @returns {Array} 匹配到的词条
 */
function detectSlangTerms(text) {
  if (!text || text.length < 2) return [];
  const lower = text.toLowerCase();
  const found = [];
  const seen = new Set();
  for (const entry of SLANG_DB) {
    for (const term of entry.terms) {
      if (lower.includes(term.toLowerCase()) && !seen.has(entry.name)) {
        seen.add(entry.name);
        found.push(entry);
        break;
      }
    }
  }
  return found;
}

/**
 * 生成故事生成时的上下文增强文本
 * @param {string} text
 * @returns {string}
 */
function buildSlangContext(text) {
  const matches = detectSlangTerms(text);
  if (!matches.length) return '';
  return '\n\n【专有名词背景说明】\n' + matches.map(m =>
    `- ${m.name}：${m.desc}`
  ).join('\n') + '\n请根据以上背景生成符合原作设定的故事内容。';
}

module.exports = { detectSlangTerms, buildSlangContext, SLANG_DB };
