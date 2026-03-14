/**
 * 动作资源索引服务 (Motion Asset Catalog)
 *
 * 将 FBX 动作资源包按类别索引，映射到 action_type，
 * 在视频生成时用于增强 prompt 的动作描述精确度。
 */

const fs = require('fs');
const path = require('path');

const MOTION_DIR = path.resolve(__dirname, '../../动作资源包');

// ═══ 动作分类目录 ═══
// 每个 FBX 文件按照动作语义分类到对应类别
const MOTION_CATALOG = {
  // ---- 格斗/近战 (combat) ----
  combat: {
    label: '近身格斗',
    action_type: 'combat',
    motions: [
      { file: 'Jab Cross.fbx', name: '直拳交叉', desc: 'rapid jab-cross boxing combo, fists striking forward alternately' },
      { file: 'Flying Knee Punch Combo.fbx', name: '飞膝拳连击', desc: 'leaping knee strike followed by overhead punch, aerial melee combo' },
      { file: 'Mma Kick.fbx', name: 'MMA踢击', desc: 'powerful roundhouse MMA kick with full hip rotation' },
      { file: 'Drop Kick.fbx', name: '飞踢', desc: 'dramatic drop kick with both legs extended mid-air' },
      { file: 'Illegal Elbow Punch.fbx', name: '肘击', desc: 'close-range elbow strike to the head, brutal and fast' },
      { file: 'Sword And Shield Attack.fbx', name: '剑盾攻击', desc: 'sword slash from behind shield, coordinated offense and defense' },
      { file: 'Great Sword Slash.fbx', name: '巨剑斩击', desc: 'massive two-handed greatsword downward slash with full body weight' },
      { file: 'Great Sword Jump Attack.fbx', name: '巨剑跳斩', desc: 'leaping overhead greatsword slam, powerful descending strike' },
      { file: 'Stable Sword Inward Slash.fbx', name: '横斩', desc: 'stable inward horizontal sword slash across the body' },
      { file: 'Capoeira.fbx', name: '卡波耶拉', desc: 'capoeira acrobatic kick with spinning body rotation' },
      { file: 'Chapa-Giratoria.fbx', name: '旋转踢', desc: 'spinning back kick with full 360 rotation' },
      { file: 'Martelo 2.fbx', name: '马特洛踢', desc: 'capoeira roundhouse kick with fluid body movement' },
      { file: 'Center Block.fbx', name: '格挡', desc: 'defensive center block with arms raised to protect torso' },
      { file: 'Jump Attack.fbx', name: '跳跃攻击', desc: 'jumping forward attack with weapon drawn back mid-air' },
      { file: 'Standing Torch Melee Attack 01.fbx', name: '火把攻击', desc: 'melee attack swinging a burning torch as weapon' },
      { file: 'Rifle Turn And Kick.fbx', name: '枪托踢击', desc: 'turning with rifle and delivering a side kick' },
      { file: 'Big Kidney Hit.fbx', name: '腰部重击', desc: 'devastating body blow to the kidney area' },
    ]
  },

  // ---- 远程/射击 (ranged) ----
  ranged: {
    label: '远程射击',
    action_type: 'ranged',
    motions: [
      { file: 'Shooting Gun.fbx', name: '射击', desc: 'firing handgun with recoil, muzzle flash, steady aim stance' },
      { file: 'Standing Aim Idle 01.fbx', name: '持枪瞄准', desc: 'standing still aiming down sights, focused targeting pose' },
      { file: 'Pistol Kneeling Idle.fbx', name: '跪姿持枪', desc: 'kneeling with pistol drawn, low-profile tactical position' },
      { file: 'Grab Rifle And Put Back.fbx', name: '取放步枪', desc: 'reaching for rifle on back and returning it, equipment management' },
      { file: 'Rifle Run To Stop.fbx', name: '持枪急停', desc: 'running with rifle then coming to sudden tactical stop' },
      { file: 'Rifle Turn.fbx', name: '持枪转身', desc: 'turning body while keeping rifle at ready position' },
      { file: 'Stop Walking With Rifle.fbx', name: '持枪停步', desc: 'walking with rifle and transitioning to stationary aim' },
    ]
  },

  // ---- 追逐/移动 (chase) ----
  chase: {
    label: '追逐移动',
    action_type: 'chase',
    motions: [
      { file: 'Run Forward.fbx', name: '全速奔跑', desc: 'full sprint forward, arms pumping, intense running' },
      { file: 'Running Jump.fbx', name: '跑跳', desc: 'running and leaping over obstacle mid-stride' },
      { file: 'Sprint Backward.fbx', name: '后退冲刺', desc: 'rapid backward sprint maintaining forward facing' },
      { file: 'Run Forward Arc Left.fbx', name: '弧线奔跑', desc: 'sprinting in left arc, curving chase path' },
      { file: 'Standing Run Forward.fbx', name: '起步冲刺', desc: 'burst from standing to full running speed' },
      { file: 'Running Up Stairs.fbx', name: '跑上楼梯', desc: 'dashing up stairs two at a time, vertical chase' },
      { file: 'Climbing Ladder.fbx', name: '爬梯', desc: 'climbing ladder rapidly, hand-over-hand vertical movement' },
      { file: 'Climbing To Top.fbx', name: '攀爬到顶', desc: 'pulling body up and over ledge edge, parkour vault' },
      { file: 'Freehang Climb.fbx', name: '悬挂攀爬', desc: 'free-hanging and pulling up on cliff edge' },
    ]
  },

  // ---- 爆炸/冲击 (explosion) ----
  explosion: {
    label: '爆炸冲击',
    action_type: 'explosion',
    motions: [
      { file: 'Shoved Reaction With Spin.fbx', name: '爆炸击飞', desc: 'being blasted backward with spinning body from explosion impact' },
      { file: 'Shoved Reaction With Spin (1).fbx', name: '爆炸击飞2', desc: 'violent pushback reaction from shockwave, body spinning through air' },
      { file: 'Fall Flat.fbx', name: '倒地', desc: 'falling flat on ground from impact force, face down crash' },
      { file: 'Death From Right.fbx', name: '右侧击倒', desc: 'being struck from right side, dramatic death fall' },
      { file: 'Standing React Large From Front.fbx', name: '正面重击反应', desc: 'massive frontal impact reaction, body jerking backward' },
      { file: 'Standing React Large From Left.fbx', name: '左侧重击反应', desc: 'heavy impact from left side, staggering sideways' },
    ]
  },

  // ---- 能量/变身 (power) ----
  power: {
    label: '能量爆发',
    action_type: 'power',
    motions: [
      { file: 'Standing Taunt Battlecry.fbx', name: '战吼蓄力', desc: 'battle cry with arms spread wide, channeling inner power, aura buildup' },
      { file: 'Offensive Idle.fbx', name: '战斗蓄势', desc: 'offensive combat stance radiating killing intent, pre-attack power pose' },
      { file: 'Action Idle To Fight Idle.fbx', name: '进入战斗', desc: 'transitioning from idle to fighting stance, powering up' },
      { file: 'Standing Block End.fbx', name: '破防', desc: 'breaking through defensive block, power overwhelming guard' },
      { file: 'Snatch.fbx', name: '力量爆发', desc: 'explosive upward power snatch, channeling full body strength' },
      { file: 'Box Jump.fbx', name: '爆发跳跃', desc: 'powerful explosive vertical jump, raw power demonstration' },
    ]
  },

  // ---- 潜行/暗杀 (stealth) ----
  stealth: {
    label: '潜行暗杀',
    action_type: 'stealth',
    motions: [
      { file: 'Crouch To Stand.fbx', name: '潜伏起身', desc: 'rising from crouched stealth position to standing' },
      { file: 'Crouch Turn Left 90.fbx', name: '蹲伏转向', desc: 'crouched turning 90 degrees while staying low' },
      { file: 'Crouch Turn To Stand.fbx', name: '潜行转身起身', desc: 'crouching turn transition to standing position, readying for strike' },
      { file: 'Crouch Torch Turn Right 90.fbx', name: '持火蹲行', desc: 'crouching with torch, turning right in dark corridor' },
      { file: 'Cover To Stand.fbx', name: '掩体出击', desc: 'emerging from cover position to standing combat ready' },
      { file: 'Standing Cover Turn.fbx', name: '掩体转角', desc: 'turning around cover corner, tactical peek and advance' },
      { file: 'Taking Cover Idle.fbx', name: '掩体待命', desc: 'pressed against cover, waiting for moment to strike' },
    ]
  },

  // ---- 空中/飞行 (aerial) ----
  aerial: {
    label: '空战飞行',
    action_type: 'aerial',
    motions: [
      { file: 'Jumping.fbx', name: '腾空', desc: 'jumping high into air, body fully airborne' },
      { file: 'Jump.fbx', name: '起跳', desc: 'powerful vertical jump launch from ground' },
      { file: 'Joyful Jump.fbx', name: '欢跃腾空', desc: 'joyful energetic leap with arms up' },
      { file: 'Jumping Down.fbx', name: '高处跳下', desc: 'jumping down from height, controlled aerial descent' },
      { file: 'Jumping Down (1).fbx', name: '空降', desc: 'dropping from elevation, landing preparation' },
      { file: 'Jumping Down (2).fbx', name: '急速下坠', desc: 'rapid descent from height, falling fast' },
      { file: 'Left Strafing Jump.fbx', name: '侧闪跳', desc: 'lateral strafing jump, aerial dodge to the left' },
      { file: 'Falling.fbx', name: '自由落体', desc: 'free-falling through air, body in freefall pose' },
      { file: 'Swinging.fbx', name: '荡跃', desc: 'swinging through air like on vine or rope' },
      { file: 'Hanging Idle.fbx', name: '悬挂', desc: 'hanging from ledge or aerial position' },
    ]
  },

  // ---- 武器特殊 (weapon) ----
  weapon: {
    label: '武器专精',
    action_type: 'combat',
    motions: [
      { file: 'Great Sword 180 Turn.fbx', name: '巨剑回旋', desc: '180-degree turn with greatsword sweeping arc, massive blade momentum' },
      { file: 'Great Sword Crouching.fbx', name: '巨剑蹲伏', desc: 'crouching low with greatsword ready for upward slash' },
      { file: 'Sword And Shield Turn.fbx', name: '剑盾旋转', desc: 'turning with sword and shield, defensive pivot' },
      { file: 'Sitting Weapon Grab.fbx', name: '拾取武器', desc: 'reaching down to grab weapon from ground while sitting' },
      { file: 'Standing Torch Light Torch.fbx', name: '点燃火把', desc: 'lighting a torch, fire igniting and illuminating surroundings' },
    ]
  },

  // ---- 舞蹈 (dance) ----
  dance: {
    label: '舞蹈表演',
    action_type: 'normal',
    motions: [
      { file: 'Breakdance 1990.fbx', name: '霹雳舞', desc: 'breakdancing power move, spinning on back with legs extended' },
      { file: 'Breakdance Uprock Var 2.fbx', name: '摇滚步', desc: 'uprock breakdance steps with rhythmic arm movements' },
      { file: 'Bboy Uprock Start.fbx', name: '街舞起步', desc: 'b-boy uprock starting pose, getting into the groove' },
      { file: 'Hip Hop Dancing.fbx', name: '嘻哈舞', desc: 'hip hop dance moves with bouncing rhythm and arm waves' },
      { file: 'Rumba Dancing.fbx', name: '伦巴', desc: 'sensual rumba partner dance, flowing hip movements' },
      { file: 'Samba Dancing.fbx', name: '桑巴', desc: 'energetic samba dancing with rapid footwork' },
      { file: 'Dancing Twerk.fbx', name: '电臀舞', desc: 'twerking dance move with rhythmic body isolation' },
      { file: 'Silly Dancing.fbx', name: '搞怪舞', desc: 'silly fun dancing with exaggerated comedic movements' },
      { file: 'Thriller Part 3.fbx', name: '惊悚舞', desc: 'Michael Jackson Thriller zombie dance choreography' },
      { file: 'Twist Dance.fbx', name: '扭扭舞', desc: 'classic twist dance, rotating hips and feet' },
      { file: 'Shuffling.fbx', name: '曳步舞', desc: 'Melbourne shuffle dance, rapid sliding footwork' },
      { file: 'Guitar Playing.fbx', name: '弹吉他', desc: 'playing guitar with strumming and fingering motion' },
    ]
  },

  // ---- 情感/表情 (emotion) ----
  emotion: {
    label: '情感表达',
    action_type: 'normal',
    motions: [
      { file: 'Angry.fbx', name: '愤怒', desc: 'furious angry gesture, clenched fists and tense body' },
      { file: 'Excited.fbx', name: '兴奋', desc: 'excited celebration, jumping and pumping fists' },
      { file: 'Surprised.fbx', name: '惊讶', desc: 'shocked surprise reaction, stepping back with wide gesture' },
      { file: 'Thankful.fbx', name: '感激', desc: 'thankful bowing gesture, hands together in gratitude' },
      { file: 'Defeated.fbx', name: '败北', desc: 'defeated slumped posture, head down in despair' },
      { file: 'Pain Gesture.fbx', name: '痛苦', desc: 'pain reaction, clutching wounded area, grimacing' },
      { file: 'Reaction.fbx', name: '受惊反应', desc: 'startled reaction, body flinching from unexpected event' },
      { file: 'Thoughtful Head Shake.fbx', name: '沉思摇头', desc: 'thoughtful head shake, contemplating with slight disapproval' },
      { file: 'Stroke Shaking Head.fbx', name: '无奈摇头', desc: 'helpless head shaking, expressing frustration or disbelief' },
      { file: 'Waving Gesture.fbx', name: '挥手', desc: 'friendly waving gesture, greeting or farewell' },
      { file: 'Standing Clap.fbx', name: '鼓掌', desc: 'standing ovation clapping, enthusiastic applause' },
      { file: 'Sitting Clap.fbx', name: '坐姿鼓掌', desc: 'sitting and clapping, appreciative audience reaction' },
      { file: 'Sitting Laughing.fbx', name: '坐姿大笑', desc: 'sitting and laughing heartily, whole body shaking with joy' },
      { file: 'Sitting Thumbs Up.fbx', name: '竖拇指', desc: 'seated thumbs up approval gesture' },
      { file: 'Sitting Yell.fbx', name: '坐姿呐喊', desc: 'sitting and yelling, passionate shouting' },
      { file: 'Salute.fbx', name: '敬礼', desc: 'military salute, hand to forehead, standing at attention' },
      { file: 'Taunt.fbx', name: '挑衅', desc: 'taunting gesture, provoking the opponent with confident swagger' },
      { file: 'Praying.fbx', name: '祈祷', desc: 'praying with hands clasped together, devotional kneeling' },
      { file: 'Kiss.fbx', name: '亲吻', desc: 'leaning in for a kiss, romantic intimate gesture' },
      { file: 'Kneeling Pointing.fbx', name: '跪地指向', desc: 'kneeling on one knee and pointing forward dramatically' },
    ]
  },

  // ---- 日常/生活 (daily) ----
  daily: {
    label: '日常动作',
    action_type: 'normal',
    motions: [
      { file: 'Walking.fbx', name: '行走', desc: 'casual walking, natural stride and arm swing' },
      { file: 'Female Walk.fbx', name: '女性步态', desc: 'feminine walking style, graceful and elegant stride' },
      { file: 'Start Walking.fbx', name: '起步', desc: 'starting to walk from standing still' },
      { file: 'Walking Backwards.fbx', name: '倒退', desc: 'walking backward carefully, looking over shoulder' },
      { file: 'Unarmed Walk Forward.fbx', name: '空手前行', desc: 'casual unarmed walking forward' },
      { file: 'Sitting.fbx', name: '坐下', desc: 'sitting down on chair or surface, relaxed posture' },
      { file: 'Standing Up.fbx', name: '站起', desc: 'standing up from seated position' },
      { file: 'Idle.fbx', name: '站立', desc: 'standing idle, natural resting pose with subtle breathing' },
      { file: 'Old Man Idle.fbx', name: '老者站立', desc: 'elderly person standing with slightly hunched posture' },
      { file: 'Talking On Phone.fbx', name: '打电话', desc: 'talking on phone, hand raised to ear with gesturing' },
      { file: 'Texting While Standing.fbx', name: '站立发短信', desc: 'standing and texting on phone, looking down at device' },
      { file: 'Telling A Secret.fbx', name: '说悄悄话', desc: 'leaning in to whisper a secret, hand cupping mouth' },
      { file: 'Opening Door Inwards.fbx', name: '推门而入', desc: 'opening a door inward and stepping through' },
      { file: 'Petting Animal.fbx', name: '抚摸动物', desc: 'gently petting an animal, affectionate stroking motion' },
      { file: 'Using A Fax Machine.fbx', name: '操作设备', desc: 'using office equipment, pressing buttons and handling paper' },
      { file: 'Pilot Flips Switches.fbx', name: '飞行员操作', desc: 'pilot flipping cockpit switches, professional operation' },
      { file: 'Removing Driver.fbx', name: '下车', desc: 'getting out of vehicle, stepping down from driver seat' },
      { file: 'Cards.fbx', name: '打牌', desc: 'playing cards, shuffling and dealing with hand gestures' },
      { file: 'Bicycle Crunch.fbx', name: '卷腹运动', desc: 'bicycle crunch exercise, alternating knee-to-elbow' },
      { file: 'Jump Push Up.fbx', name: '跳跃俯卧撑', desc: 'explosive push-up with body leaving ground' },
      { file: 'Start Plank.fbx', name: '平板支撑', desc: 'getting into plank position, core engagement' },
    ]
  },

  // ---- 被击/受伤 (hit_reaction) ----
  hit_reaction: {
    label: '受击反应',
    action_type: 'combat',
    motions: [
      { file: 'Taking Punch.fbx', name: '挨拳', desc: 'getting punched in the face, head snapping back from impact' },
      { file: 'Light Hit To Head.fbx', name: '轻击头部', desc: 'light strike to head, brief stagger and recovery' },
      { file: 'Medium Hit To Head.fbx', name: '中击头部', desc: 'medium impact to head, noticeable stagger with dazed reaction' },
      { file: 'Standing React Small From Back.fbx', name: '背后轻击', desc: 'small hit reaction from behind, flinching forward' },
      { file: 'Dodging Right.fbx', name: '右闪', desc: 'dodging to the right, quick evasive side step' },
      { file: 'Standing Dodge Backward.fbx', name: '后闪', desc: 'dodging backward to avoid attack, leaning back sharply' },
      { file: 'Laying Breathless.fbx', name: '倒地喘息', desc: 'lying on ground breathless, exhausted from beating' },
      { file: 'Dying.fbx', name: '倒下', desc: 'collapsing and dying, dramatic death sequence' },
      { file: 'Standing Death Left 01.fbx', name: '左侧倒地', desc: 'death fall to the left side, shot or struck fatally' },
      { file: 'Injured Walk Backwards.fbx', name: '负伤后退', desc: 'walking backward while injured, clutching wound and limping' },
      { file: 'Situp To Idle.fbx', name: '起身恢复', desc: 'sitting up from ground and returning to standing, recovering' },
    ]
  },

  // ---- 特殊动态/走位 (movement) ----
  movement: {
    label: '战术走位',
    action_type: 'normal',
    motions: [
      { file: 'Strafe.fbx', name: '侧移', desc: 'lateral strafing movement, staying facing forward' },
      { file: 'Strafing.fbx', name: '战术侧移', desc: 'tactical side-stepping, ready for combat' },
      { file: 'Strafing (1).fbx', name: '快速侧移', desc: 'rapid lateral movement, combat strafing' },
      { file: 'Right Strafe Walking.fbx', name: '右侧行走', desc: 'walking to the right while facing forward' },
      { file: 'Walk Strafe Left.fbx', name: '左侧行走', desc: 'walking to the left side, tactical positioning' },
      { file: 'Strafe Right Stop.fbx', name: '侧移急停', desc: 'strafing right then sudden stop, ready to engage' },
      { file: 'Stepping Backward.fbx', name: '后退', desc: 'careful backward stepping, maintaining awareness' },
      { file: 'Left Turn.fbx', name: '左转', desc: 'turning left while walking, direction change' },
      { file: 'Right Turn.fbx', name: '右转', desc: 'turning right while walking, smooth direction change' },
      { file: 'Catwalk Walk Turn 180 Tight.fbx', name: '急转身', desc: 'tight 180-degree turn, spinning on heel' },
      { file: 'Baseball Walk Out.fbx', name: '大步走出', desc: 'confident walking out stride, purposeful exit' },
      { file: 'Drunk Walk.fbx', name: '醉步', desc: 'drunk staggering walk, unsteady swaying gait' },
      { file: 'Drunk Idle Variation.fbx', name: '醉态', desc: 'drunk idle swaying, unfocused and unbalanced' },
      { file: 'Wheelbarrow Walk.fbx', name: '推车行走', desc: 'walking while pushing wheelbarrow, labored movement' },
    ]
  },

  // ---- 怪物/僵尸 (creature) ----
  creature: {
    label: '怪物动作',
    action_type: 'combat',
    motions: [
      { file: 'Zombie Walk.fbx', name: '僵尸行走', desc: 'slow zombie shambling walk, arms outstretched, dragging feet' },
      { file: 'Zombie Idle.fbx', name: '僵尸站立', desc: 'zombie idle stance, head tilted, twitching movements' },
      { file: 'Zombie Biting.fbx', name: '僵尸撕咬', desc: 'zombie lunging forward and biting, vicious attack' },
      { file: 'Zombie Transition.fbx', name: '僵尸变异', desc: 'zombie transformation, body contorting and mutating' },
      { file: 'Mutant Idle.fbx', name: '变异体待机', desc: 'mutant creature idle pose, menacing and unnatural' },
      { file: 'Mutant Right Turn 45.fbx', name: '变异体转向', desc: 'mutant creature turning, alien body mechanics' },
      { file: 'Orc Idle.fbx', name: '兽人待机', desc: 'orc warrior idle stance, massive and intimidating' },
      { file: 'Hostage Situation Idle - Villain.fbx', name: '反派待机', desc: 'villain holding hostage, menacing standoff pose' },
    ]
  },

  // ---- 姿态/造型 (pose) ----
  pose: {
    label: '角色姿态',
    action_type: 'normal',
    motions: [
      { file: 'Female Dynamic Pose.fbx', name: '女性动态姿态', desc: 'female dynamic action pose, confident and powerful stance' },
      { file: 'Female Standing Pose.fbx', name: '女性站姿', desc: 'elegant female standing pose, poised and graceful' },
      { file: 'Male Action Pose.fbx', name: '男性动作姿态', desc: 'male action hero pose, ready for combat' },
      { file: 'Male Dynamic Pose.fbx', name: '男性动态姿态', desc: 'male dynamic pose, powerful athletic stance' },
      { file: 'Unarmed Idle Looking Ver. 2.fbx', name: '警戒站姿', desc: 'unarmed idle looking around alertly, scanning surroundings' },
      { file: 'Standing W_Briefcase Idle.fbx', name: '持公文包', desc: 'standing with briefcase, professional business posture' },
      { file: 'Right Turn W_ Briefcase.fbx', name: '持包转身', desc: 'turning while holding briefcase, business professional' },
    ]
  }
};

