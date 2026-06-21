# 高定广告片产品故事生成器原型说明

## 背景

用户反馈当前高定广告片界面仍像“广告数字人制作台”：人物、背景、配音、风格、镜头数量、摄影提示词、供应商队列等概念混在一起，用户需要理解过多制作参数。

参考竞品和参考视频后，本模块应改为“产品宣传故事生成器”：用户提供产品内容和可选素材，系统自动生成广告故事板、关键帧和成片。Topview、Seedance、可灵、海螺、Image2Video、摄影解构等能力保留在后台，不作为主界面用户概念。

## 产品定位

高定广告片不是普通广告数字人的变体，也不是商品数字人口播。

- 普通广告数字人：单镜头展墙/空间导览，人物讲解为主。
- 商品数字人：已融合商品的人物口播，带货表达为主。
- 高定广告片：围绕产品、品牌或场景讲一个宣传故事，视频画面和节奏为主，人物可选。

## 首屏目标

用户进入高定广告片首屏，只需要理解三件事：

1. 上传产品/品牌/场景素材。
2. 填写产品宣传内容。
3. 生成广告故事板。

首屏不展示供应商、摄影解构、焦段、Image2Video、Seedance、Topview 队列等技术词。

## 页面结构

实现上必须新增真正独立的 pane，不再把 `luxury-ad` 映射到 `space-guide`。

```html
<div class="dh-tab-pane" data-pane="luxury-ad">
  <section class="lux-ad-page">
    <header class="lux-ad-header">...</header>
    <main class="lux-ad-workspace">
      <aside class="lux-ad-assets-panel">...</aside>
      <section class="lux-ad-story-panel">...</section>
      <aside class="lux-ad-preview-panel">...</aside>
    </main>
    <footer class="lux-ad-mobile-actions">...</footer>
  </section>
</div>
```

JS 状态应新增 `state.luxuryAd`，不要继续把高定状态塞进 `state.space`。后端接口可第一阶段复用现有 `/api/dh/spaces/keyframes` 与 `/api/dh/spaces/generate`，但前端 DOM、状态、渲染函数和事件绑定必须与普通广告数字人隔离。

### 左侧：素材与身份

区域标题：广告素材

控件：
- 参考素材上传区：支持 1-8 张图片，第一张为主产品/主场景。
- 缩略图素材条：显示序号、主参考标记、上传状态。
- 人物身份参考（可选）：选择后仅作为同一人物身份锁，不是固定数字人主持人。

说明文案：
- “上传产品、品牌、场景或参考画面。系统会用这些素材保持产品形态、材质、颜色和品牌区域。”
- “人物可不选；选择后会保持同一人物身份，只改变姿态、表情和镜头角度。”

建议 DOM：

```html
<aside class="lux-ad-assets-panel">
  <section class="lux-asset-uploader">
    <h2>广告素材</h2>
    <div id="luxAssetDrop" class="lux-asset-drop">
      <input id="luxAssetFiles" type="file" accept="image/*" multiple hidden>
      <span>上传产品、品牌、场景或参考画面</span>
    </div>
    <div id="luxAssetStrip" class="lux-asset-strip"></div>
  </section>
  <section class="lux-character-ref">
    <h2>人物身份参考（可选）</h2>
    <div id="luxCharacterRef"></div>
    <button data-lux-pick-avatar>选择人物</button>
  </section>
</aside>
```

### 中间：产品宣传内容

区域标题：产品宣传故事

默认字段：
- 产品/品牌名称
- 核心卖点
- 目标用户
- 使用场景
- 想要的感觉
- 结尾行动

主输入：
- 一个大文本框，用户也可以直接粘贴完整产品介绍或广告诉求。
- “AI 整理”按钮：把用户散乱内容整理成上述字段。

主按钮：
- 生成广告故事板

缺失提示只检查：
- 产品宣传内容

参考素材第一版建议强提示但不硬阻断：没有素材时允许生成概念广告故事板，但在生成关键帧/成片前提示“未上传真实产品素材，画面可能与真实产品不一致”。

建议 DOM：

```html
<section class="lux-ad-story-panel">
  <label>产品/品牌名称<input id="luxProductName"></label>
  <label>核心卖点<textarea id="luxSellingPoints"></textarea></label>
  <label>目标用户<input id="luxAudience"></label>
  <label>使用场景<input id="luxUseScene"></label>
  <label>完整宣传内容<textarea id="luxBrief"></textarea></label>
  <button id="luxOrganizeBrief">AI 整理内容</button>
  <button id="luxGenerateStoryboard">生成广告故事板</button>
</section>
```

### 右侧：故事板与预览

初始空态：
- 显示 4 个默认故事段落占位：
  1. 开场吸引
  2. 产品细节
  3. 使用/互动
  4. 品牌收束

生成后展示：
- 每个故事段落一张卡片。
- 卡片只展示用户能判断的内容：
  - 这一镜讲什么
  - 画面应该看到什么
  - 使用哪些参考素材
  - 是否有人物出现
  - 关键帧预览图

隐藏在卡片详情/调试信息里：
- workflow_type
- shot_count
- photography
- camera_plan
- image2_brief
- i2v_brief
- provider queue

底部主按钮：
- 确认故事板并生成广告片

建议 DOM：

