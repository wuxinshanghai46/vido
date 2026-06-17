# 剧情广告增强控制模式产品/UI 设计稿 - 2026-06-17

> 类型：产品规则 + UI/UX 设计稿  
> 范围：剧情广告模块新增“增强控制模式”，不改默认经典生成流程  
> 状态：设计确认稿，未进入代码实现

## 目标

在不影响现有剧情广告正常生成的前提下，新增一套可显式启用的增强控制能力，解决三类需求：

1. 场景不只局限于室内，可以明确控制室外、室内外混合、门店外景、城市街区、工厂外景等。
2. 支持“科技感商业 / 科幻商业”视觉方向，但保持真人实拍商业质感，不把人物变成塑料 AI 或纯 3D CG。
3. 商品不再只是参考图，而是可以配置为“必须入镜”的生产资产，并明确规划哪些镜头展示商品、如何展示、用什么强度锁定。

## 绝对原则

- 默认流程不变。用户不启用增强控制时，仍走现有 classic 剧情广告流程。
- 不固定写死行业、商品、场景、镜头数量、商品出现位置。
- 不隐藏兜底。任一关键规则无法满足时必须失败，并展示失败原因。
- 不让参考图覆盖用户确认的剧本、场地和人物动作。
- 不把“商品图”自动塞进所有镜头；商品必须按照镜头计划进入。
- 不把“科幻商业”混入普通写实模式；普通模式继续严格限制 CGI、假 UI、假人。
- UI 必须沿用当前剧情广告工作台的信息层级，不新增孤立页面。

## 新旧流程边界

### classic 模式

现有剧情广告默认模式。满足以下条件时继续使用 classic：

- 场景方向为“自动”
- 未启用商品强入镜
- 未启用参考视频/风格锁
- 未启用科技感商业模式

classic 不新增强制字段，不改变现有 prompt、QA 和生成链路。

### controlled 模式

增强控制模式。满足任一条件时进入 controlled：

- 用户选择了非“自动”的场景方向
- 用户上传主商品图并启用商品融入策略
- 用户上传参考视频/参考风格并确认使用
- 用户选择“科技感商业”
- 用户填写了禁止场景或必须场景

controlled 只新增规则层，不复用隐藏兜底。生成失败时返回规则失败。

## 页面结构

增强控制不单独开新页，放在剧情广告第 1 步“广告需求”下方，作为一个可折叠区块：

```text
剧情广告
├─ 广告需求输入
├─ 可选参考图/视频
├─ 制作控制（新增，可折叠）
│  ├─ 场景方向
│  ├─ 商品融入
│  ├─ 参考风格
│  └─ 禁止项
├─ 生成场景配置
└─ 后续步骤保持现有顺序
```

默认折叠标题：

```text
制作控制  自动
```

启用后标题显示摘要：

```text
制作控制  室外+商品强入镜+科技UI
```

## 制作控制区 UI

### 1. 场景方向

使用 segmented control，不用自由散乱按钮。

选项：

- 自动
- 室内
- 室外
- 室内+室外
- 科技感商业
- 自定义

字段：

```json
{
  "environment_control": {
    "enabled": true,
    "mode": "auto | indoor | outdoor | mixed | sci_fi_commercial | custom",
    "required_locations": [],
    "forbidden_locations": [],
    "location_ratio": {
      "indoor": 0,
      "outdoor": 0,
      "studio": 0
    },
    "custom_prompt": ""
  }
}
```

交互规则：

- 选“自动”时不进入 controlled。
- 选“室外”时，默认不写死具体场地，只要求分镜规划阶段给出合理室外地点。
- 选“科技感商业”时，允许 UI/SFX 标签，但不允许人物变 CG。
- “必须场景”和“禁止场景”是用户输入的动态规则，不内置固定行业场景。

### 2. 商品融入

以“主商品卡片”呈现，不放在隐藏侧栏。

卡片字段：

- 商品图上传
- 商品名称
- 商品出现强度：低 / 中 / 高
- 商品锁定强度：严格 / 标准 / 宽松
- 展示方式多选：
  - 商品特写
  - 人物手持
  - 使用过程
  - 场景中自然出现
  - 对比/证明
  - 结尾 CTA

字段：

```json
{
  "product_control": {
    "enabled": true,
    "asset_id": "main_product",
    "name": "",
    "image_url": "",
    "presence_level": "low | medium | high",
    "lock_strength": "strict | standard | loose",
    "display_methods": ["detail", "in_hand", "usage_demo", "scene_evidence", "proof", "cta"],
    "must_appear_shot_count": null
  }
}
```

交互规则：

- 上传商品但不启用商品融入时，只作为普通参考，不触发 controlled。
- 启用商品融入后，分镜规划必须生成商品入镜计划。
- 严格锁定不等于每个镜头都商品特写，而是商品出现的镜头必须尽量保持上传商品外观。
- 如果商品图上传失败或不可访问，不能继续生成 controlled 分镜。

### 3. 参考风格

参考图/参考视频归入“参考风格”卡片，不和主商品混用。

字段：

```json
{
  "style_control": {
    "enabled": true,
    "source": "reference_image | reference_video | manual",
    "asset_urls": [],
    "style_bible": {
      "visual_tone": "",
      "camera_rhythm": "",
      "color_palette": "",
      "lighting": "",
      "vfx_policy": "none | subtle_ui | sci_fi_ui",
      "must_keep": [],
      "must_avoid": []
    },
    "confirmed_by_user": false
  }
}
```

