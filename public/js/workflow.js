// ═══ VIDO Workflow Canvas ═══
// Drawflow-based node editor for AI video production pipeline

let editor;
let currentWorkflowId = null;
let nodeCounter = 0;
let contextMenuPos = { x: 300, y: 300 };
let _videoModels = [];  // 从 settings 动态加载的视频模型列表

// auth.js 已通过 <script> 标签引入，authFetch() 直接可用
// 页面加载时检查登录状态
(function checkAuth() {
  if (!getToken || !getToken()) {
    window.location.href = '/login.html';
  }
})();

// ═══ NODE HTML TEMPLATES ═══

function nodeHTML(type, nodeId) {
  const templates = {
    text: `
      <div class="wf-nd">
        <div class="wf-nd-header">
          <div class="wf-nd-header-icon wf-icon-text">T</div>
          <div class="wf-nd-header-title">文本</div>
          <div class="wf-nd-header-actions">
            <button class="wf-nd-btn-sm" onclick="toggleNodeBody(this)">折叠</button>
            <button class="wf-nd-btn-sm" onclick="deleteNode(this)">×</button>
          </div>
        </div>
        <div class="wf-nd-body" id="nd-body-${nodeId}">
          <div class="wf-nd-chips">
            <button class="wf-nd-chip active" onclick="setTextMode(this,'script')">短剧</button>
            <button class="wf-nd-chip" onclick="setTextMode(this,'action')">动作打斗</button>
            <button class="wf-nd-chip" onclick="setTextMode(this,'ad')">广告词</button>
            <button class="wf-nd-chip" onclick="setTextMode(this,'brand')">品牌文案</button>
            <button class="wf-nd-chip" onclick="setTextMode(this,'free')">自由文本</button>
          </div>
          <div class="wf-nd-label">内容来源</div>
          <div class="wf-nd-chips">
            <button class="wf-nd-chip active" onclick="setTextSource(this,'manual')">手动输入</button>
            <button class="wf-nd-chip" onclick="importFromNovel(this)">导入小说</button>
            <button class="wf-nd-chip" onclick="importFromContentLib(this)">导入内容库</button>
          </div>
          <textarea class="wf-nd-ta" rows="4" placeholder="输入故事描述、台词或文案内容..." onchange="syncNodeData(this)" oninput="autoCalcSceneCount(this)"></textarea>
          <div class="wf-nd-label">画面风格</div>
          <div class="wf-nd-chips" data-group="style">
            <button class="wf-nd-chip active" onclick="setChipGroup(this)">2D 动画</button>
            <button class="wf-nd-chip" onclick="setChipGroup(this)">3D 动画</button>
            <button class="wf-nd-chip" onclick="setChipGroup(this)">真人拟真</button>
          </div>
          <div class="wf-nd-row" style="gap:8px;align-items:center">
            <span class="wf-nd-label" style="margin:0;flex:0 0 auto">分镜数量</span>
            <input type="number" class="wf-nd-input wf-nd-scene-count-input" min="2" max="50" value="3" style="width:60px;text-align:center" onchange="syncNodeData(this)" title="根据内容自动计算，也可手动修改" />
            <span style="font-size:11px;color:var(--wf-text2)">段</span>
          </div>
          <div class="wf-nd-label">图片模型</div>
          <select class="wf-nd-select wf-nd-img-model-global" style="font-size:11px;padding:4px 6px" onchange="syncNodeData(this)">
            <option value="auto">自动选择模型</option>
          </select>
          <div class="wf-nd-row">
            <button class="wf-nd-action wf-nd-action-primary" style="flex:1" onclick="aiGenerateText(this)">
              ✦ AI 生成
            </button>
            <button class="wf-nd-action" style="flex:0;padding:7px 10px;background:var(--wf-bg);border:1px solid var(--wf-border);color:var(--wf-text2);white-space:nowrap" onclick="autoSplitText(this)">
              ✂ 分割
            </button>
          </div>
          <div class="wf-nd-scenes-list" id="nd-scenes-${nodeId}" style="display:none"></div>
          <button class="wf-nd-action" style="margin-top:4px;background:var(--wf-bg);border:1px solid var(--wf-accent);color:var(--wf-accent);font-size:11px" onclick="batchGenerateAllImages(this)">
            🎨 一键生成全部分镜图片
          </button>
        </div>
        <div class="wf-nd-footer">
          <span class="wf-nd-status wf-nd-status-idle">就绪</span>
          <span class="wf-nd-scene-count"></span>
        </div>
      </div>`,

    background: `
      <div class="wf-nd">
        <div class="wf-nd-header">
          <div class="wf-nd-header-icon wf-icon-bg">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="1" y="2" width="14" height="12" rx="2" stroke="currentColor" stroke-width="1.2"/><path d="M1 11l4-3.5 2.5 2 3-3 4.5 4" stroke="currentColor" stroke-width="1" stroke-linejoin="round"/></svg>
          </div>
          <div class="wf-nd-header-title">背景</div>
          <div class="wf-nd-header-actions">
            <button class="wf-nd-btn-sm" onclick="toggleNodeBody(this)">折叠</button>
            <button class="wf-nd-btn-sm" onclick="deleteNode(this)">×</button>
          </div>
        </div>
        <div class="wf-nd-body" id="nd-body-${nodeId}">
          <div class="wf-nd-preview" onclick="previewMedia(this)">
            <span class="wf-nd-preview-ph">点击生成背景图</span>
          </div>
          <textarea class="wf-nd-ta" rows="2" placeholder="背景场景描述..." onchange="syncNodeData(this)"></textarea>
          <select class="wf-nd-select" data-field="img-model" style="font-size:11px;padding:4px 6px" onchange="syncNodeData(this)">
            <option value="auto">自动选择模型</option>
          </select>
          <div class="wf-nd-row" style="gap:4px;margin-top:4px">
            <select class="wf-nd-select" data-field="img-ratio" style="flex:1;font-size:11px;padding:4px 6px">
              <option value="16:9" selected>16:9</option>
              <option value="4:3">4:3</option>
              <option value="1:1">1:1</option>
              <option value="3:2">3:2</option>
              <option value="21:9">21:9</option>
            </select>
            <select class="wf-nd-select" data-field="img-res" style="flex:1;font-size:11px;padding:4px 6px">
              <option value="1K">1K</option>
              <option value="2K" selected>2K</option>
              <option value="4K">4K</option>
            </select>
          </div>
          <button class="wf-nd-action wf-nd-action-primary" style="margin-top:4px" onclick="generateImage(this,'background')">生成背景</button>
        </div>
        <div class="wf-nd-footer">
          <span class="wf-nd-status wf-nd-status-idle">就绪</span>
        </div>
      </div>`,

    character: `
      <div class="wf-nd">
        <div class="wf-nd-header">
          <div class="wf-nd-header-icon wf-icon-char">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="5" r="3" stroke="currentColor" stroke-width="1.2"/><path d="M2 14c0-3.3 2.7-6 6-6s6 2.7 6 6" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
          </div>
          <div class="wf-nd-header-title">人物</div>
          <div class="wf-nd-header-actions">
            <button class="wf-nd-btn-sm" onclick="toggleNodeBody(this)">折叠</button>
            <button class="wf-nd-btn-sm" onclick="deleteNode(this)">×</button>
          </div>
        </div>
        <div class="wf-nd-body" id="nd-body-${nodeId}">
          <div class="wf-nd-preview" onclick="previewMedia(this)">
            <span class="wf-nd-preview-ph">点击生成人物图</span>
          </div>
          <textarea class="wf-nd-ta" rows="2" placeholder="人物外貌特征描述（发型、服装、体型等）..." onchange="syncNodeData(this)"></textarea>
          <select class="wf-nd-select" data-field="img-model" style="font-size:11px;padding:4px 6px" onchange="syncNodeData(this)">
            <option value="auto">自动选择模型</option>
          </select>
          <div class="wf-nd-row" style="gap:4px;margin-top:4px">
            <select class="wf-nd-select" data-field="img-ratio" style="flex:1;font-size:11px;padding:4px 6px">
              <option value="3:4" selected>3:4</option>
              <option value="1:1">1:1</option>
              <option value="9:16">9:16</option>
              <option value="2:3">2:3</option>
              <option value="4:3">4:3</option>
            </select>
            <select class="wf-nd-select" data-field="img-res" style="flex:1;font-size:11px;padding:4px 6px">
              <option value="1K">1K</option>
              <option value="2K" selected>2K</option>
              <option value="4K">4K</option>
            </select>
          </div>
          <button class="wf-nd-action wf-nd-action-primary" style="margin-top:4px" onclick="generateImage(this,'character')">生成人物</button>
        </div>
        <div class="wf-nd-footer">
          <span class="wf-nd-status wf-nd-status-idle">就绪</span>
        </div>
      </div>`,

    image: `
      <div class="wf-nd">
        <div class="wf-nd-header">
          <div class="wf-nd-header-icon wf-icon-image">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="1" y="2" width="14" height="12" rx="2" stroke="currentColor" stroke-width="1.2"/><circle cx="5" cy="6" r="1.5" stroke="currentColor" stroke-width="1"/><path d="M1 11l4-3.5 2.5 2 3-3 4.5 4" stroke="currentColor" stroke-width="1" stroke-linejoin="round"/></svg>
          </div>
          <div class="wf-nd-header-title">图片</div>
          <div class="wf-nd-header-actions">
            <button class="wf-nd-btn-sm" onclick="toggleNodeBody(this)">折叠</button>
            <button class="wf-nd-btn-sm" onclick="deleteNode(this)">×</button>
          </div>
        </div>
        <div class="wf-nd-body" id="nd-body-${nodeId}">
          <div class="wf-nd-preview" onclick="previewMedia(this)">
            <span class="wf-nd-preview-ph">点击生成或上传图片</span>
          </div>
          <textarea class="wf-nd-ta" rows="2" placeholder="图片描述提示词..." onchange="syncNodeData(this)"></textarea>
          <div class="wf-nd-row">
            <select class="wf-nd-select" style="flex:1" onchange="syncNodeData(this)">
              <option value="auto">自动选择模型</option>
              <option value="nanobanana">NanoBanana</option>
              <option value="zhipu">智谱 CogView</option>
              <option value="jimeng">即梦AI</option>
              <option value="openai">DALL-E 3</option>
            </select>
          </div>
          <div class="wf-nd-row">
            <button class="wf-nd-action wf-nd-action-primary" style="flex:1" onclick="generateImage(this)">生成图片</button>
            <button class="wf-nd-action" style="flex:0;padding:7px 10px;background:var(--wf-bg);border:1px solid var(--wf-border);color:var(--wf-text2)" onclick="uploadImage(this)">上传</button>
          </div>
        </div>
        <div class="wf-nd-footer">
          <span class="wf-nd-status wf-nd-status-idle">就绪</span>
          <span></span>
        </div>
      </div>`,

    video: `
      <div class="wf-nd">
        <div class="wf-nd-header">
          <div class="wf-nd-header-icon wf-icon-video">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="1" y="3" width="10" height="10" rx="1.5" stroke="currentColor" stroke-width="1.2"/><path d="M11 6l4-2v8l-4-2" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>
          </div>
          <div class="wf-nd-header-title">视频</div>
          <div class="wf-nd-header-actions">
            <button class="wf-nd-btn-sm" onclick="toggleNodeBody(this)">折叠</button>
            <button class="wf-nd-btn-sm" onclick="deleteNode(this)">×</button>
          </div>
        </div>
        <div class="wf-nd-body" id="nd-body-${nodeId}">
          <div class="wf-nd-preview" onclick="previewMedia(this)">
            <span class="wf-nd-preview-ph">视频预览</span>
          </div>
          <div class="wf-nd-row" style="align-items:center;gap:4px">
            <div class="wf-nd-label" style="margin:0;flex:1">提示词</div>
            <button class="wf-nd-btn-sm" style="font-size:10px;padding:2px 6px;background:var(--wf-accent);color:#fff;border-radius:4px;border:none;cursor:pointer" onclick="aiRefineVideoPrompt(this)" title="AI 优化提示词">✦ AI优化</button>
          </div>
          <textarea class="wf-nd-ta" rows="3" placeholder="视频画面描述（可从上游节点自动填充）...&#10;支持：场景、人物动作、镜头运动、光影氛围等" onchange="syncNodeData(this)"></textarea>
          <div class="wf-nd-prompt-info" style="font-size:10px;color:var(--wf-text3);margin:-2px 0 4px;display:none"></div>
          <div class="wf-nd-label">操作</div>
          <div class="wf-nd-chips">
            <button class="wf-nd-chip active" onclick="setVideoMode(this,'t2v')">文生视频</button>
            <button class="wf-nd-chip" onclick="setVideoMode(this,'i2v')">图生视频</button>
            <button class="wf-nd-chip" onclick="setVideoMode(this,'upload')">上传视频</button>
          </div>
          <div class="wf-nd-label">模型</div>
          <select class="wf-nd-select wf-video-model-select" data-field="model" onchange="syncNodeData(this)">
            <option value="auto">自动选择</option>
          </select>
          <div class="wf-nd-row">
            <div style="flex:1">
              <div class="wf-nd-label">时长</div>
              <select class="wf-nd-select" data-field="duration" onchange="syncNodeData(this)">
                <option value="5">5秒</option>
                <option value="10" selected>10秒</option>
                <option value="15">15秒</option>
                <option value="30">30秒</option>
              </select>
            </div>
            <div style="flex:1">
              <div class="wf-nd-label">比例</div>
              <select class="wf-nd-select" data-field="ratio" onchange="syncNodeData(this)">
                <option value="16:9">16:9</option>
                <option value="9:16">9:16</option>
                <option value="1:1">1:1</option>
              </select>
            </div>
          </div>
          <button class="wf-nd-action wf-nd-action-primary" style="margin-top:6px" onclick="generateVideo(this)">生成视频</button>
        </div>
        <div class="wf-nd-footer">
          <span class="wf-nd-status wf-nd-status-idle">就绪</span>
          <span></span>
        </div>
      </div>`,

    avatar: `
      <div class="wf-nd">
        <div class="wf-nd-header">
          <div class="wf-nd-header-icon wf-icon-avatar">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="5" r="3" stroke="currentColor" stroke-width="1.2"/><path d="M2 14c0-3.3 2.7-6 6-6s6 2.7 6 6" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
          </div>
          <div class="wf-nd-header-title">数字人</div>
          <div class="wf-nd-header-actions">
            <button class="wf-nd-btn-sm" onclick="toggleNodeBody(this)">折叠</button>
            <button class="wf-nd-btn-sm" onclick="deleteNode(this)">×</button>
          </div>
        </div>
        <div class="wf-nd-body" id="nd-body-${nodeId}">
          <div class="wf-nd-label">人物形象</div>
          <div class="wf-nd-avatar-grid" id="nd-avatar-grid-${nodeId}">
            <div class="wf-nd-avatar-item active" data-avatar-id="female-1" onclick="selectAvatarNode(this,'female-1')">
              <img src="/api/avatar/preset-img/avatar_female-1.png" alt="商务女性" /><span class="wf-nd-avatar-name">商务女性</span>
            </div>
            <div class="wf-nd-avatar-item" data-avatar-id="male-1" onclick="selectAvatarNode(this,'male-1')">
              <img src="/api/avatar/preset-img/avatar_male-1.png" alt="商务男性" /><span class="wf-nd-avatar-name">商务男性</span>
            </div>
            <div class="wf-nd-avatar-item" data-avatar-id="female-2" onclick="selectAvatarNode(this,'female-2')">
              <img src="/api/avatar/preset-img/avatar_female-2.png" alt="新闻主播" /><span class="wf-nd-avatar-name">新闻主播</span>
            </div>
            <div class="wf-nd-avatar-item" data-avatar-id="male-2" onclick="selectAvatarNode(this,'male-2')">
              <img src="/api/avatar/preset-img/avatar_male-2.png" alt="教育讲师" /><span class="wf-nd-avatar-name">教育讲师</span>
            </div>
            <div class="wf-nd-avatar-item" data-avatar-id="anime-1" onclick="selectAvatarNode(this,'anime-1')">
              <img src="/api/avatar/preset-img/avatar_anime-1.png" alt="动漫角色" /><span class="wf-nd-avatar-name">动漫角色</span>
            </div>
            <div class="wf-nd-avatar-item wf-nd-avatar-upload" onclick="uploadAvatarImage(this)" title="上传自定义形象">
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M10 4v12M4 10h12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
            </div>
          </div>
          <button class="wf-nd-action" style="font-size:11px;padding:5px 8px;background:var(--wf-bg);border:1px solid var(--wf-border);color:var(--wf-text2)" onclick="loadAvatarCharacters(this)">
            🔄 加载AI角色形象
          </button>
          <div class="wf-nd-sep"></div>
          <div class="wf-nd-label">背景场景</div>
          <div class="wf-nd-avatar-bg-grid">
            <div class="wf-nd-bg-card active" data-bg="office" onclick="selectAvatarBgPreset(this)">
              <img class="wf-nd-bg-img" src="/api/avatar/preset-img/bg_office.png" alt="办公室" /><span>办公室</span>
            </div>
            <div class="wf-nd-bg-card" data-bg="studio" onclick="selectAvatarBgPreset(this)">
              <img class="wf-nd-bg-img" src="/api/avatar/preset-img/bg_studio.png" alt="演播室" /><span>演播室</span>
            </div>
            <div class="wf-nd-bg-card" data-bg="classroom" onclick="selectAvatarBgPreset(this)">
              <img class="wf-nd-bg-img" src="/api/avatar/preset-img/bg_classroom.png" alt="教室" /><span>教室</span>
            </div>
            <div class="wf-nd-bg-card" data-bg="outdoor" onclick="selectAvatarBgPreset(this)">
              <img class="wf-nd-bg-img" src="/api/avatar/preset-img/bg_outdoor.png" alt="户外" /><span>户外</span>
            </div>
            <div class="wf-nd-bg-card" data-bg="green" onclick="selectAvatarBgPreset(this)">
              <div class="wf-nd-bg-ph" style="background:#00b140"></div><span>绿幕</span>
            </div>
            <div class="wf-nd-bg-card" data-bg="custom" onclick="uploadAvatarBg(this)">
              <div class="wf-nd-bg-ph" style="background:var(--wf-bg);border:1px dashed var(--wf-border2);display:flex;align-items:center;justify-content:center;color:var(--wf-text3);font-size:14px">+</div><span>自定义</span>
            </div>
          </div>
          <button class="wf-nd-action" style="font-size:11px;padding:5px 8px;background:var(--wf-bg);border:1px solid var(--wf-border);color:var(--wf-text2);margin-top:4px" onclick="generateAvatarBg(this)">
            ✦ AI 生成背景图
          </button>
          <div class="wf-nd-sep"></div>
          <div class="wf-nd-label">台词</div>
          <textarea class="wf-nd-ta" rows="3" placeholder="输入数字人要说的台词..." onchange="syncNodeData(this)"></textarea>
          <div class="wf-nd-sep"></div>
          <div class="wf-nd-label">音色</div>
          <select class="wf-nd-select" data-field="avatar-voice" onchange="syncNodeData(this)">
            <option value="">自动</option>
            <optgroup label="系统音色">
              <option value="female-sweet">甜美女声</option>
              <option value="female-pro">专业女声</option>
              <option value="male-mature">成熟男声</option>
              <option value="male-young">青年男声</option>
            </optgroup>
            <optgroup label="我的语音包" id="nd-custom-voices-${nodeId}">
            </optgroup>
          </select>
          <button class="wf-nd-action" style="font-size:11px;padding:5px 8px;background:var(--wf-bg);border:1px dashed var(--wf-border2);color:var(--wf-text2)" onclick="uploadCustomVoice(this)">
            🎙️ 上传自定义语音包
          </button>
          <div class="wf-nd-sep"></div>
          <div class="wf-nd-label">数字人模型</div>
          <select class="wf-nd-select" data-field="avatar-model" onchange="syncNodeData(this)">
            <optgroup label="⭐ 推荐">
              <option value="I2V-01-live">Hailuo I2V Live — 口播推荐</option>
              <option value="kling-v3">Kling 3.0 — 4K旗舰</option>
              <option value="MiniMax-Hailuo-2.3">Hailuo 2.3 — 最新旗舰</option>
              <option value="cogvideox-flash" selected>CogVideoX Flash — 快速免费</option>
            </optgroup>
            <optgroup label="Kling AI">
              <option value="kling-v2.5-turbo-pro">Kling 2.5 Turbo Pro</option>
              <option value="kling-v2-master">Kling V2 Master</option>
            </optgroup>
            <optgroup label="MiniMax">
              <option value="MiniMax-Hailuo-2.3-Fast">Hailuo 2.3 Fast</option>
              <option value="I2V-01">Hailuo I2V-01</option>
            </optgroup>
            <optgroup label="智谱AI">
              <option value="cogvideox-3">CogVideoX 3</option>
            </optgroup>
          </select>
          <button class="wf-nd-action wf-nd-action-primary" style="margin-top:6px" onclick="generateAvatar(this)">生成数字人视频</button>
        </div>
        <div class="wf-nd-footer">
          <span class="wf-nd-status wf-nd-status-idle">就绪</span>
          <span></span>
        </div>
      </div>`,

    voice: `
      <div class="wf-nd">
        <div class="wf-nd-header">
          <div class="wf-nd-header-icon wf-icon-voice">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="5" y="1" width="6" height="8" rx="3" stroke="currentColor" stroke-width="1.2"/><path d="M3 7a5 5 0 0010 0M8 12v3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
          </div>
          <div class="wf-nd-header-title">配音</div>
          <div class="wf-nd-header-actions">
            <button class="wf-nd-btn-sm" onclick="toggleNodeBody(this)">折叠</button>
            <button class="wf-nd-btn-sm" onclick="deleteNode(this)">×</button>
          </div>
        </div>
        <div class="wf-nd-body" id="nd-body-${nodeId}">
          <textarea class="wf-nd-ta" rows="2" placeholder="配音文本（可从文本节点连入）..." onchange="syncNodeData(this)"></textarea>
          <div class="wf-nd-row">
            <div style="flex:1">
              <div class="wf-nd-label">音色</div>
              <select class="wf-nd-select" onchange="syncNodeData(this)">
                <option value="">自动选择</option>
                <optgroup label="系统音色">
                  <option value="female-sweet">甜美女声</option>
                  <option value="female-pro">专业女声</option>
                  <option value="male-mature">成熟男声</option>
                  <option value="male-young">青年男声</option>
                </optgroup>
                <optgroup label="我的语音包" class="wf-voice-custom-group">
                </optgroup>
              </select>
            </div>
            <div style="flex:1">
              <div class="wf-nd-label">语速</div>
              <select class="wf-nd-select" onchange="syncNodeData(this)">
                <option value="0.8">0.8x</option>
                <option value="1.0" selected>1.0x</option>
                <option value="1.2">1.2x</option>
                <option value="1.5">1.5x</option>
              </select>
            </div>
          </div>
          <button class="wf-nd-action" style="font-size:11px;padding:5px 8px;background:var(--wf-bg);border:1px dashed var(--wf-border2);color:var(--wf-text2)" onclick="uploadCustomVoiceForNode(this)">
            🎙️ 上传语音包
          </button>
          <button class="wf-nd-action wf-nd-action-primary" onclick="generateVoice(this)">生成配音</button>
        </div>
        <div class="wf-nd-footer">
          <span class="wf-nd-status wf-nd-status-idle">就绪</span>
          <span></span>
        </div>
      </div>`,

    music: `
      <div class="wf-nd">
        <div class="wf-nd-header">
          <div class="wf-nd-header-icon wf-icon-music">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M6 13V4l8-3v9" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="4" cy="13" r="2" stroke="currentColor" stroke-width="1.2"/><circle cx="12" cy="10" r="2" stroke="currentColor" stroke-width="1.2"/></svg>
          </div>
          <div class="wf-nd-header-title">音乐</div>
          <div class="wf-nd-header-actions">
            <button class="wf-nd-btn-sm" onclick="toggleNodeBody(this)">折叠</button>
            <button class="wf-nd-btn-sm" onclick="deleteNode(this)">×</button>
          </div>
        </div>
        <div class="wf-nd-body" id="nd-body-${nodeId}">
          <button class="wf-nd-action" style="background:var(--wf-bg);border:1px dashed var(--wf-border2);color:var(--wf-text2)" onclick="uploadMusic(this)">
            🎵 点击上传音乐文件
          </button>
          <div class="wf-nd-row">
            <div style="flex:1">
              <div class="wf-nd-label">音量</div>
              <input type="range" min="0" max="100" value="50" style="width:100%" onchange="syncNodeData(this)" />
            </div>
          </div>
          <label style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--wf-text2)">
            <input type="checkbox" checked onchange="syncNodeData(this)" /> 循环播放
          </label>
          <div class="wf-nd-row" style="margin-top:6px">
            <div style="flex:1">
              <div class="wf-nd-label">开始时间 (秒)</div>
              <input type="number" min="0" step="0.1" value="0" placeholder="0" class="wf-nd-input wf-music-start" style="width:100%" onchange="syncNodeData(this)" />
            </div>
            <div style="flex:1">
              <div class="wf-nd-label">结束时间 (秒)</div>
              <input type="number" min="0" step="0.1" value="" placeholder="自动" class="wf-nd-input wf-music-end" style="width:100%" onchange="syncNodeData(this)" />
            </div>
          </div>
          <button class="wf-nd-action wf-clip-preview-btn" style="margin-top:4px;font-size:11px;padding:4px 8px;background:var(--wf-bg);border:1px solid var(--wf-border2);color:var(--wf-text2);display:none" onclick="previewMusicClip(this)">
            ✂️ 预览剪辑
          </button>
        </div>
        <div class="wf-nd-footer">
          <span class="wf-nd-status wf-nd-status-idle">就绪</span>
          <span></span>
        </div>
      </div>`,

    merge: `
      <div class="wf-nd wf-nd-merge-wide">
        <div class="wf-nd-header">
          <div class="wf-nd-header-icon wf-icon-merge">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="1" y="1" width="14" height="14" rx="2" stroke="currentColor" stroke-width="1.2"/><path d="M4 5h8M4 8h6M4 11h7" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/></svg>
          </div>
          <div class="wf-nd-header-title">合成输出</div>
          <div class="wf-nd-header-actions">
            <button class="wf-nd-btn-sm" onclick="toggleNodeBody(this)">折叠</button>
            <button class="wf-nd-btn-sm" onclick="deleteNode(this)">×</button>
          </div>
        </div>
        <div class="wf-nd-body" id="nd-body-${nodeId}">
          <div class="wf-nd-label">输入片段</div>
          <div style="font-size:11px;color:var(--wf-text3);padding:8px;background:var(--wf-bg);border-radius:6px;text-align:center">
            将视频/数字人节点连接到此处
          </div>

          <!-- ═══ 花字/文字特效 ═══ -->
          <div class="wf-nd-label" style="margin-top:8px">
            花字特效
            <button class="wf-nd-btn-sm" style="float:right;font-size:10px;padding:1px 6px;background:var(--wf-accent);color:#fff;border:none;border-radius:4px;cursor:pointer" onclick="addTextEffect(this)">+ 添加</button>
          </div>
          <div class="wf-fx-text-list" id="fx-texts-${nodeId}">
            <div class="wf-fx-empty" style="font-size:10px;color:var(--wf-text3);text-align:center;padding:6px">点击添加花字、价格标签、促销文字</div>
          </div>

          <!-- ═══ 产品贴图 ═══ -->
          <div class="wf-nd-label" style="margin-top:6px">
            产品贴图
            <button class="wf-nd-btn-sm" style="float:right;font-size:10px;padding:1px 6px;background:var(--wf-node-bg);color:#fff;border:none;border-radius:4px;cursor:pointer" onclick="addImageOverlay(this)">+ 上传</button>
          </div>
          <div class="wf-fx-img-list" id="fx-imgs-${nodeId}">
            <div class="wf-fx-empty" style="font-size:10px;color:var(--wf-text3);text-align:center;padding:6px">上传产品图片叠加到视频上</div>
          </div>

          <!-- ═══ 指引动画 ═══ -->
          <div class="wf-nd-label" style="margin-top:6px">
            指引动画
            <button class="wf-nd-btn-sm" style="float:right;font-size:10px;padding:1px 6px;background:var(--wf-node-char);color:#fff;border:none;border-radius:4px;cursor:pointer" onclick="addPointerEffect(this)">+ 添加</button>
          </div>
          <div class="wf-fx-ptr-list" id="fx-ptrs-${nodeId}">
            <div class="wf-fx-empty" style="font-size:10px;color:var(--wf-text3);text-align:center;padding:6px">添加箭头、手指、火焰等指引动画</div>
          </div>

          <!-- ═══ 快捷模板 ═══ -->
          <div class="wf-nd-label" style="margin-top:6px">快捷模板</div>
          <div class="wf-nd-chips">
            <button class="wf-nd-chip" onclick="applyFxTemplate(this,'ecommerce')">带货模板</button>
            <button class="wf-nd-chip" onclick="applyFxTemplate(this,'promo')">促销模板</button>
            <button class="wf-nd-chip" onclick="applyFxTemplate(this,'tutorial')">教程模板</button>
          </div>

          <div class="wf-nd-sep" style="border-top:1px solid var(--wf-border);margin:8px 0"></div>

          <!-- ═══ 配音 ═══ -->
          <div class="wf-nd-label">配音</div>
          <select class="wf-nd-select" data-field="merge-voice" onchange="syncNodeData(this)">
            <option value="">无配音</option>
            <optgroup label="系统音色">
              <option value="female-sweet">甜美女声</option>
              <option value="female-pro">专业女声</option>
              <option value="male-mature">成熟男声</option>
              <option value="male-young">青年男声</option>
            </optgroup>
          </select>

          <!-- ═══ 背景音乐 ═══ -->
          <div class="wf-nd-label" style="margin-top:4px">背景音乐</div>
          <div class="wf-fx-bgm-wrap" id="fx-bgm-${nodeId}">
            <div class="wf-nd-row" style="gap:4px">
              <button class="wf-nd-action wf-nd-bgm-btn" style="flex:1;background:var(--wf-bg);border:1px dashed var(--wf-border2);color:var(--wf-text2);font-size:11px;padding:6px 10px" onclick="uploadFxBgm(this)">
                🎵 点击上传BGM
              </button>
              <button class="wf-nd-action" style="flex:0 0 auto;background:var(--wf-bg);border:1px solid var(--wf-accent);color:var(--wf-accent);font-size:11px;padding:6px 8px" onclick="pickBgmFromAssets(this)">
                📁 素材库
              </button>
            </div>
          </div>
          <div class="wf-nd-row" style="margin-top:4px;align-items:center;display:none" id="fx-bgm-vol-${nodeId}">
            <span style="font-size:10px;color:var(--wf-text3);flex:0 0 auto">音量</span>
            <input type="range" min="0" max="100" value="30" style="flex:1;accent-color:var(--wf-accent)" data-field="bgm-volume" />
            <span class="wf-fx-bgm-vol-val" style="font-size:10px;color:var(--wf-text2);width:28px;text-align:right">30%</span>
          </div>

          <div class="wf-nd-row" style="margin-top:6px">
            <div style="flex:1">
              <div class="wf-nd-label">格式</div>
              <select class="wf-nd-select" onchange="syncNodeData(this)">
                <option value="mp4">MP4</option>
                <option value="webm">WebM</option>
                <option value="mp3">MP3（纯音频）</option>
              </select>
            </div>
            <div style="flex:1">
              <div class="wf-nd-label">字幕</div>
              <select class="wf-nd-select" onchange="syncNodeData(this)">
                <option value="on">开启</option>
                <option value="off">关闭</option>
              </select>
            </div>
          </div>
          <button class="wf-nd-action wf-nd-action-primary" style="margin-top:6px" onclick="executeMerge(this)">
            开始合成
          </button>
          <div class="wf-nd-preview" onclick="previewMedia(this)" style="display:none">
            <span class="wf-nd-preview-ph">合成完成后预览</span>
          </div>
        </div>
        <div class="wf-nd-footer">
          <span class="wf-nd-status wf-nd-status-idle">就绪</span>
          <span></span>
        </div>
      </div>`
  };
  return templates[type] || '<div>未知节点</div>';
}

