// ═══════════════════════════════════════════
//  AI 画布 — 主逻辑
//  Phase 0 + Phase 1：布局 + Agent + 可运行节点
// ═══════════════════════════════════════════

let editor = null;
let agentHistory = [];
let agentContext = { selected_nodes: [] };
let agentBusy = false;
let paletteCallback = null;
let saveTimer = null;
let canvasHistory = [];
let canvasHistoryIndex = -1;
let historyTimer = null;
let historyApplying = false;
let workflowRunning = false;

// ═══ 节点类型定义 ═══
// 每个节点有：id / label / icon / group / inputs / outputs / desc / runner（执行函数）
const NODE_TYPES = [
  { id: 'text',       label: 'Text',        icon: '≡',  group: '输入', inputs: 0, outputs: 1, desc: '文本/剧本/描述' },
  { id: 'image',      label: 'Image',       icon: '🖼', group: '生成', inputs: 1, outputs: 1, desc: '图片生成' },
  { id: 'background', label: 'Background',  icon: '🏞', group: '生成', inputs: 1, outputs: 1, desc: '场景/背景' },
  { id: 'character',  label: 'Character',   icon: '🧝', group: '生成', inputs: 1, outputs: 1, desc: '角色形象' },
  { id: 'i2v',        label: 'I2V',         icon: '✨', group: '生成', inputs: 1, outputs: 1, desc: '图生视频' },
  { id: 'video',      label: 'Video',       icon: '▶',  group: '生成', inputs: 3, outputs: 1, desc: '视频生成' },
  { id: 'avatar',     label: 'Avatar',      icon: '🧑', group: '生成', inputs: 2, outputs: 1, desc: '数字人' },
  { id: 'voice',      label: 'Voice',       icon: '🎙', group: '音频', inputs: 1, outputs: 1, desc: '语音合成' },
  { id: 'music',      label: 'Music',       icon: '🎵', group: '音频', inputs: 0, outputs: 1, desc: '配乐' },
  { id: 'merge',      label: 'Merge',       icon: '⊞',  group: '输出', inputs: 4, outputs: 0, desc: '合成输出' }
];

// ═══ 参考样例（每种节点 3 个示例，点击 💡 按钮循环填充） ═══
const NODE_EXAMPLES = {
  text: [
    '黄昏的海边，一个老渔夫望着远处归航的船只，想起年轻时未说出口的告白',
    '2099 年的东京，霓虹街角的面馆老板其实是被遗忘的 AI 战神',
    '雨夜的咖啡馆里，两个陌生人通过桌上的遗留书籍开始了一场无声对话',
    '沙漠深处的废弃加油站，一个小女孩每晚对着空油桶讲故事给她消失的机器人朋友听'
  ],
  image: [
    '赛博朋克风格，雨夜霓虹街道，穿风衣的女侦探，电影感构图，4K 高清',
    '水墨国风，月下竹林，一只白鹿静立，唯美写意，宫崎骏画风',
    '日系动漫，夏日教室，窗边少女回眸，阳光透过樱花，新海诚色彩',
    '黑白电影胶片质感，1950 年代纽约街头，一辆老爷车驶过，极高对比度'
  ],
  background: [
    '废弃的巨型机甲残骸散落在末日沙漠，远处是橙红色的夕阳',
    '云雾缭绕的仙山，瀑布从天而降，古刹飞檐隐约可见，东方奇幻',
    '温暖的咖啡馆内景，木质桌椅，暖黄灯光，窗外正下着雨',
    '赛博朋克高楼林立的夜景，霓虹广告牌，空中飞车穿梭'
  ],
  character: [
    '少女剑客，黑色长发扎高马尾，身着白袍红绸，腰佩长剑，眼神坚定，武侠风',
    '赛博朋克黑客，银灰短发，机械义眼，穿着带光条的黑色风衣，坐在老旧终端前',
    '森林精灵，绿瞳长耳，发间缠绕藤蔓，手持长弓，阳光透过树叶洒在她身上',
    '朋克摇滚少女，粉色发梢，皮夹克，耳环丁零作响，背着电吉他'
  ],
  i2v: [
    '镜头缓慢推进，人物转头微笑，发丝在风中轻轻飘动',
    '从俯视角度拉远，主角在雨中奔跑，水花四溅，动感强烈',
    '环绕镜头展示角色 360 度，背景有光粒子特效',
    '画面从左向右平移，背景的云快速流动，呈现时间流逝感'
  ],
  voice: [
    '大家好，今天给大家分享三个让效率翻倍的 AI 工具',
    '在那个寒冷的冬夜，她独自坐在窗边，想起了童年时和父亲一起堆过的雪人',
    '欢迎来到今天的产品介绍，让我用一分钟告诉你最核心的三个卖点',
    '从前有一个小女孩，她有一颗会发光的石头，每当夜晚降临，石头就会告诉她星星的故事'
  ],
  music: [
    '史诗级奥斯卡电影配乐，弦乐为主，充满希望和力量',
    '80 年代复古迪斯科，跳跃节拍，电子鼓，合成器',
    '空灵古风，古筝加箫，月夜悠远，禅意',
    '紧张的追逐场面，快节奏打击乐，交响乐渲染'
  ],
  avatar: [
    '大家好，我是 VIDO AI 数字人讲师，今天带你了解 AI 视频创作的全流程',
    '欢迎订阅，每天分享一个让你豁然开朗的思维模型',
    '新品发布，三大核心功能让你的创作效率提升 10 倍，点赞关注不迷路'
  ],
  video: [
    '一只白猫跳上屋顶追逐萤火虫，月光洒在青瓦上，水墨画风格',
    '机械猫与少年在废墟都市中探险，赛博朋克风格'
  ],
  merge: []
};

function getRandomExample(type) {
  const list = NODE_EXAMPLES[type] || [];
  if (list.length === 0) return '';
  return list[Math.floor(Math.random() * list.length)];
}

