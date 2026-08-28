/**
 * 转场边界与微表情知识（2026-08-28）
 *
 * 两份本地网页标题分别声称 88 个转场、40 组微表情，但保存附件实际只
 * 包含 18 个可读取转场和 10 个可读取微表情。这里只收录有附件证据的条目。
 */

const TRANSITION_SOURCE = '88个AI漫剧转场提示词（优化版）';
const EXPRESSION_SOURCE = '40组AI人物微表情提示词，做短剧漫剧直接套用';

const TRANSITIONS = [
  ['镜面置换', 'match_cut', 'generated_boundary', '镜面区域或镜框', '上一镜镜面逐步被另一时空画面占满', '下一镜从同一镜面构图进入新时空', '镜面边界、主体位置和构图轮廓在前后镜可对应'],
  ['风雪覆盖', 'dissolve', 'generated_boundary', '风雪与白雾', '风雪逐步覆盖镜头直至主要画面不可辨', '雪雾沿相同方向散开并露出寒冬新场景', '覆盖方向、白雾密度和散开后的新场景均可见'],
  ['黑帧切割', 'fade', 'editorial_only', '全黑画面', '上一镜快速压暗到全黑并短暂停顿', '从全黑快速亮起进入下一剧情', '黑场只出现在授权边界且持续时间符合合同'],
  ['书信启幕', 'match_cut', 'generated_boundary', '展开的书信或书页', '文字/图像在展开纸面形成旧事入口', '下一镜以相同纸面区域或构图进入回忆', '纸面、文字区域与回忆首帧位置可对应'],
  ['水波扩散', 'dissolve', 'generated_boundary', '水面波纹', '涟漪从触发点扩散并覆盖画面', '水下或回忆场景从同心波纹中显现', '涟漪中心、扩散方向与新场景显现顺序可见'],
  ['窗帘拂过', 'match_cut', 'semantic_cut', '被风吹动的窗帘', '窗帘横向扫过并完全遮挡镜头', '下一镜由同方向窗帘离开露出新空间', '完整遮挡帧与一致运动方向可验证'],
  ['迷雾吞没', 'dissolve', 'generated_boundary', '云雾', '雾气逐层吞没人物和空间', '雾气散去后露出目标仙侠/秘境空间', '吞没与散开过程、人物数量和目标空间都可见'],
  ['玻璃起雾', 'dissolve', 'generated_boundary', '玻璃表面雾气', '玻璃雾化并遮蔽原场景', '雾层中先出现轮廓再显露新场景', '玻璃平面、雾层和新轮廓的先后关系可见'],
  ['火焰蔓延', 'dissolve', 'generated_boundary', '从画面边缘进入的火焰', '火焰沿边缘蔓延至覆盖主要画面', '火焰退去后进入战后或重生场景', '火焰来源、覆盖范围和退去后的状态变化可见'],
  ['物件掠镜', 'match_cut', 'semantic_cut', '与剧情有关的前景物件', '物件高速掠过并短暂完全遮挡画面', '遮挡后从相同方向露出新地点远景', '必须存在完整遮挡帧且物件运动方向一致'],
  ['回身错位', 'match_cut', 'generated_boundary', '人物完整转身动作', '转身前保持原造型与时代背景', '同一转身相位落在新造型或新时代场景', '身体朝向、旋转相位和人物身份保持'],
  ['拔剑出鞘', 'match_cut', 'semantic_cut', '剑光或刀光', '剑刃出鞘时高光掠过镜头', '同一光带/方向切入目标战场', '剑光位置、动作相位和持剑手保持'],
  ['挥刃衔接', 'cut_on_action', 'semantic_cut', '连续挥击轨迹', '上一镜在挥击中段离开', '下一镜从相同方向和相位完成挥击', '武器、手别、轨迹方向与动作相位连续'],
  ['腾空跃迁', 'cut_on_action', 'generated_boundary', '人物跳跃轨迹', '人物离地进入腾空阶段', '下一空间从相同腾空相位继续到落地', '起跳、空中、落地三态与人物身份可验证'],
  ['抬手召唤', 'dissolve', 'generated_boundary', '手掌光效或粒子', '手掌聚集光效并扩展到画面主体区域', '光效退去后目标战场或力量状态出现', '手掌位置、粒子来源和力量状态变化可见'],
  ['抬眸觉醒', 'match_cut', 'semantic_cut', '低头到抬眼的头部动作', '人物低头保持旧神态', '在抬眼同一动作节点进入新环境或新立场', '眼神目标、头部角度与神态变化可见'],
  ['奔袭穿梭', 'cut_on_action', 'semantic_cut', '人物持续奔跑', '人物按既定方向跑出画面', '人物从下一场景相同方向和速度跑入', '人物身份、速度、步态相位和屏幕方向连续'],
  ['蹲起揭示', 'cut_on_action', 'semantic_cut', '下蹲到起身动作', '人物蹲下检查目标并开始起身', '起身同一相位进入发现后的新空间或信息状态', '手部接触、重心、视线和起身相位连续'],
];

