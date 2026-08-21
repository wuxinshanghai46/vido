export function guidedResumePrompt({ mode = '', idea = '' } = {}) {
  const source = String(idea || '').trim();
  const narrative = mode === 'narrative_story';
  if (!narrative) return {
    topic: 'audience_intent',
    text: '我已经看到你的广告设想。先把传播对象定准：这条片最需要打动哪类人，他们看完后最希望产生什么行动？',
    answers: ['面向新用户，先建立认知与兴趣', '面向犹豫用户，用证据推动购买', '面向老用户，强化品牌认同与复购'],
  };
  if (source.length < 36) return {
    topic: 'subject_motivation',
    text: '我先抓住了你的故事方向。要让它真正往下发展，先把主角放进一个具体处境：谁是主角，他最想得到什么，又被什么挡住？',
    answers: ['一个想挽回旧爱、却不敢面对过去的人', '一对被家族与身份拆散的恋人', '请导演根据现有想法提出主角方案'],
  };
  const hasConcreteWorld = /(?:夏商周|春秋|战国|秦朝?|汉朝?|三国|晋朝?|南北朝|隋朝?|唐朝?|五代|宋朝?|元朝?|明朝?|清朝?|民国|当代|现代|近未来|公元|\d{3,4}\s*年|架空[^，。；\n]{0,12}(?:世界|王朝|大陆)|(?:长安|洛阳|汴京|临安|大都|北京|上海|广州|香港|中国|日本|欧洲|美国)[^，。；\n]{0,10})/u.test(source);
  const hasVisualDirection = /(?:真人|实拍|二维|2D|三维|3D|动画|水墨|定格|写实|纪实|胶片|国漫|电影质感|视觉风格|美术风格)/iu.test(source);
  if (!hasConcreteWorld) return {
    topic: 'world_era',
    text: '人物关系和主要事件已经有了方向。为了让身份、服化道和场景真正落地，这个故事更适合发生在哪一种世界里？',
    answers: ['真实历史朝代，我来补充具体时期', '架空东方神话世界，不受史实限制', '请导演结合这个故事推荐一个时代'],
  };
  if (!hasVisualDirection) return {
    topic: 'visual_medium',
    text: '故事的时空已经有了落点。接下来会直接影响人物与场景怎么制作：你希望观众看到怎样的画面质感？',
    answers: ['真人实拍', '国风二维动画', '电影级三维动画'],
  };
  return {
    topic: 'audience_intent',
    text: '人物、故事与画面方向已经能对上了。最后把观众感受定准：你最希望结尾留下一种什么情绪？',
    answers: ['遗憾之后的释然', '跨越生死仍无法割舍的震撼', '命运轮回、终于重逢的感动'],
  };
}