// ═══ 节点能力选项（模型/风格/比例 等可选配置） ═══
// 每一项会渲染成节点底部的 pill 下拉，运行时收集到 data 里传给对应的后端 API
const NODE_CAPABILITIES = {
  text: {
    model: {
      label: '模型',
      options: [
        { id: 'agent',     label: 'VIDO Agent', default: true },
        { id: 'deepseek',  label: 'DeepSeek' },
        { id: 'gpt-4',     label: 'GPT-4o' },
        { id: 'claude',    label: 'Claude' }
      ]
    },
    style: {
      label: '风格',
      options: [
        { id: 'creative',  label: '✨ 富有创意', default: true },
        { id: 'concise',   label: '📝 简洁' },
        { id: 'cinematic', label: '🎬 电影感' },
        { id: 'poetic',    label: '🌸 诗意' },
        { id: 'humor',     label: '😄 幽默' },
        { id: 'horror',    label: '👻 悬疑惊悚' }
      ]
    },
    length: {
      label: '长度',
      options: [
        { id: 'short',  label: '短 · 80字' },
        { id: 'medium', label: '中 · 200字', default: true },
        { id: 'long',   label: '长 · 500字' }
      ]
    }
  },
  image: {
    model: {
      label: '模型',
      options: [
        { id: 'flux-pro',  label: 'FLUX 1.1 Pro',      default: true },
        { id: 'sd3',       label: 'Stable Diffusion 3' },
        { id: 'dalle3',    label: 'DALL-E 3' },
        { id: 'jimeng-4',  label: '即梦 4.0' },
        { id: 'cogview',   label: '智谱 CogView' },
        { id: 'nano-banana', label: 'Nano Banana' }
      ]
    },
    aspect: {
      label: '比例',
      options: [
        { id: '1:1',  label: '1:1 方形',  default: true },
        { id: '16:9', label: '16:9 宽屏' },
        { id: '9:16', label: '9:16 竖屏' },
        { id: '4:3',  label: '4:3' },
        { id: '3:4',  label: '3:4' }
      ]
    },
    style: {
      label: '风格',
      options: [
        { id: 'photo',      label: '📷 写实摄影', default: true },
        { id: 'anime',      label: '🌸 日系动漫' },
        { id: 'cinematic',  label: '🎬 电影感' },
        { id: 'cyberpunk',  label: '⚡ 赛博朋克' },
        { id: 'oil',        label: '🎨 油画' },
        { id: 'watercolor', label: '💧 水彩' },
        { id: 'ink',        label: '🖌️ 水墨国风' },
        { id: 'fantasy',    label: '🧝 奇幻' }
      ]
    }
  },
  background: {
    model: {
      label: '模型',
      options: [
        { id: 'flux-pro', label: 'FLUX 1.1 Pro', default: true },
        { id: 'sd3',      label: 'Stable Diffusion 3' },
        { id: 'jimeng-4', label: '即梦 4.0' }
      ]
    },
    aspect: {
      label: '比例',
      options: [
        { id: '16:9', label: '16:9 宽屏', default: true },
        { id: '9:16', label: '9:16 竖屏' },
        { id: '21:9', label: '21:9 超宽' },
        { id: '1:1',  label: '1:1 方形' }
      ]
    },
    time: {
      label: '时段',
      options: [
        { id: 'day',     label: '☀️ 白天', default: true },
        { id: 'night',   label: '🌙 夜晚' },
        { id: 'sunrise', label: '🌅 日出' },
        { id: 'sunset',  label: '🌇 黄昏' },
        { id: 'neon',    label: '💡 霓虹' }
      ]
    }
  },
  character: {
    style: {
      label: '风格',
      options: [
        { id: 'realistic', label: '📷 写实', default: true },
        { id: 'anime',     label: '🌸 日系' },
        { id: 'chibi',     label: '🍡 Q版' },
        { id: 'comic',     label: '📚 美漫' },
        { id: 'ink',       label: '🖌️ 水墨' }
      ]
    },
    dim: {
      label: '维度',
      options: [
        { id: '2d', label: '2D', default: true },
        { id: '3d', label: '3D' }
      ]
    }
  },
  i2v: {
    model: {
      label: '模型',
      options: [
        { id: 'seedance-pro', label: 'Seedance 1.0 Pro', default: true },
        { id: 'kling-v2',     label: 'Kling V2 Master' },
        { id: 'cogvideox',    label: '智谱 CogVideoX' },
        { id: 'veo-3',        label: 'Google Veo 3' },
        { id: 'luma-ray',     label: 'Luma Ray 2' },
        { id: 'minimax',      label: 'MiniMax Hailuo' }
      ]
    },
    duration: {
      label: '时长',
      options: [
        { id: '5',  label: '5 秒', default: true },
        { id: '8',  label: '8 秒' },
        { id: '10', label: '10 秒' }
      ]
    },
    motion: {
      label: '镜头',
      options: [
        { id: 'auto',    label: '🤖 智能', default: true },
        { id: 'zoom-in', label: '📷 推镜' },
        { id: 'zoom-out', label: '🔙 拉镜' },
        { id: 'pan-l',   label: '← 左移' },
        { id: 'pan-r',   label: '右移 →' },
        { id: 'orbit',   label: '🔄 环绕' },
        { id: 'dolly',   label: '🎬 稳定' }
      ]
    }
  },
  video: {
    model: {
      label: '模型',
      options: [
        { id: 'seedance-pro', label: 'Seedance 1.0 Pro', default: true },
        { id: 'kling-v2',     label: 'Kling V2' },
        { id: 'cogvideox',    label: 'CogVideoX' },
        { id: 'veo-3',        label: 'Veo 3' }
      ]
    },
    aspect: {
      label: '比例',
      options: [
        { id: '16:9', label: '16:9 宽屏', default: true },
        { id: '9:16', label: '9:16 竖屏' },
        { id: '1:1',  label: '1:1 方形' }
      ]
    },
    duration: {
      label: '时长',
      options: [
        { id: '5',  label: '5 秒', default: true },
        { id: '10', label: '10 秒' }
      ]
    }
  },
  avatar: {
    voice: {
      label: '声音',
      options: [
        { id: 'female-warm',   label: '女 · 温暖', default: true },
        { id: 'female-sweet',  label: '女 · 甜美' },
        { id: 'female-news',   label: '女 · 新闻' },
        { id: 'male-steady',   label: '男 · 沉稳' },
        { id: 'male-energy',   label: '男 · 激情' },
        { id: 'child',         label: '童声' }
      ]
    },
    aspect: {
      label: '比例',
      options: [
        { id: '9:16', label: '9:16 竖屏', default: true },
        { id: '16:9', label: '16:9 宽屏' },
        { id: '1:1',  label: '1:1 方形' }
      ]
    }
  },
  voice: {
    voice: {
      label: '声音',
      options: [
        { id: 'female-warm',   label: '女 · 温暖', default: true },
        { id: 'female-sweet',  label: '女 · 甜美' },
        { id: 'female-news',   label: '女 · 新闻' },
        { id: 'male-steady',   label: '男 · 沉稳' },
        { id: 'male-energy',   label: '男 · 激情' },
        { id: 'child',         label: '童声' }
      ]
    },
    speed: {
      label: '语速',
      options: [
        { id: '0.8', label: '慢 0.8×' },
        { id: '1.0', label: '正常 1.0×', default: true },
        { id: '1.2', label: '快 1.2×' },
        { id: '1.5', label: '极快 1.5×' }
      ]
    }
  },
  music: {
    genre: {
      label: '风格',
      options: [
        { id: 'cinematic', label: '🎬 电影原声', default: true },
        { id: 'pop',       label: '🎤 流行' },
        { id: 'rock',      label: '🎸 摇滚' },
        { id: 'electronic', label: '⚡ 电子' },
        { id: 'jazz',      label: '🎷 爵士' },
        { id: 'classical', label: '🎻 古典' },
        { id: 'ambient',   label: '🌊 氛围' },
        { id: 'ethnic',    label: '🏮 民族' }
      ]
    },
    mood: {
      label: '情绪',
      options: [
        { id: 'epic',     label: '史诗', default: true },
        { id: 'calm',     label: '舒缓' },
        { id: 'happy',    label: '欢快' },
        { id: 'sad',      label: '忧伤' },
        { id: 'tense',    label: '紧张' },
        { id: 'romantic', label: '浪漫' },
        { id: 'mystery',  label: '神秘' }
      ]
    },
    duration: {
      label: '时长',
      options: [
        { id: '15', label: '15 秒' },
        { id: '30', label: '30 秒', default: true },
        { id: '60', label: '60 秒' },
        { id: '120', label: '2 分钟' }
      ]
    }
  }
};

function buildCapRow(type, data) {
  const caps = NODE_CAPABILITIES[type];
  if (!caps) return '';
  const parts = Object.entries(caps).map(([field, cap]) => {
    const current = data[field] || (cap.options.find(o => o.default) || cap.options[0]).id;
    return `
      <select class="ac-cap-pill" df-${field} title="${escapeAttr(cap.label)}">
        ${cap.options.map(o => `<option value="${escapeAttr(o.id)}" ${o.id === current ? 'selected' : ''}>${escapeHtml(o.label)}</option>`).join('')}
      </select>
    `;
  });
  return `<div class="ac-node-caps">${parts.join('')}</div>`;
}

