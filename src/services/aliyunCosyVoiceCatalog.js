/**
 * 阿里百炼 CosyVoice v3-flash（北京）官方音色目录。
 * Source: https://help.aliyun.com/zh/model-studio/cosyvoice-voice-list
 * Synced: 2026-09-01
 */
const rows = [
  ['longanyang', '龙安阳', 'male', '中文'],
  ['longanhuan_v3', '龙安欢', 'female', '中文'], ['longanhuan', '龙安欢（兼容）', 'female', '中文'],
  ['longhuhu_v3', '龙呼呼', 'child', '童声'], ['longpaopao_v3', '龙泡泡', 'child', '童声'],
  ['longjielidou_v3', '龙杰力豆', 'child', '童声'], ['longxian_v3', '龙仙', 'female', '中文'],
  ['longling_v3', '龙灵', 'female', '中文'], ['longshanshan_v3', '龙珊珊', 'female', '中文'],
  ['longniuniu_v3', '龙妞妞', 'child', '童声'], ['longjiaxin_v3', '龙嘉欣', 'female', '中文'],
  ['longjiayi_v3', '龙嘉怡', 'female', '中文'], ['longanyue_v3', '龙安悦', 'female', '中文'],
  ['longlaotie_v3', '龙老铁', 'male', '方言'], ['longshange_v3', '龙山哥', 'male', '方言'],
  ['longanmin_v3', '龙安闽', 'female', '方言'],
  ['loongkyong_v3', 'Kyong', 'female', '多语言'], ['loongriko_v3', 'Riko', 'female', '多语言'],
  ['loongtomoka_v3', 'Tomoka', 'female', '多语言'], ['loongabby_v3', 'Abby', 'female', '多语言'],
  ['loongandy_v3', 'Andy', 'male', '多语言'], ['loongannie_v3', 'Annie', 'female', '多语言'],
  ['loongava_v3', 'Ava', 'female', '多语言'], ['loongbeth_v3', 'Beth', 'female', '多语言'],
  ['loongbetty_v3', 'Betty', 'female', '多语言'], ['loongcally_v3', 'Cally', 'female', '多语言'],
  ['loongcindy_v3', 'Cindy', 'female', '多语言'], ['loongdavid_v3', 'David', 'male', '多语言'],
  ['loongdonna_v3', 'Donna', 'female', '多语言'], ['loongemily_v3', 'Emily', 'female', '多语言'],
  ['loongeric_v3', 'Eric', 'male', '多语言'], ['loongluna_v3', 'Luna', 'female', '多语言'],
  ['loongluca_v3', 'Luca', 'male', '多语言'], ['loongtomoya_v3', 'Tomoya', 'male', '多语言'],
  ['loongyuuna_v3', 'Yuuna', 'female', '多语言'], ['loongyuuma_v3', 'Yuuma', 'male', '多语言'],
  ['loongjihun_v3', 'Jihun', 'male', '多语言'], ['loongindah_v3', 'Indah', 'female', '多语言'],
  ['longfei_v3', '龙飞', 'male', '中文'], ['longyingxiao_v3', '龙应笑', 'female', '中文'],
  ['longyingxun_v3', '龙应讯', 'male', '中文'], ['longyingjing_v3', '龙应静', 'female', '中文'],
  ['longyingling_v3', '龙应灵', 'female', '中文'], ['longyingtao_v3', '龙应涛', 'male', '中文'],
  ['longxiaochun_v3', '龙小淳', 'female', '推荐'], ['longxiaoxia_v3', '龙小夏', 'female', '中文'],
  ['longyumi_v3', 'YUMI', 'female', '中文'], ['longanyun_v3', '龙安昀', 'male', '中文'],
  ['longanwen_v3', '龙安温', 'female', '中文'], ['longanli_v3', '龙安莉', 'female', '中文'],
  ['longanlang_v3', '龙安朗', 'male', '播报'], ['longyingmu_v3', '龙应沐', 'female', '中文'],
  ['longantai_v3', '龙安台', 'female', '方言'], ['longhua_v3', '龙华', 'female', '中文'],
  ['longcheng_v3', '龙橙', 'male', '推荐'], ['longze_v3', '龙泽', 'male', '中文'],
  ['longzhe_v3', '龙哲', 'male', '中文'], ['longyan_v3', '龙颜', 'female', '中文'],
  ['longxing_v3', '龙星', 'female', '中文'], ['longtian_v3', '龙天', 'male', '中文'],
  ['longwan_v3', '龙婉', 'female', '中文'], ['longqiang_v3', '龙嫱', 'female', '中文'],
  ['longfeifei_v3', '龙菲菲', 'female', '中文'], ['longhao_v3', '龙浩', 'male', '中文'],
  ['longanrou_v3', '龙安柔', 'female', '中文'], ['longhan_v3', '龙寒', 'male', '中文'],
  ['longanzhi_v3', '龙安智', 'male', '中文'], ['longanling_v3', '龙安灵', 'female', '中文'],
  ['longanya_v3', '龙安雅', 'female', '中文'], ['longanqin_v3', '龙安亲', 'female', '中文'],
  ['longmiao_v3', '龙妙', 'female', '有声书'], ['longsanshu_v3', '龙三叔', 'male', '有声书'],
  ['longyuan_v3', '龙媛', 'female', '有声书'], ['longyue_v3', '龙悦', 'female', '有声书'],
  ['longxiu_v3', '龙修', 'male', '有声书'], ['longnan_v3', '龙楠', 'male', '有声书'],
  ['longwanjun_v3', '龙婉君', 'female', '有声书'], ['longyichen_v3', '龙逸尘', 'male', '有声书'],
  ['longlaobo_v3', '龙老伯', 'male', '长者'], ['longlaoyi_v3', '龙老姨', 'female', '长者'],
  ['longjiqi_v3', '龙机器', 'neutral', '短视频'], ['longhouge_v3', '龙猴哥', 'male', '短视频'],
  ['longdaiyu_v3', '龙黛玉', 'female', '短视频'], ['longanran_v3', '龙安燃', 'female', '直播'],
  ['longanxuan_v3', '龙安宣', 'female', '直播'],
];

const voices = Object.freeze(rows.map(([id, name, gender, tag]) => Object.freeze({
  id, name, gender, tag, model: 'cosyvoice-v3-flash', lang: tag === '多语言' ? 'multi' : 'zh',
})));

module.exports = { voices, syncedAt: '2026-09-01', sourceUrl: 'https://help.aliyun.com/zh/model-studio/cosyvoice-voice-list' };
