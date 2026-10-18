"use strict";

const { spawn } = require("node:child_process");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");

const MAX_TEXT = 3500;
const MAX_LINE = 3 * 1024 * 1024;
const MAX_TIME_MS = 120000;

function plainSpeech(markdown) {
  return String(markdown || "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/<[^>]*>/g, "")
    .replace(/[#*_~>|]/g, " ")
    .replace(/\s+/g, " ").trim();
}

class SpeechService {
  constructor({ repo, send, processFactory = spawn, home = os.homedir(), fileExists = fs.existsSync }) {
    this.repo = repo;
    this.send = send;
    this.processFactory = processFactory;
    this.home = home;
    this.fileExists = fileExists;
    this.active = null;
    this.timer = null;
    this.closed = false;
  }

  stop() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const current = this.active;
    this.active = null;
    if (current) current.proc.kill();
  }

  dispose() {
    this.closed = true;
    this.stop();
  }

  speak(turnId, markdown) {
    if (this.closed) return;
    this.stop();
    const text = plainSpeech(markdown);
    if (!Number.isSafeInteger(turnId) || turnId < 1 || !text || text.length > MAX_TEXT) {
      this.send({ type: "speech-error", turnId,
        message: "Narration currently supports explanations up to 3,500 characters." });
      return;
    }
    const python = path.join(this.home, ".cache", "precisionpdf-kokoro", ".venv", "bin", "python");
    const script = path.join(this.repo, "experiments", "kokoro_speech_worker.py");
    if (!this.fileExists(python) || !this.fileExists(script)) {
      this.send({ type: "speech-error", turnId,
        message: "Local Kokoro installation not found. Run the Fedora setup in experiments/KOKORO_VOICE_PROBE.md." });
      return;
    }

    const proc = this.processFactory(python, [script], {
      cwd: this.repo, stdio: ["pipe", "pipe", "pipe"]
    });
    const current = { proc, turnId, buffer: "", receivedDone: false };
    this.active = current;
    this.send({ type: "speech-start", turnId });
    const fail = (error) => {
      if (this.active !== current) return;
      this.stop();
      this.send({ type: "speech-error", turnId, message: String(error).slice(0, 500) });
    };

    this.timer = setTimeout(() => fail("Voice generation timed out."), MAX_TIME_MS);
    proc.stdout.setEncoding("utf8");
    proc.stdout.on("data", (data) => {
      if (this.active !== current) return;
      current.buffer += data;
      if (current.buffer.length > MAX_LINE) return fail("Voice output exceeded the safety limit.");
      let at;
      while ((at = current.buffer.indexOf("\n")) !== -1) {
        const line = current.buffer.slice(0, at);
        current.buffer = current.buffer.slice(at + 1);
        let event;
        try { event = JSON.parse(line); }
        catch (_) { return fail("Invalid voice worker response."); }
        if (event.type === "audio" && typeof event.data === "string" &&
            event.data.length < MAX_LINE && /^[A-Za-z0-9+/]+={0,2}$/.test(event.data)) {
          this.send({ type: "speech-audio", turnId, data: event.data });
        } else if (event.type === "done") {
          current.receivedDone = true;
          this.send({ type: "speech-done", turnId });
        } else if (event.type === "error") {
          return fail(event.message || "Local speech synthesis failed.");
        } else {
          return fail("Unexpected message from local voice worker.");
        }
        if (this.active !== current) return;
      }
    });
    proc.stderr.on("data", () => {}); // avoid leaking runtime diagnostic details to the webview
    proc.on("error", (error) => fail("Unable to start Kokoro: " + error.message));
    proc.on("exit", (code) => {
      if (this.active !== current) return;
      if (!current.receivedDone) fail("Kokoro exited before audio was ready (code " + code + ").");
      else {
        if (this.timer) clearTimeout(this.timer);
        this.timer = null;
        this.active = null;
      }
    });
    proc.stdin.end(JSON.stringify({ text }) + "\n");
  }
}

module.exports = { SpeechService, plainSpeech };