// ═══ 轻量 Markdown 渲染（Agent 消息气泡用） ═══
function renderMarkdown(text) {
  if (!text) return '';
  let html = escapeHtml(String(text));
  // Inline
  html = html.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
  html = html.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  // Block 级处理
  const lines = html.split('\n');
  const out = [];
  let listType = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const h = line.match(/^(#{1,3}) (.+)$/);
    const ol = line.match(/^(\d+)\. (.+)$/);
    const ul = line.match(/^[-•*] (.+)$/);
    // 列表终止
    if (listType === 'ol' && !ol) { out.push('</ol>'); listType = null; }
    if (listType === 'ul' && !ul) { out.push('</ul>'); listType = null; }
    if (h) {
      const lvl = Math.min(h[1].length + 2, 6);
      out.push(`<h${lvl}>${h[2]}</h${lvl}>`);
    } else if (ol) {
      if (listType !== 'ol') { out.push('<ol>'); listType = 'ol'; }
      out.push(`<li>${ol[2]}</li>`);
    } else if (ul) {
      if (listType !== 'ul') { out.push('<ul>'); listType = 'ul'; }
      out.push(`<li>${ul[1]}</li>`);
    } else {
      out.push(`<p>${line}</p>`);
    }
  }
  if (listType) out.push(`</${listType}>`);
  return out.join('');
}

// ═══ 初始化 ═══
(async function init() {
  const ok = await requireAuth();
  if (!ok) return;

  const user = getCurrentUser();
  if (user) {
    document.getElementById('ac-agent-username').textContent = user.username || '';
  }

  initEditor();
  await loadCanvasFromQuery();
  resetCanvasHistory();
  initCanvasEvents();
  initKeyboardShortcuts();
  initAgentEvents();
})();

function initEditor() {
  const container = document.getElementById('drawflow');
  editor = new Drawflow(container);
  editor.reroute = false;               // 关闭连线中点 reroute 按钮（会挡住节点内容）
  editor.reroute_fix_curvature = true;
  editor.force_first_input = false;
  editor.curvature = 0.5;
  editor.start();

  // 暴露给节点内部的 onclick（需要 global 访问）
  window.__ACEditor = editor;

  editor.on('nodeCreated', () => { updateEmptyGuide(); onCanvasMutated(); });
  editor.on('nodeRemoved', () => { updateEmptyGuide(); onCanvasMutated(); });
  editor.on('connectionCreated', onCanvasMutated);
  editor.on('connectionRemoved', onCanvasMutated);
  editor.on('nodeDataChanged', onCanvasMutated);
  editor.on('nodeMoved', onCanvasMutated);
  editor.on('nodeSelected', syncAgentContext);
  editor.on('nodeUnselected', syncAgentContext);
  editor.on('zoom', updateZoomDisplay);

  updateEmptyGuide();
}

function updateEmptyGuide() {
  const data = editor.export();
  const hasNodes = Object.keys(data.drawflow.Home.data || {}).length > 0;
  const guide = document.getElementById('ac-empty-guide');
  guide.classList.toggle('hidden', hasNodes);
}

function updateZoomDisplay() {
  const z = Math.round((editor.zoom || 1) * 100);
  const val = document.getElementById('ac-zoom-val');
  const slider = document.getElementById('ac-zoom-slider');
  if (val) val.textContent = z + '%';
  if (slider) slider.value = z;
}

function scheduleSave() {
  const status = document.getElementById('ac-save-status');
  if (status) status.textContent = '编辑中...';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(doSave, 1500);
}

function onCanvasMutated() {
  if (historyApplying) return;
  scheduleSave();
  clearTimeout(historyTimer);
  historyTimer = setTimeout(captureCanvasHistory, 180);
  syncAgentContext();
}

async function doSave() {
  try {
    const data = editor.export();
    const name = document.getElementById('ac-project-name').value || '未命名项目';
    const body = { id: window.__ACWorkflowId || null, name, drawflow: data.drawflow };
    const resp = await authFetch('/api/workflow/save', {
      method: 'POST', body: JSON.stringify(body)
    });
    const json = await resp.json();
    if (json.success && json.data) {
      window.__ACWorkflowId = json.data.id;
      const status = document.getElementById('ac-save-status');
      if (status) status.textContent = '已保存 · 刚刚';
      return true;
    }
  } catch (e) {
    const status = document.getElementById('ac-save-status');
    if (status) status.textContent = '保存失败';
  }
  return false;
}

function onProjectRename() { scheduleSave(); }

async function loadCanvasFromQuery() {
  const workflowId = new URLSearchParams(location.search).get('id');
  if (!workflowId) return;
  try {
    const resp = await authFetch(`/api/workflow/${encodeURIComponent(workflowId)}`);
    const json = await resp.json();
    if (!json.success || !json.data?.drawflow) throw new Error(json.error || '画布不存在');
    window.__ACWorkflowId = json.data.id;
    document.getElementById('ac-project-name').value = json.data.name || '未命名项目';
    const graph = { drawflow: JSON.parse(JSON.stringify(json.data.drawflow)) };
    const home = graph.drawflow?.Home?.data || {};
    Object.values(home).forEach((node) => {
      const type = String(node.name || node.class || '').replace(/^ac-node-/, '').replace(/^wf-node-/, '');
      const definition = NODE_TYPES.find(item => item.id === type);
      if (!definition) return;
      node.name = type;
      node.class = `ac-node-${type}`;
      node.html = buildNodeHtml(type, node.data || {});
    });
    historyApplying = true;
    editor.clear();
    editor.import(graph);
    historyApplying = false;
    Object.keys(home).forEach(id => makeNodeResizable(id));
    updateEmptyGuide();
    syncAgentContext();
    document.getElementById('ac-save-status').textContent = '已加载';
  } catch (error) {
    historyApplying = false;
    toast(error.message || '画布加载失败', 'error');
  }
}

function canvasSnapshot() {
  return JSON.stringify(editor.export());
}

function resetCanvasHistory() {
  canvasHistory = [canvasSnapshot()];
  canvasHistoryIndex = 0;
  updateHistoryButtons();
}

function captureCanvasHistory() {
  if (historyApplying || !editor) return;
  const snapshot = canvasSnapshot();
  if (canvasHistory[canvasHistoryIndex] === snapshot) return;
  canvasHistory = canvasHistory.slice(0, canvasHistoryIndex + 1);
  canvasHistory.push(snapshot);
  if (canvasHistory.length > 50) canvasHistory.shift();
  canvasHistoryIndex = canvasHistory.length - 1;
  updateHistoryButtons();
}

function updateHistoryButtons() {
  const undo = document.getElementById('ac-undo-btn');
  const redo = document.getElementById('ac-redo-btn');
  if (undo) undo.disabled = canvasHistoryIndex <= 0;
  if (redo) redo.disabled = canvasHistoryIndex < 0 || canvasHistoryIndex >= canvasHistory.length - 1;
}

function restoreCanvasSnapshot(index) {
  if (index < 0 || index >= canvasHistory.length) return;
  historyApplying = true;
  editor.clear();
  editor.import(JSON.parse(canvasHistory[index]));
  canvasHistoryIndex = index;
  const nodes = editor.drawflow?.drawflow?.Home?.data || {};
  Object.keys(nodes).forEach(id => makeNodeResizable(id));
  historyApplying = false;
  updateHistoryButtons();
  updateEmptyGuide();
  syncAgentContext();
  scheduleSave();
}

function undoCanvas() { restoreCanvasSnapshot(canvasHistoryIndex - 1); }
function redoCanvas() { restoreCanvasSnapshot(canvasHistoryIndex + 1); }

async function saveCanvasNow() {
  clearTimeout(saveTimer);
  document.getElementById('ac-save-status').textContent = '保存中…';
  const ok = await doSave();
  toast(ok ? '画布已保存' : '画布保存失败', ok ? 'success' : 'error');
}

function toggleCanvasTheme() {
  const current = window.vidoTheme?.current?.() || document.documentElement.dataset.theme || 'purple';
  window.vidoTheme?.store?.(current === 'light-mist' ? 'purple' : 'light-mist');
}

function syncAgentContext() {
  if (!editor) return;
  const nodes = editor.drawflow?.drawflow?.Home?.data || {};
  const selected = document.querySelector('.drawflow-node.selected');
  const selectedId = selected?.id?.replace('node-', '');
  const summarize = (node, id) => ({
    id: String(id),
    type: String(node.name || node.class || '').replace(/^ac-node-/, ''),
    label: NODE_TYPES.find(item => item.id === String(node.name || node.class || '').replace(/^ac-node-/, ''))?.label || node.name || '节点',
    prompt: String(node.data?.prompt || '').slice(0, 500),
    result: typeof node.data?.result === 'string' ? node.data.result.slice(0, 500) : String(node.data?.result?.text || '').slice(0, 500)
  });
  agentContext = {
    selected_nodes: selectedId && nodes[selectedId] ? [summarize(nodes[selectedId], selectedId)] : [],
    canvas_nodes: Object.entries(nodes).slice(0, 30).map(([id, node]) => summarize(node, id)),
    project_name: document.getElementById('ac-project-name')?.value || '未命名项目'
  };
}

function getCanvasExecutionOrder() {
  const nodes = editor.drawflow?.drawflow?.Home?.data || {};
  const ids = Object.keys(nodes);
  const indegree = Object.fromEntries(ids.map(id => [id, 0]));
  const edges = Object.fromEntries(ids.map(id => [id, []]));
  ids.forEach((id) => {
    Object.values(nodes[id].outputs || {}).forEach(output => (output.connections || []).forEach((connection) => {
      const target = String(connection.node);
      if (!(target in indegree)) return;
      edges[id].push(target);
      indegree[target] += 1;
    }));
  });
  const queue = ids.filter(id => indegree[id] === 0);
  const ordered = [];
  while (queue.length) {
    const id = queue.shift();
    ordered.push(id);
    edges[id].forEach((target) => { if (--indegree[target] === 0) queue.push(target); });
  }
  if (ordered.length !== ids.length) throw new Error('画布中存在循环连接，请先断开循环后再运行');
  return ordered;
}

function setRunProgress(current, total, text) {
  const panel = document.getElementById('ac-run-progress');
  panel?.classList.toggle('show', total > 0);
  const label = document.getElementById('ac-run-progress-text');
  const count = document.getElementById('ac-run-progress-count');
  const bar = document.getElementById('ac-run-progress-bar');
  if (label) label.textContent = text || '正在运行';
  if (count) count.textContent = `${current}/${total}`;
  if (bar) bar.style.width = `${total ? Math.round(current / total * 100) : 0}%`;
}

async function runCanvasWorkflow() {
  if (workflowRunning) return;
  const order = getCanvasExecutionOrder();
  if (!order.length) return toast('请先添加或选择一个工作流模板', 'info');
  const runnable = order;
  workflowRunning = true;
  const button = document.getElementById('ac-run-all-btn');
  if (button) button.disabled = true;
  setRunProgress(0, runnable.length, '准备运行工作流');
  try {
    for (let index = 0; index < runnable.length; index++) {
      const id = runnable[index];
      const node = editor.drawflow.drawflow.Home.data[id];
      const type = String(node.name || node.class || '').replace(/^ac-node-/, '');
      setRunProgress(index, runnable.length, `正在运行 ${NODE_TYPES.find(item => item.id === type)?.label || type}`);
      const success = await runNode(Number(id));
      if (!success) throw new Error(`${NODE_TYPES.find(item => item.id === type)?.label || type} 节点运行失败，工作流已停止`);
      setRunProgress(index + 1, runnable.length, `${NODE_TYPES.find(item => item.id === type)?.label || type} 已完成`);
    }
    await doSave();
    toast('工作流运行完成', 'success');
  } catch (error) {
    toast(error.message || '工作流运行失败', 'error');
  } finally {
    workflowRunning = false;
    if (button) button.disabled = false;
    setTimeout(() => setRunProgress(0, 0, ''), 900);
  }
}

function autoLayoutCanvas() {
  const nodes = editor.drawflow?.drawflow?.Home?.data || {};
  const order = getCanvasExecutionOrder();
  const depth = {};
  order.forEach((id) => {
    let value = 0;
    Object.values(nodes[id].inputs || {}).forEach(input => (input.connections || []).forEach(connection => {
      value = Math.max(value, (depth[String(connection.node)] || 0) + 1);
    }));
    depth[id] = value;
  });
  const rows = {};
  order.forEach((id) => {
    const column = depth[id] || 0;
    rows[column] = rows[column] || 0;
    const x = 130 + column * 340;
    const y = 110 + rows[column]++ * 260;
    nodes[id].pos_x = x;
    nodes[id].pos_y = y;
    const element = document.getElementById(`node-${id}`);
    if (element) { element.style.left = `${x}px`; element.style.top = `${y}px`; }
    editor.updateConnectionNodes(`node-${id}`);
  });
  onCanvasMutated();
  fitView();
  toast('节点已自动整理', 'success');
}

// ═══ 节点构建 ═══
function buildNodeHtml(type, data) {
  const t = NODE_TYPES.find(n => n.id === type);
  if (!t) return '';
  const body = buildNodeBody(type, data || {});
  return `
    <div class="ac-node-wrap">
      <div class="ac-node-header"><span class="ac-node-header-icon">${t.icon}</span><span>${t.label}</span></div>
      <div class="ac-node-body" data-type="${type}">${body}</div>
    </div>
  `;
}

function buildNodeBody(type, data) {
  const prompt = escapeHtml(data.prompt || '');
  const result = data.result ? renderResult(type, data.result) : '';

  const hasExamples = (NODE_EXAMPLES[type] || []).length > 0;
  const promptHead = hasExamples
    ? `<div class="ac-node-prompt-head">
         <span class="ac-node-prompt-label">提示词</span>
         <button type="button" class="ac-example-btn" onclick="useExampleBtn(this,'${type}')" title="填入参考样例">💡 参考样例</button>
       </div>`
    : '';
  const promptField = `${promptHead}<textarea class="ac-node-prompt" placeholder="${promptPlaceholder(type)}" df-prompt>${prompt}</textarea>`;
  const resultField = `<div class="ac-node-result">${result}</div>`;
  const runBtn = `<button class="ac-node-run" onclick="runNodeBtn(this)">▶ 运行</button>`;

  const caps = buildCapRow(type, data);

  switch (type) {
    case 'text':
      return `
        ${promptField}
        ${resultField}
        ${caps}
        <div class="ac-node-footer">
          <span class="ac-node-info">⊙ 5</span>
          ${runBtn}
        </div>`;
    case 'image':
    case 'background':
      return `
        ${promptField}
        ${resultField}
        ${caps}
        <div class="ac-node-footer">
          <span class="ac-node-info">⊙ 10</span>
          ${runBtn}
        </div>`;
    case 'character':
      return `
        ${promptField}
        ${resultField}
        ${caps}
        <div class="ac-node-footer">
          <span class="ac-node-info">⊙ 60 · 6 视图</span>
          ${runBtn}
        </div>`;
    case 'i2v':
      return `
        <div class="ac-node-upload ${data.image_url ? 'has-file' : ''}" onclick="uploadImgForNode(this)">
          ${data.image_url ? `<img src="${escapeAttr(data.image_url)}" />` : '📤 点击上传图片 <span style="opacity:.6">或连接上游图片节点</span>'}
        </div>
        <input type="hidden" df-image_url value="${escapeAttr(data.image_url || '')}" />
        ${promptField}
        ${resultField}
        ${caps}
        <div class="ac-node-footer">
          <span class="ac-node-info">⊙ 50</span>
          ${runBtn}
        </div>`;
    case 'avatar':
      return `
        <div class="ac-node-upload ${data.image_url ? 'has-file' : ''}" onclick="uploadImgForNode(this)">
          ${data.image_url ? `<img src="${escapeAttr(data.image_url)}" />` : '📤 上传人物正脸照'}
        </div>
        <input type="hidden" df-image_url value="${escapeAttr(data.image_url || '')}" />
        ${promptField}
        ${resultField}
        ${caps}
        <div class="ac-node-footer">
          <span class="ac-node-info">⊙ 30</span>
          ${runBtn}
        </div>`;
    case 'voice':
      return `
        ${promptField}
        ${resultField}
        ${caps}
        <div class="ac-node-footer">
          <span class="ac-node-info">⊙ 5</span>
          ${runBtn}
        </div>`;
    case 'music':
      return `
        ${promptField}
        ${resultField}
        ${caps}
        <div class="ac-node-footer">
          <span class="ac-node-info">⊙ 20</span>
          ${runBtn}
        </div>`;
    case 'video':
      return `
        ${promptField}
        ${resultField}
        ${caps}
        <div class="ac-node-footer">
          <span class="ac-node-info">连接图片后生成视频</span>
          ${runBtn}
        </div>`;
    case 'merge':
      return `
        <div class="ac-node-placeholder" style="text-align:center;color:var(--ac-text3);padding:18px 12px 10px;font-size:12px">连接一个或多个视频节点，按顺序合成为最终成片</div>
        ${resultField}
        <div class="ac-node-footer"><span class="ac-node-info">最终输出</span>${runBtn}</div>`;
    default:
      return '<div class="ac-node-placeholder">未知节点类型</div>';
  }
}

function promptPlaceholder(type) {
  return {
    text: '描述你想写的内容，LLM 会生成文字...',
    image: '描述图片内容、风格、光线...',
    background: '描述场景：山/海/城市/废墟...',
    character: '描述角色：外形/服饰/性格...',
    i2v: '描述图片如何动起来...',
    video: '描述视频内容...',
    avatar: '要朗读的台词文本...',
    voice: '要朗读的文本...',
    music: '风格描述：流行/古风/摇滚...',
    merge: ''
  }[type] || '提示词...';
}

function renderResult(type, result) {
  if (!result) return '';
  if (typeof result === 'string' && result.startsWith('ERROR:')) {
    return `<div class="ac-error">${escapeHtml(result.slice(6))}</div>`;
  }
  if (type === 'text' || type === 'voice') {
    if (typeof result === 'string') return `<div class="ac-text-out">${escapeHtml(result)}</div>`;
    if (result.text) return `<div class="ac-text-out">${escapeHtml(result.text)}</div>`;
  }
  // 人物形象 — 6 图网格
  if (type === 'character' && Array.isArray(result.images)) {
    const cells = result.images.map((r, i) => {
      if (r.image_url) {
        return `<img src="${escapeAttr(r.image_url)}" title="${escapeAttr(r.label || '')}" ${i === 0 ? 'class="primary"' : ''} />`;
      }
      return `<div class="ac-char-slot error">✗ ${escapeHtml((r.error || '失败').slice(0, 10))}</div>`;
    }).join('');
    return `<div class="ac-char-grid">${cells}</div>`;
  }
  if (result.image_url || result.imageUrl) {
    return `<img src="${escapeAttr(result.image_url || result.imageUrl)}" />`;
  }
  if (result.video_url || result.videoUrl) {
    return `<video src="${escapeAttr(result.video_url || result.videoUrl)}" controls />`;
  }
  if (result.audio_url || result.audioUrl) {
    return `<audio src="${escapeAttr(result.audio_url || result.audioUrl)}" controls />`;
  }
  return '';
}

// ═══ 节点添加 ═══
function addNodeAt(type, clientX, clientY, data) {
  const t = NODE_TYPES.find(n => n.id === type);
  if (!t) return null;
  const rect = document.getElementById('drawflow').getBoundingClientRect();
  const cx = (clientX - rect.left - editor.canvas_x) / editor.zoom;
  const cy = (clientY - rect.top - editor.canvas_y) / editor.zoom;
  const nodeData = Object.assign({ prompt: '' }, data || {});
  const id = editor.addNode(type, t.inputs, t.outputs, cx, cy, `ac-node-${type}`, nodeData, buildNodeHtml(type, nodeData));
  // 节点右下角 resize handle 区域屏蔽 Drawflow 拖拽
  makeNodeResizable(id);
  return id;
}

function makeNodeResizable(nodeId) {
  // 让右下角原生 resize 手柄不被 Drawflow 捕获为拖拽
  const el = findNodeElement(nodeId);
  if (!el) return;
  const body = el.querySelector('.ac-node-body');
  if (!body) return;
  body.addEventListener('mousedown', (e) => {
    const rect = body.getBoundingClientRect();
    // 右下 18x18 像素是原生 resize 握柄
    if (e.clientX > rect.right - 18 && e.clientY > rect.bottom - 18) {
      e.stopPropagation();
    }
  }, true);
  // 同时让 textarea、input、button 的点击不触发 Drawflow 的拖拽
  body.querySelectorAll('textarea, input, select, button').forEach(inp => {
    inp.addEventListener('mousedown', (ev) => ev.stopPropagation());
  });
}

function addNodeCenter(type, data) {
  const rect = document.getElementById('drawflow').getBoundingClientRect();
  return addNodeAt(type, rect.left + rect.width / 2, rect.top + rect.height / 2, data);
}

// ═══ 节点库弹出 ═══
function openAddNodeMenu(e) {
  const ref = (e && e.currentTarget) || document.querySelector('.ac-tb-plus');
  const rect = ref.getBoundingClientRect();
  showNodePalette(rect.right + 12, rect.top, (type) => addNodeCenter(type));
}

function showNodePalette(x, y, callback) {
  paletteCallback = callback;
  const palette = document.getElementById('ac-node-palette');
  palette.style.left = Math.min(x, window.innerWidth - 320) + 'px';
  palette.style.top = Math.min(y, window.innerHeight - 440) + 'px';
  palette.classList.add('show');
  const search = document.getElementById('ac-palette-search');
  search.value = '';
  renderNodePalette('');
  setTimeout(() => search.focus(), 40);
}

function hideNodePalette() {
  const p = document.getElementById('ac-node-palette');
  if (p) p.classList.remove('show');
}

function renderNodePalette(filter) {
  const lo = (filter || '').toLowerCase();
  const list = document.getElementById('ac-palette-list');
  const items = NODE_TYPES.filter(t =>
    !lo || t.id.includes(lo) || t.label.toLowerCase().includes(lo) || t.desc.includes(lo)
  );
  // 按 group 分组渲染
  const groups = {};
  items.forEach(t => { (groups[t.group] = groups[t.group] || []).push(t); });
  let html = '';
  for (const g of Object.keys(groups)) {
    html += `<div class="ac-palette-group">${g}</div>`;
    html += groups[g].map(t => `
      <div class="ac-palette-item" onclick="selectNodeFromPalette('${t.id}')">
        <span class="ac-palette-item-icon">${t.icon}</span>
        <span class="ac-palette-item-name">${t.label}</span>
        <span class="ac-palette-item-desc">${t.desc}</span>
      </div>
    `).join('');
  }
  list.innerHTML = html || '<div class="ac-palette-item">无匹配节点</div>';
}

function filterNodePalette(v) { renderNodePalette(v); }

function selectNodeFromPalette(type) {
  if (paletteCallback) paletteCallback(type);
  hideNodePalette();
}

// ═══ 画布事件 ═══
function initCanvasEvents() {
  const container = document.getElementById('drawflow');

  // 双击空白 → 节点库
  container.addEventListener('dblclick', (e) => {
    if (e.target.closest('.drawflow-node')) return;
    if (e.target.closest('.ac-empty-guide')) return;
    showNodePalette(e.clientX, e.clientY, (type) => addNodeAt(type, e.clientX, e.clientY));
  });

  // 点击外部关闭面板
  document.addEventListener('mousedown', (e) => {
    if (!e.target.closest('.ac-node-palette') &&
        !e.target.closest('.ac-tb-plus') &&
        !e.target.closest('.ac-tb-btn')) {
      hideNodePalette();
    }
  });
}

function initKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hideNodePalette();
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      openAddNodeMenu();
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      saveCanvasNow();
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) redoCanvas(); else undoCanvas();
    }
  });
}

