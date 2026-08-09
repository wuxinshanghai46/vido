# VIDO 模型能力端到端审计

> 生成时间：2026-08-09T06:07:19.441Z

本报告只读取现有模型调用管理、业务代码引用和能力元数据，不创建第二套模型注册表，也不执行真实付费调用。

## 汇总

- 业务组：9
- 阶段：93
- 已在业务代码中静态引用：73
- 未发现业务代码静态引用：20
- 没有启用模型的阶段：3
- 显式能力标记：0
- 已验证能力标记：0

“未发现静态引用”是需要继续人工追踪的证据，不直接等同于功能不可用；它表示模型调用管理中的阶段 ID 没有出现在业务执行代码中。

## 高级能力链路

| 能力 | 业务需要 | 业务输入 | 适配器参数 | 供应商参数 | 状态 |
|---|---|---|---|---|---|
| new_story_ad_first_frame | 是 | approved keyframe | image_url | content[].role=first_frame | connected |
| new_story_ad_reference_images | 是 | verified person and scene assets | reference_image_urls | content[].role=reference_image | connected |
| new_story_ad_camera_motion | 是 | shot.camera_movement / shot.camera / shot.action | compiled prompt | structured content text | connected_as_prompt_not_native_control |
| new_story_ad_last_frame | 否 | - | - | - | not_required_current_flow |
| new_story_ad_motion_reference_video | 否 | reference video analysis produces semantic camera/action guidance only | - | - | not_required_current_flow |
| new_story_ad_native_audio | 否 | separate TTS and deterministic audio mux | - | generate_audio=false | intentionally_disabled_to_avoid_double_audio_and_billing |

## 阶段连接矩阵

