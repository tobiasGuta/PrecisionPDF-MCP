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


## First experimental Read Aloud implementation (af_heart)

On this same branch, completed **Manual tutoring** Copilot answers now offer
**Read aloud / Pause / Resume / Stop** under the visible written answer.
Voice: the chosen offline Kokoro voice **af_heart**, CPU-only, with no additional
Copilot request. Speech is opt-in and runs in a cancellable, separate Python
process. It generates short WAV chunks in memory, then plays them sequentially
in the VS Code webview. No audio files are persisted, and PDF files remain
read-only. Each new narration starts a new worker process (model startup takes
around 1.3 seconds on the tested machine); a persistent worker may follow if
runtime testing shows repeated startup delays.

The worker is installed in the **selected backend clone** at
experiments/kokoro_speech_worker.py and calls the existing isolated Kokoro
environment at ~/.cache/precisionpdf-kokoro/.venv/bin/python. The full-quality
Kokoro model and voice pack from the setup section above must be present.

After updating the branch, rebuild/install the experimental VSIX locally:

    cd /mnt/Development/Tools/PrecisionPDF-MCP
    npm --prefix vscode-learning test
    cd vscode-learning
    npm run package:vsix
    code --install-extension ./precisionpdf-learning-0.6.2.vsix --force

Reload VS Code, reopen PrecisionPDF Learning Mode, ask Copilot a question,
then click **Read aloud** after the answer finishes. Confirm that the answer
remains visible; audio can pause/resume and stop; a second request cancels the
first; and Guided Reading's existing **Play** remains navigation-only.

Known first-version limits: max 3,500 spoken characters per answer; it is
not enabled for Guided Reading yet; no voice or reading-rate selector yet.
Playback relies on audio support in your VS Code webview and may require a
manual Resume click if Chromium blocks autoplay. Speech text is a simplified
plain-text form of the Copilot response, so long code/math passages may not
read naturally.