// ═══ 快捷创建（带真实参考样例预填） ═══
function quickCreate(preset) {
  const presets = {
    text2video: [
      ['text',  { prompt: getRandomExample('text') }],
      ['image', { prompt: getRandomExample('image') }],
      ['i2v',   { prompt: getRandomExample('i2v') }]
    ],
    img2bg: [
      ['character',  { prompt: getRandomExample('character') }],
      ['background', { prompt: getRandomExample('background') }]
    ],
    i2v: [
      ['image', { prompt: getRandomExample('image') }],
      ['i2v',   { prompt: getRandomExample('i2v') }]
    ],
    music2video: [
      ['music', { prompt: getRandomExample('music') }],
      ['image', { prompt: getRandomExample('image') }],
      ['i2v',   { prompt: getRandomExample('i2v') }]
    ]
  };
  const set = presets[preset];
  if (!set) return;
  const rect = document.getElementById('drawflow').getBoundingClientRect();
  const cx = rect.left + rect.width / 2 - 360;
  const cy = rect.top + rect.height / 2 - 60;
  const ids = [];
  set.forEach(([type, data], i) => {
    const id = addNodeAt(type, cx + i * 340, cy, data);
    if (id) ids.push(id);
  });
  // 自动连线
  for (let i = 0; i < ids.length - 1; i++) {
    try { editor.addConnection(ids[i], ids[i + 1], 'output_1', 'input_1'); } catch {}
  }
  toast('✓ 已创建 ' + set.length + ' 个节点，样例提示词已预填', 'success');
}

