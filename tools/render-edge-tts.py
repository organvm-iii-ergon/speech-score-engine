#!/usr/bin/env python3
"""Render one Edge-TTS clip and the word boundaries from the same stream."""

from __future__ import annotations

import argparse
import asyncio
import json
from pathlib import Path

from edge_tts import Communicate


TICKS_PER_SECOND = 10_000_000


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--voice", required=True)
    parser.add_argument("--rate", default="+0%")
    parser.add_argument("--text", required=True)
    parser.add_argument("--media-out", type=Path, required=True)
    parser.add_argument("--timing-out", type=Path, required=True)
    return parser.parse_args()


async def render(args: argparse.Namespace) -> None:
    args.media_out.parent.mkdir(parents=True, exist_ok=True)
    args.timing_out.parent.mkdir(parents=True, exist_ok=True)
    media_temp = args.media_out.with_suffix(args.media_out.suffix + ".tmp")
    timing_temp = args.timing_out.with_suffix(args.timing_out.suffix + ".tmp")
    words: list[dict[str, object]] = []
    communicate = Communicate(
        args.text,
        args.voice,
        rate=args.rate,
        boundary="WordBoundary",
    )

    try:
        with media_temp.open("wb") as media:
            async for chunk in communicate.stream():
                if chunk["type"] == "audio":
                    media.write(chunk["data"])
                    continue
                if chunk["type"] != "WordBoundary":
                    continue
                offset = int(chunk["offset"])
                duration = int(chunk["duration"])
                words.append(
                    {
                        "text": chunk["text"],
                        "offset": offset,
                        "duration": duration,
                        "start": offset / TICKS_PER_SECOND,
                        "end": (offset + duration) / TICKS_PER_SECOND,
                    }
                )

        if not words:
            raise RuntimeError("Edge-TTS returned audio without word boundaries")
        payload = {
            "voice": args.voice,
            "rate": args.rate,
            "text": args.text,
            "duration": words[-1]["end"],
            "words": words,
        }
        timing_temp.write_text(
            json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
            encoding="utf-8",
        )
        media_temp.replace(args.media_out)
        timing_temp.replace(args.timing_out)
    finally:
        media_temp.unlink(missing_ok=True)
        timing_temp.unlink(missing_ok=True)


def main() -> None:
    asyncio.run(render(parse_args()))


if __name__ == "__main__":
    main()
