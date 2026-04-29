#!/usr/bin/env python3
"""
edge-tts 配音脚本
支持多种中文声音
"""

import argparse
import asyncio
import sys
import edge_tts


async def main():
    parser = argparse.ArgumentParser(description="Text-to-Speech via edge-tts")
    parser.add_argument("--text", type=str, default=None, help="文本内容(短文本)")
    parser.add_argument("--voice", type=str, default="zh-CN-YunxiNeural")
    parser.add_argument("--output", type=str, required=True)
    parser.add_argument("--rate", type=str, default="+0%")
    parser.add_argument("--stdin", action="store_true", help="从 stdin 读取文本")
    args = parser.parse_args()

    text = args.text
    if args.stdin or not text:
        text = sys.stdin.read().strip()

    if not text:
        print("Error: 没有提供文本", file=sys.stderr)
        sys.exit(1)

    communicate = edge_tts.Communicate(text, args.voice, rate=args.rate)
    await communicate.save(args.output)
    print(f"Saved to {args.output}", file=sys.stderr)


if __name__ == "__main__":
    asyncio.run(main())