// ═══ 缩放 ═══
function onZoomSlider(value) {
  const z = parseInt(value, 10) / 100;
  editor.zoom = z;
  editor.zoom_refresh();
  const v = document.getElementById('ac-zoom-val');
  if (v) v.textContent = value + '%';
}
function fitView() { editor.zoom_reset(); setTimeout(updateZoomDisplay, 100); }
function toggleGrid() { document.querySelector('.ac-canvas').classList.toggle('no-grid'); }

// ═══ Agent 面板 ═══
function toggleAgent() {
  const panel = document.getElementById('ac-agent');
  const fab = document.getElementById('ac-agent-fab');
  const canvasArea = document.querySelector('.ac-canvas-area');
  const hidden = panel.classList.toggle('hidden');
  if (fab) fab.style.display = hidden ? 'flex' : 'none';
  // 画布区域占满右侧
  if (canvasArea) canvasArea.style.right = hidden ? '0' : 'var(--ac-agent-w)';
}

function newAgentChat() {
  agentHistory = [];
  agentContext = { selected_nodes: [] };
  renderAgentBody();
}

function agentStarter(text) {
  document.getElementById('ac-agent-input').value = text;
  sendAgentMessage();
}

async function sendAgentMessage() {
  if (agentBusy) return;
  const input = document.getElementById('ac-agent-input');
  const message = input.value.trim();
  if (!message) return;

  agentHistory.push({ role: 'user', content: message });
  input.value = '';
  document.getElementById('ac-agent-welcome').style.display = 'none';
  renderAgentBody();

  syncAgentContext();
  const assistant = { role: 'assistant', content: '', phases: [], actions: [], _streaming: true };
  agentHistory.push(assistant);
  renderAgentBody();
  agentBusy = true;
  const sendBtn = document.getElementById('ac-agent-send-btn');
  if (sendBtn) sendBtn.disabled = true;

  try {
    const histForSend = agentHistory.slice(0, -2).map(item => ({ role: item.role, content: item.content }));
    const response = await authFetch('/api/agent/chat-stream', {
      method: 'POST',
      body: JSON.stringify({ message, context: agentContext, history: histForSend })
    });
    if (!response.ok || !response.body) throw new Error(`助手请求失败（${response.status}）`);
    await consumeAgentStream(response, assistant);
  } catch (e) {
    assistant.content = '⚠ ' + e.message;
    assistant._streaming = false;
    assistant.phases = assistant.phases.map(phase => phase.state === 'running' ? { ...phase, state: 'error' } : phase);
  } finally {
    agentBusy = false;
    if (sendBtn) sendBtn.disabled = false;
    renderAgentBody();
  }
}

async function consumeAgentStream(response, assistant) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const dispatch = (block) => {
    let event = 'message';
    let data = null;
    block.split(/\r?\n/).forEach((line) => {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      if (line.startsWith('data:')) {
        try { data = JSON.parse(line.slice(5).trim()); } catch {}
      }
    });
    if (!data) return;
    if (event === 'phase') {
      const index = assistant.phases.findIndex(item => item.id === data.id);
      if (index >= 0) assistant.phases[index] = data; else assistant.phases.push(data);
    } else if (event === 'chunk') {
      assistant.content += `${assistant.content ? '\n' : ''}${data.text || ''}`;
    } else if (event === 'actions') {
      assistant.actions = Array.isArray(data.actions) ? data.actions : [];
    } else if (event === 'done') {
      assistant.content = data.reply || assistant.content;
      assistant._streaming = false;
    } else if (event === 'error') {
      assistant.content = `⚠ ${data.error || '生成失败'}`;
      assistant._streaming = false;
      assistant.phases = assistant.phases.map(phase => phase.state === 'running' ? { ...phase, state: 'error' } : phase);
    }
    renderAgentBody();
  };
  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() || '';
    blocks.forEach(dispatch);
    if (done) break;
  }
  if (buffer.trim()) dispatch(buffer);
  assistant._streaming = false;
}

