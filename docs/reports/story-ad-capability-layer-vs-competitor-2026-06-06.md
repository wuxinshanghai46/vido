# 剧情广告能力层本地验证与竞品差距 - 2026-06-06

## 本次本地验证

- 本地地址：http://localhost:3007
- 测试 brief：30 秒写实真人商业广告，固定同一位真人店长，AI 智能订货系统，要求 4 个镜头。
- 剧本接口：`POST /api/dh/luxury-ad/storyboard`
  - 返回成功。
  - `segments.length = 4`
  - `recommended_shot_count = 4`
  - `shot_count_range = { min: 4, max: 4 }`
- 分镜审核包：`POST /api/dh/spaces/keyframes`
  - `storyboard_mode = planning_sheet`
  - `scenes.length = 4`
  - `keyframes.length = 0`
  - `storyboard_sheets.length = 1`
  - `production_project_id = 3b699243-e927-45db-87b3-a3841f89f346`
  - `project_state = frame_reviewing`
  - 演员参考：已确认。
- 最终关键帧请求：
  - HTTP 422
  - `code = LUXURY_REFERENCE_PRESERVING_MODEL_REQUIRED`
  - `project_state = model_required`
  - 被硬拦截，没有继续消耗自由生图模型。

## 能力层结果

当前可运行关键帧模型：

- `deyunai/nano-banana-pro`
- `deyunai/nano-banana`
- `deyunai/qwen-image-edit`
- `deyunai/qwen-image`
- `deyunai/doubao-seedream-4-0-250828`
- `deyunai/imagen-4`
- `deyunai/flux-pro`

严格真人关键帧要求：

- `image_edit`
- `reference_preserving`
- `character_consistency`
- `realistic_photo`

验证结论：当前可运行模型里没有满足完整保参考真人关键帧能力的模型。`qwen-image-edit`、`nano-banana-pro` 虽具备图像编辑/多参考/写实倾向，但缺少被系统认定可商用放行的 `reference_preserving` 和 `character_consistency`，所以不会再被误当作商用真人关键帧模型。

## 竞品状态机对比

竞品静态包仍能识别完整项目状态：

- `draft`
- `script_generating`
- `script_reviewing`
- `frame_generating`
- `frame_reviewing`
- `video_generating`
- `video_ready`
- `exported`
- `failed`

本地当前已补齐/改善：

- 剧本镜头数硬约束：已从“4 镜请求可能生成 9/10 镜”修到“正好 4 镜”。
- 项目化审核包：已生成可审核分镜板和生产项目 ID。
- 模型能力门禁：已从 Topview/供应商硬编码改为能力判断。
- 最终关键帧防误跑：已能明确挡住不具备保参考真人能力的模型。

本地仍落后：

- 还没有可运行的严格真人保参考关键帧模型，所以无法产出竞品级真人分镜图。
- 还没有完成“确认关键帧后进入图生视频”的可商用闭环。
- 分镜审核板只是流程资产，不等于竞品右侧那种可直接检查的真实真人关键帧/成片预览。
- 视觉风格能否接近竞品真实商业片，仍取决于保参考 Image2/编辑模型实际可用性和 QA 通过率。

## 完成度判断

- 流程骨架完成度：约 65%。
- 商用可交付完成度：约 45%-50%。
- 与竞品差距：仍约 35%-40%，主要卡在真实人物关键帧模型能力和后续成片闭环，而不是剧本拆分或 UI 状态。

## 下一步必须做

1. 在模型调用管理中启用至少一个满足 `image_edit + reference_preserving + character_consistency + realistic_photo` 的关键帧模型。
2. 用同一演员参考跑 4 镜最终关键帧，并要求 QA 全部通过。
3. 关键帧通过后，再进入 `luxury_ad.video`，按 `image_to_video` 能力选择 Seedance2 / Topview I2V / 可灵 / 海螺。
4. 对成片做商用检查：同一演员、同一场景世界、镜头运动自然、无 AI 塑料感、无剧情跑偏。
