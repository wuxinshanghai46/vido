# 剧情广告严格不兜底修复验证 - 2026-06-06

## 修复内容

- 关闭最终关键帧阶段的 `allowQaRepair`，不再出现 `qa-repair/contract-rewrite` 自动改写提示词。
- Topview 人物镜头只接收演员身份参考组，不再混入商品/场景参考图污染角色。
- 人物镜头增加真人写实演员素材门禁：素材被识别为动漫、3D、卡通、非真人，或缺少身份参考图时，直接 422 停止。
- 门禁已前移到 production contract 之后、storyboard sheet / seed assets / keyframe provider 之前；final 阶段不会先消耗 image2/Topview 再失败。

## 本地验证

- 服务：`http://localhost:3007`
- 验证输出：`outputs/story-ad-strict-no-fallback-20260606143053/summary.json`
- HTTP：422
- 错误码：`LUXURY_ACTOR_REFERENCE_NOT_REALISTIC`
- 关键帧数：0
- Topview 是否被调用：false
- QA rewrite 是否出现：false
- attempts：仅 `preflight/actor-reference-reality-gate`

## 真实差距

- 当前本地 Lin 三张演员参考被识别为动漫/3D/卡通，不是竞品那种固定真人演员库素材。
- 在未补齐真人演员库前，严格链路会正确停止，不能继续声称可生成竞品级真人成片。
- 下一步要做的是演员库：真人写实演员卡、多视图身份参考、演员状态确认、再进入 image2/Topview 关键帧链路。
