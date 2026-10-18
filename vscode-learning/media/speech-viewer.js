"use strict";

// Webview-local playback state. Copilot text remains displayed and unchanged.
function setupPrecisionPDFSpeech({ host }) {
  const entries = new Map();
  let activeId = null;
  let queue = [];
  let playing = null;
  let paused = false;
  let finished = false;
  let status = "";

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
    activeId = null;
    queue = [];
    finished = false;
    paused = false;
    status = "";
    if (playing) {
      playing.pause();
      playing.removeAttribute("src");
      playing.load();
      playing = null;
    }
    update();
    if (wasActive && notify) host.postMessage({ type: "speechStop" });
  }

  function playNext() {
    if (activeId === null || paused || playing) return;
    if (!queue.length) {
      if (finished) stop(false);
      else { status = "Generating speech locally…"; update(); }
      return;
    }
    const id = activeId;
    const clip = new Audio("data:audio/wav;base64," + queue.shift());
    playing = clip;
    status = "Speaking · af_heart";
    update();
    clip.onended = () => {
      if (playing !== clip) return;
      playing = null;
      clip.removeAttribute("src");
      clip.load();
      playNext();
    };
    clip.onerror = () => {
      if (activeId !== id) return;
      stop();
      const entry = entries.get(id);
      if (entry) entry.status.textContent = "Audio playback failed.";
    };
    clip.play().catch(() => {
      if (activeId === id && playing === clip) {
        paused = true;
        status = "Playback blocked; click Resume.";
        update();
      }
    });
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
        stop();
        activeId = turnId;
        status = "Loading local Kokoro voice…";
        update();
        host.postMessage({ type: "speechSpeak", turnId });
      } else if (!paused) {
        paused = true;
        if (playing) playing.pause();
        status = "Paused";
        update();
      } else {
        paused = false;
        if (playing) {
          status = "Speaking · af_heart";
          playing.play().catch(() => { paused = true; status = "Playback blocked."; update(); });
        } else {
          playNext();
        }
        update();
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
      const id = activeId;
      stop();
      const entry = entries.get(id);
      if (entry) entry.status.textContent = String(message.message || "Speech generation failed.");
    } else if (message.type === "speech-start") {
      status = "Generating speech locally…";
      update();
    }
    return true;
  }
  return { createControls, complete, clear, stop, onMessage };
}
globalThis.setupPrecisionPDFSpeech = setupPrecisionPDFSpeech;
