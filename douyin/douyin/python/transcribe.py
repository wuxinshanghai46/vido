#!/usr/bin/env python3
"""
Whisper large-v3 转录脚本 (基于 faster-whisper)
被 Node.js 后端调用, 输出 JSON 格式的转录结果到 stdout
"""

import argparse
import json
import sys


def main():
    parser = argparse.ArgumentParser(description="Whisper Transcription")
    parser.add_argument("--model_path", type=str, default="large-v3")
    parser.add_argument("--audio_file", type=str, required=True)
    parser.add_argument("--device", type=str, default=None)
    args = parser.parse_args()

    from faster_whisper import WhisperModel

    # Apple Silicon 用 CPU + int8 最稳定高效
    if args.device:
        device = args.device
        compute_type = "float16" if device == "cuda" else "int8"
    else:
        device = "cpu"
        compute_type = "int8"

    print(f"Loading model: {args.model_path} (device={device}, compute={compute_type})", file=sys.stderr)

    model = WhisperModel(
        args.model_path,
        device=device,
        compute_type=compute_type,
    )

    print(f"Transcribing: {args.audio_file}", file=sys.stderr)

    segments, info = model.transcribe(
        args.audio_file,
        beam_size=5,
        language="zh",
        vad_filter=True,
        vad_parameters=dict(min_silence_duration_ms=500),
        word_timestamps=False,
        initial_prompt="以下是普通话的句子，请使用标点符号。",
    )

    print(f"Detected language: {info.language} (prob={info.language_probability:.2f})", file=sys.stderr)

    result = []
    for seg in segments:
        result.append({
            "start_time": round(seg.start, 2),
            "end_time": round(seg.end, 2),
            "speaker": "",
            "text": seg.text.strip(),
        })

    json.dump(result, sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    main()
