#!/usr/bin/env python3
"""On-demand offline speech synthesis. One JSON request, streamed WAV chunks."""
import base64
import io
import json
from pathlib import Path
import re
import sys

MAX_TEXT = 3500


def segments(text, limit=230):
    out, part = [], []
    length = 0
    for word in text.split():
        if len(word) > limit:
            raise ValueError("One word is too long to narrate")
        if part and length + len(word) + 1 > limit:
            out.append(" ".join(part))
            part, length = [], 0
        part.append(word)
        length += len(word) + (1 if length else 0)
        if length > 90 and re.search(r"[.!?;:]$", word):
            out.append(" ".join(part))
            part, length = [], 0
    if part:
        out.append(" ".join(part))
    return out


def emit(value):
    print(json.dumps(value, ensure_ascii=True), flush=True)


def main():
    try:
        request = json.loads(sys.stdin.readline())
        text = request.get("text")
        if not isinstance(text, str) or not text.strip() or len(text) > MAX_TEXT:
            raise ValueError("Narration must be 1 to 3,500 characters")
        cache = Path.home() / ".cache" / "precisionpdf-kokoro"
        model, voices = cache / "kokoro-v1.0.onnx", cache / "voices-v1.0.bin"
        if not model.is_file() or not voices.is_file():
            raise FileNotFoundError("Kokoro models missing from ~/.cache/precisionpdf-kokoro")
        import onnxruntime as ort
        import soundfile as sf
        from kokoro_onnx import Kokoro

        opts = ort.SessionOptions()
        opts.intra_op_num_threads = 4
        opts.inter_op_num_threads = 1
        session = ort.InferenceSession(str(model), sess_options=opts,
                                       providers=["CPUExecutionProvider"])
        kokoro = Kokoro.from_session(session, str(voices))
        if "af_heart" not in kokoro.get_voices():
            raise ValueError("Voice af_heart is not installed")
        for sentence in segments(text):
            samples, rate = kokoro.create(sentence, voice="af_heart",
                                          speed=1.0, lang="en-us")
            if len(samples) == 0:
                raise RuntimeError("Kokoro returned no audio")
            wave = io.BytesIO()
            sf.write(wave, samples, rate, format="WAV", subtype="PCM_16")
            emit({"type": "audio", "data": base64.b64encode(wave.getvalue()).decode("ascii")})
        emit({"type": "done"})
        return 0
    except Exception as exc:
        emit({"type": "error", "message": str(exc)[:400]})
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
