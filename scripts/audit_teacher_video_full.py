from __future__ import annotations

import argparse
import csv
import math
from pathlib import Path

import av
from PIL import Image, ImageChops, ImageDraw, ImageFont, ImageStat


def frame_at(container: av.container.InputContainer, stream, second: float) -> Image.Image | None:
    container.seek(int(second * av.time_base), stream=stream, backward=True, any_frame=False)
    for frame in container.decode(stream):
        timestamp = float(frame.pts * frame.time_base) if frame.pts is not None else second
        if timestamp + 0.08 >= second:
            return frame.to_image().convert("RGB")
    return None


def difference(a: Image.Image | None, b: Image.Image) -> float:
    if a is None:
        return 255.0
    x = a.resize((160, 90)).convert("L")
    y = b.resize((160, 90)).convert("L")
    return ImageStat.Stat(ImageChops.difference(x, y)).mean[0]


def stamp(image: Image.Image, text: str) -> Image.Image:
    result = image.copy()
    draw = ImageDraw.Draw(result)
    draw.rectangle((0, result.height - 26, result.width, result.height), fill=(0, 0, 0))
    draw.text((7, result.height - 22), text, fill=(255, 255, 255), font=ImageFont.load_default())
    return result


def make_sheets(images: list[tuple[float, Path]], output_dir: Path, columns: int = 4, rows: int = 4) -> None:
    per_sheet = columns * rows
    cell_w, cell_h = 384, 242
    for sheet_no in range(math.ceil(len(images) / per_sheet)):
        batch = images[sheet_no * per_sheet : (sheet_no + 1) * per_sheet]
        sheet = Image.new("RGB", (columns * cell_w, rows * cell_h), "#202020")
        for index, (second, path) in enumerate(batch):
            image = Image.open(path).convert("RGB")
            image.thumbnail((cell_w, cell_h - 26))
            x = (index % columns) * cell_w + (cell_w - image.width) // 2
            y = (index // columns) * cell_h
            sheet.paste(stamp(image, f"{second:08.1f}s | {second / 60:06.2f}m"), (x, y))
        sheet.save(output_dir / f"contact-{sheet_no + 1:03d}.jpg", quality=88)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("video", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--interval", type=float, default=5.0)
    parser.add_argument("--difference", type=float, default=4.0)
    args = parser.parse_args()

    args.output.mkdir(parents=True, exist_ok=True)
    frames_dir = args.output / "keyframes"
    sheets_dir = args.output / "contact-sheets"
    frames_dir.mkdir(exist_ok=True)
    sheets_dir.mkdir(exist_ok=True)

    container = av.open(str(args.video))
    stream = container.streams.video[0]
    duration = float(stream.duration * stream.time_base)
    previous: Image.Image | None = None
    retained: list[tuple[float, Path]] = []
    timeline: list[dict[str, object]] = []

    second = 0.0
    sample_no = 0
    while second < duration:
        image = frame_at(container, stream, second)
        if image is None:
            second += args.interval
            continue
        score = difference(previous, image)
        forced = sample_no == 0 or int(second) % 60 < args.interval
        keep = forced or score >= args.difference
        path = ""
        if keep:
            thumb = image.copy()
            thumb.thumbnail((768, 432))
            out_path = frames_dir / f"frame-{int(second):06d}.jpg"
            thumb.save(out_path, quality=88)
            retained.append((second, out_path))
            path = str(out_path.relative_to(args.output))
        timeline.append({"second": round(second, 2), "minute": round(second / 60, 3), "difference": round(score, 3), "kept": keep, "path": path})
        previous = image
        sample_no += 1
        second += args.interval

    with (args.output / "timeline.csv").open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=["second", "minute", "difference", "kept", "path"])
        writer.writeheader()
        writer.writerows(timeline)

    make_sheets(retained, sheets_dir)
    print(f"duration_seconds={duration:.3f}")
    print(f"samples={len(timeline)}")
    print(f"keyframes={len(retained)}")
    print(f"contact_sheets={math.ceil(len(retained) / 16)}")


if __name__ == "__main__":
    main()