// ═══ 动作资源包（ZIP）目录 ═══
const MOTION_PACKS = [
  { file: 'Basic Shooter Pack.zip', name: '基础射击包', category: 'ranged', desc: 'comprehensive shooter animations: aim, fire, reload, tactical movement' },
  { file: 'Capoeira Pack.zip', name: '卡波耶拉包', category: 'combat', desc: 'full capoeira martial arts set: ginga, kicks, spins, acrobatics' },
  { file: 'Longbow Locomotion Pack.zip', name: '长弓移动包', category: 'ranged', desc: 'longbow animations: draw, aim, release, walk while aiming, dodge' },
  { file: 'Pro Melee Axe Pack.zip', name: '斧战包', category: 'combat', desc: 'professional axe combat: overhead chop, horizontal swing, block, combo attacks' },
  { file: 'Sword and Shield Pack.zip', name: '剑盾包', category: 'combat', desc: 'sword and shield combat set: slash, stab, shield bash, parry, combo' },
];

// ═══ 中国国风动作映射（仙侠/武侠专用） ═══
const CHINESE_MOTION_MAP = {
  // 武侠/仙侠动作 → FBX 动作映射 + 国风增强描述
  sword_dance: {
    fbx: ['Great Sword Slash.fbx', 'Stable Sword Inward Slash.fbx', 'Great Sword 180 Turn.fbx'],
    prompt: 'flowing sword dance with silk ribbon trails, wuxia swordsmanship, blade leaving luminous arc trails in ink-wash style'
  },
  qinggong: {
    fbx: ['Jumping.fbx', 'Running Jump.fbx', 'Swinging.fbx', 'Freehang Climb.fbx'],
    prompt: 'qinggong lightness skill, leaping across rooftops like a feather, trailing wisps of qi energy, wuxia wire-fu movement'
  },
  neigong: {
    fbx: ['Standing Taunt Battlecry.fbx', 'Offensive Idle.fbx', 'Snatch.fbx'],
    prompt: 'internal energy cultivation, glowing qi aura emanating from dantian, meditation power buildup with swirling energy particles'
  },
  fist_technique: {
    fbx: ['Jab Cross.fbx', 'Flying Knee Punch Combo.fbx', 'Capoeira.fbx'],
    prompt: 'Chinese martial arts fist technique, tiger claw and crane stance, swift precise strikes with afterimage trails'
  },
  palm_strike: {
    fbx: ['Center Block.fbx', 'Big Kidney Hit.fbx', 'Standing React Large From Front.fbx'],
    prompt: 'devastating palm strike with visible qi shockwave, taiji push with energy ripple, internal force burst on impact'
  },
  stealth_kill: {
    fbx: ['Crouch To Stand.fbx', 'Cover To Stand.fbx', 'Crouch Turn To Stand.fbx'],
    prompt: 'shadow assassination, dark figure emerging from shadows, swift silent kill with flashing blade, ninja-like stealth'
  },
  defeat: {
    fbx: ['Dying.fbx', 'Laying Breathless.fbx', 'Fall Flat.fbx'],
    prompt: 'dramatic wuxia death scene, blood mist dissipating like cherry blossoms, falling in slow motion with robes billowing'
  },
  meditation: {
    fbx: ['Praying.fbx', 'Idle.fbx'],
    prompt: 'cultivation meditation on mountain peak, cross-legged with energy vortex forming, celestial glow and floating qi particles'
  }
};