// Node input/output config
const NODE_IO = {
  text:       { inputs: 0, outputs: 1 },
  background: { inputs: 1, outputs: 1 },
  character:  { inputs: 1, outputs: 1 },
  image:      { inputs: 1, outputs: 1 },
  video:      { inputs: 3, outputs: 1 },
  avatar:     { inputs: 1, outputs: 1 },
  voice:      { inputs: 1, outputs: 1 },
  music:      { inputs: 0, outputs: 1 },
  merge:      { inputs: 4, outputs: 0 },
};

// ═══ INITIALIZATION ═══

document.addEventListener('DOMContentLoaded', () => {
  const container = document.getElementById('drawflow');
  editor = new Drawflow(container);
  editor.reroute = true;
  editor.reroute_fix_curvature = true;
  editor.force_first_input = false;
  editor.start();

  // Track zoom
  editor.on('zoom', (zoom) => {
    document.getElementById('wf-zoom-val').textContent = Math.round(zoom * 100) + '%';
  });

  // Track node count + update node list
  editor.on('nodeCreated', () => { updateNodeCount(); updateNodeList(); });
  editor.on('nodeRemoved', () => { updateNodeCount(); updateNodeList(); });

  // Context menu on canvas double-click
  container.addEventListener('dblclick', (e) => {
    if (e.target.closest('.drawflow-node')) return;
    contextMenuPos = { x: e.clientX, y: e.clientY };
    showContextMenu(e.clientX, e.clientY);
  });

  // Hide context menu on click
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.wf-context-menu')) {
      document.getElementById('wf-context-menu').style.display = 'none';
    }
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (document.activeElement.tagName === 'TEXTAREA' || document.activeElement.tagName === 'INPUT') return;
      // Delete selected node
      const selected = document.querySelector('.drawflow-node.selected');
      if (selected) {
        const nodeId = selected.id.replace('node-', '');
        editor.removeNodeId('node-' + nodeId);
      }
    }
    if (e.ctrlKey && e.key === 's') { e.preventDefault(); saveWorkflow(); }
    if (e.ctrlKey && e.key === 'z') { e.preventDefault(); undoAction(); }
  });

  // Load workflow from URL param
  const params = new URLSearchParams(window.location.search);
  if (params.get('id')) {
    loadWorkflow(params.get('id'));
  }

  updateNodeCount();

  // 从 settings 动态加载视频/图片模型列表
  loadAllModels();
});

let _imageModels = [];

// 加载视频 + 图片模型列表
async function loadAllModels() {
  try {
    const res = await authFetch('/api/settings');
    const data = await res.json();
    if (!data.success) return;
    const providers = data.data?.providers || [];
    _videoModels = [];
    _imageModels = [];
    providers.forEach(p => {
      if (p.enabled === false) return;
      (p.models || []).forEach(m => {
        if (m.use === 'video' || m.type === 'video') {
          _videoModels.push({
            id: m.id || m.name,
            name: `${p.name} - ${m.name || m.id}`,
            provider: p.id
          });
        }
        if (m.use === 'image' || m.type === 'image') {
          _imageModels.push({
            id: p.id + ':' + (m.id || m.name),
            name: `${p.name} - ${m.name || m.id}`,
            provider: p.id,
            modelId: m.id || m.name
          });
        }
      });
    });
    console.log(`[Workflow] 已加载 ${_videoModels.length} 个视频模型, ${_imageModels.length} 个图片模型`);
    // 动态填充页面上所有图片模型下拉框
    document.querySelectorAll('[data-field="img-model"], .wf-nd-img-model-global').forEach(sel => {
      fillImageModelSelect(sel);
    });
  } catch(e) {
    console.warn('[Workflow] 加载模型失败:', e);
  }
}

// 填充图片模型下拉框
function fillImageModelSelect(sel) {
  if (!sel) return;
  const prev = sel.value;
  sel.innerHTML = '<option value="auto">自动选择模型</option>';
  _imageModels.forEach(m => {
    sel.innerHTML += `<option value="${m.provider}">${m.name}</option>`;
  });
  if (prev && sel.querySelector(`option[value="${prev}"]`)) sel.value = prev;
}

// 兼容旧调用名
async function loadVideoModels() { return loadAllModels(); }

// 风格与推荐模型的映射
const STYLE_MODEL_RECOMMENDATIONS = {
  '2d': ['wan', 'cogvideo', 'kling', 'minimax', 'zhipu', 'seedance'],
  '3d': ['wan', 'kling', 'seedance', 'vidu', 'runway', 'luma'],
  'realistic': ['kling', 'runway', 'luma', 'seedance', 'veo', 'sora', 'pika']
};

// 构建视频模型下拉选项 HTML（支持按风格推荐）
function buildVideoModelOptions(style) {
  let html = '<option value="auto">自动选择</option>';
  if (_videoModels.length > 0) {
    const recs = style ? (STYLE_MODEL_RECOMMENDATIONS[style] || []) : [];
    // 分为推荐和其他
    const recommended = [];
    const others = [];
    _videoModels.forEach(m => {
      const idLower = (m.id + ' ' + m.name + ' ' + (m.provider || '')).toLowerCase();
      const isRec = recs.some(r => idLower.includes(r));
      if (isRec) recommended.push(m); else others.push(m);
    });
    if (recommended.length > 0 && style) {
      const styleLabel = style === '2d' ? '2D动画' : style === '3d' ? '3D动画' : '真人拟真';
      html += `<optgroup label="⭐ ${styleLabel}推荐">`;
      recommended.forEach(m => { html += `<option value="${m.id}">${m.name}</option>`; });
      html += '</optgroup>';
    }
    if (others.length > 0) {
      html += `<optgroup label="其他模型">`;
      others.forEach(m => { html += `<option value="${m.id}">${m.name}</option>`; });
      html += '</optgroup>';
    }
    if (recommended.length === 0 && others.length === 0) {
      _videoModels.forEach(m => { html += `<option value="${m.id}">${m.name}</option>`; });
    }
  } else {
    html += `
      <option value="fal-ai/wan/v2.1/1.3b/text-to-video">Wan 2.1 (快速)</option>
      <option value="fal-ai/kling-video/v1.6/standard/text-to-video">Kling 1.6</option>
      <option value="fal-ai/seedance/v2/text-to-video">Seedance 2.0</option>
      <option value="cogvideox-flash">CogVideoX (免费)</option>`;
  }
  return html;
}

// 自动选择字节系模型（Seedance 2.0 > 即梦 > FAL Seedance）
function autoSelectByteDanceModel(selectEl) {
  const priority = ['doubao-seedance-2-0-t2v', 'doubao-seedance-2-0-i2v', 'doubao-seedance-2-0',
                     'mxapi-jimeng-t2v', 'jimeng_t2v', 'fal-ai/seedance/v2'];
  for (const keyword of priority) {
    const opt = [...selectEl.options].find(o => o.value.includes(keyword));
    if (opt) { opt.selected = true; return; }
  }
}

// AI 优化视频提示词
async function aiRefineVideoPrompt(btn) {
  const node = btn.closest('.drawflow-node');
  const ta = node.querySelector('textarea');
  const raw = ta?.value?.trim();
  if (!raw) { showToast('请先输入基础描述', 'error'); return; }

  btn.disabled = true;
  btn.textContent = '优化中...';
  try {
    const res = await authFetch('/api/workflow/refine-video-prompt', {
      method: 'POST',
      body: JSON.stringify({ prompt: raw })
    });
    const data = await res.json();
    if (data.success && data.prompt) {
      ta.value = data.prompt;
      ta.rows = 5;
      showToast('提示词已优化', 'success');
    } else {
      showToast(data.error || '优化失败', 'error');
    }
  } catch (e) {
    showToast('网络错误: ' + e.message, 'error');
  }
  btn.disabled = false;
  btn.textContent = '✦ AI优化';
}

// ═══ NODE CREATION ═══