| 业务组 | 阶段 | 类型 | 启用模型 | 业务引用 | 状态 |
|---|---|---:|---:|---:|---|
| 数字人 | `avatar.describe` | story | 2 | 0 | configured_but_not_statically_referenced |
| 数字人 | `avatar.image_gen` | image | 3 | 0 | configured_but_not_statically_referenced |
| 数字人 | `avatar.sample_video` | video | 2 | 0 | configured_but_not_statically_referenced |
| 数字人 | `avatar.lip_sync` | avatar | 1 | 3 | configured_and_statically_referenced |
| 数字人 | `avatar.tts` | tts | 2 | 1 | configured_and_statically_referenced |
| 商品数字人 | `product_avatar.describe` | story | 1 | 0 | configured_but_not_statically_referenced |
| 商品数字人 | `product_avatar.person_image` | image | 2 | 0 | configured_but_not_statically_referenced |
| 商品数字人 | `product_avatar.fuse_image` | avatar | 3 | 1 | configured_and_statically_referenced |
| 商品数字人 | `product_avatar.marketing_video` | video | 2 | 1 | configured_and_statically_referenced |
| 商品数字人 | `product_avatar.tts` | tts | 2 | 1 | configured_and_statically_referenced |
| 广告数字人 | `ad_avatar.copy` | story | 1 | 0 | configured_but_not_statically_referenced |
| 广告数字人 | `ad_avatar.keyframe` | image | 2 | 0 | configured_but_not_statically_referenced |
| 广告数字人 | `ad_avatar.marketing_video` | video | 6 | 1 | configured_and_statically_referenced |
| 广告数字人 | `ad_avatar.lip_sync` | avatar | 1 | 2 | configured_and_statically_referenced |
| 广告数字人 | `ad_avatar.tts` | tts | 1 | 1 | configured_and_statically_referenced |
| 剧情广告 | `luxury_ad.scene_config` | story | 10 | 1 | configured_and_statically_referenced |
| 剧情广告 | `luxury_ad.script` | story | 10 | 1 | configured_and_statically_referenced |
| 剧情广告 | `luxury_ad.storyboard_director` | story | 10 | 1 | configured_and_statically_referenced |
| 剧情广告 | `luxury_ad.reference_analyze` | vlm | 4 | 1 | configured_and_statically_referenced |
| 剧情广告 | `luxury_ad.person_sheet` | image | 4 | 2 | configured_and_statically_referenced |
| 剧情广告 | `luxury_ad.presenter_seed` | image | 4 | 1 | configured_and_statically_referenced |
| 剧情广告 | `luxury_ad.scene_seed` | image | 4 | 1 | configured_and_statically_referenced |
| 剧情广告 | `luxury_ad.subject_evidence_seed` | image | 5 | 1 | configured_and_statically_referenced |
| 剧情广告 | `luxury_ad.keyframe` | image | 8 | 2 | configured_and_statically_referenced |
| 剧情广告 | `luxury_ad.keyframe_qa` | vlm | 4 | 2 | configured_and_statically_referenced |
| 剧情广告 | `luxury_ad.keyframe_repair` | story | 4 | 0 | configured_but_not_statically_referenced |
| 剧情广告 | `luxury_ad.video` | video | 4 | 2 | configured_and_statically_referenced |
| 剧情广告 | `luxury_ad.tts` | tts | 2 | 0 | configured_but_not_statically_referenced |
| 剧情广告 | `luxury_ad.post` | video | 1 | 0 | configured_but_not_statically_referenced |
| 新剧情广告 | `new_story_ad.reference_video_vision` | vlm | 3 | 2 | configured_and_statically_referenced |
| 新剧情广告 | `new_story_ad.reference_video_synthesis` | story | 4 | 2 | configured_and_statically_referenced |
| 新剧情广告 | `new_story_ad.asset_plan` | story | 4 | 3 | configured_and_statically_referenced |
| 新剧情广告 | `new_story_ad.scene_config` | story | 3 | 3 | configured_and_statically_referenced |
| 新剧情广告 | `new_story_ad.story_facts` | story | 4 | 1 | configured_and_statically_referenced |
| 新剧情广告 | `new_story_ad.story_facts_repair` | story | 4 | 1 | configured_and_statically_referenced |
| 新剧情广告 | `new_story_ad.asset_plan_missing_sections_recovery` | story | 4 | 2 | configured_and_statically_referenced |
| 新剧情广告 | `new_story_ad.asset_plan_scene_recovery` | story | 4 | 1 | configured_and_statically_referenced |
| 新剧情广告 | `new_story_ad.asset_plan_story_development` | story | 4 | 1 | configured_and_statically_referenced |
| 新剧情广告 | `new_story_ad.asset_plan_scene_coverage_recovery` | story | 0 | 1 | configured_and_statically_referenced |
| 新剧情广告 | `new_story_ad.blueprint` | story | 3 | 5 | configured_and_statically_referenced |
| 新剧情广告 | `new_story_ad.blueprint_structure_repair` | story | 4 | 2 | configured_and_statically_referenced |
| 新剧情广告 | `new_story_ad.blueprint_language_repair` | story | 4 | 2 | configured_and_statically_referenced |
| 新剧情广告 | `new_story_ad.blueprint_polish` | story | 4 | 2 | configured_and_statically_referenced |
| 新剧情广告 | `new_story_ad.storyboard_table` | story | 3 | 3 | configured_and_statically_referenced |
| 新剧情广告 | `new_story_ad.storyboard_fill_missing` | story | 4 | 1 | configured_and_statically_referenced |
| 新剧情广告 | `new_story_ad.storyboard_rewrite` | story | 3 | 3 | configured_and_statically_referenced |
| 新剧情广告 | `new_story_ad.storyboard_language_repair` | story | 4 | 2 | configured_and_statically_referenced |
| 新剧情广告 | `new_story_ad.scene_config_language_repair` | story | 4 | 1 | configured_and_statically_referenced |
| 新剧情广告 | `new_story_ad.qa` | story | 3 | 3 | configured_and_statically_referenced |
| 新剧情广告 | `new_story_ad.json_repair` | story | 3 | 18 | configured_and_statically_referenced |
| 新剧情广告 | `new_story_ad.assist` | story | 3 | 4 | configured_and_statically_referenced |
| 新剧情广告 | `new_story_ad.person_sheet` | image | 1 | 4 | configured_and_statically_referenced |
| 新剧情广告 | `new_story_ad.person_dossier_atlas` | image | 1 | 1 | configured_and_statically_referenced |
| 新剧情广告 | `new_story_ad.person_dossier_native_master` | image | 1 | 1 | configured_and_statically_referenced |
| 新剧情广告 | `new_story_ad.person_dossier_wearable_accessory` | image | 1 | 0 | configured_but_not_statically_referenced |
| 新剧情广告 | `new_story_ad.person_dossier_wardrobe_detail` | image | 1 | 0 | configured_but_not_statically_referenced |
| 新剧情广告 | `new_story_ad.pet_dossier` | image | 1 | 1 | configured_and_statically_referenced |
| 新剧情广告 | `new_story_ad.prop_dossier_atlas` | image | 1 | 1 | configured_and_statically_referenced |
| 新剧情广告 | `new_story_ad.product_asset` | image | 1 | 1 | configured_and_statically_referenced |
| 新剧情广告 | `new_story_ad.storyboard_sketch` | image | 1 | 1 | configured_and_statically_referenced |
| 新剧情广告 | `new_story_ad.scene_asset` | image | 1 | 2 | configured_and_statically_referenced |
| 新剧情广告 | `new_story_ad.scene_panorama` | image | 1 | 2 | configured_and_statically_referenced |
| 新剧情广告 | `new_story_ad.scene_panorama_qa` | vlm | 3 | 2 | configured_and_statically_referenced |
| 新剧情广告 | `new_story_ad.person_consistency_qa` | vlm | 3 | 1 | configured_and_statically_referenced |
| 新剧情广告 | `new_story_ad.person_dossier_qa` | vlm | 3 | 1 | configured_and_statically_referenced |
| 新剧情广告 | `new_story_ad.person_keyframe_qa` | vlm | 3 | 1 | configured_and_statically_referenced |
| 新剧情广告 | `new_story_ad.pet_consistency_qa` | vlm | 3 | 1 | configured_and_statically_referenced |
| 新剧情广告 | `new_story_ad.product_consistency_qa` | vlm | 3 | 1 | configured_and_statically_referenced |
| 新剧情广告 | `new_story_ad.product_keyframe_qa` | vlm | 3 | 1 | configured_and_statically_referenced |
| 新剧情广告 | `new_story_ad.scene_vision` | vlm | 3 | 2 | configured_and_statically_referenced |
| 新剧情广告 | `new_story_ad.scene_consistency_qa` | vlm | 3 | 3 | configured_and_statically_referenced |
| 新剧情广告 | `new_story_ad.scene_camera_qa` | vlm | 3 | 1 | configured_and_statically_referenced |
| 新剧情广告 | `new_story_ad.video_frame_qa` | vlm | 3 | 1 | configured_and_statically_referenced |
| 新剧情广告 | `new_story_ad.cross_shot_visual_qa` | vlm | 3 | 1 | configured_and_statically_referenced |
| 新剧情广告 | `new_story_ad.scene_depth` | image | 0 | 1 | configured_and_statically_referenced |
| 新剧情广告 | `new_story_ad.scene_spatial_reconstruction` | image | 0 | 1 | configured_and_statically_referenced |
| 新剧情广告 | `new_story_ad.scene_spatial_qa` | vlm | 3 | 1 | configured_and_statically_referenced |
| 新剧情广告 | `new_story_ad.keyframe` | image | 1 | 3 | configured_and_statically_referenced |
| 新剧情广告 | `new_story_ad.video` | video | 2 | 3 | configured_and_statically_referenced |
| 新剧情广告 | `new_story_ad.tts` | tts | 2 | 1 | configured_and_statically_referenced |
| 网剧 | `drama.script` | story | 1 | 2 | configured_and_statically_referenced |
| 网剧 | `drama.character_image` | image | 1 | 0 | configured_but_not_statically_referenced |
| 网剧 | `drama.scene_image` | image | 1 | 1 | configured_and_statically_referenced |
| 网剧 | `drama.video_clip` | video | 2 | 1 | configured_and_statically_referenced |
| 网剧 | `drama.tts` | tts | 1 | 0 | configured_but_not_statically_referenced |
| 爆款复刻 | `replicate.extract` | story | 1 | 0 | configured_but_not_statically_referenced |
| 爆款复刻 | `replicate.rewrite` | story | 1 | 0 | configured_but_not_statically_referenced |
| 爆款复刻 | `replicate.tts` | tts | 1 | 0 | configured_but_not_statically_referenced |
| 爆款复刻 | `replicate.avatar` | avatar | 1 | 0 | configured_but_not_statically_referenced |
| 剧情/故事生成 | `story.generate` | story | 1 | 3 | configured_and_statically_referenced |
| 剧情/故事生成 | `story.parse_script` | story | 1 | 0 | configured_but_not_statically_referenced |
| AI 图片生成 | `imggen.t2i` | image | 1 | 0 | configured_but_not_statically_referenced |
| AI 图片生成 | `imggen.i2v` | video | 1 | 1 | configured_and_statically_referenced |

