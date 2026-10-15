"use strict";

const host = acquireVsCodeApi();
const el = (id) => document.getElementById(id);
const stage = el("stage");
const overlay = el("overlay");
let page = null;
let selectedStart = -1;
let selectedEnd = -1;
let dragging = false;
let answering = false;

function selectionText() {
  if (!page || selectedStart < 0 || selectedEnd < 0) return "";
  const first = Math.min(selectedStart, selectedEnd);
  const last = Math.max(selectedStart, selectedEnd);
  return page.words.slice(first, last + 1).map((w) => w[4]).join(" ").slice(0, 2500);
}

function drawSelection() {
  const min = Math.min(selectedStart, selectedEnd);
  const max = Math.max(selectedStart, selectedEnd);
  overlay.querySelectorAll(".word").forEach((node) => {
    const idx = Number(node.dataset.index);
    node.classList.toggle("selected", min >= 0 && idx >= min && idx <= max);
  });
  el("selection").textContent = selectionText() ||
    "No text selected. Questions will use the current page.";
}

function resetSelection() {
  selectedStart = -1;
  selectedEnd = -1;
  dragging = false;
  drawSelection();
}

function render(data) {
  page = data;
  el("notice").textContent = "";
  stage.hidden = false;
  el("pageImage").src = "data:image/png;base64," + data.png_base64;
  el("pageImage").alt = "PDF page " + data.page + " of " + data.pages;
  el("pages").textContent = "Page " + data.page + " / " + data.pages;
  el("prev").disabled = data.page <= 1;
  el("next").disabled = data.page >= data.pages;
  overlay.replaceChildren();
  const fragment = document.createDocumentFragment();
  data.words.forEach((word, index) => {
    const [x0, y0, x1, y1, text] = word;
    const box = document.createElement("span");
    box.className = "word";
    box.dataset.index = String(index);
    box.title = text;
    box.setAttribute("aria-label", text);
    box.style.left = (100 * x0 / data.width) + "%";
    box.style.top = (100 * y0 / data.height) + "%";
    box.style.width = (100 * (x1 - x0) / data.width) + "%";
    box.style.height = (100 * (y1 - y0) / data.height) + "%";
    fragment.appendChild(box);
  });
  overlay.appendChild(fragment);
  resetSelection();
}

overlay.addEventListener("pointerdown", (event) => {
  const word = event.target.closest(".word");
  if (!word || event.button !== 0) return;
  event.preventDefault();
  selectedStart = Number(word.dataset.index);
  selectedEnd = selectedStart;
  dragging = true;
  drawSelection();
});
overlay.addEventListener("pointerover", (event) => {
  if (!dragging) return;
  const word = event.target.closest(".word");
  if (word) {
    selectedEnd = Number(word.dataset.index);
    drawSelection();
  }
});
window.addEventListener("pointerup", () => { dragging = false; });
window.addEventListener("blur", () => { dragging = false; });

function navigate(delta) {
  if (!page) return;
  const next = page.page + delta;
  if (next >= 1 && next <= page.pages) host.postMessage({ type: "navigate", page: next });
}

el("prev").addEventListener("click", () => navigate(-1));
el("next").addEventListener("click", () => navigate(1));
el("clear").addEventListener("click", resetSelection);
el("ask").addEventListener("click", () => {
  if (!page || answering) return;
  answering = true;
  el("ask").disabled = true;
  el("answer").textContent = "";
  host.postMessage({
    type: "ask", selection: selectionText(), question: el("question").value
  });
});
el("copy").addEventListener("click", () => {
  if (!page) return;
  host.postMessage({
    type: "copy", selection: selectionText(), question: el("question").value
  });
});

window.addEventListener("message", (event) => {
  const message = event.data;
  if (!message || typeof message !== "object") return;
  if (message.type === "loading") {
    el("notice").textContent = "Loading page…";
    stage.hidden = true;
  } else if (message.type === "page") {
    render(message.data);
  } else if (message.type === "thinking") {
    el("answer").textContent = "Asking Copilot…\n";
  } else if (message.type === "chunk") {
    if (el("answer").textContent === "Asking Copilot…\n") el("answer").textContent = "";
    el("answer").textContent += message.text;
  } else if (message.type === "done") {
    answering = false;
    el("ask").disabled = false;
  } else if (message.type === "error") {
    el("notice").textContent = message.message;
    el("answer").textContent += "\n" + message.message;
    answering = false;
    el("ask").disabled = false;
  } else if (message.type === "copied") {
    el("answer").textContent = "Prompt copied. Paste it into your existing chat client.";
  }
});

host.postMessage({ type: "ready" });