function addNodeAtCenter(type) {
  const canvas = document.getElementById('drawflow');
  const rect = canvas.getBoundingClientRect();
  const x = (rect.width / 2 - 120) / editor.zoom - editor.canvas_x / editor.zoom;
  const y = (rect.height / 2 - 100) / editor.zoom - editor.canvas_y / editor.zoom;
  createNode(type, x + Math.random() * 80 - 40, y + Math.random() * 80 - 40);
}

function addNodeAt(type) {
  const menu = document.getElementById('wf-context-menu');
  menu.style.display = 'none';
  const canvas = document.getElementById('drawflow');
  const rect = canvas.getBoundingClientRect();
  const x = (contextMenuPos.x - rect.left) / editor.zoom - editor.canvas_x / editor.zoom;
  const y = (contextMenuPos.y - rect.top) / editor.zoom - editor.canvas_y / editor.zoom;
  createNode(type, x, y);
}

function createNode(type, x, y) {
  nodeCounter++;
  const id = 'n' + nodeCounter;
  const io = NODE_IO[type];
  const html = nodeHTML(type, id);
  const nodeId = editor.addNode(type, io.inputs, io.outputs, x, y, type, { type, nodeId: id }, html);
  // 初始化动态内容
  setTimeout(() => initNodeDynamic(nodeId, type), 50);
}

// 初始化节点的动态内容（视频模型列表等）
function initNodeDynamic(nodeId, type) {
  const node = document.getElementById('node-' + nodeId);
  if (!node) return;
  // 填充视频模型选项
  if (type === 'video') {
    const modelSel = node.querySelector('.wf-video-model-select');
    if (modelSel) modelSel.innerHTML = buildVideoModelOptions();
  }
  // 填充图片模型选项（背景/人物/文本节点）
  if (type === 'background' || type === 'character' || type === 'text') {
    node.querySelectorAll('[data-field="img-model"], .wf-nd-img-model-global').forEach(sel => fillImageModelSelect(sel));
  }
  // 数字人节点：自动加载语音包（不自动加载AI角色，保留预设形象）
  if (type === 'avatar') {
    initAvatarVoices(nodeId);
  }
}

function dragNode(event, type) {
  event.dataTransfer.setData('node-type', type);
}

function dropNode(event) {
  event.preventDefault();
  const type = event.dataTransfer.getData('node-type');
  if (!type) return;
  const canvas = document.getElementById('drawflow');
  const rect = canvas.getBoundingClientRect();
  const x = (event.clientX - rect.left) / editor.zoom - editor.canvas_x / editor.zoom;
  const y = (event.clientY - rect.top) / editor.zoom - editor.canvas_y / editor.zoom;
  createNode(type, x, y);
}

// ═══ NODE INTERACTIONS ═══

function toggleNodeBody(btn) {
  const node = btn.closest('.drawflow-node');
  const body = node.querySelector('.wf-nd-body');
  if (body) {
    body.classList.toggle('collapsed');
    btn.textContent = body.classList.contains('collapsed') ? '展开' : '折叠';
  }
}

// 根据文本内容自动计算推荐分镜数量
function autoCalcSceneCount(ta) {
  const node = ta.closest('.drawflow-node');
  if (!node) return;
  const input = node.querySelector('.wf-nd-scene-count-input');
  if (!input || input._manuallySet) return; // 用户手动改过就不再自动
  const text = ta.value.trim();
  if (!text) return;
  // 按自然段落/句号分段估算：每100字约1个场景，最少2个，最多20个
  const charCount = text.length;
  const paragraphs = text.split(/[。！？\n]+/).filter(s => s.trim().length > 10).length;
  const recommended = Math.max(2, Math.min(20, Math.round(Math.max(charCount / 100, paragraphs))));
  input.value = recommended;
}

function deleteNode(btn) {
  const node = btn.closest('.drawflow-node');
  const nodeId = node.id.replace('node-', '');
  editor.removeNodeId('node-' + nodeId);
}

function syncNodeData(el) {
  // Sync form data to Drawflow node data store (for export)
  const node = el.closest('.drawflow-node');
  if (!node) return;
  const nodeId = node.id.replace('node-', '');
  // Collect all form values
  const data = {};
  node.querySelectorAll('textarea').forEach((ta, i) => { data['text_' + i] = ta.value; });
  node.querySelectorAll('select').forEach((sel, i) => { data['select_' + i] = sel.value; });
  node.querySelectorAll('input[type=range]').forEach((r, i) => { data['range_' + i] = r.value; });
  node.querySelectorAll('input[type=checkbox]').forEach((cb, i) => { data['check_' + i] = cb.checked; });
  try { editor.updateNodeDataFromId(nodeId, data); } catch(e) {}
}

function setTextMode(btn, mode) {
  btn.closest('.wf-nd-chips').querySelectorAll('.wf-nd-chip').forEach(c => c.classList.remove('active'));
  btn.classList.add('active');
}

function setVideoMode(btn, mode) {
  btn.closest('.wf-nd-chips').querySelectorAll('.wf-nd-chip').forEach(c => c.classList.remove('active'));
  btn.classList.add('active');
}

function selectAvatarNode(el, avatarId) {
  el.closest('.wf-nd-avatar-grid').querySelectorAll('.wf-nd-avatar-item').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
}

function setNodeStatus(btn, status, text) {
  const node = btn.closest('.drawflow-node') || btn.closest('.wf-nd');
  const statusEl = node.querySelector('.wf-nd-status');
  if (statusEl) {
    statusEl.className = 'wf-nd-status wf-nd-status-' + status;
    statusEl.textContent = text;
  }
}

// ═══ API INTEGRATION ═══

async function aiGenerateText(btn) {
  const node = btn.closest('.drawflow-node');
  const ta = node.querySelector('textarea');
  const theme = ta.value.trim();
  if (!theme) { ta.focus(); ta.placeholder = '请先输入故事主题...'; return; }

  // 检测当前选中的模式
  const activeMode = node.querySelector('.wf-nd-chips .wf-nd-chip.active');
  const mode = activeMode?.textContent?.trim() || '短剧';

  // 映射类型到 genre
  const genreMap = { '短剧': 'drama', '动作打斗': 'action', '广告词': 'ad', '品牌文案': 'brand', '自由文本': 'free' };
  const genre = genreMap[mode] || 'drama';

  // 获取分镜数量
  const sceneInput = node.querySelector('.wf-nd-scene-count-input');
  const sceneCount = sceneInput ? parseInt(sceneInput.value) || 6 : 6;

  // 获取画面风格
  const styleChips = node.querySelector('[data-group="style"]');
  const activeStyle = styleChips?.querySelector('.wf-nd-chip.active')?.textContent?.trim() || '2D 动画';
  const styleDim = activeStyle.includes('3D') ? '3d' : activeStyle.includes('真人') ? 'realistic' : '2d';

  // 根据分镜数量计算时长（每段约10秒）
  const duration = sceneCount * 10;

  setNodeStatus(btn, 'running', 'AI 生成中...');
  btn.disabled = true;
  try {
    const res = await authFetch('/api/story/generate', {
      method: 'POST',
      body: JSON.stringify({ theme, duration, genre, scene_dim: styleDim, scene_count: sceneCount })
    });
    const data = await res.json();
    if (!data.success) {
      setNodeStatus(btn, 'error', data.error || '生成失败');
      btn.disabled = false;
      return;
    }

    const story = data.data;
    // 保留完整剧本到 textarea（折叠，只显示摘要）
    ta.value = story.full_script || story.synopsis || theme;
    ta.style.display = 'none'; // 隐藏原始 textarea，用章节视图替代
    setNodeStatus(btn, 'done', '已生成');

    // ── 渲染章节总览 ──
    const scenes = story.scenes || [];
    if (scenes.length > 0) {
      renderChaptersOverview(node, scenes, story);
      renderScenesList(node, scenes);
      autoCreateSceneNodes(node, scenes, story);
    } else {
      ta.style.display = ''; // 没有场景时恢复显示 textarea
      setNodeStatus(btn, 'running', '自动分割中...');
      await doAutoSplit(node, ta.value);
    }
  } catch(e) {
    setNodeStatus(btn, 'error', e.message || '请求失败');
    console.error('[Workflow] AI生成失败:', e);
  }
  btn.disabled = false;
}

// 渲染章节总览（每章独立标题+内容，可折叠展开）
function renderChaptersOverview(node, scenes, story) {
  let overviewEl = node.querySelector('.wf-nd-chapters');
  if (!overviewEl) {
    const body = node.querySelector('.wf-nd-body');
    const ta = body.querySelector('textarea');
    overviewEl = document.createElement('div');
    overviewEl.className = 'wf-nd-chapters';
    // 插到 textarea 后面
    if (ta?.nextSibling) body.insertBefore(overviewEl, ta.nextSibling);
    else body.appendChild(overviewEl);
  }

  const synopsis = story?.synopsis || '';

  overviewEl.innerHTML = `
    <div class="wf-ch-header" onclick="this.nextElementSibling.style.display=this.nextElementSibling.style.display==='none'?'block':'none';this.querySelector('.wf-ch-toggle').textContent=this.nextElementSibling.style.display==='none'?'展开':'收起'">
      <span style="font-weight:700;color:var(--wf-accent);font-size:12px">章节总览</span>
      <span style="font-size:10px;color:var(--wf-text3);margin-left:4px">${scenes.length} 章</span>
      <span class="wf-ch-toggle" style="margin-left:auto;font-size:10px;color:var(--wf-text3);cursor:pointer">收起</span>
    </div>
    ${synopsis ? `<div style="font-size:10px;color:var(--wf-text2);padding:4px 8px;line-height:1.5;background:var(--wf-bg);border-radius:6px;margin-bottom:4px">${synopsis.substring(0, 120)}${synopsis.length > 120 ? '...' : ''}</div>` : ''}
    <div class="wf-ch-list">
      ${scenes.map((s, i) => {
        const title = s.title || `第${i + 1}章`;
        const desc = s.description || s.background || s.location || '';
        const action = s.characters_action || s.action || '';
        const dialogue = s.dialogue || '';
        const chars = (s.characters_in_scene || []).join('、');
        const dur = s.duration || 10;
        return `
        <div class="wf-ch-item" data-idx="${i}">
          <div class="wf-ch-item-header" onclick="this.nextElementSibling.classList.toggle('wf-ch-collapsed')">
            <span class="wf-ch-num">${i + 1}</span>
            <span class="wf-ch-title">${title}</span>
            <span class="wf-ch-dur">${dur}s</span>
          </div>
          <div class="wf-ch-item-body">
            ${desc ? `<div class="wf-ch-row"><span class="wf-ch-tag" style="color:var(--wf-node-bg)">场景</span>${desc.substring(0, 100)}</div>` : ''}
            ${chars ? `<div class="wf-ch-row"><span class="wf-ch-tag" style="color:var(--wf-node-char)">角色</span>${chars}</div>` : ''}
            ${action ? `<div class="wf-ch-row"><span class="wf-ch-tag" style="color:var(--wf-node-video)">动作</span>${action.substring(0, 80)}</div>` : ''}
            ${dialogue ? `<div class="wf-ch-row"><span class="wf-ch-tag" style="color:var(--wf-node-voice)">台词</span>"${dialogue.substring(0, 60)}"</div>` : ''}
          </div>
        </div>`;
      }).join('')}
    </div>
    <div style="text-align:center;margin-top:4px">
      <button class="wf-nd-btn-sm" style="font-size:10px;padding:2px 8px;color:var(--wf-text3);background:none;border:1px solid var(--wf-border);border-radius:4px;cursor:pointer" onclick="const ta=this.closest('.wf-nd-body').querySelector('textarea');ta.style.display=ta.style.display==='none'?'':'none';this.textContent=ta.style.display==='none'?'查看原始剧本':'隐藏原始剧本'">查看原始剧本</button>
    </div>
  `;
}

// 渲染分镜列表到文本节点
function renderScenesList(node, scenes) {
  const nodeId = node.id.replace('node-', '');
  let listEl = node.querySelector('.wf-nd-scenes-list');
  if (!listEl) {
    // 如果模板中没有列表元素，动态创建
    const body = node.querySelector('.wf-nd-body');
    listEl = document.createElement('div');
    listEl.className = 'wf-nd-scenes-list';
    body.appendChild(listEl);
  }
  listEl.style.display = 'block';
  listEl.innerHTML = scenes.map((s, i) => {
    const bgDesc = s.background || s.location || s.description || '';
    const charDesc = s.characters_action || s.action || '';
    const camera = s.camera || '';
    return `
    <div class="wf-scene-card" style="padding:8px 10px;margin-top:4px;background:var(--wf-bg);border:1px solid var(--wf-border);border-radius:8px;font-size:11px;">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:3px;">
        <span style="color:var(--wf-accent);font-weight:700;">场景 ${i + 1}</span>
        <span style="color:var(--wf-text);font-weight:600;">${s.title || ''}</span>
        <span style="margin-left:auto;color:var(--wf-text3);font-size:10px;">${s.duration || 10}s</span>
      </div>
      ${bgDesc ? `<div style="color:var(--wf-node-bg);line-height:1.4;margin-bottom:2px;">🏞️ ${bgDesc.substring(0, 80)}${bgDesc.length > 80 ? '...' : ''}</div>` : ''}
      ${charDesc ? `<div style="color:var(--wf-node-char);line-height:1.4;">👤 ${charDesc.substring(0, 80)}${charDesc.length > 80 ? '...' : ''}</div>` : ''}
      ${s.dialogue ? `<div style="color:var(--wf-node-voice);margin-top:2px;font-style:italic;">💬 "${s.dialogue.substring(0, 60)}"</div>` : ''}
      ${camera ? `<div style="color:var(--wf-text3);margin-top:2px;font-size:10px;">🎥 ${camera}</div>` : ''}
    </div>`;
  }).join('');

  const countEl = node.querySelector('.wf-nd-scene-count');
  if (countEl) countEl.textContent = scenes.length + ' 个场景';
}

// 自动为分镜创建 背景+人物+视频 节点并连线（横排布局）
// 流程: 文本 → 背景  人物 → 视频
//             (横排同一行)
function autoCreateSceneNodes(textNode, scenes, parsedData) {
  const textNodeId = textNode.id.replace('node-', '');
  const textData = editor.getNodeFromId(textNodeId);
  const baseY = textData.pos_y;
  const bgColX = textData.pos_x + 360;   // 背景列
  const charColX = bgColX + 280;          // 人物列（紧挨背景）
  const vidColX = charColX + 280;         // 视频列
  const rowHeight = 260;                  // 每场景行高

  // 获取风格
  const styleChip = textNode.querySelector('[data-group="style"] .wf-nd-chip.active');
  const styleText = styleChip?.textContent?.trim() || '2D 动画';
  const styleDim = styleText.includes('3D') ? '3d' : styleText.includes('真人') ? 'realistic' : '2d';

  // ═══ 第一步：提取唯一角色，创建共享人物节点 ═══
  const characters = parsedData?.characters || [];
  const charNodeMap = {}; // name → nodeId

  // 方式1: 从 AI 返回的 characters 数组
  characters.forEach((char, ci) => {
    nodeCounter++;
    const charHtml = nodeHTML('character', 'n' + nodeCounter);
    const charNodeId = editor.addNode('character', 1, 1, charColX, baseY + ci * 200, 'character', {
      type: 'character', charName: char.name
    }, charHtml);
    try { editor.addConnection(textNodeId, charNodeId, 'output_1', 'input_1'); } catch(e) {}
    charNodeMap[char.name] = charNodeId;

    setTimeout(() => {
      const n = document.getElementById('node-' + charNodeId);
      if (!n) return;
      const ta = n.querySelector('textarea');
      if (ta) ta.value = `${char.name}：${char.appearance || char.description || ''}`;
    }, 100);
  });

  // 方式2: 从场景的 characters_in_scene 去重补充
  if (characters.length === 0) {
    const seenNames = new Set();
    scenes.forEach(s => {
      (s.characters_in_scene || []).forEach(name => seenNames.add(name));
    });
    let ci = 0;
    seenNames.forEach(name => {
      nodeCounter++;
      const charHtml = nodeHTML('character', 'n' + nodeCounter);
      const charNodeId = editor.addNode('character', 1, 1, charColX, baseY + ci * 200, 'character', {
        type: 'character', charName: name
      }, charHtml);
      try { editor.addConnection(textNodeId, charNodeId, 'output_1', 'input_1'); } catch(e) {}
      charNodeMap[name] = charNodeId;
      setTimeout(() => {
        const n = document.getElementById('node-' + charNodeId);
        if (n) { const ta = n.querySelector('textarea'); if (ta) ta.value = name; }
      }, 100);
      ci++;
    });
  }

  // 方式3: 如果仍然没有角色，从文本内容中提取（至少保证有一个人物节点）
  if (Object.keys(charNodeMap).length === 0) {
    const ta = textNode.querySelector('textarea');
    const fullText = ta?.value || '';
    // 简单提取：中文名字模式（2-4字的常见称呼）
    const nameMatches = fullText.match(/[阿小老大][A-Za-z\u4e00-\u9fff]{1,3}|[A-Za-z\u4e00-\u9fff]{2,4}(?=侧躺|站|走|跑|坐|躺|看|说|笑|哭|伸|起|转|望|追|飞)/g);
    const extractedNames = [...new Set(nameMatches || [])].slice(0, 3);
    if (extractedNames.length === 0) extractedNames.push('主角');

    extractedNames.forEach((name, ci) => {
      nodeCounter++;
      const charHtml = nodeHTML('character', 'n' + nodeCounter);
      const charNodeId = editor.addNode('character', 1, 1, charColX, baseY + ci * 200, 'character', {
        type: 'character', charName: name
      }, charHtml);
      try { editor.addConnection(textNodeId, charNodeId, 'output_1', 'input_1'); } catch(e) {}
      charNodeMap[name] = charNodeId;
      setTimeout(() => {
        const n = document.getElementById('node-' + charNodeId);
        if (n) { const ta = n.querySelector('textarea'); if (ta) ta.value = `${name}（请补充外貌描述）`; }
      }, 100);
    });
  }

  const charCount = Object.keys(charNodeMap).length;
  // 获取全局图片模型选择
  const globalImgModel = textNode.querySelector('.wf-nd-img-model-global')?.value || 'auto';

  // 设置人物节点的模型
  setTimeout(() => {
    Object.values(charNodeMap).forEach(cId => {
      const n = document.getElementById('node-' + cId);
      if (n) { const sel = n.querySelector('[data-field="img-model"]'); if (sel) sel.value = globalImgModel; }
    });
  }, 150);

  const sceneStartY = charCount > 0 ? baseY + charCount * 200 + 40 : baseY;

  // ═══ 第二步：每个场景只创建 背景 + 视频 节点 ═══
  scenes.forEach((scene, i) => {
    const yOffset = i * rowHeight;

    // ── 背景节点 ──
    nodeCounter++;
    const bgHtml = nodeHTML('background', 'n' + nodeCounter);
    const bgNodeId = editor.addNode('background', 1, 1, bgColX, sceneStartY + yOffset, 'background', {
      type: 'background', sceneIndex: i
    }, bgHtml);
    try { editor.addConnection(textNodeId, bgNodeId, 'output_1', 'input_1'); } catch(e) {}
    setTimeout(() => {
      const n = document.getElementById('node-' + bgNodeId);
      if (!n) return;
      const ta = n.querySelector('textarea');
      // 优先用详细的 background 描述，否则回退到 location
      if (ta) ta.value = scene.background || scene.description || scene.location || '';
      // 设置全局模型
      const sel = n.querySelector('[data-field="img-model"]');
      if (sel) { fillImageModelSelect(sel); sel.value = globalImgModel; }
    }, 100);

    // ── 视频节点 ──
    nodeCounter++;
    const vidHtml = nodeHTML('video', 'n' + nodeCounter);
    const vidNodeId = editor.addNode('video', 3, 1, vidColX, sceneStartY + yOffset, 'video', {
      type: 'video', sceneIndex: i
    }, vidHtml);
    // 连线：背景 → 视频 input_1
    try { editor.addConnection(bgNodeId, vidNodeId, 'output_1', 'input_1'); } catch(e) {}
    // 连线：该场景出场角色 → 视频 input_2
    const sceneChars = scene.characters_in_scene || [];
    for (const cName of sceneChars) {
      const cNodeId = charNodeMap[cName];
      if (cNodeId) { try { editor.addConnection(cNodeId, vidNodeId, 'output_1', 'input_2'); } catch(e) {} break; }
    }
    // 如果只有一个角色，直接连
    if (sceneChars.length === 0 && charCount === 1) {
      const onlyCharId = Object.values(charNodeMap)[0];
      try { editor.addConnection(onlyCharId, vidNodeId, 'output_1', 'input_2'); } catch(e) {}
    }
    // 连线：文本 → 视频 input_3
    try { editor.addConnection(textNodeId, vidNodeId, 'output_1', 'input_3'); } catch(e) {}

    setTimeout(() => {
      const vidNode = document.getElementById('node-' + vidNodeId);
      if (!vidNode) return;
      const modelSel = vidNode.querySelector('.wf-video-model-select');
      if (modelSel) {
        modelSel.innerHTML = buildVideoModelOptions(styleDim);
        autoSelectByteDanceModel(modelSel);
      }
      const ta = vidNode.querySelector('textarea');
      if (ta) {
        // 使用 visual_prompt（如果有），否则拼接基础描述
        const visualPrompt = scene.visual_prompt || '';
        if (visualPrompt) {
          ta.value = visualPrompt;
          ta.rows = 5;
        } else {
          const bgDesc = scene.background || scene.location || '';
          const charDesc = scene.characters_action || scene.action || '';
          const camera = scene.camera || '';
          ta.value = [bgDesc, charDesc, camera ? `镜头：${camera}` : ''].filter(Boolean).join('。');
        }
      }
    }, 120);
  });

  updateNodeCount();
  updateNodeList();
}

