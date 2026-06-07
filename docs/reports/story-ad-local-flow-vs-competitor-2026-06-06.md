# 剧情广告本地全流程跑测与竞品差距 - 2026-06-06

> 本报告只记录本地环境跑测和公开/已授权竞品结构对比；未提交 Git，未同步服务器。

## 跑测样本

- run_id: `local-commercial-flow-20260606-154650`
- 本地服务: `http://localhost:3007`
- 本地页面: `http://localhost:3007/digital-human.html`
- 生产包 ID: `05caab7b-be55-46e9-b502-de653d244a92`
- 生产包接口: `GET /api/dh/luxury-ad/projects/05caab7b-be55-46e9-b502-de653d244a92`
- 本地数据文件:
  - `outputs/local-commercial-flow-20260606-154650_storyboard.json`
  - `outputs/local-commercial-flow-20260606-154650_keyframes_review.json`
  - `outputs/local-commercial-flow-20260606-154650_keyframes_final.json`
  - `outputs/local-commercial-flow-20260606-154650_keyframes_final_response.txt`
  - `outputs/luxury_ad_projects.json`

## 本地实际流程结果

| 阶段 | 本地结果 | 结论 |
|---|---|---|
| 需求到详细剧本 | 成功，但请求 4 镜后实际返回 10 镜 | 镜头数/时长约束不够硬 |
| 分镜板审核 | 成功，归一化为 6 镜，生成 2 页 storyboard sheet | 已具备可审核分镜板 |
| 固定演员 | 已确认，使用本地数字人形象 `8660209e-f13a-4e2e-a1aa-4aa3beae02d0` | 已越过“缺演员”门槛 |
| 真实关键帧 | 失败，`LUXURY_REFERENCE_PRESERVING_MODEL_REQUIRED` | 保参考关键帧模型不可运行 |
| 视频生成 | 未进入 | 没有真实关键帧，不能商用成片 |

Storyboard sheet:

- `http://127.0.0.1:3007/public/jimeng-assets/storyboard_sheet_4c2bb7cb-8887-458c-8bd2-e64e328658f2_plan_01.png`
- `http://127.0.0.1:3007/public/jimeng-assets/storyboard_sheet_4c2bb7cb-8887-458c-8bd2-e64e328658f2_plan_02.png`

最终阻断:

```json
{
  "code": "LUXURY_REFERENCE_PRESERVING_MODEL_REQUIRED",
  "project_state": "model_required",
  "actor": "confirmed",
  "ref_model_ready": false,
  "required_actions": ["enable_reference_preserving_keyframe_model"]
}
```

当前可运行图像模型里没有可保参考模型:

```json
{
  "runnable_models": [
    "deyunai/nano-banana-pro",
    "deyunai/nano-banana",
    "deyunai/qwen-image-edit",
    "deyunai/qwen-image",
    "deyunai/doubao-seedream-4-0-250828",
    "deyunai/imagen-4",
    "deyunai/flux-pro"
  ],
  "reference_preserving_models": []
}
```

## 竞品对比

本次复查竞品公开前端 chunk，仍存在项目状态机:

```text
draft
script_generating
script_reviewing
frame_generating
frame_reviewing
video_generating
video_ready
exported
failed
```

结合此前授权登录复核，竞品关键结构是:

- 项目是第一对象，不是一次性请求。
- `visual_asset.sheet_url` / `master_sheet_url` / `segment_sheet_urls` 是项目资产。
- `visual_bible` 和人物/场景/风格约束随项目流转。
- 分镜审核和最终视频生成是明确状态推进，不把失败候选图暴露为结果。

## 差距评估

| 能力 | 竞品 | 当前本地 |
|---|---|---|
| 项目状态机 | 完整到 `video_ready/exported` | 只补到 `script_reviewing/frame_reviewing/model_required` |
| storyboard sheet | 项目级核心资产 | 已生成并落生产包 |
| 固定真人演员 | 作为资产/视觉合同参与后续生成 | 已能识别确认，但不能稳定生成关键帧 |
| 保参考关键帧 | 能持续把同一人带入场景 | 本地缺可运行保参考模型 |
| 成片阶段 | 有 `video_generating/video_ready` | 未进入 |
| 镜头数量控制 | 跟脚本和项目状态绑定 | 仍出现请求 4 镜返回 10 镜的问题 |
| 恢复/继续编辑 | 项目资产可恢复 | 生产包已落盘，但前端还没有项目恢复列表 |

当前完成度判断: 约 60%-65%。已经从“乱生成/假成功”推进到“项目生产包 + 分镜审核 + 硬门禁”，但离商用还差关键的 3 件事:

1. 启用并验证真正可保参考的关键帧模型链路。
2. 前端支持从生产包恢复项目、继续编辑、继续生成。
3. 真实关键帧通过后补视频阶段状态机和成片 QA。