## 未发现业务静态引用的阶段

- `avatar.describe`：Step1 形象描述 AI 扩写
- `avatar.image_gen`：Step1 形象图生成
- `avatar.sample_video`：Step2 动态样片
- `product_avatar.describe`：商品卖点 / 口播脚本
- `product_avatar.person_image`：商品数字人底图生成
- `ad_avatar.copy`：广告文案 / 分镜拆解
- `ad_avatar.keyframe`：广告展示画面 / 关键帧
- `luxury_ad.keyframe_repair`：4 分镜 QA 修正 / 重试
- `luxury_ad.tts`：5 广告合成 / 配音 TTS
- `luxury_ad.post`：5 广告合成 / 字幕后期
- `new_story_ad.person_dossier_wearable_accessory`：人物可穿戴配件细节
- `new_story_ad.person_dossier_wardrobe_detail`：人物服装细节
- `drama.character_image`：角色形象图
- `drama.tts`：剧本配音 TTS
- `replicate.extract`：原视频文案提取 + 分析
- `replicate.rewrite`：AI 改写新文案
- `replicate.tts`：复刻配音 TTS
- `replicate.avatar`：数字人合成（可选）
- `story.parse_script`：剧本解析为场景 JSON
- `imggen.t2i`：文生图主链路

## 解释边界

- 模型名称推断只能作为候选能力，不能标记为真实已验证。
- 真实 verified 状态必须来自最小付费调用、结果归档、费用和任务状态核对。
- 当前剧情广告原生音频关闭是有意设计：平台先生成独立 TTS，再做确定性混音，避免双音轨和重复计费。
- 参考视频当前用于反推镜头、动作和提示词，不等于把视频作为供应商动作参考素材直接提交。