交互规则：

- 上传参考视频后，系统先分析，不直接进入生成。
- 分析结果必须展示给用户确认。
- 用户未确认 `style_bible` 时，不写入生成规则。
- 参考风格不能覆盖商品锁、人物锁和场景锁。

### 4. 禁止项

轻量文本输入，不做固定写死。

字段：

```json
{
  "negative_control": {
    "forbidden_locations": [],
    "forbidden_visuals": [],
    "forbidden_products": [],
    "forbidden_style": []
  }
}
```

示例占位文案：

```text
例如：不要办公室、不要家居、不要白色极简室内、不要展厅、不要假3D感
```

## 分镜页 UI

每个镜头卡片新增规则标签区域，保持当前分镜卡片风格。

标签示例：

```text
室外  商品必入镜  人物必出现  科技UI  QA严格
```

镜头字段展示：

- 场地锁：城市街区 / 门店外景 / 工厂外景 / 自定义
- 商品角色：无 / 可选 / 必须 / 特写 / 手持 / 使用过程 / CTA
- 人物要求：无 / 可选 / 必须
- UI/SFX：无 / 轻量UI / 科技UI
- QA 策略：普通 / 商品严格 / 场景严格 / 科技商业

用户可在逐镜编辑里改这些字段。修改后只影响该镜头，不反向污染全局规则。

## 分镜计划数据结构

controlled 模式下，场景配置和剧本阶段必须输出结构化镜头计划：

```json
{
  "control_mode": "controlled",
  "shot_controls": [
    {
      "index": 0,
      "environment_mode": "outdoor",
      "location_lock": "city street near the store entrance",
      "location_source": "user_rule | ai_plan | reference_style",
      "product_presence": "required | optional | none",
      "product_role": "hero | detail | in_hand | usage_demo | scene_evidence | proof | cta",
      "product_fidelity_required": true,
      "person_required": true,
      "vfx_overlay": "none | subtle_ui | sci_fi_ui",
      "qa_profile": "standard | product_strict | environment_strict | sci_fi_commercial"
    }
  ]
}
```

## 后端新增逻辑边界

新增一组函数，不改旧函数默认行为：

```text
buildLuxuryControlledBrief()
planLuxuryControlledShots()
compileLuxuryControlledShotContract()
validateLuxuryControlledShotQa()
```

老流程继续使用现有 `luxury_ad` 默认逻辑。新函数只在 `control_mode === "controlled"` 时调用。

## QA 规则

### 商品 QA

仅对 `product_presence === "required"` 的镜头启用。

失败条件：

- 商品未出现
- 商品品类错误
- 商品被替换成竞品或无关道具
- 商品被遮挡到不可识别
- 严格锁定时，颜色/形状/包装与上传图明显不符

### 场景 QA

仅对非 auto 场景启用。

失败条件：

- 要求室外却生成室内
- 要求门店外景却生成办公室/家居/展厅
- 禁止场景出现在画面主体中

### 科技商业 QA

仅对 `sci_fi_commercial` 或 `vfx_overlay !== "none"` 启用。

允许：

- 轻量 AR UI
- 半透明数据面板
- 科技感光效
- 手机/APP/业务流程视觉化

拒绝：

- 人物变 3D/塑料/蜡像
- 全画面变科幻实验室但和 brief 无关
- 大量假文字/乱码
- UI 遮挡商品或人物主体

## 失败呈现

controlled 模式不兜底。失败卡片展示：

- 失败镜头
- 失败规则
- 当前候选图
- QA 摘要
- 可操作项：
  - 修改该镜头规则
  - 重新生成该镜头
  - 关闭该镜头的增强规则
  - 返回制作控制区调整全局规则

不提供“一键忽略 QA 继续成片”。

## 参考视频处理

参考视频不是直接参与生图，而是先生成 `style_bible`。

分析字段：

- 画幅比例
- 主要场景类型
- 色调
- 光线
- 镜头节奏
- UI/SFX 类型
- 商品出现方式
- 人物构图
- 必须避免项

如果视频分析工具不可用或分析失败：

- 返回失败
- 不把文件名当作风格
- 不继续假装使用参考视频

## 验收标准

### 产品验收

- 默认 classic 流程不显示强制规则，不改变生成行为。
- 启用任一增强控制后，页面明确显示 controlled 状态。
- 商品、场景、参考风格是三个独立卡片，不混用。
- 分镜卡片能看到每镜头规则标签。
- 失败时页面能说明是商品、场景、风格还是人物一致性失败。

### 技术验收

- 未启用 controlled 时，请求体不带增强控制字段，或字段为 disabled。
- 启用 controlled 时，请求体包含 `environment_control`、`product_control`、`style_control`、`shot_controls`。
- controlled 后端逻辑独立函数实现，不改 classic 默认路径。
- QA 失败时返回明确 code，不自动切换模型、不自动降级。
- 本地 `node --check` 通过。

## 实施顺序

1. UI 骨架和状态字段：只保存规则，不接生成。
2. 场景方向进入场景配置/剧本规划。
3. 商品融入进入分镜计划和关键帧 QA。
4. 科技商业模式进入风格规则和 QA。
5. 参考视频分析生成 `style_bible`，用户确认后进入 controlled。

每一步完成后独立验证，不把多个能力一次性混在一起上线。
