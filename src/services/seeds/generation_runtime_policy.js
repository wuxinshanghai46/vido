/**
 * 通用视觉生成运行时规则。
 * 规则只描述跨行业稳定约束，不包含任何行业、人物、地点或商品模板。
 */

module.exports = [
  {
    id: 'kb_runtime_person_visual_contract_v1',
    collection: 'engineering',
    subcategory: '知识驱动生成',
    title: '人物视觉合同运行时规则',
    summary: '将已批准身份、身材、妆发、服装和配件清单作为跨视图不可变量。',
    content: '适用于任意合法行业与人物类型。只允许当前生成单元明确要求的角度、表情或动作发生变化。',
    tags: ['运行时规则', '人物一致性', '行业无关'],
    keywords: ['person contract', 'identity invariants', 'knowledge policy'],
    prompt_snippets: [],
    applies_to: ['character_consistency', 'prompt_engineer', 'director', 'test_engineer'],
    source: 'VIDO 人物档案与一致性回归经验，2026-08-06',
    lang: 'zh-en',
    enabled: true,
    runtime_policy: {
      schema_version: 1,
      rules: [{
        id: 'person-closed-visual-inventory', version: 1, status: 'active', priority: 90,
        stages: ['person_dossier', 'keyframe'], asset_types: ['person'], enforcement: 'hard',
        conflict_key: 'person_visual_inventory',
        instruction: 'Treat the approved identity, apparent age, body proportions, hair, makeup, wardrobe, footwear and wearable-accessory inventory as a closed visual contract. Change only the view, expression or action explicitly requested by the current unit; never add, remove or redesign an invariant.',
        negative: 'unrequested identity, age, body, hair, makeup, wardrobe, footwear or wearable-accessory change',
        qa_checks: ['visible person invariants match the approved contract', 'only the authored view, expression or action changes'],
      }],
    },
  },
  {
    id: 'kb_runtime_scene_visual_contract_v1',
    collection: 'engineering',
    subcategory: '知识驱动生成',
    title: '场景物理合同与多尺度场景卡运行时规则',
    summary: '锁定空间、材质、灯光和禁止项，并用总览、关系、局部、细节四级证据约束跨镜一致性。',
    content: '场景知识只能结构化任务已有事实：把同一场景拆为稳定空间骨架、资产清单、环境状态、材质细节和色彩锚点，再按总览到细节的尺度梯度生成与验收；不得依据行业印象增加未要求的内容。',
    tags: ['运行时规则', '场景一致性', '行业无关'],
    keywords: ['scene contract', 'physical invariants', 'knowledge policy'],
    prompt_snippets: [],
    applies_to: ['art_director', 'atmosphere', 'prompt_engineer', 'director', 'test_engineer'],
    source: 'VIDO 多场景空间合同与跨视图回归经验，2026-08-06',
    lang: 'zh-en',
    enabled: true,
    runtime_policy: {
      schema_version: 1,
      rules: [{
        id: 'scene-task-facts-only', version: 1, status: 'active', priority: 90,
        stages: ['scene_asset', 'keyframe'], asset_types: ['scene'], enforcement: 'hard',
        conflict_key: 'scene_scope_authority',
        instruction: 'Keep layout, boundaries, access points, material identity, lighting logic, interaction zones and explicit exclusions as separate physical invariants. Use only current-task evidence; never infer industry-standard furniture, decoration, people, products or segmentation that the task did not request.',
        negative: 'generic industry template, unrequested structure, furnishing, decoration, person, product or surface segmentation',
        qa_checks: ['layout, material, lighting and interaction evidence match current-task facts', 'no industry stereotype or unrequested element is introduced'],
      }, {
        id: 'scene-task-facts-only', version: 2, status: 'active', priority: 90,
        stages: ['scene_asset', 'keyframe'], asset_types: ['scene'], enforcement: 'hard',
        conflict_key: 'scene_scope_authority',
        instruction: 'Represent the current-task scene as one scale-linked evidence card: overview silhouette and boundaries; spatial relationships, access points and camera anchors; local interaction zones and asset groups; material, weathering, atmosphere and small-detail evidence. Keep one stable geometry, asset inventory, environmental state, lighting logic and palette anchor across all scales and views. Include only evidence authorized by the task.',
        negative: 'inconsistent geometry or scale, missing or duplicated task-authorized asset, drifting weather, material, lighting or palette, generic industry template, or unrequested structure, furnishing, decoration, person or product',
        qa_checks: ['overview, relationship, local and detail views describe the same physical scene', 'geometry, asset inventory, environmental state, material, lighting and palette anchors remain consistent across scales', 'no task-authorized asset disappears or duplicates and no unrequested element is introduced'],
      }],
    },
  },
  {
    id: 'kb_runtime_keyframe_visual_contract_v1',
    collection: 'engineering',
    subcategory: '知识驱动生成',
    title: '关键帧最小变化运行时规则',
    summary: '关键帧只执行当前镜头明确要求的可见变化，并保持人物、商品和场景锁。',
    content: '镜头构图不能成为重建人物、商品或场景的理由；静态关键帧不承担视频时间变化的证明责任。',
    tags: ['运行时规则', '关键帧', '最小变化'],
    keywords: ['keyframe contract', 'intended change', 'invariants'],
    prompt_snippets: [],
    applies_to: ['storyboard', 'director', 'prompt_engineer', 'test_engineer'],
    source: 'VIDO 关键帧合同与时序证据回归经验，2026-08-06',
    lang: 'zh-en',
    enabled: true,
    runtime_policy: {
      schema_version: 1,
      rules: [{
        id: 'keyframe-minimum-authored-change', version: 1, status: 'active', priority: 92,
        stages: ['keyframe'], asset_types: ['shot'], enforcement: 'hard',
        conflict_key: 'keyframe_change_boundary',
        instruction: 'Render only the visible state and composition authored for this shot. Preserve every verified person, product and scene invariant; a new camera composition does not authorize redesigning locked assets. Do not require a still keyframe to prove temporal motion or transition timing.',
        negative: 'asset redesign, unrequested visible state, temporal effect baked into a still frame',
        qa_checks: ['the authored visible state is present', 'verified person, product and scene locks remain unchanged', 'temporal-only effects are not judged in the still frame'],
      }],
    },
  },
  {
    id: 'kb_runtime_video_temporal_contract_v1',
    collection: 'engineering',
    subcategory: '知识驱动生成',
    title: '视频时序与物理运行时规则',
    summary: '视频从已批准关键帧出发，只执行镜头动作，并以可见因果结果结束。',
    content: '适用于任意行业和场景；不规定具体人物、产品、地点或动作，只规定时序、物理与资产连续性。',
    tags: ['运行时规则', '视频连续性', '物理合理性', '行业无关'],
    keywords: ['video contract', 'temporal stability', 'physical causality'],
    prompt_snippets: [],
    applies_to: ['director', 'storyboard', 'prompt_engineer', 'test_engineer'],
    source: 'VIDO 视频抽帧、跨镜连续性与物理 QA 经验，2026-08-06',
    lang: 'zh-en',
    enabled: true,
    runtime_policy: {
      schema_version: 1,
      rules: [{
        id: 'video-keyframe-causal-continuity', version: 1, status: 'active', priority: 94,
        stages: ['video'], asset_types: ['shot'], enforcement: 'hard',
        conflict_key: 'video_temporal_boundary',
        instruction: 'Start from the approved keyframe state, perform only the authored action and camera movement, and reach the declared end state through physically plausible intermediate motion. Preserve identity, wardrobe, product, material, geometry and lighting without flicker, duplication, morphing or teleportation.',
        negative: 'flicker, identity drift, wardrobe drift, product drift, geometry drift, duplication, morphing, teleportation or causally unsupported end state',
        qa_checks: ['start, middle and end visibly prove the authored causal progression', 'identity, product, scene, material and lighting remain temporally stable', 'contacts, mass and anatomy remain physically plausible'],
      }],
    },
  },
  {
    id: 'kb_runtime_scene_progressive_expansion_v1',
    collection: 'engineering',
    subcategory: '知识驱动生成',
    title: '场景渐进扩展与证据闭环运行时规则',
    summary: '从最小可制作空间骨架开始，只按叙事义务逐层补充关系区、互动区、材质与氛围证据。',
    content: `场景规划先确认地点身份、边界、出入口、行动路径和关键交互区，再按镜头真正需要逐层扩展，而不是一次堆满装饰。

通用扩展顺序：
1. 核心骨架：空间身份、尺度、边界、出入口和稳定几何。
2. 叙事关系：人物、物件、行动路径与镜头锚点之间的可达关系。
3. 局部生产区：只补足当前动作、构图或因果结果需要的互动区域。
4. 证据增强：材质、磨损、天气、光线、声场和氛围细节。

每一层都必须继承上一层的几何、资产清单和环境状态。新增内容必须能追溯到任务事实或明确的叙事义务；若新证据要求改变地点身份、时代、稳定布景或环境状态，应创建新的制作场次，而不是在原场景内静默覆盖。场景数量由真实制作差异决定，不按题材、时长或固定比例凑数。`,
    tags: ['运行时规则', '场景渐进扩展', '制作证据', '行业无关'],
    keywords: ['场景渐进扩展', 'progressive scene expansion', 'scene evidence layers', '空间骨架', '叙事义务'],
    prompt_snippets: [],
    applies_to: ['art_director', 'director', 'storyboard', 'prompt_engineer', 'test_engineer'],
    source: 'VIDO 场景生产合同与跨题材回归经验，2026-08-09',
    lang: 'zh-en',
    enabled: true,
    runtime_policy: {
      schema_version: 1,
      rules: [{
        id: 'scene-progressive-evidence-expansion', version: 1, status: 'active', priority: 91,
        stages: ['scene_asset'], asset_types: ['scene'], enforcement: 'hard',
        conflict_key: 'scene_progressive_expansion',
        instruction: 'Build the stable scene skeleton first; add only relationship, interaction, material and atmosphere evidence required by authored narrative obligations. Preserve geometry, inventory and environment at every layer.',
        negative: 'decorative scope inflation, unsupported asset, overwritten geometry or silent environment change',
        qa_checks: ['each expansion traces to a task fact or narrative obligation', 'all layers preserve one stable physical scene'],
      }],
    },
  },
  {
    id: 'kb_runtime_shot_narrative_function_v1',
    collection: 'engineering',
    subcategory: '知识驱动生成',
    title: '镜头叙事功能与状态变化运行时规则',
    summary: '每个镜头必须承担可说明的叙事职责，并用进入状态、可见动作和退出状态证明变化。',
    content: `镜头不是画面数量单位，而是叙事功能单位。每个镜头至少承担一种主职责：建立空间或关系、推进动作、揭示信息、呈现反应、完成转折、证明结果、连接时空或收束情绪。

镜头合同应明确：进入时观众已知什么；本镜头让什么发生或被看见；退出时人物、物件、信息或情绪发生了什么可验证变化。相邻镜头若既不新增信息、也不改变状态、也不提供必要的空间或情绪呼吸，应合并或重新设计。景别、机位和运镜必须服务于主职责，不能以视觉变化替代剧情推进。一个镜头可有次要功能，但不能让增强效果掩盖核心叙事义务。`,
    tags: ['运行时规则', '镜头叙事功能', '状态变化', '行业无关'],
    keywords: ['镜头叙事功能', 'shot narrative function', 'entry state', 'exit state', 'information change'],
    prompt_snippets: [],
    applies_to: ['screenwriter', 'director', 'storyboard', 'editor', 'prompt_engineer', 'test_engineer'],
    source: 'VIDO 分镜合同、连续性与镜头因果回归经验，2026-08-09',
    lang: 'zh-en',
    enabled: true,
    runtime_policy: {
      schema_version: 1,
      rules: [{
        id: 'shot-visible-narrative-function', version: 1, status: 'active', priority: 90,
        stages: ['keyframe', 'video'], asset_types: ['shot'], enforcement: 'hard',
        conflict_key: 'shot_narrative_function',
        instruction: 'Assign each shot one primary narrative function and a visible entry-to-exit change. Camera choices must serve it; visual novelty cannot replace information, action, reaction or consequence.',
        negative: 'redundant shot, functionless camera change or unchanged entry-to-exit state',
        qa_checks: ['the primary narrative function is visible', 'entry and exit states prove the authored change'],
      }],
    },
  },
  {
    id: 'kb_runtime_axis_eyeline_continuity_v1',
    collection: 'engineering',
    subcategory: '知识驱动生成',
    title: '动作轴线、银幕方向与视线目标运行时规则',
    summary: '在连续动作单元内锁定轴线、左右关系、运动方向和视线目标；跨线必须显式重建空间。',
    content: `连续性单元先由建立镜头或首个明确关系镜头确定动作轴线。后续镜头保持人物左右关系、运动方向、观察者视线与被观察目标的位置逻辑。

视线不是“向左/向右”的孤立标签，而是观察者、目标、相机侧和画外空间共同形成的关系。正反打、追逐、操作和注视动作都应让前镜的视线或动作在后镜得到空间回应。需要跨越轴线时，必须使用可见的连续绕行、中性机位、轴上镜头、角色走位或重新建立镜头，让观众理解新方向；不能在切镜中无声明翻转。故意制造迷失感也必须作为明确叙事选择记录，不能由模型偶然产生。`,
    tags: ['运行时规则', '轴线', '视线匹配', '银幕方向', '行业无关'],
    keywords: ['轴线', '视线匹配', 'camera axis', 'eyeline match', 'screen direction', 'line crossing'],
    prompt_snippets: [],
    applies_to: ['director', 'storyboard', 'editor', 'prompt_engineer', 'test_engineer'],
    source: '连续性剪辑通用法则与 VIDO 跨镜回归经验，2026-08-09',
    lang: 'zh-en',
    enabled: true,
    runtime_policy: {
      schema_version: 1,
      rules: [{
        id: 'shot-axis-eyeline-continuity', version: 1, status: 'active', priority: 89,
        stages: ['keyframe', 'video'], asset_types: ['shot'], enforcement: 'hard',
        conflict_key: 'shot_spatial_continuity',
        instruction: 'Preserve action axis, screen direction, subject side and eyeline target within a continuity unit. Cross only through an authored neutral/on-axis move or re-establishing shot.',
        negative: 'unmotivated side swap, reversed motion, empty eyeline or undeclared axis crossing',
        qa_checks: ['screen direction and eyeline resolve to the intended target', 'any axis crossing is visibly motivated and re-establishes space'],
      }],
    },
  },
  {
    id: 'kb_runtime_core_enhancement_decoupling_v1',
    collection: 'engineering',
    subcategory: '知识驱动生成',
    title: '核心生产合同与增强层解耦运行时规则',
    summary: '先验证故事、空间、动作和连续性核心，再独立叠加光影、材质、氛围与镜头修辞。',
    content: `核心层回答“是否正确且可制作”：任务事实、人物与物件身份、场景拓扑、镜头叙事功能、动作因果、连续性、进入/退出状态和明确禁止项。

增强层回答“如何更有表现力”：光影层次、材质微细节、天气、声场、景深、运动质感、色彩节奏和转场修辞。增强只能引用已通过的核心合同，不能新增人物、物件、地点、剧情事实，不能改变场景数量、空间拓扑或动作结果。

核心验收与增强验收必须分别报告。增强缺失时可以标记降级或待补，但不得把合格核心误判为不存在；核心失败时则禁止依赖增强遮盖问题，也禁止进入付费下游。增强重做只失效增强指纹，不应让已批准核心资产重复生成。`,
    tags: ['运行时规则', '核心增强解耦', '生产合同', '成本控制', '行业无关'],
    keywords: ['核心增强解耦', 'core enhancement decoupling', 'core contract', 'enhancement layer', 'independent QA'],
    prompt_snippets: [],
    applies_to: ['executive_producer', 'director', 'art_director', 'storyboard', 'prompt_engineer', 'test_engineer'],
    source: 'VIDO 生成合同、质量门禁与付费恢复回归经验，2026-08-09',
    lang: 'zh-en',
    enabled: true,
    runtime_policy: {
      schema_version: 1,
      rules: [{
        id: 'core-before-enhancement', version: 1, status: 'active', priority: 88,
        stages: ['scene_asset', 'keyframe', 'video'], asset_types: ['scene', 'shot'], enforcement: 'hard',
        conflict_key: 'core_enhancement_boundary',
        instruction: 'Validate facts, topology, narrative function, causality and continuity before enhancement. Enhancement must not create or alter core facts, assets, topology or outcomes.',
        negative: 'enhancement used to invent, replace or conceal a failed core contract',
        qa_checks: ['core and enhancement results are reported separately', 'enhancement preserves every approved core invariant'],
      }],
    },
  },
];