async function generateImage(btn, imgType) {
  const node = btn.closest('.drawflow-node');
  const ta = node.querySelector('textarea');
  const rawText = ta.value.trim();

  // 获取风格（递归查找上游文本节点）
  const dim = getUpstreamStyle(node);
  const dimLabel = dim === '3d' ? '3D写实风格' : dim === 'realistic' ? '真人拟真风格' : '2D动画风格';

  // 读取比例和清晰度设置
  const ratioSel = node.querySelector('[data-field="img-ratio"]');
  const resSel = node.querySelector('[data-field="img-res"]');
  const aspectRatio = ratioSel?.value || (imgType === 'background' ? '16:9' : '3:4');
  const resolution = resSel?.value || '2K';

  // 收集参考图（角色一致性）—— 从画布上所有已生成的角色图中提取
  const referenceImages = collectReferenceImages(node, imgType);

  // 根据类型构建更准确的提示词
  let body, endpoint;
  if (imgType === 'background') {
    endpoint = '/api/story/generate-scene-image';
    const prompt = rawText || '一个场景背景';
    body = {
      title: prompt.substring(0, 20),
      description: `${prompt}。${dimLabel}，纯风景画，只有自然环境和建筑，绝对没有人物、没有眼睛、没有表情、没有面孔、没有emoji。注重光影氛围，电影级构图。`,
      dim, aspectRatio, resolution, referenceImages
    };
  } else {
    endpoint = '/api/story/generate-character-image';
    const charDesc = rawText || '一个动漫角色';
    const colonIdx = charDesc.indexOf('：');
    const charName = colonIdx > 0 ? charDesc.substring(0, colonIdx).trim() : '角色';
    const charAppearance = colonIdx > 0 ? charDesc.substring(colonIdx + 1).trim() : charDesc;
    body = {
      name: charName, description: charAppearance, dim,
      mode: 'portrait',
      aspectRatio, resolution, referenceImages
    };
  }

  // 显示使用的模型和风格
  const modelSel = node.querySelector('[data-field="img-model"]');
  const modelName = modelSel?.selectedOptions?.[0]?.textContent || '自动';
  setNodeStatus(btn, 'running', `${modelName} · ${dimLabel} 生成中...`);
  btn.disabled = true;
  try {
    const res = await authFetch(endpoint, {
      method: 'POST',
      body: JSON.stringify(body)
    });
    const data = await res.json();
    const imageUrl = data.data?.imageUrl || data.data?.url;
    if (data.success && imageUrl) {
      const preview = node.querySelector('.wf-nd-preview');
      preview.innerHTML = `<img src="${imageUrl}" alt="生成图片" style="cursor:pointer" />`;
      addExpandButton(preview);
      setNodeStatus(btn, 'done', `已生成 · ${modelName}`);
    } else {
      setNodeStatus(btn, 'error', `${modelName}: ${(data.error || '生成失败').substring(0, 60)}`);
      console.error('[Workflow] 图片生成失败:', data.error);
    }
  } catch(e) {
    setNodeStatus(btn, 'error', `${modelName}: ${e.message}`);
    console.error('[Workflow] 图片生成异常:', e);
  }
  btn.disabled = false;
}

async function generateVideo(btn) {
  const node = btn.closest('.drawflow-node');
  // 使用 data-field 定位，避免 querySelectorAll('select') 顺序错误
  const modelSel = node.querySelector('[data-field="model"]');
  const durationSel = node.querySelector('[data-field="duration"]');
  const ratioSel = node.querySelector('[data-field="ratio"]');
  const model = modelSel?.value || 'auto';
  const duration = parseInt(durationSel?.value || '10');
  const ratio = ratioSel?.value || '16:9';

  // 获取提示词（优先节点自身的 textarea）
  const ta = node.querySelector('textarea');
  const selfText = ta?.value?.trim() || '';
  const connectedText = getConnectedNodeText(node, 0) || getConnectedNodeText(node, 2);
  const bgImage = getConnectedNodeImage(node, 0);     // input_1: 背景图
  const charImage = getConnectedNodeImage(node, 1);    // input_2: 人物图
  const charText = getConnectedNodeText(node, 1);      // input_2: 人物描述
  const connectedImage = bgImage || charImage;
  // 构建 prompt：自身提示词 + 人物外貌描述（确保角色一致性）
  let prompt = selfText || connectedText || '';
  if (charText && !prompt.includes(charText.substring(0, 20))) {
    prompt = prompt + '。角色外貌：' + charText;
  }

  if (!prompt && !connectedImage) {
    setNodeStatus(btn, 'error', '请输入提示词或连接上游节点');
    return;
  }

  // 判断模式：有上游图片时自动切换到图生视频
  const activeChip = node.querySelector('.wf-nd-chip.active');
  let mode = activeChip?.textContent?.trim() || '文生视频';
  if (connectedImage && mode === '文生视频') {
    // 自动切换到图生视频
    mode = '图生视频';
    const chips = node.querySelectorAll('.wf-nd-chip');
    chips.forEach(c => {
      c.classList.toggle('active', c.textContent.trim() === '图生视频');
    });
  }

  const modelLabel = modelSel?.selectedOptions?.[0]?.textContent || model;

  if (mode === '图生视频' && connectedImage) {
    setNodeStatus(btn, 'running', `图生视频 (${modelLabel})...`);
    btn.disabled = true;
    try {
      const res = await authFetch('/api/i2v/generate', {
        method: 'POST',
        body: JSON.stringify({
          image_url: connectedImage,
          prompt: prompt || 'Animate this image with natural motion',
          duration, aspect_ratio: ratio,
          video_provider: model === 'auto' ? undefined : model.split('/')[0],
          video_model: model === 'auto' ? undefined : model,
        })
      });
      const data = await res.json();
      if (data.success && data.data?.taskId) {
        pollI2VStatus(btn, data.data.taskId, node);
      } else {
        const errMsg = data.error || data.message || '提交失败';
        setNodeStatus(btn, 'error', errMsg.substring(0, 80));
        console.error('[Workflow] 图生视频失败:', errMsg);
        btn.disabled = false;
      }
    } catch(e) {
      setNodeStatus(btn, 'error', `网络错误: ${e.message}`);
      console.error('[Workflow] 图生视频异常:', e);
      btn.disabled = false;
    }
  } else {
    setNodeStatus(btn, 'running', `文生视频 (${modelLabel})...`);
    btn.disabled = true;
    try {
      const res = await authFetch('/api/projects', {
        method: 'POST',
        body: JSON.stringify({
          theme: prompt || '一个动画场景', duration, aspect_ratio: ratio,
          mode: 'custom', skip_parse: true,
          video_provider: model === 'auto' ? undefined : model.split('/')[0],
          video_model: model === 'auto' ? undefined : model,
          custom_content: JSON.stringify({
            characters: [],
            custom_scenes: [{ title: '场景1', description: prompt, duration, dialogue: '' }]
          })
        })
      });
      const data = await res.json();
      if (data.success && data.data?.projectId) {
        pollProjectStatus(btn, data.data.projectId, node);
      } else {
        const errMsg = data.error || data.message || '提交失败';
        setNodeStatus(btn, 'error', errMsg.substring(0, 80));
        console.error('[Workflow] 文生视频失败:', errMsg);
        btn.disabled = false;
      }
    } catch(e) {
      setNodeStatus(btn, 'error', `网络错误: ${e.message}`);
      console.error('[Workflow] 文生视频异常:', e);
      btn.disabled = false;
    }
  }
}

async function generateAvatar(btn) {
  const node = btn.closest('.drawflow-node');
  const ta = node.querySelector('textarea');
  const text = ta?.value?.trim();
  if (!text) { if(ta) ta.focus(); setNodeStatus(btn, 'error', '请输入台词'); return; }

  // 获取形象
  const activeAvatar = node.querySelector('.wf-nd-avatar-item.active');
  if (!activeAvatar) { setNodeStatus(btn, 'error', '请选择人物形象（点击+上传或加载AI角色）'); return; }
  const avatarImg = activeAvatar.querySelector('img');
  const avatar = activeAvatar.dataset?.avatarId || '';
  // AI角色图的URL是服务端路径，直接可用；自定义上传的是blob URL，需要先上传
  let avatarImageUrl = '';
  if (avatarImg?.src) {
    if (avatarImg.src.startsWith('blob:')) {
      // 自定义上传的blob，先上传到服务器
      setNodeStatus(btn, 'running', '上传形象图...');
      try {
        const resp = await fetch(avatarImg.src);
        const blob = await resp.blob();
        const formData = new FormData();
        formData.append('image', blob, 'avatar.png');
        const upRes = await authFetch('/api/i2v/upload-image', { method: 'POST', body: formData });
        const upData = await upRes.json();
        avatarImageUrl = upData.success ? (upData.data?.image_url || upData.data?.url || `/api/i2v/images/${upData.data?.filename}`) : '';
        if (!avatarImageUrl) { setNodeStatus(btn, 'error', '形象图上传失败'); btn.disabled = false; return; }
      } catch(e) { setNodeStatus(btn, 'error', '形象图上传失败: ' + e.message); return; }
    } else {
      avatarImageUrl = avatarImg.src;
    }
  }

  const voiceSel = node.querySelector('[data-field="avatar-voice"]');
  const voiceId = voiceSel?.value || '';
  const modelSel = node.querySelector('[data-field="avatar-model"]');
  const model = modelSel?.value || 'cogvideox-flash';
  const modelLabel = modelSel?.selectedOptions?.[0]?.textContent || model;
  const activeBgCard = node.querySelector('.wf-nd-bg-card.active');
  const bgType = activeBgCard?.dataset?.bg || 'office';
  const bgImage = activeBgCard?.dataset?.customUrl || '';

  btn.disabled = true;

  // 自动分段：文本超过 30 字时调用 AI 智能分段
  let segments = null;
  if (text.length > 30) {
    setNodeStatus(btn, 'running', '智能分段中...');
    try {
      const segRes = await authFetch('/api/avatar/segment-script', {
        method: 'POST',
        body: JSON.stringify({ text, segmentDuration: 10 })
      });
      const segData = await segRes.json();
      if (segData.success && segData.segments?.length > 1) {
        segments = segData.segments;
        console.log(`[Workflow] 智能分段: ${segments.length} 段`);
      }
    } catch(e) {
      console.warn('[Workflow] 分段失败，使用单段模式:', e.message);
    }
  }

  setNodeStatus(btn, 'running', `生成中 (${modelLabel.split('—')[0].trim()})${segments ? ' · ' + segments.length + '段' : ''}...`);
  try {
    // avatar 字段需要传可解析的形象路径：预设ID / 服务器URL / 本地路径
    // 对于 AI 角色和自定义上传，用实际的图片 URL
    const avatarValue = avatarImageUrl || avatar;
    const res = await authFetch('/api/avatar/generate', {
      method: 'POST',
      body: JSON.stringify({
        avatar: avatarValue, text, voiceId, model,
        ratio: '9:16',
        background: bgType,
        background_image: bgImage,
        segments
      })
    });
    const data = await res.json();
    if (data.success && data.taskId) {
      setNodeStatus(btn, 'running', '处理中...');
      pollAvatarStatus(btn, data.taskId, node);
    } else {
      const errMsg = data.error || data.message || '生成失败';
      setNodeStatus(btn, 'error', errMsg.substring(0, 80));
      console.error('[Workflow] 数字人生成失败:', errMsg);
      btn.disabled = false;
    }
  } catch(e) {
    setNodeStatus(btn, 'error', `网络错误: ${e.message}`);
    console.error('[Workflow] 数字人异常:', e);
    btn.disabled = false;
  }
}

// ═══ AVATAR NODE HELPERS ═══

// 上传自定义数字人形象（先上传到服务器获取URL）
function uploadAvatarImage(el) {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = 'image/*';
  input.onchange = async () => {
    const file = input.files[0]; if (!file) return;
    const grid = el.closest('.wf-nd-avatar-grid');
    // 先上传到服务器
    const formData = new FormData();
    formData.append('image', file);
    try {
      const res = await authFetch('/api/avatar/upload-image', { method: 'POST', body: formData });
      const data = await res.json();
      const serverUrl = data.path || (data.filename ? `/api/avatar/images/${data.filename}` : null);
      const displayUrl = serverUrl || URL.createObjectURL(file);
      // 取消其他选中
      grid.querySelectorAll('.wf-nd-avatar-item').forEach(i => i.classList.remove('active'));
      // 移除旧的自定义上传项
      grid.querySelectorAll('.wf-nd-avatar-custom').forEach(i => i.remove());
      // 创建新 avatar item
      const item = document.createElement('div');
      item.className = 'wf-nd-avatar-item wf-nd-avatar-custom active';
      item.dataset.avatarId = 'custom_upload';
      item.innerHTML = `<img src="${displayUrl}" alt="自定义形象" /><span class="wf-nd-avatar-name">自定义</span>`;
      item.onclick = function() { selectAvatarNode(this, 'custom_upload'); };
      grid.insertBefore(item, el);
    } catch(e) {
      alert('上传形象图失败: ' + e.message);
    }
  };
  input.click();
}

// 加载 AI 生成的角色形象到 avatar 选择网格（折叠展示，默认显示8个）
async function loadAvatarCharacters(btn) {
  const COLLAPSED_COUNT = 8;
  const node = btn.closest('.drawflow-node');
  const grid = node.querySelector('.wf-nd-avatar-grid');
  btn.textContent = '🔄 加载中...';
  try {
    const res = await authFetch('/api/story/character-images');
    const data = await res.json();
    const allImages = data.success ? (data.data || []) : [];
    // 严格过滤：只保留角色图（type=character 且文件名以 char_ 开头）
    const charImages = allImages.filter(img => img.type === 'character' && (img.filename || '').startsWith('char_'));
    if (charImages.length === 0) {
      btn.textContent = '🔄 暂无AI角色，请先在分镜中生成';
      return;
    }
    // 清除旧的 AI 角色（保留上传按钮和已上传的自定义形象）
    grid.querySelectorAll('.wf-nd-avatar-ai').forEach(el => el.remove());
    grid.querySelectorAll('.wf-nd-avatar-more-btn').forEach(el => el.remove());
    const uploadBtn = grid.querySelector('.wf-nd-avatar-upload');

    charImages.forEach((img, i) => {
      const item = document.createElement('div');
      const isHidden = i >= COLLAPSED_COUNT;
      item.className = 'wf-nd-avatar-item wf-nd-avatar-ai' + (i === 0 ? ' active' : '') + (isHidden ? ' wf-nd-avatar-hidden' : '');
      if (isHidden) item.style.display = 'none';
      item.dataset.avatarId = img.url; // 使用完整 URL 作为 ID
      const displayName = (img.name || `角色${i + 1}`).substring(0, 6);
      item.innerHTML = `<img src="${img.url}" alt="${displayName}" /><span class="wf-nd-avatar-name">${displayName}</span>`;
      item.onclick = function() {
        grid.querySelectorAll('.wf-nd-avatar-item').forEach(el => el.classList.remove('active'));
        this.classList.add('active');
      };
      grid.insertBefore(item, uploadBtn);
    });

    // 如果超过折叠数量，添加"展开更多"按钮
    if (charImages.length > COLLAPSED_COUNT) {
      const moreBtn = document.createElement('div');
      moreBtn.className = 'wf-nd-avatar-item wf-nd-avatar-more-btn';
      moreBtn.innerHTML = `<span style="font-size:10px;color:var(--wf-text2);text-align:center;line-height:1.3">展开<br>+${charImages.length - COLLAPSED_COUNT}</span>`;
      moreBtn.style.cursor = 'pointer';
      moreBtn.onclick = function() {
        const hidden = grid.querySelectorAll('.wf-nd-avatar-hidden');
        const isExpanded = this.dataset.expanded === 'true';
        hidden.forEach(el => { el.style.display = isExpanded ? 'none' : ''; });
        this.dataset.expanded = isExpanded ? 'false' : 'true';
        this.innerHTML = isExpanded
          ? `<span style="font-size:10px;color:var(--wf-text2);text-align:center;line-height:1.3">展开<br>+${hidden.length}</span>`
          : `<span style="font-size:10px;color:var(--wf-text2);text-align:center">收起</span>`;
      };
      grid.insertBefore(moreBtn, uploadBtn);
    }

    grid.querySelectorAll('.wf-nd-avatar-upload').forEach(el => el.classList.remove('active'));
    btn.textContent = `🔄 ${charImages.length} 个角色`;
  } catch(e) {
    btn.textContent = '🔄 加载失败: ' + (e.message || '');
    console.error('[Workflow] 加载角色失败:', e);
  }
}

// 选择数字人预设背景
function selectAvatarBgPreset(el) {
  const grid = el.closest('.wf-nd-avatar-bg-grid');
  grid.querySelectorAll('.wf-nd-bg-card').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
}

// 上传数字人自定义场景背景
function uploadAvatarBg(btn) {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = 'image/*';
  input.onchange = () => {
    const file = input.files[0]; if (!file) return;
    const node = btn.closest('.drawflow-node');
    const url = URL.createObjectURL(file);
    // 选中自定义卡片并设置图片
    const customCard = node.querySelector('[data-bg="custom"]');
    if (customCard) {
      const ph = customCard.querySelector('.wf-nd-bg-ph');
      ph.style.backgroundImage = `url(${url})`;
      ph.style.backgroundSize = 'cover';
      ph.style.backgroundPosition = 'center';
      ph.textContent = '';
      selectAvatarBgPreset(customCard);
      customCard.dataset.customUrl = url;
    }
  };
  input.click();
}

// AI 生成数字人场景背景
async function generateAvatarBg(btn) {
  const node = btn.closest('.drawflow-node');
  const ta = node.querySelector('textarea');
  const text = ta?.value?.trim() || '专业直播间背景';
  btn.textContent = '✦ 生成中...';
  btn.disabled = true;
  try {
    const res = await authFetch('/api/story/generate-scene-image', {
      method: 'POST',
      body: JSON.stringify({ title: '数字人背景', description: text, dim: '2d' })
    });
    const data = await res.json();
    const imageUrl = data.data?.imageUrl;
    if (data.success && imageUrl) {
      // 把生成的图设置到"自定义"背景卡片上
      const customCard = node.querySelector('[data-bg="custom"]');
      if (customCard) {
        const ph = customCard.querySelector('.wf-nd-bg-ph');
        ph.style.backgroundImage = `url(${imageUrl})`;
        ph.style.backgroundSize = 'cover';
        ph.style.backgroundPosition = 'center';
        ph.textContent = '';
        customCard.dataset.customUrl = imageUrl;
        selectAvatarBgPreset(customCard);
      }
      btn.textContent = '✦ 已生成，点击重新生成';
    } else {
      btn.textContent = '✦ 生成失败: ' + (data.error || '未知错误');
    }
  } catch(e) {
    btn.textContent = '✦ 生成失败: ' + (e.message || '');
  }
  btn.disabled = false;
}

