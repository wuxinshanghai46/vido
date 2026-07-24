(() => {
  function formatCastMode(value = '') {
    const raw = String(value || '').trim().toLowerCase();
    const labels = {
      auto: '自动判断',
      single: '单人物展示 / 导览',
      dual: '双人物对话 / 互动',
      multi: '多人剧情 / 群体展示',
      group: '多人剧情 / 群体展示',
      no_human: '无人物，仅产品 / 空间 / 材料',
      none: '无人物，仅产品 / 空间 / 材料',
      animal: '动物 / 宠物主体',
      pet: '动物 / 宠物主体',
      human_pet: '人物 + 宠物（混合主体）',
    };
    return labels[raw] || value || '-';
  }

  function description(spec = {}) {
    const labels = {
      castMode: { auto: '按内容判断', no_human: '无人物 / 只拍主体', animal: '动物 / 宠物主体', human_pet: '人物 + 宠物（混合主体）', single: '单人', dual: '双人对话', group: '多人 / 群体' },
      gender: { auto: '按故事判断', male: '男性', female: '女性', mixed: '双人/多人混合', all_male: '双人/多人全男性', all_female: '双人/多人全女性' },
      age: { match_brief: '按广告需求判断', young_adult_17_25: '年轻成人 / 17-25', young_adult: '青年 / 25-32', adult_30_40: '成熟青年 / 30-40', middle_40_55: '中年 / 40-55', senior_55_plus: '年长 / 55+' },
      origin: { east_asian_cn: '中国 / 东亚面孔', match_brief: '按广告需求判断', mixed_global: '多种族 / 国际化' },
    };
    return [
      `人物数量：${labels.castMode[spec.castMode] || spec.castMode || '按内容判断'}`,
      `人物性别：${labels.gender[spec.gender] || spec.gender || '按故事判断'}`,
      `人物年龄：${labels.age[spec.age] || spec.age || '按广告需求判断'}`,
      `地域/种族：${labels.origin[spec.origin] || spec.origin || '按广告需求判断'}`,
      ['animal', 'human_pet'].includes(spec.castMode) ? `宠物数量：${Number(spec.expectedAnimals || 0) || 1}` : '',
      ['animal', 'human_pet'].includes(spec.castMode) && spec.petType ? `宠物类型：${spec.petType}` : '',
      ['animal', 'human_pet'].includes(spec.castMode) && spec.petDescription ? `宠物识别特征：${spec.petDescription}` : '',
      spec.displayName ? `人物姓名：${spec.displayName}` : '',
      spec.roleName ? `人物身份：${spec.roleName}` : '',
      spec.appearanceText ? `外貌气质：${spec.appearanceText}` : '',
      spec.wardrobeText ? `穿着服装：${spec.wardrobeText}` : '',
      spec.hairMakeupText ? `发型妆造：${spec.hairMakeupText}` : '',
      spec.negativeText ? `人物禁止项：${spec.negativeText}` : '',
      'AI 生成只作为拟真演员参考；需要真人请上传真人照片或使用授权真人演员素材。',
      '没有手动填写姓名时，编剧必须为每个出场人物生成正式姓名；服装、发型、妆造和身份必须进入人物档案。',
    ].filter(Boolean).join('；');
  }

  function complete(suggestion = {}, current = {}, fallback = {}) {
    const source = suggestion && typeof suggestion === 'object' ? suggestion : {};
    const existing = current && typeof current === 'object' ? current : {};
    const defaults = fallback && typeof fallback === 'object' ? fallback : {};
    const keys = [
      'castMode', 'gender', 'age', 'origin', 'roleName', 'displayName',
      'appearanceText', 'wardrobeText', 'hairMakeupText', 'negativeText',
      'expectedPeople', 'expectedAnimals', 'petType', 'petDescription',
    ];
    return keys.reduce((result, key) => {
      result[key] = String(source[key] ?? '').trim()
        || String(existing[key] ?? '').trim()
        || String(defaults[key] ?? '').trim();
      return result;
    }, {});
  }

  function fallbackFromBrief(brief = '') {
    const isMale = /男|先生|老板|师傅|经理/.test(brief) && !/女|女士|美女|太太/.test(brief);
    const isFemale = /女|女士|美女|太太|模特/.test(brief);
    const isDual = /双人|两人|对话|客户.*顾问|销售.*客户|经销商.*客户/.test(brief);
    const isGroup = /多人|团队|群像|一家人|员工/.test(brief);
    const noHuman = /无人|无人物|不出现人|不要人物|只拍产品|只拍空间|纯产品|纯空间/.test(brief);
    const animal = /动物|宠物|萌宠/.test(brief);
    const human = /人物|真人|演员|主人|一家人|一家(?:[一二三四五六七八九十\d]+)口|家庭|父母|妈妈|爸爸|孩子|儿童|夫妻|男女|男士|女士|顾问|客户|用户|员工|团队/.test(brief);
    return {
      castMode: noHuman ? 'no_human' : (animal && human ? 'human_pet' : (animal ? 'animal' : (isGroup ? 'group' : (isDual ? 'dual' : 'single')))),
      gender: isMale ? 'male' : (isFemale ? 'female' : 'auto'),
      age: /老板|经理|经销商|顾问|专家|负责人/.test(brief) ? 'adult_30_40' : 'match_brief',
      origin: 'match_brief',
      roleName: /顾问|销售|经销商|导购/.test(brief) ? '品牌顾问 / 商业讲解人' : '广告主角',
      appearanceText: '符合当前广告需求的真实商业广告人物，五官自然，表情可信，气质干净专业；根据任务内容、目标用户和剧情关系判断年龄感、职业感和亲和度，避免网红脸和过度磨皮。',
      wardrobeText: '服装贴合当前产品定位、使用场景和目标客群，干净真实，颜色克制；鞋、配饰和整体风格保持商业广告质感，不抢主体画面。',
      hairMakeupText: '发型整洁自然，妆容清爽克制，皮肤保留真实质感；可有轻微商务妆、自然眉眼和干净发际线，避免厚重滤镜、夸张美瞳或塑料感皮肤。',
      negativeText: '不要卡通、不要塑料感皮肤、不要多余人物、不要水印文字、不要夸张变形；不要网红脸、廉价服装、过度磨皮、表情浮夸或与产品定位不符的造型。',
      expectedAnimals: animal ? 1 : '',
      petType: animal ? '按广告需求判断' : '',
      petDescription: animal ? '保持同一只宠物的品种、毛色、体型、年龄感、面部花纹、项圈和独特识别特征，毛发细节自然真实，跨镜头不得增删、换种或复制。' : '',
    };
  }

  window.NewStoryAdPersonPetSpec = { formatCastMode, description, complete, fallbackFromBrief };
})();