// ═══ 核心功能 ═══

/**
 * 根据 action_type 获取匹配的动作描述列表
 */
function getMotionsByActionType(actionType) {
  const results = [];
  for (const [catKey, cat] of Object.entries(MOTION_CATALOG)) {
    if (cat.action_type === actionType) {
      results.push(...cat.motions);
    }
  }
  return results;
}

/**
 * 根据场景文本智能匹配最佳动作资源
 * @param {string} sceneText - 场景描述文本（action + visual_prompt）
 * @param {string} actionType - 场景 action_type
 * @param {number} count - 返回数量
 * @returns {Array} 匹配的动作描述
 */
function matchMotionsForScene(sceneText, actionType = 'normal', count = 3) {
  const text = (sceneText || '').toLowerCase();
  const candidates = [];

  // 按 action_type 筛选主分类
  const primaryMotions = getMotionsByActionType(actionType);

  // 关键词匹配评分
  const keywords = {
    combat: ['punch', 'kick', 'strike', 'slash', 'sword', 'fight', 'block', 'melee',
             '拳', '踢', '砍', '剑', '格斗', '搏击', '出招', '攻击', '格挡', '对决'],
    ranged: ['shoot', 'gun', 'rifle', 'aim', 'fire', 'bow', 'arrow',
             '射击', '枪', '瞄准', '弓箭', '远程', '投掷'],
    chase:  ['run', 'sprint', 'chase', 'climb', 'escape', 'pursue',
             '跑', '追', '逃', '爬', '冲刺', '奔跑', '追逐'],
    explosion: ['explode', 'blast', 'shockwave', 'destroy', 'crash',
                '爆炸', '冲击', '摧毁', '碎裂', '粉碎'],
    power:  ['power', 'energy', 'transform', 'channel', 'aura', 'charge',
             '力量', '能量', '变身', '蓄力', '气场', '爆发', '觉醒'],
    stealth: ['stealth', 'sneak', 'crouch', 'hide', 'shadow', 'assassin',
              '潜行', '暗杀', '隐蔽', '偷袭', '蹲伏', '刺客'],
    aerial: ['fly', 'jump', 'fall', 'air', 'soar', 'dive', 'leap',
             '飞', '跳', '坠落', '腾空', '高空', '翱翔'],
    dance:  ['dance', 'music', 'rhythm', 'groove',
             '舞', '跳舞', '节奏', '律动'],
    emotion: ['angry', 'happy', 'sad', 'surprise', 'cry', 'laugh',
              '愤怒', '高兴', '悲伤', '惊讶', '哭', '笑', '感动'],
  };

  // 对所有分类的动作评分
  for (const [catKey, cat] of Object.entries(MOTION_CATALOG)) {
    for (const motion of cat.motions) {
      let score = 0;
      // 主分类匹配加权
      if (cat.action_type === actionType) score += 5;
      // 关键词匹配
      const motionText = (motion.name + ' ' + motion.desc).toLowerCase();
      for (const [kw_cat, kw_list] of Object.entries(keywords)) {
        for (const kw of kw_list) {
          if (text.includes(kw) && motionText.includes(kw)) score += 2;
          if (text.includes(kw) && kw_cat === actionType) score += 1;
        }
      }
      if (score > 0) {
        candidates.push({ ...motion, score, category: catKey });
      }
    }
  }

  // 按分数排序，取 top N
  candidates.sort((a, b) => b.score - a.score);
  return candidates.slice(0, count);
}

