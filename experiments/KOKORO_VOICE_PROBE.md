# PrecisionPDF — offline Kokoro voice experiment

This branch adds a **standalone CPU-only voice-quality/latency probe**, before adding any audio controls to the VS Code extension. The current PDF reader, MCP annotation tools, Copilot usage, and VSIX packaging are unchanged. No model is downloaded or audio is generated automatically.

## Fedora setup (isolated; does not change the existing PrecisionPDF Python environment)

From the PrecisionPDF-MCP repository root:

```bash
git fetch origin
git switch feat/kokoro-local-voice-probe

CACHE="$HOME/.cache/precisionpdf-kokoro"
mkdir -p "$CACHE"
uv venv --python 3.12 "$CACHE/.venv"
uv pip install --python "$CACHE/.venv/bin/python" "kokoro-onnx==0.6.1" "soundfile>=0.13,<1"

curl --fail --location --retry 3 \
  --output "$CACHE/kokoro-v1.0.onnx" \
  "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1/kokoro-v1.0.onnx"
curl --fail --location --retry 3 \
  --output "$CACHE/voices-v1.0.bin" \
  "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1/voices-v1.0.bin"

sha256sum "$CACHE/kokoro-v1.0.onnx" "$CACHE/voices-v1.0.bin"
```

These are upstream release assets; verify their origin and SHA-256 values against a trusted upstream source when available. The `sha256sum` command records downloaded checksums; **it does not authenticate them** by itself. The model and output audio live outside the repository. Do not commit model weights or generated WAV files.

## Compare voice samples on CPU

```bash
CACHE="$HOME/.cache/precisionpdf-kokoro"
PY="$CACHE/.venv/bin/python"

"$PY" experiments/kokoro_voice_probe.py --list-voices

"$PY" experiments/kokoro_voice_probe.py --voice af_heart
"$PY" experiments/kokoro_voice_probe.py --voice am_michael
"$PY" experiments/kokoro_voice_probe.py --voice bf_emma

# Open generated audio in Fedora's default audio player:
xdg-open "$CACHE/af_heart.wav"
```

The probe uses the **same text for each voice** and reports model load time, synthesis time, generated audio duration, real-time factor, and Linux peak process RSS. It explicitly selects `CPUExecutionProvider` and limits ONNX Runtime to four inference threads by default; no CUDA installation is needed.

To try a different phrase:

```bash
"$PY" experiments/kokoro_voice_probe.py \
  --voice am_michael --speed 1.0 --threads 4 \
  --text "A SQL injection vulnerability occurs when untrusted input changes the intended database query." \
  --output "$CACHE/sql-injection-michael.wav"
```

Each output filename is protected against accidental overwrite (use `--overwrite` only if desired). Run `"$PY" experiments/kokoro_voice_probe.py --help` for all options.

## Decision after listening

Choose the voice you prefer, compare first-response latency and audio quality, and decide whether a dedicated local TTS process should serve the VS Code webview. This branch **does not yet provide a Read Aloud button**; that is deliberately reserved for the next milestone after your Fedora benchmark.

References: [kokoro-onnx upstream](https://github.com/thewh1teagle/kokoro-onnx), [upstream Python WAV example](https://github.com/thewh1teagle/kokoro-onnx/blob/main/examples/save.py).