// 上传自定义语音包
async function uploadCustomVoice(btn) {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = 'audio/*';
  input.onchange = async () => {
    const file = input.files[0]; if (!file) return;
    const name = prompt('请输入语音包名称:', file.name.replace(/\.[^.]+$/, ''));
    if (!name) return;
    btn.textContent = '🎙️ 上传中...';
    const formData = new FormData();
    formData.append('audio', file);
    formData.append('name', name);
    formData.append('gender', 'female');
    try {
      const res = await authFetch('/api/workbench/upload-voice', { method: 'POST', body: formData });
      const data = await res.json();
      if (data.success) {
        // 添加到音色下拉框
        const node = btn.closest('.drawflow-node');
        const voiceSel = node.querySelector('[data-field="avatar-voice"]');
        const customGroup = voiceSel?.querySelector('optgroup:last-child');
        if (customGroup) {
          const opt = document.createElement('option');
          opt.value = data.voiceId;
          opt.textContent = '🎙️ ' + name;
          customGroup.appendChild(opt);
          voiceSel.value = data.voiceId;
        }
        btn.textContent = '🎙️ 已上传: ' + name;
      } else {
        btn.textContent = '🎙️ 上传失败，点击重试';
      }
    } catch(e) {
      btn.textContent = '🎙️ 上传失败，点击重试';
    }
  };
  input.click();
}

// 初始化 avatar 节点：加载已有的自定义语音包
async function initAvatarVoices(nodeId) {
  try {
    const res = await authFetch('/api/workbench/voices');
    const data = await res.json();
    if (data.success && data.voices?.length) {
      const node = document.getElementById('node-' + nodeId);
      if (!node) return;
      const customGroup = node.querySelector('optgroup:last-child');
      if (!customGroup) return;
      data.voices.forEach(v => {
        const opt = document.createElement('option');
        opt.value = v.voiceId || v.id;
        opt.textContent = '🎙️ ' + (v.name || '自定义');
        customGroup.appendChild(opt);
      });
    }
  } catch(e) {}
}

async function pollAvatarStatus(btn, taskId, node) {
  try {
    const res = await authFetch(`/api/avatar/tasks/${taskId}/status`);
    const data = await res.json();
    if (data.status === 'done') {
      setNodeStatus(btn, 'done', '已完成');
      if (data.videoUrl) {
        const preview = node.querySelector('.wf-nd-preview');
        if (preview) { preview.innerHTML = `<video src="${data.videoUrl}" controls preload="auto" playsinline></video>`; addExpandButton(preview); }
      }
      btn.disabled = false;
    } else if (data.status === 'error') {
      setNodeStatus(btn, 'error', '生成失败');
      btn.disabled = false;
    } else {
      setTimeout(() => pollAvatarStatus(btn, taskId, node), 3000);
    }
  } catch(e) {
    setTimeout(() => pollAvatarStatus(btn, taskId, node), 5000);
  }
}

async function generateVoice(btn) {
  const node = btn.closest('.drawflow-node');
  const ta = node.querySelector('textarea');
  const text = ta?.value?.trim() || getConnectedNodeText(node, 0);
  if (!text) { if(ta) { ta.focus(); ta.placeholder = '请输入配音文本...'; } return; }
  const selects = node.querySelectorAll('select');
  const voiceId = selects[0]?.value || '';
  const speed = parseFloat(selects[1]?.value || '1.0');
  setNodeStatus(btn, 'running', '生成中...');
  btn.disabled = true;
  try {
    const res = await authFetch('/api/story/preview-voice', {
      method: 'POST',
      body: JSON.stringify({ text: text.substring(0, 200), voiceId, speed })
    });
    const data = await res.json();
    if (data.success && data.data?.audioUrl) {
      setNodeStatus(btn, 'done', '已生成');
      // 在节点中显示播放按钮
      const body = node.querySelector('.wf-nd-body');
      let player = body.querySelector('.wf-nd-audio-player');
      if (!player) {
        player = document.createElement('audio');
        player.className = 'wf-nd-audio-player';
        player.controls = true;
        player.style.cssText = 'width:100%;height:32px;margin-top:6px;border-radius:6px;';
        body.appendChild(player);
      }
      player.src = data.data.audioUrl;
    } else {
      setNodeStatus(btn, 'error', data.error || '生成失败');
    }
  } catch(e) {
    setNodeStatus(btn, 'error', '请求失败');
  }
  btn.disabled = false;
}

function uploadImage(btn) {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = 'image/*';
  input.onchange = async () => {
    const file = input.files[0]; if (!file) return;
    const node = btn.closest('.drawflow-node');
    const preview = node.querySelector('.wf-nd-preview');
    const url = URL.createObjectURL(file);
    preview.innerHTML = `<img src="${url}" alt="上传图片" style="cursor:pointer" />`;
    addExpandButton(preview);
    setNodeStatus(btn, 'done', '已上传');
  };
  input.click();
}

function uploadMusic(btn) {
  uploadMusicReal(btn);
}

// 合成完成后显示下载和保存按钮
function showMergeActions(node, videoUrl) {
  let actionsEl = node.querySelector('.wf-merge-actions');
  if (actionsEl) actionsEl.remove();
  actionsEl = document.createElement('div');
  actionsEl.className = 'wf-merge-actions';
  actionsEl.style.cssText = 'display:flex;gap:6px;padding:8px 14px;flex-wrap:wrap';
  actionsEl.innerHTML = `
    <a href="${videoUrl}" download="vido_output.mp4" class="wf-nd-action" style="flex:1;text-align:center;text-decoration:none;background:var(--wf-accent);color:#fff;font-size:12px;padding:8px;border-radius:6px;font-weight:600">
      ⬇ 下载视频
    </a>
    <button class="wf-nd-action" style="flex:1;background:var(--wf-bg3);border:1px solid var(--wf-accent);color:var(--wf-accent);font-size:12px;padding:8px;border-radius:6px;font-weight:600" onclick="saveToWorks(this,'${videoUrl}')">
      💾 保存到作品
    </button>
  `;
  const footer = node.querySelector('.wf-nd-footer');
  if (footer) footer.before(actionsEl);
  else node.querySelector('.wf-nd-body')?.appendChild(actionsEl);
}

async function saveToWorks(btn, videoUrl) {
  const node = btn.closest('.drawflow-node');
  const title = document.getElementById('wf-title')?.value || '工作流视频';
  btn.textContent = '保存中...';
  btn.disabled = true;
  try {
    // 通过 workflow API 保存到作品库
    const res = await authFetch('/api/workflow/save-to-works', {
      method: 'POST',
      body: JSON.stringify({ title, videoUrl, workflowId: currentWorkflowId })
    });
    const data = await res.json();
    if (data.success) {
      btn.textContent = '✅ 已保存';
      showToast('已保存到"我的作品"', 'success');
    } else {
      btn.textContent = '💾 保存到作品';
      showToast('保存失败: ' + (data.error || ''), 'error');
    }
  } catch(e) {
    btn.textContent = '💾 保存到作品';
    showToast('保存失败: ' + e.message, 'error');
  }
  btn.disabled = false;
}

async function executeMerge(btn) {
  const node = btn.closest('.drawflow-node');
  const nodeId = node.id.replace('node-', '');
  const nodeData = editor.getNodeFromId(nodeId);

  // 收集所有连接到此合成节点的视频/音频来源
  const inputs = nodeData.inputs || {};
  const connectedVideoUrls = [];
  const connectedProjectIds = [];

  for (const key of Object.keys(inputs)) {
    const conns = inputs[key]?.connections || [];
    for (const conn of conns) {
      const srcNode = document.getElementById('node-' + conn.node);
      if (!srcNode) continue;
      // 检查视频节点中是否有已生成的视频
      const video = srcNode.querySelector('.wf-nd-preview video');
      if (video?.src) connectedVideoUrls.push(video.src);
    }
  }

  if (connectedVideoUrls.length === 0) {
    setNodeStatus(btn, 'error', '无视频输入');
    alert('请先将视频/数字人节点连接到合成节点，并确保视频已生成。');
    return;
  }

  setNodeStatus(btn, 'running', `合成 ${connectedVideoUrls.length} 个片段...`);
  btn.disabled = true;

  // 提取 projectId 进行合成（如果是通过项目API生成的视频）
  const projectMatch = connectedVideoUrls[0]?.match(/projects\/([^/]+)\/stream/);
  if (projectMatch) {
    const projectId = projectMatch[1];
    // 项目已经自带合成，直接展示
    const preview = node.querySelector('.wf-nd-preview');
    if (preview) {
      preview.style.display = 'block';
      preview.innerHTML = `<video src="/api/projects/${projectId}/stream#t=0.1" controls preload="auto" playsinline></video>`;
      addExpandButton(preview);
    }
    setNodeStatus(btn, 'done', '合成完成');
    btn.disabled = false;
    return;
  }

  // 对于 i2v/avatar 生成的独立视频
  // 检查是否有特效需要应用
  const fxConfig = collectFxConfig(node);
  const hasFx = fxConfig.texts.length > 0 || fxConfig.images.length > 0 || fxConfig.pointers.length > 0 || fxConfig.bgm;

  // 逐个应用特效（如果有）
  let finalUrls = connectedVideoUrls;
  if (hasFx && connectedVideoUrls.length > 0) {
    const processedUrls = [];
    for (let vi = 0; vi < connectedVideoUrls.length; vi++) {
      setNodeStatus(btn, 'running', `渲染特效 ${vi + 1}/${connectedVideoUrls.length}...`);
      const resultUrl = await applyFxToVideo(node, connectedVideoUrls[vi], btn);
      processedUrls.push(resultUrl);
    }
    finalUrls = processedUrls;
  }

  // 拼接所有片段为最终视频
  if (finalUrls.length === 1) {
    const preview = node.querySelector('.wf-nd-preview');
    if (preview) {
      preview.style.display = 'block';
      loadVideoPreview(preview, finalUrls[0]);
    }
    setNodeStatus(btn, 'done', '合成完成');
    showMergeActions(node, finalUrls[0]);
  } else {
    setNodeStatus(btn, 'running', `拼接 ${finalUrls.length} 个片段...`);
    try {
      const concatRes = await authFetch('/api/workflow/concat', {
        method: 'POST',
        body: JSON.stringify({ videoUrls: finalUrls })
      });
      const concatData = await concatRes.json();
      if (concatData.success && concatData.taskId) {
        // 轮询拼接状态
        let concatDone = false;
        for (let i = 0; i < 60; i++) {
          await new Promise(r => setTimeout(r, 3000));
          const pollRes = await authFetch(`/api/workflow/effects/status/${concatData.taskId}`);
          const pollData = await pollRes.json();
          if (pollData.success) {
            const t = pollData.data;
            if (t.status === 'done') {
              const preview = node.querySelector('.wf-nd-preview');
              if (preview) { preview.style.display = 'block'; loadVideoPreview(preview, t.outputUrl); }
              setNodeStatus(btn, 'done', '合成完成');
              showMergeActions(node, t.outputUrl);
              concatDone = true;
              break;
            } else if (t.status === 'error') {
              setNodeStatus(btn, 'error', '拼接失败: ' + (t.error || '').substring(0, 60));
              concatDone = true;
              break;
            }
            setNodeStatus(btn, 'running', t.detail || '拼接中...');
          }
        }
        if (!concatDone) setNodeStatus(btn, 'error', '拼接超时');
      } else {
        setNodeStatus(btn, 'error', concatData.error || '拼接请求失败');
      }
    } catch(e) {
      setNodeStatus(btn, 'error', '拼接失败: ' + e.message);
    }
  }
  btn.disabled = false;
}

// ═══ WORKFLOW MANAGEMENT ═══

// 保存前：把所有节点的动态内容（textarea值、图片URL等）写入 data
function snapshotNodeStates() {
  document.querySelectorAll('.drawflow-node').forEach(node => {
    const nodeId = node.id.replace('node-', '');
    try {
      const nd = editor.getNodeFromId(nodeId);
      // textarea 值
      const tas = node.querySelectorAll('textarea');
      nd.data._textareas = Array.from(tas).map(ta => ta.value);
      // select 值
      const sels = node.querySelectorAll('select');
      nd.data._selects = Array.from(sels).map(s => s.value);
      // 图片预览 URL
      const img = node.querySelector('.wf-nd-preview img');
      nd.data._previewImg = img?.src || '';
      // 视频预览 URL
      const vid = node.querySelector('.wf-nd-preview video');
      nd.data._previewVid = vid?.src || '';
      // 状态
      const status = node.querySelector('.wf-nd-status');
      nd.data._status = status?.textContent || '';
      nd.data._statusClass = status?.className || '';
      // chip 选中状态
      const chips = node.querySelectorAll('.wf-nd-chip.active');
      nd.data._activeChips = Array.from(chips).map(c => c.textContent.trim());
      // 场景列表 HTML
      const sceneList = node.querySelector('.wf-nd-scenes-list');
      if (sceneList && sceneList.style.display !== 'none' && sceneList.innerHTML) {
        nd.data._sceneListHtml = sceneList.innerHTML;
      }
      editor.updateNodeDataFromId(nodeId, nd.data);
    } catch(e) {}
  });
}

async function saveWorkflow() {
  snapshotNodeStates();
  const wfData = editor.export();
  const title = document.getElementById('wf-title').value || '未命名项目';
  const saveBtn = document.querySelector('.wf-tb-btn[onclick*="saveWorkflow"]');
  if (saveBtn) { saveBtn.disabled = true; saveBtn.style.opacity = '0.5'; }
  try {
    const res = await authFetch('/api/workflow/save', {
      method: 'POST',
      body: JSON.stringify({ id: currentWorkflowId, name: title, drawflow: wfData })
    });
    const data = await res.json();
    if (data.success) {
      currentWorkflowId = data.data.id;
      showToast('✅ 画布已保存', 'success');
    } else {
      showToast('❌ 保存失败: ' + (data.error || ''), 'error');
    }
  } catch(e) {
    showToast('❌ 保存失败: ' + e.message, 'error');
    console.error('保存失败', e);
  }
  if (saveBtn) { saveBtn.disabled = false; saveBtn.style.opacity = '1'; }
}

// Toast 提示
function showToast(msg, type) {
  const existing = document.querySelector('.wf-toast');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.className = 'wf-toast wf-toast-' + (type || 'info');
  toast.textContent = msg;
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('wf-toast-show'));
  setTimeout(() => { toast.classList.remove('wf-toast-show'); setTimeout(() => toast.remove(), 300); }, 3000);
}

async function loadWorkflow(id) {
  try {
    const res = await authFetch(`/api/workflow/${id}`);
    const data = await res.json();
    if (data.success && data.data) {
      currentWorkflowId = data.data.id;
      document.getElementById('wf-title').value = data.data.name || '';
      if (data.data.drawflow) {
        editor.clear();
        editor.import(data.data.drawflow);
        // 等 DOM 渲染后恢复动态内容
        setTimeout(() => {
          restoreNodeStates();
          updateNodeCount();
          updateNodeList();
          // 重新填充动态模型下拉框
          document.querySelectorAll('.drawflow-node').forEach(n => {
            const nId = n.id.replace('node-', '');
            try {
              const nd = editor.getNodeFromId(nId);
              const type = nd.class || nd.data?.type || '';
              initNodeDynamic(nId, type);
            } catch {}
          });
        }, 300);
      }
    }
  } catch(e) {
    console.error('加载失败', e);
  }
}

// 加载后：从 data 恢复所有节点的动态内容
function restoreNodeStates() {
  document.querySelectorAll('.drawflow-node').forEach(node => {
    const nodeId = node.id.replace('node-', '');
    try {
      const nd = editor.getNodeFromId(nodeId);
      const d = nd.data || {};

      // 恢复 textarea 值
      if (d._textareas) {
        const tas = node.querySelectorAll('textarea');
        d._textareas.forEach((val, i) => { if (tas[i] && val) tas[i].value = val; });
      }
      // 恢复 select 值
      if (d._selects) {
        const sels = node.querySelectorAll('select');
        d._selects.forEach((val, i) => { if (sels[i] && val) sels[i].value = val; });
      }
      // 恢复图片预览
      if (d._previewImg) {
        const preview = node.querySelector('.wf-nd-preview');
        if (preview) {
          preview.innerHTML = `<img src="${d._previewImg}" alt="预览" style="cursor:pointer" />`;
          addExpandButton(preview);
        }
      }
      // 恢复视频预览
      if (d._previewVid) {
        const preview = node.querySelector('.wf-nd-preview');
        if (preview) {
          preview.innerHTML = `<video src="${d._previewVid}" controls preload="auto" playsinline></video>`;
          addExpandButton(preview);
        }
      }
      // 恢复状态
      if (d._status) {
        const status = node.querySelector('.wf-nd-status');
        if (status) { status.textContent = d._status; status.className = d._statusClass || ''; }
      }
      // 恢复 chip 选中状态
      if (d._activeChips && d._activeChips.length) {
        node.querySelectorAll('.wf-nd-chips').forEach(group => {
          group.querySelectorAll('.wf-nd-chip').forEach(chip => {
            const text = chip.textContent.trim();
            if (d._activeChips.includes(text)) chip.classList.add('active');
            else chip.classList.remove('active');
          });
        });
      }
      // 恢复场景列表
      if (d._sceneListHtml) {
        const sceneList = node.querySelector('.wf-nd-scenes-list');
        if (sceneList) { sceneList.innerHTML = d._sceneListHtml; sceneList.style.display = 'block'; }
      }
      // 初始化动态内容（视频模型列表等）
      const type = nd.class || d.type || '';
      if (type === 'video') {
        const modelSel = node.querySelector('.wf-video-model-select');
        if (modelSel) {
          const savedVal = d._selects?.[0] || '';
          modelSel.innerHTML = buildVideoModelOptions();
          if (savedVal) modelSel.value = savedVal;
        }
      }
    } catch(e) {
      console.warn('[Workflow] 恢复节点状态失败:', nodeId, e);
    }
  });
  updateNodeCount();
  updateNodeList();
  showToast('✅ 画布已恢复', 'success');
}

