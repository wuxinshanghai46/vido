#!/usr/bin/env python3
"""
阿里云 CosyVoice 声音克隆脚本
支持两种模式：
1. enroll - 注册声音（上传参考音频创建 voice_id）
2. synthesize - 合成语音（用已注册的 voice_id 生成配音）
"""

import os
import sys
import json
import time
import argparse

def main():
    parser = argparse.ArgumentParser(description="CosyVoice TTS")
    parser.add_argument("--mode", type=str, required=True, choices=["enroll", "synthesize"])
    parser.add_argument("--audio_url", type=str, default=None, help="参考音频 URL（enroll 模式）")
    parser.add_argument("--audio_file", type=str, default=None, help="参考音频本地路径（enroll 模式）")
    parser.add_argument("--voice_id", type=str, default=None, help="已注册的声音 ID（synthesize 模式）")
    parser.add_argument("--output", type=str, default=None, help="输出音频路径（synthesize 模式）")
    parser.add_argument("--stdin", action="store_true", help="从 stdin 读取合成文本")
    parser.add_argument("--text", type=str, default=None, help="合成文本")
    parser.add_argument("--speed", type=float, default=1.0, help="语速倍率 0.5-2.0")
    args = parser.parse_args()

    import dashscope
    from dashscope.audio.tts_v2 import VoiceEnrollmentService, SpeechSynthesizer

    api_key = os.environ.get("DASHSCOPE_API_KEY", "")
    if not api_key:
        print("Error: DASHSCOPE_API_KEY not set", file=sys.stderr)
        sys.exit(1)

    dashscope.api_key = api_key
    dashscope.base_http_api_url = "https://dashscope.aliyuncs.com/api/v1"

    MODEL = "cosyvoice-v3.5-plus"

    if args.mode == "enroll":
        enroll_voice(args, dashscope, VoiceEnrollmentService, MODEL)
    elif args.mode == "synthesize":
        synthesize_speech(args, SpeechSynthesizer, MODEL)


def enroll_voice(args, dashscope, VoiceEnrollmentService, model):
    """注册声音"""
    service = VoiceEnrollmentService()

    try:
        audio_url = args.audio_url

        if not audio_url and args.audio_file:
            # 本地文件先上传到 dashscope 获取临时 URL
            print(f"Uploading audio file: {args.audio_file}", file=sys.stderr)
            upload_resp = dashscope.Files.upload(
                file_path=args.audio_file,
                purpose="file-extract"
            )
            file_id = upload_resp.output["uploaded_files"][0]["file_id"]
            print(f"File uploaded, ID: {file_id}", file=sys.stderr)

            # 获取临时下载 URL
            file_info = dashscope.Files.get(file_id)
            audio_url = file_info.output["url"]
            print(f"Got download URL", file=sys.stderr)

        if not audio_url:
            print("Error: 需要提供 --audio_url 或 --audio_file", file=sys.stderr)
            sys.exit(1)

        print(f"Creating voice enrollment with model={model}...", file=sys.stderr)
        voice_id = service.create_voice(
            target_model=model,
            prefix="myvoice",
            url=audio_url,
        )
        print(f"Voice enrollment submitted. Voice ID: {voice_id}", file=sys.stderr)

        # 轮询等待声音就绪
        max_attempts = 30
        for attempt in range(max_attempts):
            voice_info = service.query_voice(voice_id=voice_id)
            status = voice_info.get("status")
            print(f"  [{attempt+1}/{max_attempts}] Status: {status}", file=sys.stderr)

            if status == "OK":
                print(f"Voice ready: {voice_id}", file=sys.stderr)
                # 输出结果到 stdout（JSON）
                print(json.dumps({"voice_id": voice_id, "status": "OK"}))
                return
            elif status in ("UNDEPLOYED", "FAILED"):
                print(f"Voice enrollment failed: {status}", file=sys.stderr)
                sys.exit(1)

            time.sleep(5)

        print("Timeout waiting for voice enrollment", file=sys.stderr)
        sys.exit(1)

    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)


def synthesize_speech(args, SpeechSynthesizer, model):
    """合成语音"""
    if not args.voice_id:
        print("Error: 需要提供 --voice_id", file=sys.stderr)
        sys.exit(1)

    text = args.text
    if args.stdin or not text:
        text = sys.stdin.read().strip()

    if not text:
        print("Error: 没有提供文本", file=sys.stderr)
        sys.exit(1)

    output = args.output
    if not output:
        print("Error: 需要提供 --output", file=sys.stderr)
        sys.exit(1)

    try:
        # speech_rate: 0.5-2.0 倍速
        speed = max(0.5, min(2.0, args.speed))
        print(f"Synthesizing ({len(text)} chars) with model={model}, speed={speed}...", file=sys.stderr)
        synthesizer = SpeechSynthesizer(model=model, voice=args.voice_id, speech_rate=speed)
        audio_data = synthesizer.call(text)

        if not audio_data:
            print("Error: 合成返回空数据", file=sys.stderr)
            sys.exit(1)

        with open(output, "wb") as f:
            f.write(audio_data)

        print(f"Output saved: {output} ({len(audio_data)} bytes)", file=sys.stderr)

    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
