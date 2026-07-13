# 新剧情广告商用补强与竞品重评估

> 日期：2026-07-13  
> 基线：`ebfe51aacfef5f7cf215182489b35d725a326c3c`  
> 结论：昨日方案的质量门禁方向正确，但开发顺序需重排，并补入产品输入、广告模式、变体测试、品牌资产和候选审片层。

---

## 一、先看当前业务现实

### 1. 生产漏斗（近 14 天聚合）

| 指标 | 数量 |
|---|---:|
| 新剧情广告任务 | 7 |
| 进入分镜表 | 3 |
| 至少有关键帧 | 2 |
| 关键帧全部完成 | 2 |
| 有逐镜视频 | 0 |
| 有最终成片 | 0 |

任务级主要失败包括 `KEYFRAME_GENERATION_FAILED`、`BLUEPRINT_POLISH_QUALITY_FAILED`、`MODEL_CONFIG` 和未归类异常。模型调用级失败主要是计费、5xx、授权和未归类错误。

这意味着当前首要目标应是：

> 先将“创建任务 → 分镜 → 关键帧 → 视频 → 成片”的真实成功率从 0 提高到可反复验证，再扩展专业导演字段。

### 2. 当前生产路由

- 图片阶段仅有 DeyunAI `gpt-image-2` / `nano-banana-pro` / `nano-banana` 三个候选。
- 视频阶段主候选为 DeyunAI Seedance 2.0 两个模型。
- 账务熔断仍以供应商为主，国内人民币图片通道余额不足可能连带影响同供应商其他通道。
- 当前代码有候选轮询和熔断，但还缺“供应商 + 模型 + endpoint + 计费钱包”粒度的可用性管理。

---

## 二、当前已经具备的能力

不应在新一轮开发中重复建设以下能力：

| 能力 | 当前状态 | 备注 |
|---|---|---|
| 任务化与阶段状态 | 已有 | 支持 blueprint/storyboard/keyframes/tts/video/compose |
| 异步任务与刷新恢复 | 已有 | 有 `generation_id`、孤儿任务收口和网络断开回查 |
| 用户取消后停止后续步骤 | 已有 | 是协作式取消，不是 HTTP/FFmpeg 强中止 |
| 单镜关键帧重生 | 已有 | `only_index` 可局部重试 |
| 失败镜头补生 | 已有 | `missing_only` 支持缺失镜头恢复 |
| 场景四视图和空间合同 | 已有 | 含空间锚点、区域、机位和跨视图 QA |
| 场景关键帧 QA | 部分已有 | 已比对场景参考，但未做 verified 硬门禁 |
| 文本连续性合同 | 已有 | 有入/出帧、动作、轴线、视线、道具状态等字段 |
| 简体中文保护 | 部分已有 | 可修复整体英文输出，但未达逐字段强校验 |
| TTS、逐镜视频和合成 | 已有代码 | 生产近 14 天尚无任务进入成片 |
| 原九组专项测试 | 全部通过 | 属于结构和单元级验证，不等于真实商用成片验收 |

---

## 三、昨日方案中仍然真实缺失的能力

### P0：会直接造成商用失败

1. **人物身份合同和四视图 QA**
   - 当前有人物参考图，但没有可持久化的 `person_revision/status/cross_view_qa` 合同。
   - 关键帧完成后只做场景 QA，没有人物身份、年龄、服装、体态和手部归属 QA。

2. **产品/商品身份合同**
   - 昨日方案提到商品 QA，但没有独立的产品合同任务。
   - 商业广告中，包装形状、颜色、Logo 区域、材质和产品数量与人物同样是硬约束。
   - 应新增 `productIdentityContractService` 和逐镜产品 QA，不能只依靠 prompt 文本描述。

3. **场景 verified 硬门禁**
   - 当前 QA 不可用时会保存 unverified 场景，这是正确的资产保护。
   - 但关键帧阶段没有硬性拒绝 unverified 场景，需增加 `SCENE_VERIFICATION_REQUIRED`。

4. **多场景绑定严格失败**
   - `scene_id` 找不到时仍回退到 `assets[0]`。
   - 跨场景仍可自动写入通用转场理由。
   - 必须将多场景错误 ID、revision 不一致和缺少真实转场理由改为显式错误。

5. **真正的请求中止和后端阶段总预算**
   - `cancellationContext` 只保存取消标记，没有 `AbortController`。
   - axios、OpenAI/Claude HTTP、图片/视频轮询、资源下载和 FFmpeg 没有统一的 abort signal。
   - 前端有等待超时，但后端没有全阶段 deadline；页面停止等待不等于后台停止花费。

6. **视频抽帧 QA 和局部视频返修**
   - 现有视频阶段生成 clip 后直接保存，没有抽取首/中/尾帧做人物、场景、产品、人数和文字水印 QA。
   - 没有基于上一镜尾帧与当前镜首帧的真实视觉连续性检查。