const EXPRESSIONS = [
  ['若有所思', '视线略抬并落在远处虚点', '眼睑自然放松', '眉心轻蹙但不紧锁', '嘴角轻抿或微松', '', '头部保持稳定', '', 'quiet reflection'],
  ['眯眼审视', '直接看向被审视对象', '眼裂轻微收窄', '眉头轻压', '嘴角一侧轻压', '轻微收紧', '正面或轻侧头', '', 'controlled scrutiny'],
  ['轻托下巴', '柔和看向侧前方', '自然', '自然或轻蹙', '嘴唇轻抿不过度用力', '', '头部重心落在托举侧', '手指或手掌轻托下巴', 'immersive thinking'],
  ['怀疑挑眉', '微眯并停留在信息来源', '一侧略低', '单侧眉轻抬、另一侧自然', '轻抿或轻微后拉', '', '保持克制', '', 'skeptical denial'],
  ['垂头困惑', '看向斜下方', '略低垂', '轻微不对称蹙起', '嘴角轻沉', '', '头部微侧并低下', '', 'unresolved confusion'],
  ['垂眸盘算', '目光落向下方固定点', '眼睑低垂', '眉间轻微聚拢', '嘴角轻压且不露齿', '轻微收紧', '下颌略收', '', 'silent calculation'],
  ['放空走神', '视线空泛且没有明确焦点', '眼皮放松', '眉毛自然平放', '嘴部自然放松', '', '头部静止或微偏', '', 'attention drifts away'],
  ['抿嘴分析', '聚焦当前信息或物件', '稳定注视', '轻微集中', '双唇轻抿且不露齿', '稳定', '头部小幅前倾', '手指轻触下唇或下巴可选', 'rational analysis'],
  ['斜眼腹诽', '眼球转向一侧看人', '眼睑略低', '眉部保持克制不满', '嘴角轻微下压', '轻微收紧', '头部不完全转向目标', '', 'restrained dissatisfaction'],
  ['恍然大悟', '视线迅速锁定新发现', '眼睛适度睁大但不瞪眼', '眉毛短暂上抬', '嘴唇微张后自然收回', '放松', '头部轻抬', '', 'sudden understanding'],
];

const common = {
  collection: 'storyboard',
  applies_to: ['director', 'storyboard', 'prompt_engineer', 'character_consistency', 'qa', 'project_assistant'],
  lang: 'zh',
  enabled: true,
};

const transitionDocs = TRANSITIONS.map(([name, type, execution, sourceObject, outgoing, incoming, evidence], index) => ({
  ...common,
  id: `kb_transition_boundary_${String(index + 1).padStart(2, '0')}_20260828`,
  subcategory: '转场边界',
  title: `转场边界：${name}`,
  summary: `${name}建议使用 ${type}，执行类别为 ${execution}；必须先设计前一镜尾态与后一镜首态。`,
  content: `这不是可直接贴在任意镜头后的装饰词。转场类型：${type}；执行类别：${execution}；边界承接物/动作：${sourceObject}。上一镜尾态：${outgoing}。下一镜首态：${incoming}。验收证据：${evidence}。\n\n如果 execution_class=generated_boundary，现有本地合成器不能凭空制造该效果，必须在镜头生成阶段分别写入边界状态并通过前尾/后首帧验收；失败时使用合同指定的 hard_cut、dissolve 或 fade 零付费回退。不得为了套转场而新增人物、地点、道具或剧情。`,
  tags: ['转场', '分镜', name, type, execution],
  keywords: [name, 'transition boundary', type, execution, sourceObject],
  prompt_snippets: [`${name}：上一镜尾态“${outgoing}”；下一镜首态“${incoming}”；验收“${evidence}”。`],
  source_titles: [TRANSITION_SOURCE],
  source: '用户提供的本地网页存档中可读取的转场卡；VIDO 结构化整理，2026-08-28',
}));

const expressionDocs = EXPRESSIONS.map(([name, gaze, eyelids, brows, mouth, jaw, headPose, gesture, intent], index) => ({
  ...common,
  id: `kb_micro_expression_${String(index + 1).padStart(2, '0')}_20260828`,
  subcategory: '微表情',
  title: `人物微表情：${name}`,
  summary: `${name}必须拆成可见的视线、眼睑、眉部、嘴部、下颌、头部和可选手势，不能只给情绪标签。`,
  content: `微表情标签：${name}。剧情意图：${intent}。视线：${gaze}；眼睑：${eyelids}；眉部：${brows}；嘴部：${mouth}；下颌：${jaw || '自然，除非剧情要求才增加张力'}；头部：${headPose}；手势：${gesture || '不强制添加手势'}。\n\n使用时必须填写触发事件、出现时机、强度和保持时间，并保持人物身份、年龄、脸型和妆造不变。禁止只动嘴、空洞凝视、夸张瞪眼张嘴、五官变形和与剧情无关的摆拍。`,
  tags: ['微表情', '人物表演', name, '眼神', '眉部', '嘴角'],
  keywords: [name, intent, 'micro expression', 'gaze', 'eyelids', 'brows', 'mouth corners', 'head pose'],
  prompt_snippets: [`${name}：视线“${gaze}”，眼睑“${eyelids}”，眉部“${brows}”，嘴部“${mouth}”，头部“${headPose}”。`],
  source_titles: [EXPRESSION_SOURCE],
  source: '用户提供的本地网页存档中可读取的微表情卡；VIDO 结构化整理，2026-08-28',
}));

module.exports = [...transitionDocs, ...expressionDocs];
module.exports.TRANSITIONS = TRANSITIONS;
module.exports.EXPRESSIONS = EXPRESSIONS;