// 稳健的 JSON 请求：如果响应是 HTML（错误页），抛出清晰错误
async function safeFetchJSON(url, opts) {
  const resp = await authFetch(url, opts);
  const ct = (resp.headers && resp.headers.get && resp.headers.get('content-type')) || '';
  const text = await resp.text();
  if (text.trim().startsWith('<')) {
    // HTML 响应 — 可能是认证/权限问题或路由缺失
    if (resp.status === 401) throw new Error('未登录或会话过期，请刷新页面重新登录');
    if (resp.status === 403) throw new Error('没有访问权限（需要 aicanvas 权限）');
    if (resp.status === 404) throw new Error('接口不存在：' + url);
    throw new Error(`服务器返回 HTML（${resp.status}）— 可能是旧缓存。请 Ctrl+F5 强刷页面`);
  }
  if (!ct.includes('application/json')) {
    // 非 JSON 但也不是 HTML — 直接抛
    throw new Error(`响应格式错误（${resp.status}）: ` + text.slice(0, 80));
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error('JSON 解析失败: ' + text.slice(0, 100));
  }
}

function renderAgentBody() {
  const body = document.getElementById('ac-agent-body');
  const welcome = document.getElementById('ac-agent-welcome');
  body.querySelectorAll('.ac-message').forEach(el => el.remove());
  if (agentHistory.length === 0) {
    if (welcome) welcome.style.display = '';
    return;
  }
  if (welcome) welcome.style.display = 'none';
  agentHistory.forEach((m, messageIndex) => {
    const div = document.createElement('div');
    div.className = `ac-message ${m.role}${m._streaming ? ' is-streaming' : ''}`;
    if (m.role === 'user') {
      div.innerHTML = `<div class="ac-message-bubble">${escapeHtml(m.content)}</div>`;
    } else {
      const phases = (m.phases || []).map((phase) => `<div class="ac-agent-phase ${escapeAttr(phase.state || '')}"><i>${phase.state === 'done' ? '✓' : phase.state === 'error' ? '!' : '·'}</i><span>${escapeHtml(phase.label || '')}</span><em>${phase.state === 'done' ? '完成' : phase.state === 'error' ? '失败' : '处理中'}</em></div>`).join('');
      const answer = m.content ? `<div class="ac-agent-answer">${renderMarkdown(m.content)}</div>` : '';
      const actions = (m.actions || []).map((action, actionIndex) => `<button class="ac-agent-action" onclick="applyAgentAction(${messageIndex},${actionIndex})">${escapeHtml(action.label || '应用到画布')}</button>`).join('');
      div.innerHTML = `<div class="ac-message-bubble">${phases ? `<div class="ac-agent-waterfall">${phases}</div>` : ''}${answer}${actions ? `<div class="ac-agent-actions">${actions}</div>` : ''}</div>`;
    }
    body.appendChild(div);
  });
  body.scrollTop = body.scrollHeight;
}

function applyAgentAction(messageIndex, actionIndex) {
  const message = agentHistory[messageIndex];
  const action = message?.actions?.[actionIndex];
  if (!action) return;
  const text = String(action.payload?.text || message.content || '').trim();
  if (!text) return toast('没有可应用的内容', 'info');
  const id = addNodeCenter('text', { prompt: text, result: { text } });
  if (id == null) return toast('添加节点失败', 'error');
  captureCanvasHistory();
  syncAgentContext();
  toast(action.type === 'add_next_step' ? '已作为下一步加入画布' : '已添加为文本节点', 'success');
}

function initAgentEvents() {
  const input = document.getElementById('ac-agent-input');
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendAgentMessage();
    }
  });
}

// ═══ 节点运行时 — 核心逻辑 ═══
// 每个节点的 run 函数：收集输入 → 调 API → 更新 data.result → 重渲染

function findNodeElement(nodeId) {
  return document.getElementById('node-' + nodeId);
}

// 从节点 DOM 收集所有 df-* 属性字段写回 Drawflow data
function collectNodeData(nodeId) {
  const el = findNodeElement(nodeId);
  if (!el) return {};
  const data = {};
  el.querySelectorAll('textarea, input, select').forEach(inp => {
    for (let i = 0; i < inp.attributes.length; i++) {
      const attr = inp.attributes[i];
      if (attr.name.startsWith('df-')) {
        data[attr.name.slice(3)] = inp.value;
      }
    }
  });
  return data;
}

// 从上游节点取输入值（若节点自己没填 prompt）
function getUpstreamText(nodeId) {
  const node = editor.drawflow.drawflow.Home.data[nodeId];
  if (!node || !node.inputs) return '';
  for (const key of Object.keys(node.inputs)) {
    const conns = node.inputs[key].connections || [];
    for (const c of conns) {
      const up = editor.drawflow.drawflow.Home.data[c.node];
      if (!up) continue;
      const r = up.data && up.data.result;
      if (typeof r === 'string') return r;
      if (r && r.text) return r.text;
    }
  }
  return '';
}

function getUpstreamImageUrl(nodeId) {
  const node = editor.drawflow.drawflow.Home.data[nodeId];
  if (!node || !node.inputs) return '';
  for (const key of Object.keys(node.inputs)) {
    const conns = node.inputs[key].connections || [];
    for (const c of conns) {
      const up = editor.drawflow.drawflow.Home.data[c.node];
      if (!up) continue;
      const r = up.data && up.data.result;
      if (r && (r.image_url || r.imageUrl)) return r.image_url || r.imageUrl;
    }
  }
  return '';
}

// 从 DOM button 反查 nodeId
function runNodeBtn(btn) {
  const nodeEl = btn.closest('.drawflow-node');
  if (!nodeEl) return;
  const nodeId = parseInt(nodeEl.id.replace('node-', ''), 10);
  runNode(nodeId);
}

async function runNode(nodeId) {
  const node = editor.drawflow.drawflow.Home.data[nodeId];
  if (!node) return false;
  const type = String(node.name || node.class || '').replace('ac-node-', '');
  const fields = collectNodeData(nodeId);
  // 写回 Drawflow data
  editor.updateNodeDataFromId(nodeId, Object.assign({}, node.data, fields));

  // 取 prompt：优先节点自己的，否则用上游
  let prompt = fields.prompt || '';
  if (!prompt) prompt = getUpstreamText(nodeId);

  const el = findNodeElement(nodeId);
  const resultEl = el.querySelector('.ac-node-result');
  const runBtn = el.querySelector('.ac-node-run');
  if (runBtn) runBtn.disabled = true;
  if (resultEl) resultEl.innerHTML = '<div class="ac-loading">生成中...</div>';

  try {
    let result;
    switch (type) {
      case 'text':       result = await runText(prompt, fields); break;
      case 'image':      result = await runImage(prompt, fields); break;
      case 'background': result = await runBackground(prompt, fields); break;
      case 'character':  result = await runCharacter(prompt, fields, nodeId); break;
      case 'i2v':        result = await runI2V(prompt, fields, nodeId); break;
      case 'video':      result = await runI2V(prompt, fields, nodeId); break;
      case 'avatar':     result = await runAvatar(prompt, fields, nodeId); break;
      case 'voice':      result = await runVoice(prompt, fields); break;
      case 'music':      result = await runMusic(prompt, fields); break;
      case 'merge':      result = await runMerge(nodeId); break;
      default:           throw new Error('该节点暂未接入 API');
    }
    editor.updateNodeDataFromId(nodeId, Object.assign({}, node.data, fields, { result }));
    if (resultEl) resultEl.innerHTML = renderResult(type, result);
    toast('✓ ' + type + ' 已完成', 'success');
    return true;
  } catch (e) {
    if (resultEl) resultEl.innerHTML = `<div class="ac-error">⚠ ${escapeHtml(e.message)}</div>`;
    toast('⚠ ' + e.message, 'error');
    return false;
  } finally {
    if (runBtn) runBtn.disabled = false;
  }
}

// ═══ 各节点 runner — 对接后端 API ═══

async function runText(prompt, fields) {
  if (!prompt) throw new Error('请填写提示词');
  // 带上风格和长度
  const styleLabel = (NODE_CAPABILITIES.text.style.options.find(o => o.id === fields.style) || {}).label || '';
  const lengthLabel = (NODE_CAPABILITIES.text.length.options.find(o => o.id === fields.length) || {}).label || '';
  const augPrompt = `${prompt}\n\n要求：${styleLabel || '自然流畅'}风格，${lengthLabel || '中等长度'}。`;
  const data = await safeFetchJSON('/api/agent/run-text', {
    method: 'POST', body: JSON.stringify({ prompt: augPrompt, style: styleLabel })
  });
  if (!data.success) throw new Error(data.error || '文本生成失败');
  return { text: data.text };
}

