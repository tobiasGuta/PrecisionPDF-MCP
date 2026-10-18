"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");

function setup() {
  const messages = [], contexts = [];
  class Element {
    constructor() { this.listeners = {}; this.hidden = false; this.textContent = ""; }
    setAttribute() {}
    append() {}
    addEventListener(name, fn) { this.listeners[name] = fn; }
    click() { this.listeners.click(); }
  }
  class FakeContext {
    constructor() {
      this.sources = [];
      this.resumeCount = 0;
      this.suspendCount = 0;
      this.closed = false;
      this.destination = {};
      contexts.push(this);
    }
    resume() { this.resumeCount++; return Promise.resolve(); }
    suspend() { this.suspendCount++; return Promise.resolve(); }
    close() { this.closed = true; return Promise.resolve(); }
    decodeAudioData() { return Promise.resolve({ duration: 1 }); }
    createBufferSource() {
      const source = {
        started: false, stopped: false,
        connect() {}, disconnect() {},
        start() { this.started = true; },
        stop() { this.stopped = true; },
        onended: null
      };
      this.sources.push(source);
      return source;
    }
  }
  const globals = {
    document: { createElement: () => new Element() },
    AudioContext: FakeContext,
    atob: value => Buffer.from(value, "base64").toString("binary"),
    Uint8Array,
  };
  globals.globalThis = globals;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", "media", "speech-viewer.js"), "utf8"), globals);
  const speech = globals.setupPrecisionPDFSpeech({
    host: { postMessage: message => messages.push(message) }
  });
  const controls = speech.createControls(7);
  const toggle = controls; // child controls captured in Element.append below
  return { speech, messages, contexts, controls, globals };
}

test("speech-viewer uses one AudioContext for all chunks; no repeated Resume clicks", async () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "media", "speech-viewer.js"), "utf8");
  // Playback must be based on user-unlocked WebAudio, not new Audio() per sentence.
  assert.match(source, /new AudioContextType\(\)/);
  assert.doesNotMatch(source, /new Audio\(/);
  const messages = [], contexts = [], buttons = [];
  class Element {
    constructor(tag) { this.tag = tag; this.hidden = false; this.textContent = ""; this.handlers = {}; }
    setAttribute() {}
    append(...items) { this.children = items; }
    addEventListener(name, fn) { this.handlers[name] = fn; }
    click() { this.handlers.click(); }
  }
  class AudioCtx {
    constructor() { this.sources = []; this.resumeCalls = 0; this.suspendCalls = 0; this.destination = {}; contexts.push(this); }
    resume() { this.resumeCalls++; return Promise.resolve(); }
    suspend() { this.suspendCalls++; return Promise.resolve(); }
    close() { this.closed = true; return Promise.resolve(); }
    decodeAudioData() { return Promise.resolve({ duration: 1 }); }
    createBufferSource() {
      const node = {
        startCalls: 0, connect() {}, disconnect() {},
        start() { this.startCalls++; }, stop() { this.stopped = true; }
      };
      this.sources.push(node);
      return node;
    }
  }
  const env = {
    document: { createElement: tag => new Element(tag) },
    AudioContext: AudioCtx,
    atob: value => Buffer.from(value, "base64").toString("binary"),
    Uint8Array
  };
  env.globalThis = env;
  vm.runInNewContext(source, env);
  const player = env.setupPrecisionPDFSpeech({ host: { postMessage: msg => messages.push(msg) } });
  const root = player.createControls(7);
  const [toggle, stopButton, status] = root.children;
  player.complete(7, true);
  assert.equal(root.hidden, false);
  toggle.click();
  assert.equal(contexts.length, 1);
  assert.equal(contexts[0].resumeCalls, 1);
  assert.equal(messages[0].type, "speechSpeak");

  player.onMessage({ type: "speech-start", turnId: 7 });
  player.onMessage({ type: "speech-audio", turnId: 7, data: "UklGRg==" });
  player.onMessage({ type: "speech-audio", turnId: 7, data: "UklGRg==" });
  player.onMessage({ type: "speech-done", turnId: 7 });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(contexts[0].sources.length, 1);
  assert.equal(contexts[0].sources[0].startCalls, 1);
  contexts[0].sources[0].onended();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(contexts[0].sources.length, 2);
  assert.equal(contexts[0].sources[1].startCalls, 1);
  assert.equal(contexts[0].resumeCalls, 1, "a sentence boundary must not require another click");

  toggle.click();
  assert.equal(contexts[0].suspendCalls, 1);
  assert.equal(toggle.textContent, "Resume");
  toggle.click();
  assert.equal(contexts[0].resumeCalls, 2);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(toggle.textContent, "Pause");
  contexts[0].sources[1].onended();
  assert.equal(toggle.textContent, "Read aloud");
  assert.equal(contexts[0].closed, true);
  assert.equal(status.textContent, "");
  assert.equal(stopButton.hidden, true);
});

test("Stop immediately releases Web Audio and notifies the backend", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "media", "speech-viewer.js"), "utf8");
  class Element {
    constructor() { this.handlers = {}; this.hidden = false; this.textContent = ""; }
    setAttribute() {}
    append(...items) { this.children = items; }
    addEventListener(name, fn) { this.handlers[name] = fn; }
    click() { this.handlers.click(); }
  }
  const contexts = [], messages = [];
  class AudioCtx {
    constructor() { this.destination = {}; contexts.push(this); }
    resume() { return Promise.resolve(); }
    close() { this.closed = true; return Promise.resolve(); }
  }
  const env = { document: { createElement: () => new Element() }, AudioContext: AudioCtx, atob: () => "", Uint8Array };
  env.globalThis = env;
  vm.runInNewContext(source, env);
  const player = env.setupPrecisionPDFSpeech({ host: { postMessage: m => messages.push(m) } });
  const buttons = player.createControls(7).children;
  buttons[0].click();
  buttons[1].click();
  assert.equal(contexts[0].closed, true);
  assert.equal(messages.at(-1).type, "speechStop");
});
