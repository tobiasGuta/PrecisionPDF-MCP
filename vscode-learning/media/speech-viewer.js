"use strict";

// Keep one user-activated Web Audio context for the entire explanation.
// Recreating HTMLAudioElement for each sentence triggered Chromium's autoplay
// policy at every boundary and required an extra Resume click.
function setupPrecisionPDFSpeech({ host }) {
  const entries = new Map();
  let activeId = null;
  let context = null;
  let source = null;
  let queue = [];
  let decoded = null;
  let decoding = false;
  let paused = false;
  let finished = false;
  let status = "";
  let generation = 0;

  function update() {
    for (const [id, item] of entries) {
      const active = activeId === id;
      item.toggle.textContent = !active ? "Read aloud" : paused ? "Resume" : "Pause";
      item.stop.hidden = !active;
      item.status.textContent = active ? status : "";
    }
  }

  function stop(notify = true) {
    const wasActive = activeId !== null;
    generation++;
    activeId = null;
    queue = [];
    decoded = null;
    decoding = false;
    finished = false;
    paused = false;
    status = "";
    if (source) {
      source.onended = null;
      try { source.stop(); } catch (_) { /* May have already ended. */ }
      source.disconnect();
      source = null;
    }
    if (context) {
      const old = context;
      context = null;
      void old.close().catch(() => {});
    }
    update();
    if (wasActive && notify) host.postMessage({ type: "speechStop" });
  }

  function fail(message) {
    const id = activeId;
    stop();
    const entry = entries.get(id);
    if (entry) entry.status.textContent = String(message || "Audio playback failed.");
  }

  function playNext() {
    if (activeId === null || !context || paused || source || decoding) return;
    if (!decoded) {
      if (!queue.length) {
        if (finished) stop(false);
        else { status = "Generating speech locally…"; update(); }
        return;
      }
      const currentContext = context;
      const currentGeneration = generation;
      let buffer;
      try {
        const bytes = atob(queue.shift());
        const array = new Uint8Array(bytes.length);
        for (let i = 0; i < bytes.length; i++) array[i] = bytes.charCodeAt(i);
        buffer = array.buffer;
      } catch (_) {
        fail("Could not decode locally generated audio.");
        return;
      }
      decoding = true;
      currentContext.decodeAudioData(buffer).then((audio) => {
        if (generation !== currentGeneration || context !== currentContext) return;
        decoding = false;
        decoded = audio;
        playNext();
      }).catch(() => {
        if (generation === currentGeneration) fail("Could not play this voice segment.");
      });
      return;
    }

    const currentContext = context;
    const currentGeneration = generation;
    const node = currentContext.createBufferSource();
    node.buffer = decoded;
    decoded = null;
    node.connect(currentContext.destination);
    source = node;
    status = "Speaking · af_heart";
    update();
    node.onended = () => {
      if (generation !== currentGeneration || source !== node) return;
      node.disconnect();
      source = null;
      playNext();
    };
    try { node.start(); }
    catch (_) { fail("Unable to start local voice playback."); }
  }

  // This runs synchronously from the user's click, which unlocks Web Audio
  // once; all later sentence transitions share the same activated context.
  function start(turnId) {
    stop();
    const AudioContextType = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AudioContextType) {
      const item = entries.get(turnId);
      if (item) item.status.textContent = "VS Code Web Audio is unavailable.";
      return;
    }
    try { context = new AudioContextType(); }
    catch (_) {
      const item = entries.get(turnId);
      if (item) item.status.textContent = "Cannot initialize audio playback.";
      return;
    }
    activeId = turnId;
    status = "Loading local Kokoro voice…";
    const currentGeneration = generation;
    const unlock = context.resume();
    unlock.catch(() => {
      if (generation === currentGeneration) fail("VS Code blocked audio playback.");
    });
    update();
    host.postMessage({ type: "speechSpeak", turnId });
  }

  function createControls(turnId) {
    const root = document.createElement("div");
    root.className = "speech-controls";
    root.hidden = true;
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.textContent = "Read aloud";
    toggle.title = "Narrate this completed response locally using Kokoro (af_heart)";
    const stopButton = document.createElement("button");
    stopButton.type = "button";
    stopButton.textContent = "Stop";
    stopButton.hidden = true;
    const label = document.createElement("span");
    label.className = "speech-status";
    label.setAttribute("role", "status");
    root.append(toggle, stopButton, label);
    entries.set(turnId, { root, toggle, stop: stopButton, status: label });

    toggle.addEventListener("click", () => {
      if (activeId !== turnId) {
        start(turnId);
      } else if (!paused) {
        paused = true;
        status = "Paused";
        update();
        const currentGeneration = generation;
        context.suspend().catch(() => {
          if (generation === currentGeneration) fail("Unable to pause audio.");
        });
      } else {
        paused = false;
        status = source ? "Speaking · af_heart" : "Generating speech locally…";
        update();
        const currentGeneration = generation;
        context.resume().then(() => {
          if (generation === currentGeneration) playNext();
        }).catch(() => {
          if (generation === currentGeneration) fail("Unable to resume audio.");
        });
      }
    });
    stopButton.addEventListener("click", () => stop());
    return root;
  }

  function complete(turnId, success) {
    const entry = entries.get(turnId);
    if (entry && success) entry.root.hidden = false;
  }

  function clear() {
    stop();
    entries.clear();
  }

  function onMessage(message) {
    if (!message || typeof message.type !== "string" || !message.type.startsWith("speech-")) return false;
    if (message.turnId !== activeId) return true;
    if (message.type === "speech-audio") {
      if (typeof message.data === "string") queue.push(message.data);
      playNext();
    } else if (message.type === "speech-done") {
      finished = true;
      playNext();
    } else if (message.type === "speech-error") {
      fail(message.message || "Speech generation failed.");
    } else if (message.type === "speech-start") {
      status = "Generating speech locally…";
      update();
    }
    return true;
  }
  return { createControls, complete, clear, stop, onMessage };
}
globalThis.setupPrecisionPDFSpeech = setupPrecisionPDFSpeech;