async function runImage(prompt, fields) {
  if (!prompt) throw new Error('请填写提示词');
  const styleLabel = (NODE_CAPABILITIES.image.style.options.find(o => o.id === fields.style) || {}).label || '';
  // 清理 emoji 前缀
  const cleanStyle = styleLabel.replace(/^[^\u4e00-\u9fa5A-Za-z]+\s*/, '');
  const fullPrompt = cleanStyle ? `${prompt}，${cleanStyle}风格` : prompt;
  const data = await safeFetchJSON('/api/imggen/generate', {
    method: 'POST',
    body: JSON.stringify({
      prompt: fullPrompt,
      size: fields.aspect || '1:1',
      count: 1,
      model: fields.model === 'agent' ? undefined : fields.model,
      style: cleanStyle
    })
  });
  if (!data.images || !data.images.length) throw new Error(data.error || data.message || '图片生成失败');
  return { image_url: data.images[0] };
}

async function runBackground(prompt, fields) {
  if (!prompt) throw new Error('请填写场景描述');
  const timeLabel = (NODE_CAPABILITIES.background.time.options.find(o => o.id === fields.time) || {}).label || '';
  const cleanTime = timeLabel.replace(/^[^\u4e00-\u9fa5A-Za-z]+\s*/, '');
  const data = await safeFetchJSON('/api/story/generate-scene-image', {
    method: 'POST', body: JSON.stringify({
      title: prompt.slice(0, 30),
      description: cleanTime ? `${prompt}，${cleanTime}时段` : prompt,
      aspectRatio: fields.aspect || '16:9',
      timeOfDay: cleanTime,
      image_model: _canvasModelToProvider(fields?.model),
    })
  });
  if (!data.success) throw new Error(data.error || '场景生成失败');
  return { image_url: data.data.imageUrl };
}

// 人物形象节点 — 生成 6 个角度（正面/侧面/背面/3-4 视角/头部特写/动作姿势）
// 确保角色立体、贯穿整个画布和网剧模块使用
const CHARACTER_VIEWS = [
  { key: 'front',     label: '正面全身',   modifier: '正面全身站立，中性表情，T-Pose 姿势' },
  { key: 'side',      label: '侧面',       modifier: '侧面全身站立，完整展示角色轮廓' },
  { key: 'back',      label: '背面',       modifier: '背面全身站立，展示发型和服装背面细节' },
  { key: 'three-q',   label: '3/4 视角',   modifier: '3/4 视角全身，略微转身' },
  { key: 'portrait',  label: '头像特写',   modifier: '头部肩部特写，正面，微笑' },
  { key: 'action',    label: '动作姿势',   modifier: '充满张力的动作姿势，动感十足，电影感' }
];

// Canvas UI 模型 id → 真实 provider id 映射（严格模式，避免 fallback）
function _canvasModelToProvider(m) {
  const map = {
    'flux-pro':    'mxapi',
    'sd3':         'stability',
    'dalle3':      'openai',
    'jimeng-4':    'jimeng',
    'cogview':     'zhipu',
    'nano-banana': 'nanobanana',
  };
  return map[m] || m || '';
}

async function runCharacter(prompt, fields, nodeId) {
  if (!prompt) throw new Error('请填写角色描述');
  // 在节点 result 区域先挂占位 6 格骨架
  if (nodeId != null) renderCharacterSlots(nodeId, CHARACTER_VIEWS.length);

  const chosenModel = _canvasModelToProvider(fields?.model);

  // 并行生成 6 张
  const tasks = CHARACTER_VIEWS.map((v, i) =>
    safeFetchJSON('/api/story/generate-character-image', {
      method: 'POST',
      body: JSON.stringify({
        name: prompt.slice(0, 20) || '角色',
        description: prompt + '，' + v.modifier,
        aspectRatio: (fields?.aspect) || '1:1',
        mode: 'single',
        skipThreeView: true,
        image_model: chosenModel,
      })
    }).then(data => {
      if (!data.success) throw new Error(data.error || '生成失败');
      const url = data.data.imageUrl;
      if (nodeId != null) updateCharacterSlot(nodeId, i, url, null);
      return { key: v.key, label: v.label, image_url: url };
    }).catch(err => {
      if (nodeId != null) updateCharacterSlot(nodeId, i, null, err.message);
      return { key: v.key, label: v.label, error: err.message };
    })
  );

  const results = await Promise.all(tasks);
  const images = results.filter(r => r.image_url).map(r => r.image_url);
  if (images.length === 0) {
    throw new Error('6 张角色图全部生成失败：' + (results[0]?.error || '未知原因'));
  }
  // result.images 是完整 6 张列表；image_url 是第一张（给下游用作参考）
  return {
    images: results,  // 保留每张的 key/label/image_url 或 error
    image_url: images[0]  // 下游节点取第一张作为参考
  };
}

function renderCharacterSlots(nodeId, count) {
  const el = findNodeElement(nodeId);
  if (!el) return;
  const resultEl = el.querySelector('.ac-node-result');
  if (!resultEl) return;
  const slots = CHARACTER_VIEWS.slice(0, count).map(v =>
    `<div class="ac-char-slot loading">${v.label}</div>`
  ).join('');
  resultEl.innerHTML = `<div class="ac-char-grid">${slots}</div>`;
}

function updateCharacterSlot(nodeId, index, imageUrl, errorMsg) {
  const el = findNodeElement(nodeId);
  if (!el) return;
  const slots = el.querySelectorAll('.ac-char-grid > *');
  if (!slots[index]) return;
  if (imageUrl) {
    const img = document.createElement('img');
    img.src = imageUrl;
    img.title = CHARACTER_VIEWS[index].label;
    if (index === 0) img.className = 'primary';
    slots[index].replaceWith(img);
  } else {
    slots[index].className = 'ac-char-slot error';
    slots[index].textContent = '✗ ' + (errorMsg || '失败').slice(0, 12);
  }
}

async function runI2V(prompt, fields, nodeId) {
  let imgUrl = fields.image_url;
  if (!imgUrl) imgUrl = getUpstreamImageUrl(nodeId);
  if (!imgUrl) throw new Error('请先上传图片或连接上游图片节点');
  if (!prompt) throw new Error('请填写运动描述');
  const motionLabel = (NODE_CAPABILITIES.i2v.motion.options.find(o => o.id === fields.motion) || {}).label || '';
  const cleanMotion = motionLabel.replace(/^[^\u4e00-\u9fa5A-Za-z]+\s*/, '');
  const fullPrompt = (cleanMotion && cleanMotion !== '智能') ? `${prompt}，镜头：${cleanMotion}` : prompt;
  const data = await safeFetchJSON('/api/i2v/generate', {
    method: 'POST', body: JSON.stringify({
      image_url: imgUrl,
      prompt: fullPrompt,
      duration: parseInt(fields.duration || '5', 10),
      model: fields.model || undefined
    })
  });
  if (!data.success) throw new Error(data.error || '视频任务启动失败');
  const taskId = data.data.id || data.data.taskId;
  return await pollI2V(taskId);
}

async function pollI2V(taskId) {
  for (let i = 0; i < 120; i++) {
    await new Promise(r => setTimeout(r, 5000));
    const data = await safeFetchJSON('/api/i2v/tasks/' + taskId);
    if (!data.success) throw new Error(data.error || '查询失败');
    const t = data.data;
    if (t.status === 'completed' || t.status === 'done') {
      return { video_url: `/api/i2v/tasks/${taskId}/stream` };
    }
    if (t.status === 'error' || t.status === 'failed') {
      throw new Error(t.error_message || '视频生成失败');
    }
  }
  throw new Error('视频生成超时');
}

function getUpstreamVideoUrls(nodeId) {
  const nodes = editor.drawflow?.drawflow?.Home?.data || {};
  const node = nodes[nodeId];
  const urls = [];
  Object.values(node?.inputs || {}).forEach(input => (input.connections || []).forEach(connection => {
    const upstream = nodes[String(connection.node)];
    const result = upstream?.data?.result;
    const url = result?.video_url || result?.videoUrl || '';
    if (url && !urls.includes(url)) urls.push(url);
  }));
  return urls;
}

async function runMerge(nodeId) {
  const videoUrls = getUpstreamVideoUrls(nodeId);
  if (!videoUrls.length) throw new Error('请至少连接一个已生成视频的上游节点');
  if (videoUrls.length === 1) return { video_url: videoUrls[0] };
  const submitted = await safeFetchJSON('/api/workflow/concat', {
    method: 'POST', body: JSON.stringify({ videoUrls })
  });
  if (!submitted.success || !submitted.taskId) throw new Error(submitted.error || '视频合成启动失败');
  for (let index = 0; index < 80; index++) {
    await new Promise(resolve => setTimeout(resolve, 3000));
    const status = await safeFetchJSON(`/api/workflow/effects/status/${encodeURIComponent(submitted.taskId)}`);
    const task = status.data || {};
    if (task.status === 'done') return { video_url: task.outputUrl };
    if (task.status === 'error' || task.status === 'failed') throw new Error(task.error || '视频合成失败');
  }
  throw new Error('视频合成超时');
}

