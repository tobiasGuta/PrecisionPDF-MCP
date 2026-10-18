"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { EventEmitter } = require("node:events");
const { SpeechService, plainSpeech } = require("../speech");

test("Markdown is converted to plain local narration", () => {
  assert.equal(plainSpeech("## Overview\n**Neural networks** use [layers](https://example.com)."),
    "Overview Neural networks use layers.");
});

class FakeChild extends EventEmitter {
  constructor() {
    super();
    this.killed = false;
    this.input = "";
    this.stdin = { end: value => { this.input = value; } };
    this.stdout = new EventEmitter();
    this.stdout.setEncoding = () => {};
    this.stderr = new EventEmitter();
  }
  kill() { this.killed = true; }
  reply(value) { this.stdout.emit("data", JSON.stringify(value) + "\n"); }
}

test("Read aloud generates only after explicit request; stream, finish and stop", () => {
  const children = [], sent = [];
  const service = new SpeechService({
    repo: "/tmp/precisionpdf", home: "/home/test", fileExists: () => true,
    processFactory: () => { const c = new FakeChild(); children.push(c); return c; },
    send: message => sent.push(message)
  });
  assert.equal(children.length, 0);
  service.speak(5, "Speak this.");
  assert.equal(children.length, 1);
  assert.deepEqual(JSON.parse(children[0].input), { text: "Speak this." });
  children[0].reply({ type: "audio", data: "UklGRg==" });
  children[0].reply({ type: "done" });
  assert(sent.some(message => message.type === "speech-audio" && message.turnId === 5));
  assert(sent.some(message => message.type === "speech-done" && message.turnId === 5));
  service.dispose();
  assert(children[0].killed);
});

test("Stop cancels a running synthesis; later output is ignored", () => {
  const children = [], sent = [];
  const service = new SpeechService({
    repo: "/tmp/precisionpdf", home: "/home/test", fileExists: () => true,
    processFactory: () => { const c = new FakeChild(); children.push(c); return c; },
    send: value => sent.push(value)
  });
  service.speak(1, "First speech");
  service.stop();
  assert(children[0].killed);
  children[0].reply({ type: "audio", data: "UklGRg==" });
  assert(!sent.some(v => v.type === "speech-audio"));
  service.dispose();
});

test("Rejects overlong narration without starting Kokoro", () => {
  const sent = [];
  const service = new SpeechService({ repo: "/tmp", send: value => sent.push(value) });
  service.speak(1, "A".repeat(3501));
  assert.equal(sent[0].type, "speech-error");
  service.dispose();
});

// The message sender must exist before the speech service is constructed.
test("extension initializes speech after the webview sender", () => {
  const fs = require("node:fs");
  const ext = fs.readFileSync(require("node:path").join(__dirname, "..", "extension.js"), "utf8");
  assert(ext.indexOf("const send = (message)") < ext.indexOf("const speech = new SpeechService"));
});
