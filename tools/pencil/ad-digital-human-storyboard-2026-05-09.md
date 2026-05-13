# 广告数字人 Storyboard UI Prototype

## Goal

Redesign the advertising digital human page around the Topview-style workflow:

1. Upload material references.
2. Generate controllable keyframes/storyboard images.
3. Connect keyframes with prompt and voice settings.
4. Generate video with Seedance and smooth stitching.

## Layout

- Left panel: material rail
  - Digital human avatar
  - Ad/product/background reference image
  - Model/ratio/duration/voice settings
- Center workbench: board-first production area
  - Workflow status strip
  - Prompt and title editor
  - Storyboard board with 3-5 keyframe cards
  - Card states: empty, planned, generating, ready, failed
- Bottom action bar
  - Fill sample script
  - Generate storyboard
  - Generate video from storyboard

## Interaction

- The user should understand that the first output is not the final video.
- "AI 生成并拆分" is presented as "生成分镜看板".
- Final submit button is presented as "用分镜合成广告视频".
- Empty board cards explain the expected keyframes: scene open, product highlight, presenter pitch, CTA.

## Implementation Notes

- Existing backend already supports storyboard mode by generating multiple keyframes and stitching Seedance clips.
- The frontend should expose that mental model clearly without adding a separate backend endpoint yet.