async function runAvatar(prompt, fields, nodeId) {
  let imgUrl = fields.image_url || getUpstreamImageUrl(nodeId);
  if (!imgUrl) throw new Error('请先上传人物照片');
  if (!prompt) throw new Error('请填写朗读文本');
  const data = await safeFetchJSON('/api/avatar/generate', {
    method: 'POST', body: JSON.stringify({ image: imgUrl, text: prompt })
  });
  if (!data.success && !data.taskId) throw new Error(data.error || '任务启动失败');
  const taskId = data.taskId || data.data?.id;
  return await pollAvatar(taskId);
}

async function pollAvatar(taskId) {
  for (let i = 0; i < 120; i++) {
    await new Promise(r => setTimeout(r, 5000));
    const data = await safeFetchJSON('/api/avatar/tasks/' + taskId + '/status');
    if (data.status === 'done') return { video_url: data.videoUrl || `/api/avatar/tasks/${taskId}/stream` };
    if (data.status === 'error') throw new Error(data.error || '数字人生成失败');
  }
  throw new Error('数字人生成超时');
}

async function runVoice(prompt, fields) {
  if (!prompt) throw new Error('请填写要朗读的文本');
  const data = await safeFetchJSON('/api/workbench/synthesize', {
    method: 'POST', body: JSON.stringify({ text: prompt, voice_id: fields.voice || 'female' })
  });
  if (!data.success) throw new Error(data.error || '语音合成失败');
  return { audio_url: data.audio_url || data.url, text: prompt };
}

async function runMusic(prompt, fields) {
  const data = await safeFetchJSON('/api/projects/generate-music', {
    method: 'POST', body: JSON.stringify({
      genre: fields.genre || 'cinematic',
      mood: fields.mood || 'epic',
      duration: parseInt(fields.duration || '30', 10),
      scenes: prompt ? [{ description: prompt }] : undefined
    })
  });
  if (!data.success) throw new Error(data.error || '配乐生成失败');
  return { audio_url: data.data.file_url };
}

// ═══ 参考样例 —— 点击 💡 填入随机示例 ═══
function useExampleBtn(btn, type) {
  const nodeEl = btn.closest('.drawflow-node');
  if (!nodeEl) return;
  const promptEl = nodeEl.querySelector('[df-prompt]');
  if (!promptEl) return;
  const example = getRandomExample(type);
  if (!example) return;
  promptEl.value = example;
  promptEl.dispatchEvent(new Event('input', { bubbles: true }));
  // 把 prompt 写回 Drawflow data
  const nodeId = parseInt(nodeEl.id.replace('node-', ''), 10);
  const node = editor.drawflow.drawflow.Home.data[nodeId];
  if (node) editor.updateNodeDataFromId(nodeId, Object.assign({}, node.data, { prompt: example }));
}

// ═══ 图片上传（i2v / avatar） ═══
async function uploadImgForNode(uploadDiv) {
  const file = await pickFile('image/*');
  if (!file) return;
  toast('上传中...', 'info');
  const form = new FormData();
  form.append('image', file);
  try {
    const resp = await authFetch('/api/i2v/upload-image', { method: 'POST', body: form });
    const data = await resp.json();
    if (!data.success) { toast('上传失败: ' + (data.error || ''), 'error'); return; }
    const url = data.data.image_url || data.data.url;
    if (!url) { toast('上传返回格式错误', 'error'); return; }
    // 更新 UI — 立即显示本地 objectURL 作为优化（避免等服务器图片加载）
    const localUrl = URL.createObjectURL(file);
    uploadDiv.classList.add('has-file');
    uploadDiv.innerHTML = `<img src="${localUrl}" onload="this.dataset.ok=1" />`;
    // 预加载远程 URL 作为最终值，加载完替换
    const remoteImg = new Image();
    remoteImg.onload = () => {
      const img = uploadDiv.querySelector('img');
      if (img) img.src = url;
    };
    remoteImg.src = url;

    const hidden = uploadDiv.parentElement.querySelector('[df-image_url]');
    if (hidden) hidden.value = url;
    // 更新 Drawflow data
    const nodeEl = uploadDiv.closest('.drawflow-node');
    if (nodeEl) {
      const nodeId = parseInt(nodeEl.id.replace('node-', ''), 10);
      const node = editor.drawflow.drawflow.Home.data[nodeId];
      if (node) editor.updateNodeDataFromId(nodeId, Object.assign({}, node.data, { image_url: url }));
    }
    toast('✓ 图片已上传', 'success');
  } catch (e) {
    toast('上传失败: ' + e.message, 'error');
  }
}

function pickFile(accept) {
  return new Promise(resolve => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = accept || '*/*';
    inp.onchange = () => resolve(inp.files[0] || null);
    inp.click();
  });
}

// ═══ Toast ═══
function toast(msg, type) {
  const wrap = document.getElementById('ac-toast-wrap');
  if (!wrap) return;
  const el = document.createElement('div');
  el.className = 'ac-toast ' + (type || '');
  el.textContent = msg;
  wrap.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

// ═══ Helpers ═══
function escapeHtml(str) {
  if (str == null) return '';
  return String(str).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[m]));
}
function escapeAttr(str) { return escapeHtml(str); }

function openCanvasLibrary(title, kicker, html) {
  document.getElementById('ac-library-title').textContent = title;
  document.getElementById('ac-library-kicker').textContent = kicker || '视频画布';
  document.getElementById('ac-library-content').innerHTML = html;
  document.getElementById('ac-library-modal').hidden = false;
}

function closeCanvasLibrary() { document.getElementById('ac-library-modal').hidden = true; }

function openTemplates() {
  const templates = [
    ['text2video', '🎬', '文本生成短片', '文本 → 画面 → 视频，适合从一个想法开始'],
    ['img2bg', '🧑', '人物与场景', '人物形象与场景背景并行生成'],
    ['i2v', '✨', '首帧生成视频', '先生成首帧，再补充镜头运动'],
    ['music2video', '🎵', '配乐视觉短片', '配乐、画面和视频组合工作流']
  ];
  openCanvasLibrary('工作流模板', '统一视频画布', `<div class="ac-library-grid">${templates.map(([id, icon, title, desc]) => `<button class="ac-library-card" onclick="useCanvasTemplate('${id}')"><i>${icon}</i><span><b>${title}</b><span>${desc}</span></span><em>添加 →</em></button>`).join('')}</div>`);
}

function useCanvasTemplate(id) {
  closeCanvasLibrary();
  quickCreate(id);
  setTimeout(() => { autoLayoutCanvas(); captureCanvasHistory(); }, 80);
}

async function openHistory() {
  openCanvasLibrary('最近保存', '项目与版本', '<div class="ac-library-empty">正在加载…</div>');
  try {
    const data = await safeFetchJSON('/api/workflow');
    const rows = Array.isArray(data.data) ? data.data : [];
    document.getElementById('ac-library-content').innerHTML = rows.length
      ? `<div class="ac-library-grid">${rows.slice(0, 30).map(item => `<button class="ac-library-card" onclick="openWorkflowFromLibrary('${escapeAttr(item.id)}')"><i>▦</i><span><b>${escapeHtml(item.name || '未命名项目')}</b><span>${new Date(item.updated_at || item.created_at || Date.now()).toLocaleString()}</span></span><em>打开 →</em></button>`).join('')}</div>`
      : '<div class="ac-library-empty">还没有保存的画布</div>';
  } catch (error) {
    document.getElementById('ac-library-content').innerHTML = `<div class="ac-library-empty">${escapeHtml(error.message || '加载失败')}</div>`;
  }
}

async function openWorkflowFromLibrary(id) {
  closeCanvasLibrary();
  const url = new URL(location.href);
  url.searchParams.set('id', id);
  history.replaceState({}, '', url.pathname + url.search);
  await loadCanvasFromQuery();
  resetCanvasHistory();
}

function openAssets() {
  openCanvasLibrary('素材与作品', '平台资源', '<div class="ac-library-links"><a href="/index.html#assets"><b>我的素材库</b><span>复用已经上传或生成的人物、场景、图片和音频</span></a><a href="/index.html#works"><b>我的作品</b><span>查看已经生成和合成完成的视频</span></a><a href="/index.html#projects"><b>我的项目</b><span>从已有项目继续编辑</span></a></div>');
}
function openHelp() { toast('双击画布添加节点，Ctrl+K 打开节点库', 'info'); }