async function executeWorkflow() {
  // 找到文本节点获取内容和配置
  const textNodes = document.querySelectorAll('.drawflow-node.text');
  if (textNodes.length === 0) {
    alert('请先添加一个文本节点并输入内容');
    return;
  }
  const textNode = textNodes[0];
  const ta = textNode.querySelector('textarea');
  const text = ta?.value?.trim();
  if (!text) { alert('请在文本节点中输入内容'); return; }

  // 获取配置
  const styleChip = textNode.querySelector('[data-group="style"] .wf-nd-chip.active');
  const styleText = styleChip?.textContent?.trim() || '2D 动画';
  const style = styleText.includes('3D') ? '3d' : styleText.includes('真人') ? 'realistic' : '2d';
  const sceneInput = textNode.querySelector('.wf-nd-scene-count-input');
  const sceneCount = sceneInput ? parseInt(sceneInput.value) || 6 : 6;

  // 获取类型
  const modeChip = textNode.querySelector('.wf-nd-chips .wf-nd-chip.active');
  const modeText = modeChip?.textContent?.trim() || '短剧';
  const genreMap = { '短剧': 'drama', '动作打斗': 'action', '广告词': 'ad', '品牌文案': 'brand', '自由文本': 'free' };
  const genre = genreMap[modeText] || 'drama';

  const statusEl = document.getElementById('wf-status');
  const execBtn = document.querySelector('.wf-tb-primary');
  if (execBtn) { execBtn.disabled = true; execBtn.textContent = '执行中...'; }

  // 清空画布上已有的下游节点（保留文本节点）
  const textNodeId = textNode.id.replace('node-', '');

  try {
    // 提交 pipeline 任务
    const submitRes = await authFetch('/api/workflow/execute', {
      method: 'POST',
      body: JSON.stringify({ text, style, sceneCount, genre, aspectRatio: '16:9', resolution: '2K' })
    });
    const submitData = await submitRes.json();
    if (!submitData.success || !submitData.taskId) {
      showToast('❌ 启动失败: ' + (submitData.error || ''), 'error');
      if (execBtn) { execBtn.disabled = false; execBtn.textContent = '执行'; }
      return;
    }

    const taskId = submitData.taskId;
    if (statusEl) statusEl.textContent = '执行中...';

    // 轮询进度
    let pipelineResult = null;
    while (true) {
      await new Promise(r => setTimeout(r, 2000));
      try {
        const pollRes = await authFetch(`/api/workflow/execute/${taskId}`);
        const pollData = await pollRes.json();
        if (!pollData.success) break;
        const p = pollData.data;
        if (statusEl) statusEl.textContent = `${p.detail || ''} (${p.progress || 0}%)`;

        if (p.status === 'done') {
          pipelineResult = p.result;
          break;
        } else if (p.status === 'error') {
          showToast('❌ Pipeline 错误: ' + (p.error || ''), 'error');
          break;
        }
      } catch(e) {
        console.warn('[Workflow] 轮询失败:', e);
      }
    }

    // Pipeline 完成 — 在画布上自动创建节点
    if (pipelineResult && pipelineResult.status === 'done') {
      buildCanvasFromPipeline(textNode, pipelineResult);
      if (statusEl) statusEl.textContent = '执行完成';
      showToast(`✅ Pipeline 完成！${pipelineResult.scenes?.length || 0} 个分镜`, 'success');
      if (pipelineResult.errors?.length) {
        console.warn('[Workflow] Pipeline 部分错误:', pipelineResult.errors);
        showToast(`⚠️ ${pipelineResult.errors.length} 个生成失败，可手动重试`, 'error');
      }
      saveWorkflow();
    }

  } catch(e) {
    showToast('❌ 执行失败: ' + e.message, 'error');
    console.error('[Workflow] Pipeline error:', e);
  }

  if (execBtn) { execBtn.disabled = false; execBtn.textContent = '执行'; }
  if (statusEl) setTimeout(() => { statusEl.textContent = '就绪'; }, 5000);
}

// 根据 Pipeline 结果自动在画布上构建节点
function buildCanvasFromPipeline(textNode, result) {
  const textNodeId = textNode.id.replace('node-', '');
  const textData = editor.getNodeFromId(textNodeId);
  const baseY = textData.pos_y;
  const bgColX = textData.pos_x + 360;
  const charColX = bgColX + 280;
  const vidColX = charColX + 280;
  const rowHeight = 260;

  // 获取风格
  const styleChip = textNode.querySelector('[data-group="style"] .wf-nd-chip.active');
  const styleText = styleChip?.textContent?.trim() || '2D 动画';
  const styleDim = styleText.includes('3D') ? '3d' : styleText.includes('真人') ? 'realistic' : '2d';

  // 更新文本节点的场景列表
  if (result.sceneData) {
    renderScenesList(textNode, result.sceneData);
  }

  const scenes = result.scenes || [];

  scenes.forEach((scene, i) => {
    const yOffset = i * rowHeight;
    const sceneData = result.sceneData?.[i] || {};

    // ── 背景节点（已有生成好的图片）──
    nodeCounter++;
    const bgHtml = nodeHTML('background', 'n' + nodeCounter);
    const bgNodeId = editor.addNode('background', 1, 1, bgColX, baseY + yOffset, 'background', {
      type: 'background', sceneIndex: i
    }, bgHtml);
    try { editor.addConnection(textNodeId, bgNodeId, 'output_1', 'input_1'); } catch(e) {}
    setTimeout(() => {
      const n = document.getElementById('node-' + bgNodeId);
      if (!n) return;
      const ta = n.querySelector('textarea');
      if (ta) ta.value = sceneData.background || sceneData.description || sceneData.location || '';
      // 填充已生成的图片
      if (scene.bg?.imageUrl) {
        const preview = n.querySelector('.wf-nd-preview');
        preview.innerHTML = `<img src="${scene.bg.imageUrl}" alt="背景" style="cursor:pointer" />`;
        addExpandButton(preview);
        setNodeStatus(n.querySelector('.wf-nd-action-primary') || n, 'done', '已生成');
      }
    }, 100);

    // ── 人物节点（已有生成好的图片）──
    nodeCounter++;
    const charHtml = nodeHTML('character', 'n' + nodeCounter);
    const charNodeId = editor.addNode('character', 1, 1, charColX, baseY + yOffset, 'character', {
      type: 'character', sceneIndex: i
    }, charHtml);
    try { editor.addConnection(textNodeId, charNodeId, 'output_1', 'input_1'); } catch(e) {}
    setTimeout(() => {
      const n = document.getElementById('node-' + charNodeId);
      if (!n) return;
      const ta = n.querySelector('textarea');
      const charNames = (sceneData.characters_in_scene || []).join('、');
      const charAction = sceneData.characters_action || sceneData.action || '';
      if (ta) ta.value = (charNames ? `${charNames}：` : '') + charAction;
      if (scene.char?.imageUrl) {
        const preview = n.querySelector('.wf-nd-preview');
        preview.innerHTML = `<img src="${scene.char.imageUrl}" alt="人物" style="cursor:pointer" />`;
        addExpandButton(preview);
        setNodeStatus(n.querySelector('.wf-nd-action-primary') || n, 'done', '已生成');
      }
    }, 100);

    // ── 视频节点（等待用户确认后手动/自动生成）──
    nodeCounter++;
    const vidHtml = nodeHTML('video', 'n' + nodeCounter);
    const vidNodeId = editor.addNode('video', 3, 1, vidColX, baseY + yOffset, 'video', {
      type: 'video', sceneIndex: i
    }, vidHtml);
    try { editor.addConnection(bgNodeId, vidNodeId, 'output_1', 'input_1'); } catch(e) {}
    try { editor.addConnection(charNodeId, vidNodeId, 'output_1', 'input_2'); } catch(e) {}
    try { editor.addConnection(textNodeId, vidNodeId, 'output_1', 'input_3'); } catch(e) {}

    setTimeout(() => {
      const vidNode = document.getElementById('node-' + vidNodeId);
      if (!vidNode) return;
      const modelSel = vidNode.querySelector('.wf-video-model-select');
      if (modelSel) {
        modelSel.innerHTML = buildVideoModelOptions(styleDim);
        // 优先选择字节模型（Seedance 2.0 > 即梦）
        autoSelectByteDanceModel(modelSel);
      }
      const ta = vidNode.querySelector('textarea');
      if (ta) {
        // 优先使用 LLM 生成的专业视频提示词
        const videoPrompt = result.videoPrompts?.[i];
        if (videoPrompt?.prompt) {
          ta.value = videoPrompt.prompt;
          ta.rows = 5;
          // 显示提示词信息
          const info = vidNode.querySelector('.wf-nd-prompt-info');
          if (info) {
            const cam = videoPrompt.camera || sceneData.camera || '';
            const dur = videoPrompt.duration_hint || 5;
            info.style.display = 'block';
            info.textContent = `AI提示词 | ${cam ? '镜头: ' + cam + ' | ' : ''}建议${dur}秒`;
          }
          // 设置建议时长
          if (videoPrompt.duration_hint) {
            const durSel = vidNode.querySelector('[data-field="duration"]');
            if (durSel) {
              const hint = videoPrompt.duration_hint;
              const closest = [...durSel.options].reduce((a, b) =>
                Math.abs(parseInt(b.value) - hint) < Math.abs(parseInt(a.value) - hint) ? b : a
              );
              closest.selected = true;
            }
          }
        } else if (sceneData.visual_prompt) {
          // 使用 AI 生成的 visual_prompt（中文）
          ta.value = sceneData.visual_prompt;
          ta.rows = 5;
        } else {
          const bgDesc = sceneData.background || sceneData.location || '';
          const charDesc = sceneData.characters_action || sceneData.action || '';
          const camera = sceneData.camera || '';
          ta.value = [bgDesc, charDesc, camera ? `镜头：${camera}` : ''].filter(Boolean).join('。');
        }
      }
      // 图生视频模式（有上游图片时自动切换）
      const modeChips = vidNode.querySelectorAll('.wf-nd-chip');
      if (scene.bg?.imageUrl || scene.char?.imageUrl) {
        modeChips.forEach(c => {
          c.classList.toggle('active', c.textContent.trim() === '图生视频');
        });
      }
    }, 120);
  });

  // 添加合成节点
  if (scenes.length > 0) {
    nodeCounter++;
    const mergeHtml = nodeHTML('merge', 'n' + nodeCounter);
    const mergeNodeId = editor.addNode('merge', 4, 0, vidColX + 320, baseY + (scenes.length * rowHeight) / 2 - 100, 'merge', {
      type: 'merge'
    }, mergeHtml);
  }

  updateNodeCount();
  updateNodeList();
}

// ═══ CANVAS CONTROLS ═══

function zoomIn() { editor.zoom_in(); }
function zoomOut() { editor.zoom_out(); }
function fitView() { editor.zoom_reset(); }
function toggleGrid() {
  const canvas = document.getElementById('drawflow');
  canvas.style.backgroundImage = canvas.style.backgroundImage ? '' : 'radial-gradient(circle, rgba(255,255,255,.04) 1px, transparent 1px)';
}
function undoAction() { /* Drawflow doesn't have built-in undo */ }
function redoAction() { /* Drawflow doesn't have built-in undo */ }

function clearCanvas() {
  if (confirm('确定清空画布？所有节点将被删除。')) {
    editor.clear();
    updateNodeCount();
  }
}

function autoLayout() {
  // Simple auto-layout: arrange nodes in a grid
  const nodes = document.querySelectorAll('.drawflow-node');
  let x = 100, y = 100, col = 0;
  nodes.forEach((node, i) => {
    const nodeId = node.id.replace('node-', '');
    try {
      editor.drawflow.drawflow.Home.data[nodeId].pos_x = x;
      editor.drawflow.drawflow.Home.data[nodeId].pos_y = y;
    } catch(e) {}
    col++;
    x += 320;
    if (col >= 3) { col = 0; x = 100; y += 350; }
  });
  editor.load();
}

function updateNodeCount() {
  const count = document.querySelectorAll('.drawflow-node').length;
  const el = document.getElementById('wf-node-count');
  if (el) el.textContent = count + ' 节点';
}

function showContextMenu(x, y) {
  const menu = document.getElementById('wf-context-menu');
  menu.style.display = 'block';
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';
}

function goBack() {
  if (window.opener) {
    window.close();
  } else {
    window.location.href = '/';
  }
}

// ═══ CONNECTED NODE DATA HELPERS ═══

function getConnectedNodeText(node, inputIndex) {
  // Get text from connected node's textarea via Drawflow connections
  try {
    const nodeId = node.id.replace('node-', '');
    const nodeData = editor.getNodeFromId(nodeId);
    const inputKey = 'input_' + (inputIndex + 1);
    const connections = nodeData.inputs?.[inputKey]?.connections;
    if (connections && connections.length > 0) {
      const srcId = connections[0].node;
      const srcNode = document.getElementById('node-' + srcId);
      if (srcNode) {
        const ta = srcNode.querySelector('textarea');
        return ta?.value?.trim() || '';
      }
    }
  } catch(e) {}
  return '';
}

function getConnectedNodeImage(node, inputIndex) {
  try {
    const nodeId = node.id.replace('node-', '');
    const nodeData = editor.getNodeFromId(nodeId);
    const inputKey = 'input_' + (inputIndex + 1);
    const connections = nodeData.inputs?.[inputKey]?.connections;
    if (connections && connections.length > 0) {
      const srcId = connections[0].node;
      const srcNode = document.getElementById('node-' + srcId);
      if (srcNode) {
        const img = srcNode.querySelector('.wf-nd-preview img');
        return img?.src || '';
      }
    }
  } catch(e) {}
  return '';
}

// ═══ POLLING FUNCTIONS ═══

async function pollI2VStatus(btn, taskId, node) {
  try {
    const res = await authFetch(`/api/i2v/tasks/${taskId}`);
    const data = await res.json();
    if (data.success) {
      const task = data.data || data;
      if (task.status === 'done' && task.file_path) {
        setNodeStatus(btn, 'done', '已完成');
        const preview = node.querySelector('.wf-nd-preview');
        if (preview) { loadVideoPreview(preview, `/api/i2v/tasks/${taskId}/stream`); }
        btn.disabled = false;
      } else if (task.status === 'error') {
        const errDetail = task.error_message || task.error || '生成失败（未知原因）';
        setNodeStatus(btn, 'error', errDetail.substring(0, 80));
        console.error('[Workflow] I2V 错误:', errDetail);
        btn.disabled = false;
      } else {
        setNodeStatus(btn, 'running', '处理中...');
        setTimeout(() => pollI2VStatus(btn, taskId, node), 5000);
      }
    }
  } catch(e) {
    setTimeout(() => pollI2VStatus(btn, taskId, node), 5000);
  }
}

async function pollProjectStatus(btn, projectId, node) {
  try {
    const res = await authFetch(`/api/projects/${projectId}`);
    const data = await res.json();
    if (data.success) {
      const project = data.data || data;
      if (project.status === 'done') {
        setNodeStatus(btn, 'done', '已完成');
        const preview = node.querySelector('.wf-nd-preview');
        if (preview) { loadVideoPreview(preview, `/api/projects/${projectId}/stream`); }
        btn.disabled = false;
      } else if (project.status === 'error') {
        const errDetail = project.error || project.error_message || '生成失败（未知原因）';
        setNodeStatus(btn, 'error', errDetail.substring(0, 80));
        console.error('[Workflow] 项目视频错误:', errDetail);
        btn.disabled = false;
      } else {
        setNodeStatus(btn, 'running', project.status === 'generating_story' ? '生成剧情...' : project.status === 'generating_videos' ? '生成视频...' : '合成中...');
        setTimeout(() => pollProjectStatus(btn, projectId, node), 5000);
      }
    }
  } catch(e) {
    setTimeout(() => pollProjectStatus(btn, projectId, node), 5000);
  }
}

// ═══ TEXT NODE: IMPORT & SPLIT ═══

function setTextSource(btn, source) {
  btn.closest('.wf-nd-chips').querySelectorAll('.wf-nd-chip').forEach(c => c.classList.remove('active'));
  btn.classList.add('active');
}

async function importFromNovel(btn) {
  setTextSource(btn, 'novel');
  const node = btn.closest('.drawflow-node');
  const ta = node.querySelector('textarea');
  // 弹出小说选择器
  try {
    const res = await authFetch('/api/novel');
    const data = await res.json();
    if (data.success && data.data?.length) {
      const novels = data.data;
      const names = novels.map((n, i) => `${i + 1}. ${n.title || '未命名'}`).join('\n');
      const idx = prompt('选择小说（输入序号）：\n' + names);
      if (idx) {
        const novel = novels[parseInt(idx) - 1];
        if (novel) {
          // 加载小说完整内容
          const detailRes = await authFetch(`/api/novel/${novel.id}`);
          const detail = await detailRes.json();
          if (detail.success && detail.data) {
            const content = detail.data.chapters?.map(c => c.content || '').join('\n\n') || detail.data.synopsis || '';
            ta.value = content;
            setNodeStatus(btn, 'done', `已导入: ${novel.title}`);
          }
        }
      }
    } else {
      alert('暂无小说，请先在 AI 小说页面创建');
    }
  } catch(e) {
    alert('加载小说列表失败: ' + e.message);
  }
}

async function importFromContentLib(btn) {
  setTextSource(btn, 'contentlib');
  const node = btn.closest('.drawflow-node');
  const ta = node.querySelector('textarea');
  try {
    const res = await authFetch('/api/content');
    const data = await res.json();
    if (data.success && data.data?.length) {
      const items = data.data.slice(0, 20);
      const names = items.map((n, i) => `${i + 1}. ${(n.title || n.desc || '').substring(0, 40)}`).join('\n');
      const idx = prompt('选择内容（输入序号）：\n' + names);
      if (idx) {
        const item = items[parseInt(idx) - 1];
        if (item) {
          ta.value = item.content || item.desc || item.title || '';
          setNodeStatus(btn, 'done', '已导入内容');
        }
      }
    } else {
      alert('内容库为空，请先在素材获取页面抓取内容');
    }
  } catch(e) {
    alert('加载内容库失败: ' + e.message);
  }
}

async function autoSplitText(btn) {
  const node = btn.closest('.drawflow-node');
  const ta = node.querySelector('textarea');
  const text = ta?.value?.trim();
  if (!text) { if(ta) ta.focus(); return; }
  setNodeStatus(btn, 'running', 'AI 分割中...');
  btn.disabled = true;
  await doAutoSplit(node, text);
  btn.disabled = false;
}

async function doAutoSplit(node, text) {
  try {
    // 获取分镜数量设置
    const rangeEl = node.querySelector('.wf-nd-range');
    const sceneCount = rangeEl ? parseInt(rangeEl.value) : 6;
    const duration = sceneCount * 10;
    const res = await authFetch('/api/story/parse-script', {
      method: 'POST',
      body: JSON.stringify({ script: text, duration })
    });
    const data = await res.json();
    if (!data.success) {
      setNodeStatus(node.querySelector('.wf-nd-action'), 'error', data.error || '分割失败');
      return;
    }
    const scenes = data.data?.scenes || data.data?.custom_scenes || [];
    if (scenes.length > 0) {
      renderScenesList(node, scenes);
      autoCreateSceneNodes(node, scenes, data.data);
      setNodeStatus(node.querySelector('.wf-nd-action') || node, 'done', `已拆分 ${scenes.length} 个场景`);
    } else {
      setNodeStatus(node.querySelector('.wf-nd-action') || node, 'error', '未能识别场景');
    }
  } catch(e) {
    setNodeStatus(node.querySelector('.wf-nd-action') || node, 'error', '分割请求失败');
    console.error('[Workflow] 自动分割失败:', e);
  }
}

// ═══ 收集参考图用于角色一致性 ═══
function collectReferenceImages(currentNode, imgType) {
  const refs = [];
  try {
    // 从画布上所有已生成的角色节点中收集参考图URL
    const allNodes = document.querySelectorAll('.drawflow-node');
    allNodes.forEach(n => {
      if (n === currentNode) return;
      const title = n.querySelector('.wf-nd-header-title')?.textContent || '';
      // 只收集角色图作为参考（背景图不用作参考）
      if (title !== '人物') return;
      const img = n.querySelector('.wf-nd-preview img');
      if (img?.src && !img.src.startsWith('blob:')) {
        // 转为绝对URL
        const url = img.src.startsWith('/') ? window.location.origin + img.src : img.src;
        refs.push(url);
      }
    });
  } catch(e) {}
  return refs.slice(0, 6); // NanoBanana 最多6张高保真参考图
}