/**
 * 生成动作增强 prompt
 * 将匹配到的动作资源转化为视频生成提示词增强
 */
function buildMotionPrompt(sceneText, actionType, style = '') {
  const isChineseStyle = /仙侠|武侠|国风|古风|修仙|江湖|wuxia|xianxia|ink/i.test(style + ' ' + sceneText);

  if (isChineseStyle) {
    return buildChineseMotionPrompt(sceneText, actionType);
  }

  const motions = matchMotionsForScene(sceneText, actionType, 3);
  if (!motions.length) return '';

  const descs = motions.map(m => m.desc).join('; ');
  return `[MOTION_REF: ${descs}]`;
}

/**
 * 中国国风动作增强 prompt
 */
function buildChineseMotionPrompt(sceneText, actionType) {
  const text = (sceneText || '').toLowerCase();
  const matchedDescs = [];

  // 检查中国风专用动作映射
  for (const [key, mapping] of Object.entries(CHINESE_MOTION_MAP)) {
    const keywords = {
      sword_dance: ['剑', 'sword', '剑舞', '剑法', '剑术'],
      qinggong: ['轻功', '飞檐走壁', '腾空', 'qinggong', '飞行', '御剑'],
      neigong: ['内功', '内力', '气功', '修炼', '丹田', '真气', '灵力'],
      fist_technique: ['拳', '掌法', '武功', '功夫', '招式', '出拳'],
      palm_strike: ['掌', '推掌', '太极', '内劲', '掌击', '一掌'],
      stealth_kill: ['暗杀', '潜行', '刺客', '偷袭', '隐身'],
      defeat: ['死', '倒下', '败', '身亡', '阵亡', '倒地'],
      meditation: ['修炼', '冥想', '打坐', '闭关', '参悟'],
    };

    const kws = keywords[key] || [];
    if (kws.some(kw => text.includes(kw))) {
      matchedDescs.push(mapping.prompt);
    }
  }

  // 无匹配则回退通用
  if (!matchedDescs.length) {
    const motions = matchMotionsForScene(sceneText, actionType, 2);
    if (motions.length) {
      matchedDescs.push(motions.map(m => m.desc).join('; '));
    }
  }

  return matchedDescs.length ? `[MOTION_REF: ${matchedDescs.join('; ')}]` : '';
}

