# PrecisionPDF — offline Kokoro voice experiment

The CPU-only Kokoro setup powers the extension’s **Read selection** and **Read aloud** controls. The standalone probe can also compare voice quality and latency. Download the voice assets during setup, then use the controls to generate speech on demand.

## Fedora setup (isolated; does not change the existing PrecisionPDF Python environment)

From the PrecisionPDF-MCP repository root:

```bash
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

## Listen in Learning Mode

1. Use the Kokoro setup above on the machine running the extension host. The worker loads the model and voice pack from `~/.cache/precisionpdf-kokoro` and runs with that folder’s Python environment.
2. Open a PDF and click **Listen** to hear the current page. Select words first to hear only that passage.
3. Choose 0.8×, 1×, or 1.2× before starting. Enable **Follow audio** to highlight the segment playing on the page. Use **Pause**, **Resume**, or **Stop** during playback. Navigating to another page stops narration.
4. To hear a completed manual tutor response, click **Read aloud** under the answer.

The extension uses the English `af_heart` voice on CPU. Kokoro synthesizes audio locally and streams chunks to the webview in memory. This action uses no Copilot requests. PDF narration supports up to 24,000 characters per page and 3,500 per selection. Tutor narration supports up to 3,500 characters after plain-text conversion. Scanned pages need OCR before their text can be narrated.

If speech fails to start, check that the Python environment, model, and voice files exist at the setup paths above and that VS Code points to the matching backend clone. The standalone voice probe can verify the installation independently of VS Code.

References: [kokoro-onnx](https://github.com/thewh1teagle/kokoro-onnx), [upstream WAV example](https://github.com/thewh1teagle/kokoro-onnx/blob/main/examples/save.py).