### P1：已有骨架，需补完而不是重写

1. **导演字段**：已有 `camera_movement`、`camera_axis`、`screen_direction`、入/出帧和道具状态；只需补 `shot_size/camera_angle/lens_mm/depth_of_field/composition/subject_position` 及前端展示。
2. **声音旅程**：已有 `audio_bridge`、TTS、BGM 和字幕合成；只需补镜头级环境声、SFX、音乐 cue 与时间线。
3. **逐字段中文保护**：现有 `VISIBLE_KEYS` 和修复合并逻辑；需补字段级检测和专有名词白名单。
4. **精确人数**：上下文已有 `expected_people`，但前端仍存在 group 默认 3 人，后端 `cast_mode` 还有 `group/multi` 不统一。
5. **姓名本地化**：正式链路已能保留人物名，但 mock 和部分默认逻辑仍使用中文姓名池，应改为 locale 策略。

---

## 四、昨日方案漏掉的竞品级产品能力

竞品已不只在比“一条片的导演参数”，而是在比“从产品输入到投放测试”的整个商业闭环。

| 竞品公开能力 | 当前 VIDO | 应对策略 |
|---|---|---|
| 产品 URL → 自动提取图片、卖点、脚本和分镜 | 主要依靠用户手填 brief/上传 | 增加网页/商品页导入与资产确认步骤 |
| UGC、专业广告、剧情片、产品 CGI、教程、开箱等明确模式 | 单一通用剧情链路 | 增加少量“生产模式”，模式决定 QA 和镜头策略，不写死行业 |
| 人物 ID/演员库、产品和品牌颜色跨片复用 | 有演员/场景资产，但缺人物与产品 verified 合同 | 建立 Person/Product/Scene/Brand 四类版本化合同 |
| 多 hook、CTA、视觉方向变体，并排比较 | 主要生成单个方案 | 建立 concept/variant，共享资产而不复制整个任务 |
| 竞品广告/参考视频结构解析与品牌化重构 | 未形成独立产品流程 | 后续增加“参考广告结构”，只复用 hook/节奏/CTA 结构，不复制内容 |
| 品牌包、多尺寸、多语言、批量导出 | 有画幅、中文、字幕和合成，缺品牌包/变体导出 | 在稳定成片后增长为投放工作台 |
| 候选结果并排、选中、局部替换 | 失败候选多在后台记录，用户不能审片选择 | 每镜保留 1-3 个候选，用户确认 accepted 后才进入视频 |

公开参考：

- Higgsfield Marketing Studio：产品链接、UGC/专业/剧情模式、演员复用、脚本/镜头/剪辑一键闭环：<https://higgsfield.ai/marketing-studio-intro>
- Higgsfield Soul ID/Soul Cinema：人物与品牌颜色跨帧一致性：<https://higgsfield.ai/soul-cinema>
- HeyGen AI Ads：URL/图片/脚本输入、品牌包、变体、多尺寸与批量导出：<https://www.heygen.com/tool/ai-social-media-ad-generator>
- Creatify API/AdClone：URL-to-video 预览、演员/声音覆盖、广告结构重构：<https://docs.creatify.ai/api-reference/link_to_videos/post-apilink_to_videos_preview> 和 <https://creatify.ai/features/ad-clone>
- Runway：人物、场景和物体参考的跨镜一致性：<https://runwayml.com/product/ai-video-generator>

---

## 五、建议的产品边界

不建议立即对标所有 UGC/电商工具能力。VIDO 现阶段应将新剧情广告定义为：

> 以可审核剧本和分镜为中心，能锁定人物、产品和场景，可局部返修并生成 15-60 秒剧情/品牌短广告的制作工作台。

首批只保留三个生产模式：

1. `narrative_live_action`：单/双人剧情真人广告，强人物、场景和连续性 QA。
2. `product_story`：产品为主，可无人物，强产品形态、材质和场景 QA。
3. `service_app_story`：SaaS/服务/应用场景，强业务步骤、界面证据和数字信息正确性。

UGC 口播、虚拟试穿、纯 CGI 特效和 Ad Clone 后续作为独立生产模式，不应塞进同一条 prompt 链路。

---

## 六、重排后的实施顺序

### 批次 0：先让一条真实链路稳定成片（1-2 天）

1. 建立 6 个黄金样本，不要一开始跑 20 个行业：
   - 无人产品单场景；
   - 无人产品多场景；
   - 单人单场景；
   - 单人多场景；
   - 双人对话；
   - SaaS/服务界面证据。
2. 将熔断键改为 `provider + model + endpoint + billing_channel`。
3. 每个阶段记录成功率、耗时、费用、候选次数和最终错误。
4. 对关键帧和视频模型各做一张/一镜真实 canary，证明可用后才跑整条任务。
5. 验收：6 个样本至少 4 个能到最终成片，其余任务也必须有明确可操作错误。

