#!/usr/bin/env python3
"""A play-test video into a transcript with a frame per remark.

    python3 tools/br/transcribe.py "<video>" [--model medium.en] [--out docs/playtests]

Cam records the phone while playing and talks; this turns that into something a session
can read: `<out>/<video-stem>/transcript.md` with one `[mm:ss]` line per spoken segment,
and `frames/NNN.jpg`, the screen at the moment each segment began, so the words and what
was on the glass line up. Everything runs locally (ffmpeg + OpenAI Whisper on the GPU);
the video never leaves the machine.

Whisper's segments are its own sentence-ish chunks; a remark that spans two segments is
two lines with two frames, which is fine -- the frames are the point.
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

FFMPEG = shutil.which("ffmpeg") or r"C:\Users\cam95\AppData\Local\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-8.1-full_build\bin\ffmpeg.exe"


def run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode:
        sys.exit(f"{' '.join(map(str, cmd))}\n{r.stderr[-2000:]}")
    return r


def stamp(t):
    t = int(t)
    return f"{t // 60:02d}:{t % 60:02d}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("video")
    ap.add_argument("--model", default="medium.en", help="whisper model (tiny/base/small/medium/large-v3, .en variants)")
    ap.add_argument("--out", default="docs/playtests")
    ap.add_argument("--frame-width", type=int, default=480, help="frame grabs are scaled to this width")
    ap.add_argument("--language", default="en")
    args = ap.parse_args()

    video = Path(args.video)
    if not video.exists():
        sys.exit(f"no such video: {video}")
    out = Path(args.out) / video.stem
    frames = out / "frames"
    frames.mkdir(parents=True, exist_ok=True)
    wav = out / "audio.wav"

    # 16 kHz mono is what Whisper wants; ffmpeg does the demux and resample.
    run([FFMPEG, "-y", "-loglevel", "error", "-i", str(video), "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", str(wav)])

    import torch
    import whisper

    device = "cuda" if torch.cuda.is_available() else "cpu"
    model = whisper.load_model(args.model, device=device)
    result = model.transcribe(str(wav), language=args.language, fp16=device == "cuda", verbose=False)
    segments = [s for s in result["segments"] if s["text"].strip()]

    lines = [f"# {video.name}", "", f"Transcribed with whisper `{args.model}` on {device}; a frame per segment in `frames/`.", ""]
    for i, s in enumerate(segments):
        frame = frames / f"{i:03d}.jpg"
        run([FFMPEG, "-y", "-loglevel", "error", "-ss", f"{s['start']:.2f}", "-i", str(video), "-frames:v", "1",
             "-vf", f"scale={args.frame_width}:-2", "-q:v", "4", str(frame)])
        lines.append(f"- **[{stamp(s['start'])}]** {s['text'].strip()}  ([frame](frames/{frame.name}))")
    (out / "transcript.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    (out / "segments.json").write_text(json.dumps(segments, indent=1), encoding="utf-8")
    wav.unlink(missing_ok=True)
    print(f"{len(segments)} segments -> {out / 'transcript.md'}")
    for l in lines[4:]:
        print(l)


if __name__ == "__main__":
    main()
