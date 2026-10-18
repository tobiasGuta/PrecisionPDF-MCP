#!/usr/bin/env python3
"""CPU-only, opt-in Kokoro voice-quality and latency probe for PrecisionPDF.

This standalone experiment never reads PDFs, contacts Copilot, or changes the
PrecisionPDF application. Voice/model files must be downloaded explicitly.
"""

from __future__ import annotations

import argparse
from pathlib import Path
import sys
import time

DEFAULT_TEXT = (
    "A security vulnerability is a weakness that an attacker might exploit. "
    "For example, an application can unintentionally reveal private information "
    "when it fails to check who is allowed to access a resource. "
    "The first step is to reproduce the issue safely, then explain the evidence "
    "and the potential impact clearly."
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--models-dir", type=Path,
        default=Path.home() / ".cache" / "precisionpdf-kokoro",
        help="Directory containing kokoro-v1.0.onnx and voices-v1.0.bin.",
    )
    parser.add_argument("--voice", default="af_heart", help="Kokoro voice name.")
    parser.add_argument("--text", default=DEFAULT_TEXT, help="Text to narrate (max 1500 characters).")
    parser.add_argument("--speed", type=float, default=1.0, help="Voice speed (0.75 to 1.5).")
    parser.add_argument("--threads", type=int, default=4, help="CPU inference threads (1 to 8).")
    parser.add_argument("--output", type=Path, help="Destination WAV, defaults to models directory.")
    parser.add_argument("--overwrite", action="store_true", help="Allow overwriting an existing WAV.")
    parser.add_argument("--list-voices", action="store_true", help="Show names from the installed voice pack.")
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    if args.threads not in range(1, 9):
        parser.error("--threads must be between 1 and 8")
    if not 0.75 <= args.speed <= 1.5:
        parser.error("--speed must be between 0.75 and 1.5")
    if not args.text.strip() or len(args.text) > 1500:
        parser.error("--text must contain 1 to 1500 characters")

    model_dir = args.models_dir.expanduser().resolve()
    model = model_dir / "kokoro-v1.0.onnx"
    voices = model_dir / "voices-v1.0.bin"
    for item in (model, voices):
        if not item.is_file():
            parser.error(f"Missing {item}. Download it explicitly as described in experiments/KOKORO_VOICE_PROBE.md")

    output = (args.output.expanduser() if args.output else model_dir / f"{args.voice}.wav").resolve()
    if output.suffix.lower() != ".wav":
        parser.error("--output must end in .wav")
    if not args.list_voices and output.exists() and not args.overwrite:
        parser.error(f"Refusing to overwrite existing WAV: {output} (pass --overwrite to replace it)")
    if not args.list_voices and not output.parent.is_dir():
        parser.error(f"Output folder does not exist: {output.parent}")

    try:
        import onnxruntime as ort
        import soundfile as sf
        from kokoro_onnx import Kokoro
    except ImportError as exc:
        parser.error(
            f"Missing optional Kokoro dependencies: {exc}. "
            "Use the isolated uv environment from experiments/KOKORO_VOICE_PROBE.md"
        )

    options = ort.SessionOptions()
    options.intra_op_num_threads = args.threads
    options.inter_op_num_threads = 1

    load_start = time.perf_counter()
    session = ort.InferenceSession(
        str(model), sess_options=options, providers=["CPUExecutionProvider"]
    )
    tts = Kokoro.from_session(session, str(voices))
    load_seconds = time.perf_counter() - load_start
    available_voices = tts.get_voices()
    if args.list_voices:
        print("\n".join(sorted(available_voices)))
        return 0
    if args.voice not in available_voices:
        parser.error(f"Unknown voice {args.voice!r}. Use --list-voices to inspect installed voices.")

    started = time.perf_counter()
    samples, sample_rate = tts.create(
        args.text, voice=args.voice, speed=args.speed, lang="en-us"
    )
    synthesis_seconds = time.perf_counter() - started
    duration_seconds = len(samples) / sample_rate
    if not duration_seconds:
        parser.error("The TTS model returned empty audio; no WAV was written")

    sf.write(str(output), samples, sample_rate, subtype="PCM_16")
    print(f"Voice: {args.voice} | Provider: {session.get_providers()[0]}")
    print(f"CPU threads: {args.threads} | Playback speed: {args.speed:.2f}x")
    print(f"Model startup: {load_seconds:.2f} s")
    print(f"Synthesis: {synthesis_seconds:.2f} s")
    print(f"Generated audio: {duration_seconds:.2f} s")
    print(f"Real-time factor: {synthesis_seconds / duration_seconds:.2f} (lower is faster)")
    if sys.platform == "linux":
        import resource
        rss_mib = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024
        print(f"Peak process memory: {rss_mib:.0f} MiB (whole process; Linux ru_maxrss)")
    print(f"WAV saved: {output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