### 批次 1：商用资产合同和硬门禁（3-5 天）

1. 实现 Person Identity Contract + 四视图 QA。
2. 实现 Product Identity Contract + 产品参考 QA。
3. 实现场景 `verified` 硬门禁和重新验证。
4. 删除多场景 `assets[0]` 和通用转场文案。
5. 关键帧依次执行 Scene → Person → Product QA，单镜最多两轮返修。
6. 前端显示资产 revision、verified/unverified/rejected 和失败理由。

### 批次 2：真实取消、deadline 和成本保护（2-3 天）

1. `cancellationContext` 为每个 generation 建立 `AbortController`。
2. signal 贯穿文本、视觉 QA、图片、视频、TTS、下载和 FFmpeg。
3. 增加后端阶段绝对 deadline，超时时保留已完成镜头。
4. 旧 generation 迟到结果不得覆盖新 generation。
5. 验收：取消 1 秒内 UI 收口，3 秒内不再新增供应商调用。

### 批次 3：视频审片闭环（4-6 天）

1. 每个 clip 抽取 0/25/50/75/100% 帧。
2. 检查人物、产品、场景、人数、动作、水印/乱码。
3. 检查相邻 clip 尾/首帧的位置、轴线、视线、道具和动作连续性。
4. 每镜保留候选，支持选中、重生当前 clip 和替换后重新合成。
5. 只有所有必需 clip accepted 才进入最终合成。

### 批次 4：产品化增长层（4-7 天）

1. 产品 URL 导入与人工确认的产品资产包。
2. 三个生产模式及模式专用 QA 规则。
3. 品牌包：Logo、字体、颜色、禁止项、CTA 风格。
4. 同一 concept 生成 2-4 个 hook/CTA/节奏变体。
5. 9:16 / 1:1 / 16:9 重新构图导出，不做简单裁切。

### 批次 5：导演与声音专业化（3-5 天）

1. 在已有连续性字段上补齐景别、角度、焦段、景深和构图。
2. 增加 ambient/SFX/music cue/sound journey。
3. 先在高级面板展示，默认用户仍只看画面、动作、台词和目的。

---

## 七、第一周建议实际开发清单

### 第 1 天

- 建立生产漏斗和黄金样本脚本。
- 修复计费通道熔断粒度。
- 对图片/视频各做单资产 canary。
- 验收条件：不再因同供应商某个钱包失败而屏蔽其他可用通道。

### 第 2-3 天

- Person Identity Contract 及四视图 QA。
- Product Identity Contract 及参考图基础 QA。
- 场景 verified 门禁。
- 验收条件：任一必需资产未验证时，不消耗关键帧模型。

### 第 4 天

- 删除多场景静默 fallback。
- 增加 scene revision/transition reason 硬错误。
- 前端增加重新验证、重新绑定和中文失败理由。

### 第 5 天

- 关键帧 Scene/Person/Product 级联 QA。
- 单镜返修与候选保留。
- 跑 6 个黄金样本，产出第一份真实通过率、成本和耗时报告。

---

## 八、最终验收指标

不再用“测试脚本全通过”作为商用完成标志，必须同时满足：

| 指标 | 首期目标 |
|---|---:|
| 蓝图成功率 | ≥ 95% |
| 分镜成功率 | ≥ 90% |
| 关键帧全部 accepted | ≥ 75% |
| 单镜返修后 accepted | ≥ 90% |
| 视频 clip 全部 accepted | ≥ 70% |
| 黄金样本成片成功 | 6 中至少 4 个 |
| 取消 UI 响应 | ≤ 1 秒 |
| 取消后停止新模型调用 | ≤ 3 秒 |
| 失败可归类率 | ≥ 95% |
| 服务器独有静默 fallback | 0 |

当上述指标稳定后，再将新剧情广告定义为“具备商用控制闭环”。

---

## 九、对昨日方案的最终调整结论

### 保留并提前

- 人物身份合同与关键帧 QA。
- 场景 verified 门禁。
- 多场景严格绑定。
- AbortSignal 和后端总预算。
- 视频抽帧与跨镜视觉 QA。

### 新增

- 供应商/模型/endpoint/计费通道粒度的路由和熔断。
- Product Identity Contract。
- 生产模式分流。
- URL 导入、品牌包、变体和候选审片。
- 以真实成片成功率、成本和耗时为主的验收体系。

### 后移

- 完整导演镜头 Schema。
- Sound Journey。
- 20 行业大矩阵。
- 大规模并发、缓存和全量增量重生。

原因是这些能力只有在真实成片链路稳定后才会提高产品价值；在成片为 0 时提前实现，只会增加系统复杂度和模型成本。
