# 剧情广告本地验收与竞品差距 - 2026-06-06

## 结论

本地按竞品方式继续验收后，当前仍不能达到竞品真实成片效果。

已修复并验证通过的部分：
- 剧情广告 review 阶段不再被参考图数量截断，`shot_count=4` 会生成 4 镜。
- 用户已确认的 segments 已加最终锁，`title / voiceover / visual / action / camera` 不再被 story extract、导演修复模板或行业模板覆盖。
- 固定演员素材包进入生产合同，演员主图 + 2 张多视角参考被识别为 confirmed。
- 模型调用管理规则生效：只有阶段启用、供应商启用且授权齐全的模型才会被当作 runnable。

仍未通过的部分：
- 最终真实关键帧 0 张。
- 当前唯一可运行且满足“图像编辑 + 保参考 + 人物一致 + 写实照片”的模型是 `deyunai/gpt-image-2`，但 edits 通道返回上游 500。
- Topview 候选模型在 `luxury_ad.keyframe` 阶段已启用，但本地没有 Topview provider 授权配置，因此按模型调用管理规则不可调用。

## 本地验证记录

### 分镜锁定验证

输出目录：
- `outputs/story-ad-review-lock-check-20260606131317/summary.json`
- `outputs/story-ad-review-lock-check-20260606131317/review_response.json`

结果：
- HTTP 200
- `success=true`
- `scenes=4`
- `storyboard_sheets=1`
- `actor_status=confirmed`
- `actor_extra_count=2`
- 4 镜全部 `confirmed_segment_locked=true`

保真的镜头字段：
- Order pressure: `Lin flips through order papers while glancing at phone.`
- AI recognition: `Lin taps phone and reviews confirmation.`
- Restock advice: `Lin points from phone to shelf item, calm confidence.`
- Calm ending: `Lin puts papers down and looks up with relief.`

### 最终关键帧验证

输出目录：
- `outputs/story-ad-final-after-lock-check-20260606131503/summary.json`
- `outputs/story-ad-final-after-lock-check-20260606131503/final_response.json`

结果：
- HTTP 500
- `success=false`
- `code=LUXURY_KEYFRAME_PROVIDERS_FAILED`
- `scenes=4`
- `keyframes=0`
- attempt:
  - `deyunai/gpt-image-2`
  - `reference_count=5`
  - `reference_kinds=["story_seed_reference","story_seed_reference","identity_reference","identity_reference_view","identity_reference_view"]`
  - error: `GPT Image 2 edits provider error: code=500, reason=PANXXXO100IFR, message=Internal Server Error`

## 当前与竞品差距

1. 竞品能输出真人写实 storyboard / 成片，本地还停在 planning sheet + provider failure。
2. 竞品角色素材库能把固定演员带入后续成片，本地已完成角色包进入合同和模型参考，但模型未成图，无法验证视觉一致性。
3. 竞品项目状态机能继续到 video generating / video ready，本地因 keyframes=0 无法进入 Seedance2 / image-to-video 阶段。
4. 竞品效果图是真人实拍风；本地目前没有最终图，因此不能声称达到竞品风格。

## 下一步

要继续追竞品，必须先打通至少一个本地可运行的保参考关键帧模型：

1. 在模型调用管理里补齐 Topview provider 的 API Key + UID，并测试连接。
2. 或修复 DeyunAI `gpt-image-2` edits 通道 500，确认当前 schema / endpoint / 额度 / 分组授权正确。
3. 打通后重新跑同一套本地验证，要求：
   - 4 张关键帧全部生成。
   - 每张图同一演员、同一产品、同一剧情动作。
   - QA 通过 subject_match / storyboard_match / realism / actor consistency。
   - 关键帧生成后再进入 image-to-video / Seedance2 阶段。

## 21:54 追加：已从线上同步 Topview 授权后的实跑结果

本地已从生产配置安全同步 Topview API Key 与 UID，未在日志/终端输出凭据。

验证：
- Topview upload credential 鉴权接口返回 200 / `code=200`。
- `luxury_ad.keyframe` 阶段中 Topview 候选均变为 provider ready。

异步 final 跑测：
- 输出目录：`outputs/story-ad-final-topview-async-20260606133739/`
- 精简结果：`outputs/story-ad-final-topview-async-20260606133739/summary.json`
- 原始轮询：`outputs/story-ad-final-topview-async-20260606133739/poll_latest.json`

实际尝试模型：
- `deyunai/gpt-image-2`: edits 通道上游 500。
- `topview/topview-gpt-image-2`: 生成后 QA 未通过，subject/storyboard/character 弱匹配。
- `topview/topview-nano-banana-pro`: 生成后 QA 未通过。
- `topview/topview-seedream-5`: Topview 中间图下载超时。
- `topview/topview-nano-banana-2`: 生成后 QA 未通过，曾出现 subject_match=true 但 storyboard_match=false。

可视化候选图：
- `outputs/jimeng-assets/digital_ad_preview_6f0ab74c-bcc0-4927-a835-5780e670ffcb_kf_01_topview_5.png`
- `outputs/jimeng-assets/digital_ad_preview_6f0ab74c-bcc0-4927-a835-5780e670ffcb_kf_01_topview_3.png`
- `outputs/jimeng-assets/digital_ad_preview_6f0ab74c-bcc0-4927-a835-5780e670ffcb_kf_01_topview_2.png`

视觉结论：
- 画质达到写实商业图级别。
- 但内容没有跟随剧本：被参考素材带偏成汽车展厅、材料展厅、设计咨询场景。
- 演员没有固定为本地角色素材 Lin，出现换脸、多人、错误行业场景。
- 因此 QA 拒绝是正确的，当前仍不能视为追平竞品。

新的主要差距：
1. Topview 已可调用，但参考图角色分类和 prompt 合同还不够强，产品/场景参考会覆盖剧情合同。
2. 本地示例使用的演员素材本身偏 2D/3D/非真人参考，无法支撑竞品那种固定真人演员效果。
3. 需要把角色素材库升级为“真人演员卡”：至少正面、左右侧脸、半身、全身、表情/服装一致，而不是普通头像。
4. 需要在进入 Topview 前拆分参考图：actor identity refs 只给人物，scene/product refs 不得作为身份/主画面强参考；或者对 Topview 使用更少但更干净的参考组合。
5. 需要把通过 QA 的单帧图片保存为候选可视化面板，目前失败候选虽然落盘，但页面没有形成竞品式“候选对比/选择/修复”工作流。