/**
 * 获取完整动作目录（供前端展示）
 */
function getCatalog() {
  const catalog = {};
  for (const [key, cat] of Object.entries(MOTION_CATALOG)) {
    catalog[key] = {
      label: cat.label,
      action_type: cat.action_type,
      count: cat.motions.length,
      motions: cat.motions.map(m => ({ file: m.file, name: m.name, desc: m.desc }))
    };
  }
  return catalog;
}

/**
 * 获取目录统计
 */
function getStats() {
  let total = 0;
  const categories = {};
  for (const [key, cat] of Object.entries(MOTION_CATALOG)) {
    categories[key] = { label: cat.label, count: cat.motions.length };
    total += cat.motions.length;
  }
  // 检查实际文件
  let filesOnDisk = 0;
  try {
    if (fs.existsSync(MOTION_DIR)) {
      filesOnDisk = fs.readdirSync(MOTION_DIR).filter(f => f.endsWith('.fbx')).length;
    }
  } catch {}
  return { total, filesOnDisk, packs: MOTION_PACKS.length, categories };
}

module.exports = {
  MOTION_CATALOG,
  MOTION_PACKS,
  CHINESE_MOTION_MAP,
  getMotionsByActionType,
  matchMotionsForScene,
  buildMotionPrompt,
  buildChineseMotionPrompt,
  getCatalog,
  getStats,
};