// ═══ 批量生成所有分镜图片 ═══
async function batchGenerateAllImages(btn) {
  const textNode = btn.closest('.drawflow-node');
  const textNodeId = textNode.id.replace('node-', '');

  // 找到所有下游的背景和人物节点
  const allNodes = document.querySelectorAll('.drawflow-node');
  const targetNodes = [];
  allNodes.forEach(n => {
    const title = n.querySelector('.wf-nd-header-title')?.textContent || '';
    if (title === '背景' || title === '人物') {
      // 检查是否连接到当前文本节点
      const nId = n.id.replace('node-', '');
      try {
        const nd = editor.getNodeFromId(nId);
        const conns = nd.inputs?.input_1?.connections || [];
        if (conns.some(c => c.node === textNodeId)) {
          const genBtn = n.querySelector('.wf-nd-action-primary');
          if (genBtn && !genBtn.disabled) targetNodes.push({ node: n, btn: genBtn, type: title === '背景' ? 'background' : 'character' });
        }
      } catch(e) {}
    }
  });

  if (targetNodes.length === 0) {
    // 没有下游节点 → 自动先拆分分镜再生成
    const ta = textNode.querySelector('textarea');
    const text = ta?.value?.trim();
    if (!text) { setNodeStatus(btn, 'error', '请先输入内容'); return; }
    setNodeStatus(btn, 'running', '自动拆分分镜中...');
    btn.disabled = true;
    await doAutoSplit(textNode, text);
    // 拆分完成后重新收集节点
    await new Promise(r => setTimeout(r, 300));
    document.querySelectorAll('.drawflow-node').forEach(n => {
      const title = n.querySelector('.wf-nd-header-title')?.textContent || '';
      if (title === '背景' || title === '人物') {
        const nId = n.id.replace('node-', '');
        try {
          const nd = editor.getNodeFromId(nId);
          const conns = nd.inputs?.input_1?.connections || [];
          if (conns.some(c => c.node === textNodeId)) {
            const genBtn = n.querySelector('.wf-nd-action-primary');
            if (genBtn && !genBtn.disabled) targetNodes.push({ node: n, btn: genBtn, type: title === '背景' ? 'background' : 'character' });
          }
        } catch(e) {}
      }
    });
    if (targetNodes.length === 0) {
      setNodeStatus(btn, 'error', '分镜拆分失败，请先点击「AI生成」或「分割」');
      btn.disabled = false;
      return;
    }
  }

  setNodeStatus(btn, 'running', `批量生成 0/${targetNodes.length}...`);
  btn.disabled = true;

  // 获取风格信息显示
  const styleChip = textNode.querySelector('[data-group="style"] .wf-nd-chip.active');
  const styleLabel = styleChip?.textContent?.trim() || '2D 动画';

  // 先生成所有人物（作为参考图），再生成背景
  const charNodes = targetNodes.filter(t => t.type === 'character');
  const bgNodes = targetNodes.filter(t => t.type === 'background');
  let done = 0;
  let errors = 0;

  // 依次生成人物（间隔2秒避免速率限制）
  for (const t of charNodes) {
    if (done > 0) await new Promise(r => setTimeout(r, 2000));
    const model = t.node.querySelector('[data-field="img-model"]')?.selectedOptions?.[0]?.textContent || '自动';
    setNodeStatus(btn, 'running', `人物 ${done + 1}/${targetNodes.length} · ${model} · ${styleLabel}`);
    await generateImageAsync(t.btn, t.type);
    const status = t.node.querySelector('.wf-nd-status');
    if (status?.className?.includes('error')) errors++;
    done++;
  }
  // 再生成背景（间隔2秒避免速率限制）
  for (const t of bgNodes) {
    if (done > 0) await new Promise(r => setTimeout(r, 2000));
    const model = t.node.querySelector('[data-field="img-model"]')?.selectedOptions?.[0]?.textContent || '自动';
    setNodeStatus(btn, 'running', `背景 ${done + 1}/${targetNodes.length} · ${model} · ${styleLabel}`);
    await generateImageAsync(t.btn, t.type);
    const status = t.node.querySelector('.wf-nd-status');
    if (status?.className?.includes('error')) errors++;
    done++;
  }

  const summary = errors > 0 ? `完成 ${done - errors}/${done}，${errors} 个失败` : `已生成 ${done} 张图片`;
  setNodeStatus(btn, errors > 0 ? 'error' : 'done', summary);
  btn.disabled = false;
}

// generateImage 的 Promise 版本 — 等待生成完成
function generateImageAsync(btn, imgType) {
  return new Promise(resolve => {
    // 用 MutationObserver 监听状态变化
    const node = btn.closest('.drawflow-node');
    const statusEl = node?.querySelector('.wf-nd-status');
    if (!statusEl) { generateImage(btn, imgType); return setTimeout(resolve, 3000); }

    const observer = new MutationObserver(() => {
      const cls = statusEl.className;
      if (cls.includes('done') || cls.includes('error')) {
        observer.disconnect();
        resolve();
      }
    });
    observer.observe(statusEl, { attributes: true, childList: true, characterData: true });

    // 触发生成
    generateImage(btn, imgType);

    // 超时保护 3 分钟
    setTimeout(() => { observer.disconnect(); resolve(); }, 180000);
  });
}

// ═══ 获取上游文本节点的风格设置 ═══
function getUpstreamStyle(node) {
  // 先检查自身是否有风格选择器（文本节点）
  const selfChip = node.querySelector?.('[data-group="style"] .wf-nd-chip.active');
  if (selfChip) {
    const s = selfChip.textContent.trim();
    if (s.includes('3D')) return '3d';
    if (s.includes('真人')) return 'realistic';
    return '2d';
  }
  // 递归向上查找
  try {
    const nodeId = node.id.replace('node-', '');
    const nodeData = editor.getNodeFromId(nodeId);
    for (const key of Object.keys(nodeData.inputs || {})) {
      const conns = nodeData.inputs[key]?.connections || [];
      for (const conn of conns) {
        const srcNode = document.getElementById('node-' + conn.node);
        if (!srcNode) continue;
        const result = getUpstreamStyle(srcNode);
        return result; // 找到就返回，不管是什么值
      }
    }
  } catch(e) {}
  return '2d';
}

// ═══ SCENE NODE: GENERATE IMAGES ═══
async function generateSceneImages(btn) {
  const node = btn.closest('.drawflow-node');
  const bgTa = node.querySelector('[data-field="bg"]');
  const charTa = node.querySelector('[data-field="char"]');
  const bgText = bgTa?.value?.trim() || '一个场景背景';
  const charText = charTa?.value?.trim() || '一个动漫角色';

  // 获取风格（递归查找上游文本节点）
  const dim = getUpstreamStyle(node);

  setNodeStatus(btn, 'running', '生成背景...');
  btn.disabled = true;
  const previews = node.querySelectorAll('.wf-nd-scene-preview');

  // 并行生成背景和人物图片
  const bgPromise = authFetch('/api/story/generate-scene-image', {
    method: 'POST', body: JSON.stringify({ title: '场景', description: bgText, dim })
  }).then(r => r.json()).catch(() => ({ success: false }));

  setNodeStatus(btn, 'running', '生成人物...');
  const charPromise = authFetch('/api/story/generate-character-image', {
    method: 'POST', body: JSON.stringify({ name: 'character', description: charText, dim })
  }).then(r => r.json()).catch(() => ({ success: false }));

  const [bgData, charData] = await Promise.all([bgPromise, charPromise]);

  if (bgData.success && bgData.data?.imageUrl) {
    previews[0].innerHTML = `<img src="${bgData.data.imageUrl}" alt="背景" style="cursor:pointer" />`;
  }
  if (charData.success && charData.data?.imageUrl) {
    previews[1].innerHTML = `<img src="${charData.data.imageUrl}" alt="人物" style="cursor:pointer" />`;
  }

  const ok = (bgData.success || charData.success);
  setNodeStatus(btn, ok ? 'done' : 'error', ok ? '已生成' : '生成失败');
  btn.disabled = false;
}

function uploadSceneImage(btn, field) {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = 'image/*';
  input.onchange = () => {
    const file = input.files[0]; if (!file) return;
    const node = btn.closest('.drawflow-node');
    const previews = node.querySelectorAll('.wf-nd-scene-preview');
    const idx = field === 'bg' ? 0 : 1;
    const url = URL.createObjectURL(file);
    previews[idx].innerHTML = `<img src="${url}" alt="${field}" style="cursor:pointer" />`;
    previews[idx].onclick = function() { previewMedia(this); };
    setNodeStatus(btn, 'done', '已上传');
  };
  input.click();
}

// ═══ VOICE UPLOAD FOR VOICE/VIDEO NODES ═══
async function uploadCustomVoiceForNode(btn) {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = 'audio/*';
  input.onchange = async () => {
    const file = input.files[0]; if (!file) return;
    const name = prompt('请输入语音包名称:', file.name.replace(/\.[^.]+$/, ''));
    if (!name) return;
    btn.textContent = '🎙️ 上传中...';
    const formData = new FormData();
    formData.append('audio', file);
    formData.append('name', name);
    formData.append('gender', 'female');
    try {
      const res = await authFetch('/api/workbench/upload-voice', { method: 'POST', body: formData });
      const data = await res.json();
      if (data.success) {
        const node = btn.closest('.drawflow-node');
        const customGroup = node.querySelector('.wf-voice-custom-group');
        if (customGroup) {
          const opt = document.createElement('option');
          opt.value = data.voiceId;
          opt.textContent = '🎙️ ' + name;
          customGroup.appendChild(opt);
          customGroup.closest('select').value = data.voiceId;
        }
        btn.textContent = '🎙️ 已上传: ' + name;
      } else {
        btn.textContent = '🎙️ 上传失败';
      }
    } catch(e) {
      btn.textContent = '🎙️ 上传失败';
    }
  };
  input.click();
}

// ═══ CHIP GROUP SELECTOR ═══
function setChipGroup(btn) {
  const group = btn.closest('.wf-nd-chips');
  group.querySelectorAll('.wf-nd-chip').forEach(c => c.classList.remove('active'));
  btn.classList.add('active');
}

// ═══ MEDIA PREVIEW LIGHTBOX ═══
function previewMedia(previewEl) {
  const img = previewEl.querySelector('img');
  const video = previewEl.querySelector('video');
  if (!img && !video) return;
  openLightbox(img ? img.src : null, video ? video.src : null);
}

function openLightbox(imgSrc, videoSrc) {
  const lb = document.createElement('div');
  lb.className = 'wf-lightbox';
  lb.onclick = (e) => { if (e.target === lb) lb.remove(); };
  lb.innerHTML = `<div class="wf-lightbox-close" onclick="this.parentElement.remove()">✕</div>`;

  if (imgSrc) {
    const bigImg = document.createElement('img');
    bigImg.src = imgSrc;
    bigImg.style.cssText = 'max-width:90vw;max-height:85vh;border-radius:12px;object-fit:contain;box-shadow:0 8px 40px rgba(0,0,0,.6)';
    lb.appendChild(bigImg);
  } else if (videoSrc) {
    const bigVid = document.createElement('video');
    bigVid.src = videoSrc;
    bigVid.controls = true;
    bigVid.autoplay = true;
    bigVid.style.cssText = 'max-width:90vw;max-height:85vh;border-radius:12px;object-fit:contain;box-shadow:0 8px 40px rgba(0,0,0,.6)';
    lb.appendChild(bigVid);
  }
  document.body.appendChild(lb);
}

// 给预览区添加放大按钮（视频/图片生成后调用）
// 加载视频预览（流端点已公开，无需认证）
function loadVideoPreview(previewEl, streamUrl) {
  previewEl.innerHTML = `<video src="${streamUrl}#t=0.1" controls preload="auto" playsinline></video>`;
  addExpandButton(previewEl);
}

function addExpandButton(previewEl) {
  // 移除旧按钮
  previewEl.querySelectorAll('.wf-expand-btn').forEach(b => b.remove());
  const btn = document.createElement('div');
  btn.className = 'wf-expand-btn';
  btn.innerHTML = '🔍';
  btn.title = '点击放大预览';
  btn.onclick = (e) => {
    e.stopPropagation();
    e.preventDefault();
    const img = previewEl.querySelector('img');
    const video = previewEl.querySelector('video');
    openLightbox(img ? img.src : null, video ? video.src : null);
  };
  previewEl.style.position = 'relative';
  previewEl.appendChild(btn);
}

// ═══ BGM UPLOAD FOR VIDEO NODE ═══
function uploadBgm(btn) {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = 'audio/*';
  input.onchange = async () => {
    const file = input.files[0]; if (!file) return;
    const formData = new FormData();
    formData.append('music', file);
    btn.textContent = '🎵 上传中...';
    try {
      const res = await authFetch('/api/projects/upload-music', { method: 'POST', body: formData });
      const data = await res.json();
      if (data.success && data.data?.path) {
        btn.textContent = '🎵 ' + file.name;
        btn.dataset.bgmPath = data.data.path;
      } else {
        btn.textContent = '🎵 上传失败，点击重试';
      }
    } catch(e) {
      btn.textContent = '🎵 上传失败，点击重试';
    }
  };
  input.click();
}

// ═══ MUSIC UPLOAD (real API) ═══

async function uploadMusicReal(btn) {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = '.mp3,.wav,.ogg,.m4a,audio/*';
  input.onchange = async () => {
    const file = input.files[0]; if (!file) return;
    const formData = new FormData();
    formData.append('music', file);
    setNodeStatus(btn, 'running', '上传中...');
    try {
      const res = await authFetch('/api/projects/upload-music', { method: 'POST', body: formData });
      const data = await res.json();
      if (data.success && (data.data?.file_url || data.data?.file_path || data.data?.path)) {
        const musicUrl = data.data.file_url || data.data.path || data.data.file_path;
        btn.textContent = '🎵 ' + file.name;
        btn.dataset.musicPath = musicUrl;
        // 添加音频预听
        const node = btn.closest('.wf-nd-body') || btn.closest('.drawflow-node');
        let audioEl = node.querySelector('.wf-music-preview');
        if (!audioEl) {
          audioEl = document.createElement('audio');
          audioEl.className = 'wf-music-preview';
          audioEl.controls = true;
          audioEl.style.cssText = 'width:100%;height:32px;margin-top:4px';
          btn.parentNode.insertBefore(audioEl, btn.nextSibling);
        }
        const token = localStorage.getItem('access_token') || '';
        audioEl.src = musicUrl + (musicUrl.includes('?') ? '&' : '?') + 'token=' + token;
        // Show clip preview button
        const clipBtn = (btn.closest('.wf-nd-body') || btn.closest('.drawflow-node')).querySelector('.wf-clip-preview-btn');
        if (clipBtn) clipBtn.style.display = '';
        setNodeStatus(btn, 'done', '已上传');
      } else {
        setNodeStatus(btn, 'error', '上传失败');
      }
    } catch(e) {
      setNodeStatus(btn, 'error', '上传失败');
    }
  };
  input.click();
}

// ═══ MUSIC CLIP PREVIEW ═══

function previewMusicClip(btn) {
  const body = btn.closest('.wf-nd-body') || btn.closest('.drawflow-node');
  const audioEl = body.querySelector('.wf-music-preview');
  if (!audioEl || !audioEl.src) return;
  const startInput = body.querySelector('.wf-music-start');
  const endInput = body.querySelector('.wf-music-end');
  const startTime = parseFloat(startInput?.value) || 0;
  const endTime = parseFloat(endInput?.value) || 0;
  audioEl.currentTime = startTime;
  audioEl.play();
  if (endTime > startTime) {
    const checkEnd = () => {
      if (audioEl.currentTime >= endTime) {
        audioEl.pause();
        audioEl.removeEventListener('timeupdate', checkEnd);
      }
    };
    audioEl.addEventListener('timeupdate', checkEnd);
  }
}

// ═══ NODE LIST PANEL ═══

function updateNodeList() {
  const panel = document.getElementById('wf-node-list');
  if (!panel) return;
  const nodes = document.querySelectorAll('.drawflow-node');
  if (nodes.length === 0) {
    panel.innerHTML = '<div style="text-align:center;color:var(--wf-text3);font-size:11px;padding:12px">暂无节点</div>';
    return;
  }
  panel.innerHTML = Array.from(nodes).map(n => {
    const type = n.querySelector('.wf-nd-header-title')?.textContent || '未知';
    const status = n.querySelector('.wf-nd-status')?.textContent || '';
    const id = n.id;
    return `<div class="wf-nl-item" onclick="focusNode('${id}')" style="display:flex;align-items:center;gap:6px;padding:5px 8px;border-radius:4px;cursor:pointer;font-size:11px;color:var(--wf-text2);transition:background .12s">
      <span style="font-weight:600;color:var(--wf-text)">${type}</span>
      <span style="margin-left:auto;font-size:10px">${status}</span>
    </div>`;
  }).join('');
}

function focusNode(domId) {
  const node = document.getElementById(domId);
  if (!node) return;
  document.querySelectorAll('.drawflow-node.selected').forEach(n => n.classList.remove('selected'));
  node.classList.add('selected');
  node.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
}

// ═══════════════════════════════════════════════
// ═══ 后期特效编辑器 ═══
// ═══════════════════════════════════════════════

let _fxCounter = 0;

// 文字预设选项
const FX_TEXT_PRESETS = [
  { id: 'title', name: '标题花字', color: '#fff', sample: '限时特惠' },
  { id: 'price', name: '价格标签', color: '#FF2D55', sample: '¥9.9' },
  { id: 'promo', name: '促销信息', color: '#FFD600', sample: '今日特价' },
  { id: 'subtitle', name: '普通字幕', color: '#fff', sample: '字幕文字' },
  { id: 'emphasis', name: '强调文字', color: '#21FFF3', sample: '重点强调' },
  { id: 'danmaku', name: '弹幕风格', color: '#fff', sample: '弹幕~' },
];

// 指引动画图标
const FX_POINTER_ICONS = [
  { id: 'arrow_down', char: '👇', name: '向下箭头' },
  { id: 'arrow_right', char: '👉', name: '向右箭头' },
  { id: 'finger_point', char: '☝️', name: '手指' },
  { id: 'fire', char: '🔥', name: '火焰' },
  { id: 'star', char: '⭐', name: '星星' },
  { id: 'sparkle', char: '✨', name: '闪光' },
  { id: 'lightning', char: '⚡', name: '闪电' },
  { id: 'cart', char: '🛒', name: '购物车' },
  { id: 'money', char: '💰', name: '金钱' },
  { id: 'gift', char: '🎁', name: '礼物' },
  { id: 'hot', char: '🔥', name: '限时' },
  { id: 'click', char: '👆', name: '点击' },
];

// 位置选项
const FX_POSITIONS = [
  { id: 'top', name: '顶部居中' },
  { id: 'top-left', name: '左上角' },
  { id: 'top-right', name: '右上角' },
  { id: 'center', name: '正中' },
  { id: 'center-left', name: '左中' },
  { id: 'center-right', name: '右中' },
  { id: 'bottom', name: '底部居中' },
  { id: 'bottom-left', name: '左下角' },
  { id: 'bottom-right', name: '右下角' },
];

/** 添加花字特效条目 */
function addTextEffect(btn) {
  const node = btn.closest('.drawflow-node');
  const list = node.querySelector('.wf-fx-text-list');
  const empty = list.querySelector('.wf-fx-empty');
  if (empty) empty.remove();

  _fxCounter++;
  const id = `fxtxt-${_fxCounter}`;
  const presetOpts = FX_TEXT_PRESETS.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
  const posOpts = FX_POSITIONS.map(p => `<option value="${p.id}">${p.name}</option>`).join('');

  const item = document.createElement('div');
  item.className = 'wf-fx-item';
  item.id = id;
  item.innerHTML = `
    <div class="wf-fx-item-row">
      <select class="wf-fx-sel" data-field="fx-preset" onchange="onFxPresetChange(this)">${presetOpts}</select>
      <button class="wf-fx-del" onclick="removeFxItem(this)">×</button>
    </div>
    <input class="wf-fx-input" type="text" placeholder="输入文字内容..." data-field="fx-text" value="限时特惠" />
    <div class="wf-fx-item-row">
      <select class="wf-fx-sel" data-field="fx-position" style="flex:1">${posOpts}</select>
      <div style="display:flex;align-items:center;gap:3px;flex:1">
        <input type="number" class="wf-fx-num" data-field="fx-start" value="0" min="0" step="0.5" placeholder="开始" title="开始时间(秒)" />
        <span style="color:var(--wf-text3);font-size:10px">~</span>
        <input type="number" class="wf-fx-num" data-field="fx-end" value="" min="0" step="0.5" placeholder="结束" title="结束时间(秒)，空=全程" />
      </div>
    </div>
  `;
  list.appendChild(item);
}

/** 预设切换时更新示例文字 */
function onFxPresetChange(sel) {
  const item = sel.closest('.wf-fx-item');
  const input = item.querySelector('[data-field="fx-text"]');
  const preset = FX_TEXT_PRESETS.find(p => p.id === sel.value);
  if (preset && (!input.value || FX_TEXT_PRESETS.some(p => p.sample === input.value))) {
    input.value = preset.sample;
  }
}

