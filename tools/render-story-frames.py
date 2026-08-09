#!/usr/bin/env python3
"""Rasterize a timed two-column story layout and stream it directly into FFmpeg."""

from __future__ import annotations

import argparse
import json
import subprocess
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps


WIDTH = 1080
HEIGHT = 1920
REGULAR = "/System/Library/Fonts/Supplemental/Georgia.ttf"
ITALIC = "/System/Library/Fonts/Supplemental/Georgia Italic.ttf"
BOLD = "/System/Library/Fonts/Supplemental/Georgia Bold.ttf"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--spec", type=Path, required=True)
    parser.add_argument("--art", type=Path, required=True)
    parser.add_argument("--audio", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    return parser.parse_args()


def right_text(draw: ImageDraw.ImageDraw, point: tuple[float, float], text: str, **kwargs: object) -> None:
    box = draw.textbbox((0, 0), text, font=kwargs["font"])
    draw.text((point[0] - (box[2] - box[0]), point[1]), text, **kwargs)


def centered_text(draw: ImageDraw.ImageDraw, y: float, text: str, **kwargs: object) -> None:
    box = draw.textbbox((0, 0), text, font=kwargs["font"])
    draw.text(((WIDTH - (box[2] - box[0])) / 2, y), text, **kwargs)


def build_base(spec: dict[str, object], art_path: Path) -> Image.Image:
    image = Image.new("RGB", (WIDTH, HEIGHT), "#f8f7f3")
    draw = ImageDraw.Draw(image, "RGBA")
    draw.rectangle((70, 58, 1009, 622), fill="#d9d6ce")
    draw.rectangle((71, 59, 1008, 621), fill="#fbfaf7")

    shadow = Image.new("RGBA", image.size, (0, 0, 0, 0))
    shadow_draw = ImageDraw.Draw(shadow)
    shadow_draw.rectangle((74, 675, 1014, 1759), fill=(33, 26, 17, 32))
    image = Image.alpha_composite(image.convert("RGBA"), shadow.filter(ImageFilter.GaussianBlur(12))).convert("RGB")
    artwork = ImageOps.fit(
        Image.open(art_path).convert("RGB"),
        (940, 1084),
        method=Image.Resampling.LANCZOS,
        centering=(0.5, 0.5),
    )
    image.paste(artwork, (70, 665))
    draw = ImageDraw.Draw(image, "RGBA")
    draw.rectangle((70, 665, 1009, 1748), outline=(215, 209, 197, 255), width=1)

    italic = ImageFont.truetype(ITALIC, 27)
    regular = ImageFont.truetype(REGULAR, 18)
    lanes = spec["lanes"]
    right_text(draw, (512, 96), lanes[0]["name"].lower(), font=italic, fill=(22, 21, 18, 255))
    draw.text((568, 96), lanes[1]["name"].lower(), font=italic, fill=(22, 21, 18, 255))
    centered_text(draw, 1810, spec["credit"], font=regular, fill=(95, 88, 78, 255))
    return image


def render_frame(base: Image.Image, spec: dict[str, object], moment: float) -> Image.Image:
    image = base.copy()
    draw = ImageDraw.Draw(image, "RGBA")
    regular = ImageFont.truetype(REGULAR, 28)
    bold = ImageFont.truetype(BOLD, 28)
    first_y = 166
    line_step = 43

    for lane_index, lane in enumerate(spec["lanes"]):
        for line_index, cue in enumerate(lane["cues"]):
            if moment < cue["start"]:
                font = regular
                fill = (22, 21, 18, 102)
                inward = 0.0
            elif moment < cue["end"]:
                font = bold
                fill = (12, 11, 9, 255)
                inward = 8 * min(1.0, max(0.0, (moment - cue["start"]) / 0.08))
            else:
                font = regular
                fill = (22, 21, 18, 194)
                inward = 0.0

            y = first_y + line_index * line_step
            if lane_index == 0:
                right_text(draw, (512 + inward, y), cue["line"], font=font, fill=fill)
            else:
                draw.text((568 - inward, y), cue["line"], font=font, fill=fill)
    return image


def render(spec: dict[str, object], args: argparse.Namespace) -> None:
    duration = float(spec["duration"])
    fps = int(spec["fps"])
    frame_count = round(duration * fps)
    base = build_base(spec, args.art)
    command = [
        "ffmpeg",
        "-hide_banner",
        "-loglevel",
        "warning",
        "-y",
        "-f",
        "rawvideo",
        "-pix_fmt",
        "rgb24",
        "-s",
        f"{WIDTH}x{HEIGHT}",
        "-r",
        str(fps),
        "-i",
        "pipe:0",
        "-i",
        str(args.audio),
        "-map",
        "0:v:0",
        "-map",
        "1:a:0",
        "-t",
        str(duration),
        "-c:v",
        "libx264",
        "-crf",
        "18",
        "-preset",
        "medium",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-movflags",
        "+faststart",
        str(args.out),
    ]
    process = subprocess.Popen(command, stdin=subprocess.PIPE)
    if process.stdin is None:
        raise RuntimeError("FFmpeg did not open its video input")
    try:
        for frame_index in range(frame_count):
            moment = frame_index / fps
            process.stdin.write(render_frame(base, spec, moment).tobytes())
    finally:
        process.stdin.close()
    status = process.wait()
    if status != 0:
        raise RuntimeError(f"FFmpeg exited with {status}")


def main() -> None:
    args = parse_args()
    spec = json.loads(args.spec.read_text(encoding="utf-8"))
    render(spec, args)


if __name__ == "__main__":
    main()