```html
<section class="lux-storyboard">
  <header>
    <h2>广告故事板</h2>
    <button id="luxRegenerateStoryboard">重新生成</button>
  </header>
  <div id="luxStoryboardGrid">
    <article class="lux-shot-card">
      <div class="lux-shot-thumb"></div>
      <h3>开场吸引</h3>
      <p>这一镜讲什么</p>
      <p>画面应该看到什么</p>
      <div class="lux-shot-assets">使用素材 1、2</div>
    </article>
  </div>
  <button id="luxGenerateKeyframes">生成关键帧预览</button>
  <button id="luxSubmitVideo">确认故事板并生成广告片</button>
</section>
```

## 默认故事结构

默认 4 镜头，先不让用户选择镜头数量。

1. 开场吸引
   - 建立产品/品牌第一眼。
   - 强调产品或场景的高级感、问题钩子或情绪氛围。

2. 产品细节
   - 展示材质、工艺、形态、颜色、功能或核心卖点。
   - 必须锁定上传产品/参考素材的可识别特征。

3. 使用/互动
   - 展示产品进入真实使用场景。
   - 如果用户选择人物，这一镜可以出现同一人物身份；如果未选择人物，不生成随机人物。

4. 品牌收束
   - 建立品牌记忆点。
   - 留出字幕/Logo/行动引导空间。

高级设置中可扩展到 6 或 8 镜头。

## 高级设置

默认折叠。

可放入：
- 广告风格：奢侈品柔光、科技产品片、生活方式广告等。
- 镜头数量：4 / 6 / 8。
- 比例和像素。
- 配音音色。
- 字幕样式。
- 画面补充要求。
- 供应商调试信息。

这些都不是默认阻断项。

## 移动端结构

移动端不沿用旧 `.dh-space-layout` 的素材优先顺序，推荐顺序：

1. 标题和主按钮。
2. 产品宣传内容。
3. 广告素材上传。
4. 广告故事板。
5. 预览/任务。
6. 底部 sticky 操作条。

```css
@media (max-width: 760px) {
  .lux-ad-workspace { display: flex; flex-direction: column; }
  .lux-ad-story-panel { order: 1; }
  .lux-ad-assets-panel { order: 2; }
  .lux-ad-preview-panel { order: 3; }
  .lux-ad-mobile-actions { position: sticky; bottom: 0; }
}
```

## 后端能力映射

前端新概念映射到现有能力：

- 产品宣传内容 -> `text`
- 整理后的故事诉求 -> `scene_prompt`
- 参考素材 -> `background_url` + `reference_images`
- 人物身份参考 -> `avatar_id`
- 默认 4 镜头 -> `shot_count=4`
- 生成故事板 -> `/api/dh/spaces/keyframes` 或新增专用 story endpoint
- 确认成片 -> `/api/dh/spaces/generate`
- 内部仍使用 `ad_mode=luxury_ad` 与 `generation_mode=luxury_storyboard`

实现时建议新增独立前端 pane，例如 `data-pane="luxury-ad"`，不要继续复用 `space-guide` DOM。后端可先复用现有接口，但前端状态应与普通广告数字人彻底隔离。

如果继续复用现有接口，提交 payload 应由 `state.luxuryAd` 映射生成：

- `background_url`: 第一张参考素材 URL，没有素材时为空或使用后端概念生成模式。
- `reference_images`: 所有参考素材 URL。
- `avatar_id`: 可选人物身份参考。
- `text`: 由产品宣传内容整理后的广告 brief。
- `scene_prompt`: 由产品名称、卖点、受众、使用场景、风格自动拼出的故事方向。
- `shot_count`: 默认 4。
- `ad_mode`: `luxury_ad`。
- `generation_mode`: `luxury_storyboard`。

## 隔离要求

- 高定广告片不得修改普通广告数字人的单背景、单镜头、展墙导览流程。
- 高定广告片不得复用普通广告数字人的“配音必选、人物讲解、背景/展示画面”心智。
- 商品数字人的“商品融合形象 + 口播视频”保持独立，不迁移到高定广告片。
- 任务中心可以继续把任务归类为广告类，但卡片标题和详情要显示“高定广告片”。

## 验收标准

- 进入高定广告片首屏，看不到普通广告数字人的展墙导览文案。
- 首屏默认不出现 Topview、Seedance、Image2Video、摄影解构、焦段、供应商队列。
- 用户只填产品宣传内容，即可生成 4 段故事板。
- 多图上传后能看到 1-8 张缩略图，第一张标记为主参考。
- 未选择人物时，故事板和关键帧不应凭空生成随机人物。
- 选择人物时，故事板明确人物只作为身份参考，关键帧保持同一人物身份。
- 点击生成故事板后，用户看到的是“开场、细节、使用/互动、品牌收束”的广告故事，不是技术参数表。
- 点击确认生成广告片时，后台仍能保留 shot_count、workflow_type、provider、keyframe 等工程字段。
- 普通广告数字人入口上传多张图时仍按单背景处理第一张，不进入高定参考素材链路。
- 商品数字人入口不读取高定广告片素材状态。
- 任务中心中的高定任务标题或标签能识别为“高定广告片”。
- 失败提示必须说明阶段：素材上传失败、故事板生成失败、关键帧生成失败或视频提交失败。