/** 添加产品贴图 */
function addImageOverlay(btn) {
  const node = btn.closest('.drawflow-node');
  const list = node.querySelector('.wf-fx-img-list');
  const input = document.createElement('input');
  input.type = 'file'; input.accept = 'image/*';
  input.onchange = async () => {
    const file = input.files[0]; if (!file) return;
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await authFetch('/api/workflow/effects/upload', { method: 'POST', body: formData });
      const data = await res.json();
      if (!data.success) { showToast('上传失败: ' + (data.error || ''), 'error'); return; }

      const empty = list.querySelector('.wf-fx-empty');
      if (empty) empty.remove();

      _fxCounter++;
      const posOpts = FX_POSITIONS.map(p => `<option value="${p.id}"${p.id === 'center' ? ' selected' : ''}>${p.name}</option>`).join('');
      const item = document.createElement('div');
      item.className = 'wf-fx-item wf-fx-img-item';
      item.id = `fximg-${_fxCounter}`;
      item.dataset.filePath = data.data.path;
      item.dataset.fileUrl = data.data.url;
      item.innerHTML = `
        <div class="wf-fx-item-row">
          <div class="wf-fx-img-thumb"><img src="${data.data.url}" alt="产品图" /></div>
          <div style="flex:1;font-size:10px;color:var(--wf-text2);overflow:hidden;text-overflow:ellipsis">${file.name}</div>
          <button class="wf-fx-del" onclick="removeFxItem(this)">×</button>
        </div>
        <div class="wf-fx-item-row">
          <select class="wf-fx-sel" data-field="fx-img-pos" style="flex:1">${posOpts}</select>
          <div style="display:flex;align-items:center;gap:3px">
            <input type="number" class="wf-fx-num" data-field="fx-img-w" value="200" min="50" max="800" step="10" placeholder="宽" title="宽度(px)" />
            <span style="color:var(--wf-text3);font-size:10px">×</span>
            <input type="number" class="wf-fx-num" data-field="fx-img-h" value="200" min="50" max="800" step="10" placeholder="高" title="高度(px)" />
          </div>
        </div>
        <div class="wf-fx-item-row">
          <input type="number" class="wf-fx-num" data-field="fx-start" value="1" min="0" step="0.5" placeholder="开始(秒)" title="开始时间" />
          <span style="color:var(--wf-text3);font-size:10px">~</span>
          <input type="number" class="wf-fx-num" data-field="fx-end" value="" min="0" step="0.5" placeholder="结束(秒)" title="结束时间，空=全程" />
        </div>
      `;
      list.appendChild(item);
    } catch(e) {
      showToast('上传失败: ' + e.message, 'error');
    }
  };
  input.click();
}

/** 添加指引动画 */
function addPointerEffect(btn) {
  const node = btn.closest('.drawflow-node');
  const list = node.querySelector('.wf-fx-ptr-list');
  const empty = list.querySelector('.wf-fx-empty');
  if (empty) empty.remove();

  _fxCounter++;
  const iconOpts = FX_POINTER_ICONS.map(p => `<option value="${p.id}">${p.char} ${p.name}</option>`).join('');
  const posOpts = FX_POSITIONS.map(p => `<option value="${p.id}"${p.id === 'bottom' ? ' selected' : ''}>${p.name}</option>`).join('');

  const item = document.createElement('div');
  item.className = 'wf-fx-item';
  item.id = `fxptr-${_fxCounter}`;
  item.innerHTML = `
    <div class="wf-fx-item-row">
      <select class="wf-fx-sel" data-field="fx-icon" style="flex:2">${iconOpts}</select>
      <select class="wf-fx-sel" data-field="fx-ptr-pos" style="flex:1">${posOpts}</select>
      <button class="wf-fx-del" onclick="removeFxItem(this)">×</button>
    </div>
    <div class="wf-fx-item-row">
      <input type="number" class="wf-fx-num" data-field="fx-start" value="1" min="0" step="0.5" placeholder="开始(秒)" />
      <span style="color:var(--wf-text3);font-size:10px">~</span>
      <input type="number" class="wf-fx-num" data-field="fx-end" value="" min="0" step="0.5" placeholder="结束(秒)" />
      <input type="number" class="wf-fx-num" data-field="fx-ptr-size" value="48" min="20" max="120" step="4" placeholder="大小" title="字号" />
    </div>
  `;
  list.appendChild(item);
}

/** 删除特效条目 */
function removeFxItem(btn) {
  const item = btn.closest('.wf-fx-item');
  const list = item.parentElement;
  item.remove();
  if (list.children.length === 0) {
    list.innerHTML = '<div class="wf-fx-empty" style="font-size:10px;color:var(--wf-text3);text-align:center;padding:6px">无特效</div>';
  }
}

/** 上传 BGM（特效版） */
// 从素材库选择BGM
async function pickBgmFromAssets(btn) {
  const node = btn.closest('.drawflow-node');
  try {
    const res = await authFetch('/api/assets?type=music&limit=50');
    const data = await res.json();
    const assets = data.success ? (data.data || []) : [];
    if (assets.length === 0) { showToast('素材库中暂无音乐文件', 'error'); return; }

    // 创建选择弹窗
    let modal = document.getElementById('wf-bgm-picker');
    if (modal) modal.remove();
    modal = document.createElement('div');
    modal.id = 'wf-bgm-picker';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:9999;display:flex;align-items:center;justify-content:center';
    modal.innerHTML = `
      <div style="background:var(--wf-bg2,#141519);border-radius:12px;padding:20px;width:400px;max-height:70vh;overflow-y:auto">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
          <span style="font-size:14px;font-weight:700;color:var(--wf-text,#eee)">选择背景音乐</span>
          <button onclick="this.closest('#wf-bgm-picker').remove()" style="background:none;border:none;color:var(--wf-text3,#888);font-size:18px;cursor:pointer">✕</button>
        </div>
        <div id="wf-bgm-list" style="display:flex;flex-direction:column;gap:6px">
          ${assets.map(a => `
            <div class="wf-bgm-item" style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:var(--wf-bg,#0c0c12);border-radius:8px;cursor:pointer;border:1px solid var(--wf-border,#222)"
                 onclick="selectAssetBgm(this,'${a.file_url || a.url}','${a.file_path || ''}','${(a.name || a.original_name || '').replace(/'/g, '')}')">
              <span style="font-size:16px">🎵</span>
              <div style="flex:1;min-width:0">
                <div style="font-size:12px;color:var(--wf-text,#eee);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${a.name || a.original_name || '未命名'}</div>
                <div style="font-size:10px;color:var(--wf-text3,#888)">${a.duration ? Math.round(a.duration) + '秒' : ''} ${a.format || ''}</div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
    modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
    document.body.appendChild(modal);
    // 记住目标节点
    modal._targetNode = node;
  } catch(e) {
    showToast('加载素材库失败: ' + e.message, 'error');
  }
}

function selectAssetBgm(item, fileUrl, filePath, name) {
  const modal = document.getElementById('wf-bgm-picker');
  const node = modal?._targetNode;
  if (modal) modal.remove();
  if (!node) return;

  const bgmBtn = node.querySelector('.wf-nd-bgm-btn');
  if (bgmBtn) {
    bgmBtn.textContent = '🎵 ' + (name || '素材库音乐');
    bgmBtn.dataset.bgmPath = filePath || fileUrl;
    bgmBtn.dataset.bgmUrl = fileUrl;
  }
  // 显示音量控制
  const volWrap = node.querySelector('[id^="fx-bgm-vol-"]');
  if (volWrap) {
    volWrap.style.display = 'flex';
    const slider = volWrap.querySelector('input[type="range"]');
    const label = volWrap.querySelector('.wf-fx-bgm-vol-val');
    if (slider) slider.oninput = () => { if (label) label.textContent = slider.value + '%'; };
  }
  showToast('已选择: ' + (name || '素材库音乐'), 'success');
}

function uploadFxBgm(btn) {
  const node = btn.closest('.drawflow-node');
  const input = document.createElement('input');
  input.type = 'file'; input.accept = '.mp3,.wav,.ogg,.m4a,audio/*';
  input.onchange = async () => {
    const file = input.files[0]; if (!file) return;
    btn.textContent = '⏳ 上传中...';
    btn.disabled = true;
    const formData = new FormData();
    formData.append('music', file);
    try {
      const res = await authFetch('/api/projects/upload-music', { method: 'POST', body: formData });
      const data = await res.json();
      if (data.success) {
        const musicUrl = data.data?.file_url || data.data?.path || data.data?.file_path;
        btn.textContent = '🎵 ' + file.name;
        btn.dataset.bgmPath = data.data?.file_path || musicUrl;
        btn.dataset.bgmUrl = musicUrl;
        // 显示音量控制
        const nodeId = node.id.replace('node-', '');
        const volWrap = node.querySelector('[id^="fx-bgm-vol-"]');
        if (volWrap) {
          volWrap.style.display = 'flex';
          const slider = volWrap.querySelector('input[type="range"]');
          const label = volWrap.querySelector('.wf-fx-bgm-vol-val');
          if (slider) slider.oninput = () => { if (label) label.textContent = slider.value + '%'; };
        }
      } else {
        btn.textContent = '🎵 上传失败，点击重试';
      }
    } catch(e) {
      btn.textContent = '🎵 上传失败: ' + (e.message || '').substring(0, 30);
    }
    btn.disabled = false;
  };
  input.click();
}

/** 快捷模板应用 */
function applyFxTemplate(btn, templateId) {
  const node = btn.closest('.drawflow-node');
  // 清空现有特效
  ['wf-fx-text-list', 'wf-fx-ptr-list'].forEach(cls => {
    const list = node.querySelector('.' + cls);
    if (list) list.innerHTML = '';
  });

  if (templateId === 'ecommerce') {
    // 带货模板：标题 + 价格 + 促销 + 购物车指引
    addTextEffect(node.querySelector('.wf-fx-text-list')?.closest('.wf-nd-body')?.querySelector('[onclick*="addTextEffect"]') || btn);
    setTimeout(() => {
      const items = node.querySelectorAll('.wf-fx-text-list .wf-fx-item');
      const last = items[items.length - 1];
      if (last) {
        last.querySelector('[data-field="fx-preset"]').value = 'title';
        last.querySelector('[data-field="fx-text"]').value = '限时特惠';
        last.querySelector('[data-field="fx-position"]').value = 'top';
      }
    }, 50);
    setTimeout(() => {
      addTextEffect(node.querySelector('[onclick*="addTextEffect"]'));
      setTimeout(() => {
        const items = node.querySelectorAll('.wf-fx-text-list .wf-fx-item');
        const last = items[items.length - 1];
        if (last) {
          last.querySelector('[data-field="fx-preset"]').value = 'price';
          last.querySelector('[data-field="fx-text"]').value = '¥9.9';
          last.querySelector('[data-field="fx-position"]').value = 'center-right';
          last.querySelector('[data-field="fx-start"]').value = '2';
        }
      }, 50);
    }, 100);
    setTimeout(() => {
      addTextEffect(node.querySelector('[onclick*="addTextEffect"]'));
      setTimeout(() => {
        const items = node.querySelectorAll('.wf-fx-text-list .wf-fx-item');
        const last = items[items.length - 1];
        if (last) {
          last.querySelector('[data-field="fx-preset"]').value = 'promo';
          last.querySelector('[data-field="fx-text"]').value = '今日下单立减50%';
          last.querySelector('[data-field="fx-position"]').value = 'bottom';
          last.querySelector('[data-field="fx-start"]').value = '3';
        }
      }, 50);
    }, 200);
    setTimeout(() => {
      addPointerEffect(node.querySelector('[onclick*="addPointerEffect"]'));
      setTimeout(() => {
        const items = node.querySelectorAll('.wf-fx-ptr-list .wf-fx-item');
        const last = items[items.length - 1];
        if (last) {
          last.querySelector('[data-field="fx-icon"]').value = 'cart';
          last.querySelector('[data-field="fx-ptr-pos"]').value = 'bottom';
          last.querySelector('[data-field="fx-start"]').value = '3';
        }
      }, 50);
    }, 300);
    // 高亮选中的模板按钮
    node.querySelectorAll('.wf-nd-chips .wf-nd-chip').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    showToast('已应用带货模板，可自由编辑文字和参数', 'success');

  } else if (templateId === 'promo') {
    addTextEffect(node.querySelector('[onclick*="addTextEffect"]'));
    setTimeout(() => {
      const last = node.querySelector('.wf-fx-text-list .wf-fx-item:last-child');
      if (last) {
        last.querySelector('[data-field="fx-preset"]').value = 'emphasis';
        last.querySelector('[data-field="fx-text"]').value = '限时抢购';
        last.querySelector('[data-field="fx-position"]').value = 'top';
      }
    }, 50);
    setTimeout(() => {
      addTextEffect(node.querySelector('[onclick*="addTextEffect"]'));
      setTimeout(() => {
        const last = node.querySelector('.wf-fx-text-list .wf-fx-item:last-child');
        if (last) {
          last.querySelector('[data-field="fx-preset"]').value = 'price';
          last.querySelector('[data-field="fx-text"]').value = '¥19.9 原价¥99';
          last.querySelector('[data-field="fx-position"]').value = 'center';
          last.querySelector('[data-field="fx-start"]').value = '1';
        }
      }, 50);
    }, 100);
    setTimeout(() => {
      addPointerEffect(node.querySelector('[onclick*="addPointerEffect"]'));
      setTimeout(() => {
        const last = node.querySelector('.wf-fx-ptr-list .wf-fx-item:last-child');
        if (last) {
          last.querySelector('[data-field="fx-icon"]').value = 'fire';
          last.querySelector('[data-field="fx-start"]').value = '1';
        }
      }, 50);
    }, 200);
    node.querySelectorAll('.wf-nd-chips .wf-nd-chip').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    showToast('已应用促销模板', 'success');

  } else if (templateId === 'tutorial') {
    addTextEffect(node.querySelector('[onclick*="addTextEffect"]'));
    setTimeout(() => {
      const last = node.querySelector('.wf-fx-text-list .wf-fx-item:last-child');
      if (last) {
        last.querySelector('[data-field="fx-preset"]').value = 'subtitle';
        last.querySelector('[data-field="fx-text"]').value = '操作步骤说明';
        last.querySelector('[data-field="fx-position"]').value = 'bottom';
      }
    }, 50);
    setTimeout(() => {
      addPointerEffect(node.querySelector('[onclick*="addPointerEffect"]'));
      setTimeout(() => {
        const last = node.querySelector('.wf-fx-ptr-list .wf-fx-item:last-child');
        if (last) {
          last.querySelector('[data-field="fx-icon"]').value = 'finger_point';
          last.querySelector('[data-field="fx-ptr-pos"]').value = 'center';
          last.querySelector('[data-field="fx-start"]').value = '2';
        }
      }, 50);
    }, 100);
    node.querySelectorAll('.wf-nd-chips .wf-nd-chip').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    showToast('已应用教程模板', 'success');
  }
}

/** 从合成节点收集所有特效配置 */
function collectFxConfig(node) {
  const config = { texts: [], images: [], pointers: [], bgm: null };

  // 收集文字特效
  node.querySelectorAll('.wf-fx-text-list .wf-fx-item').forEach(item => {
    const text = item.querySelector('[data-field="fx-text"]')?.value?.trim();
    if (!text) return;
    const preset = item.querySelector('[data-field="fx-preset"]')?.value || 'subtitle';
    const position = item.querySelector('[data-field="fx-position"]')?.value || 'center';
    const startTime = parseFloat(item.querySelector('[data-field="fx-start"]')?.value) || 0;
    const endVal = item.querySelector('[data-field="fx-end"]')?.value;
    const endTime = endVal ? parseFloat(endVal) : undefined;
    config.texts.push({ text, preset, position, startTime, endTime });
  });

  // 收集图片叠加
  node.querySelectorAll('.wf-fx-img-list .wf-fx-img-item').forEach(item => {
    const filePath = item.dataset.filePath;
    if (!filePath) return;
    const position = item.querySelector('[data-field="fx-img-pos"]')?.value || 'center';
    const width = parseInt(item.querySelector('[data-field="fx-img-w"]')?.value) || 200;
    const height = parseInt(item.querySelector('[data-field="fx-img-h"]')?.value) || 200;
    const startTime = parseFloat(item.querySelector('[data-field="fx-start"]')?.value) || 0;
    const endVal = item.querySelector('[data-field="fx-end"]')?.value;
    const endTime = endVal ? parseFloat(endVal) : undefined;
    // 将位置名称转换为坐标（近似值，实际由后端根据视频尺寸计算）
    config.images.push({ path: filePath, position, width, height, startTime, endTime });
  });

  // 收集指引动画
  node.querySelectorAll('.wf-fx-ptr-list .wf-fx-item').forEach(item => {
    const icon = item.querySelector('[data-field="fx-icon"]')?.value || 'arrow_down';
    const posId = item.querySelector('[data-field="fx-ptr-pos"]')?.value || 'bottom';
    const startTime = parseFloat(item.querySelector('[data-field="fx-start"]')?.value) || 0;
    const endVal = item.querySelector('[data-field="fx-end"]')?.value;
    const endTime = endVal ? parseFloat(endVal) : undefined;
    const fontSize = parseInt(item.querySelector('[data-field="fx-ptr-size"]')?.value) || 48;
    // 位置映射到百分比
    const posMap = {
      'top': { x: '50%', y: '10%' }, 'top-left': { x: '15%', y: '10%' }, 'top-right': { x: '85%', y: '10%' },
      'center': { x: '50%', y: '50%' }, 'center-left': { x: '15%', y: '50%' }, 'center-right': { x: '85%', y: '50%' },
      'bottom': { x: '50%', y: '85%' }, 'bottom-left': { x: '15%', y: '85%' }, 'bottom-right': { x: '85%', y: '85%' }
    };
    const pos = posMap[posId] || posMap.bottom;
    config.pointers.push({ icon, x: pos.x, y: pos.y, startTime, endTime, fontSize });
  });

  // BGM
  const bgmBtn = node.querySelector('.wf-nd-bgm-btn');
  const bgmPath = bgmBtn?.dataset?.bgmPath;
  if (bgmPath) {
    const volSlider = node.querySelector('[data-field="bgm-volume"]');
    const volume = volSlider ? parseInt(volSlider.value) / 100 : 0.3;
    config.bgm = { path: bgmPath, volume, fadeIn: 1, fadeOut: 2 };
  }

  return config;
}

/** 应用特效到视频并轮询结果 */
async function applyFxToVideo(node, videoUrl, btn) {
  const fxConfig = collectFxConfig(node);
  const hasFx = fxConfig.texts.length > 0 || fxConfig.images.length > 0 || fxConfig.pointers.length > 0 || fxConfig.bgm;
  if (!hasFx) return videoUrl; // 无特效，返回原始视频

  setNodeStatus(btn, 'running', '渲染特效中...');

  // 图片位置：将 position 名转为像素坐标（假设 1080p）
  fxConfig.images = fxConfig.images.map(img => {
    const posMap = {
      'top': { x: 440, y: 40 }, 'top-left': { x: 40, y: 40 }, 'top-right': { x: 740, y: 40 },
      'center': { x: 440, y: 340 }, 'center-left': { x: 40, y: 340 }, 'center-right': { x: 740, y: 340 },
      'bottom': { x: 440, y: 640 }, 'bottom-left': { x: 40, y: 640 }, 'bottom-right': { x: 740, y: 640 }
    };
    const pos = posMap[img.position] || posMap.center;
    return { ...img, x: pos.x, y: pos.y };
  });

  try {
    const res = await authFetch('/api/workflow/effects/apply', {
      method: 'POST',
      body: JSON.stringify({ videoUrl, ...fxConfig })
    });
    const data = await res.json();
    if (!data.success || !data.taskId) {
      showToast('特效提交失败: ' + (data.error || ''), 'error');
      return videoUrl;
    }

    // 轮询
    const taskId = data.taskId;
    while (true) {
      await new Promise(r => setTimeout(r, 1500));
      try {
        const pollRes = await authFetch(`/api/workflow/effects/status/${taskId}`);
        const pollData = await pollRes.json();
        if (!pollData.success) break;
        const p = pollData.data;
        if (p.status === 'done') {
          showToast('特效渲染完成', 'success');
          return p.resultUrl;
        } else if (p.status === 'error') {
          showToast('特效渲染失败: ' + (p.error || ''), 'error');
          return videoUrl;
        }
        setNodeStatus(btn, 'running', p.detail || '渲染中...');
      } catch(e) { break; }
    }
  } catch(e) {
    showToast('特效请求失败: ' + e.message, 'error');
  }
  return videoUrl;
}
