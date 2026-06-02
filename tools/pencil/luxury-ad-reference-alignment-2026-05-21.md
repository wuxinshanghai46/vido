# 高定广告片参考视频对齐说明

## 目标

本次只增强「广告数字人 > 高定广告片」模式，不影响普通广告数字人、商品数字人、数字人形象生成、口型同步等其它独立功能。

参考视频拆成两类能力：

- 素材前处理：人物动起来、批量抠图、产品替换、背景锁定。
- 高定成片：GPT image2 类关键帧分镜 + Seedance2 / 可灵 / 海螺图生视频。

## 最小 UI 范围

- 保留现有高定广告入口、风格、镜头数量和分镜看板。
- 在高定分镜卡片内追加只读信息：
  - 参考镜头角色
  - 摄影解构：景别、焦段、灯光、调色
  - 素材处理：背景锁定、产品保持、人物身份保持
  - 运动方式：图生视频镜头运动 brief
- 在高定预览状态条显示供应商队列：火山 Seedance -> 漫路可灵 -> 漫路海螺 -> Topview。

## 后端字段

高定分镜对象新增结构化字段：

- `workflow_type: luxury_ad_storyboard`
- `reference_alignment: gpt_image2_seedance2`
- `shot_index`, `shot_count`, `shot_role`
- `photography`
- `reverse_cinematography`
- `camera_plan`
- `material_pipeline`
- `product_lock`
- `identity_lock`
- `image2_brief`
- `i2v_brief`
- `asset_prep`

这些字段只在高定广告片模式生成和展示，其它数字人链路不读取、不要求、不展示。
