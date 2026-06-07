# 剧情广告 Image2 编辑通道诊断 - 2026-06-06

## 本地结论

- 本地仅修改代码与文档，未推 Git，未同步服务器。
- 剧情广告 4 镜审核分镜包可生成，生产包可落盘，模型能力门禁已不再硬编码 Topview。
- `deyunai/gpt-image-2` 现在能被识别为可运行的保参考 Image2 关键帧候选。
- 演员资产包已进入制作合同，包含 `actor_id`、固定演员参考和角色一致性锁。
- 演员参考 URL 现在会做可达性预检；不可访问时最终关键帧直接返回 `LUXURY_ACTOR_REFERENCE_UNREACHABLE`，不再继续消耗图像模型。

## 隔离验证

- 用户测试用演员图 `https://vido.smsend.cn/public/jimeng-assets/dh_1778079756262_qbmua2_composed.jpg` 当前 HTTP 404，不能作为固定真人参考。
- DeyunAI `gpt-image-2` 无参考文生图成功，说明模型与 API Key 基础通路可用。
- DeyunAI `/ent/v1/images/edits` 在远端 URL、本地 data URL、PNG/JPEG 小图下仍返回 provider 500（`PANXXXO100IFR` / `image2O100IFR`）。
- edits schema 探针确认 `images:[{image_url:...}]` 是当前网关接受的字段形态；其它 `images:[string]`、`image_url`、`image_urls` 返回字段错误。

## 与竞品主要差距

1. 需要稳定有效的固定演员资产，且 URL 必须本地可解析或公网可下载。
2. 需要至少一个真实可用的 Image2/图像编辑保参考模型；当前 DeyunAI edits 通道不稳定，Topview 或其它等价供应商能力仍需启用/验证。
3. 在上述两点未解决前，本地只能稳定产出可审核 storyboard sheet 与制作合同，不能承诺竞品级“同一真人进入不同场景”的最终关键帧。

## 下一步修复

1. 上传或生成一张本地存在的真人演员参考，作为 `person_asset.image_url`。
2. 与 DeyunAI 确认 `gpt-image-2 edits` 的 500 错误，或切换到已验证可用的 Image2 编辑供应商。
3. 用同一演员参考跑 4 镜最终关键帧，要求全部通过视觉 QA 后，再进入 Seedance2/Topview I2V/可灵/海螺等图生视频阶段。
