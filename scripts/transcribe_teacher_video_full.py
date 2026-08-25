from __future__ import annotations

import argparse
from pathlib import Path

import av
import numpy as np
from faster_whisper import WhisperModel


def stamp(seconds: float) -> str:
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = seconds % 60
    return f"{hours:02d}:{minutes:02d}:{secs:06.3f}"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("video", type=Path)
    parser.add_argument("model", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    args.output.parent.mkdir(parents=True, exist_ok=True)

    model = WhisperModel(str(args.model), device="cpu", compute_type="int8", cpu_threads=8)
    with args.output.open("w", encoding="utf-8", buffering=1) as handle:
        handle.write("# Full-video chunked transcription; 16 kHz mono; 10-minute chunks\n")
        container = av.open(str(args.video))
        audio_stream = container.streams.audio[0]
        resampler = av.audio.resampler.AudioResampler(format="flt", layout="mono", rate=16000)
        chunk_samples = 10 * 60 * 16000
        buffered: list[np.ndarray] = []
        buffered_count = 0
        absolute_sample = 0

        def transcribe_chunk(audio: np.ndarray, offset_seconds: float) -> None:
            segments, info = model.transcribe(
                audio,
                language="ur",
                beam_size=1,
                best_of=1,
                vad_filter=True,
                condition_on_previous_text=True,
                word_timestamps=False,
            )
            handle.write(
                f"# chunk={stamp(offset_seconds)} language={info.language} "
                f"probability={info.language_probability:.4f}\n"
            )
            for segment in segments:
                line = (
                    f"[{stamp(offset_seconds + segment.start)} --> "
                    f"{stamp(offset_seconds + segment.end)}] {segment.text.strip()}\n"
                )
                handle.write(line)
                print(line, end="", flush=True)

        for packet in container.demux(audio_stream):
            for frame in packet.decode():
                converted = resampler.resample(frame)
                for out_frame in converted:
                    values = out_frame.to_ndarray().reshape(-1).astype(np.float32, copy=False)
                    buffered.append(values)
                    buffered_count += values.size
                    while buffered_count >= chunk_samples:
                        joined = np.concatenate(buffered)
                        current = joined[:chunk_samples]
                        remainder = joined[chunk_samples:]
                        transcribe_chunk(current, absolute_sample / 16000.0)
                        absolute_sample += current.size
                        buffered = [remainder] if remainder.size else []
                        buffered_count = remainder.size

        if buffered_count:
            final_audio = np.concatenate(buffered)
            transcribe_chunk(final_audio, absolute_sample / 16000.0)
        container.close()


if __name__ == "__main__":
    main()
