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
let answerText = "";
let activeAnswer = null;

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
    "No text selected. Follow-ups stay connected to the previous passage until you start a new discussion.";
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
  if (!page || answering) return;
  const next = page.page + delta;
  if (next >= 1 && next <= page.pages) host.postMessage({ type: "navigate", page: next });
}

function clearThread(reason) {
  el("thread").replaceChildren();
  answerText = "";
  activeAnswer = null;
  el("threadStatus").textContent = reason || "Select a passage and ask your first question.";
}

function beginTurn(message) {
  const card = document.createElement("article");
  card.className = "turn";
  const label = document.createElement("div");
  label.className = "turn-label";
  label.textContent = "You · page " + message.page;
  const question = document.createElement("p");
  question.className = "turn-question";
  question.textContent = message.question;
  const evidence = document.createElement("p");
  evidence.className = "turn-source";
  evidence.textContent = message.passage ?
    "Passage: “" + message.passage.slice(0, 160) + (message.passage.length > 160 ? "…" : "") + "”" :
    "Using page context";
  const answerLabel = document.createElement("div");
  answerLabel.className = "turn-label tutor-label";
  answerLabel.textContent = "Copilot";
  const answer = document.createElement("div");
  answer.className = "turn-answer";
  answer.textContent = "Thinking…";
  card.append(label, question, evidence, answerLabel, answer);
  el("thread").appendChild(card);
  el("threadStatus").textContent = "Discussion — follow-up questions will retain this passage.";
  activeAnswer = answer;
  answerText = "";
  card.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

// Do not re-render the entire page while streaming a response.
function updateAnswer() {
  if (activeAnswer) globalThis.PrecisionPDFMarkdown.renderMarkdown(activeAnswer, answerText);
}

el("prev").addEventListener("click", () => navigate(-1));
el("next").addEventListener("click", () => navigate(1));
el("clear").addEventListener("click", resetSelection);
el("newThread").addEventListener("click", () => {
  if (answering) return;
  resetSelection();
  host.postMessage({ type: "reset" });
});
el("ask").addEventListener("click", () => {
  if (!page || answering) return;
  const question = el("question").value.trim();
  if (!question) { el("threadStatus").textContent = "Enter a question first."; return; }
  answering = true;
  el("ask").disabled = true;
  host.postMessage({ type: "ask", selection: selectionText(), question });
});
el("copy").addEventListener("click", () => {
  if (!page) return;
  host.postMessage({ type: "copy", selection: selectionText(), question: el("question").value });
});

window.addEventListener("message", (event) => {
  const message = event.data;
  if (!message || typeof message !== "object") return;
  if (message.type === "loading") {
    el("notice").textContent = "Loading page…";
    stage.hidden = true;
  } else if (message.type === "page") {
    render(message.data);
  } else if (message.type === "thread-reset") {
    clearThread(message.reason);
  } else if (message.type === "thinking") {
    beginTurn(message);
  } else if (message.type === "chunk") {
    answerText += String(message.text || "");
    updateAnswer();
  } else if (message.type === "done") {
    if (activeAnswer && !answerText) activeAnswer.textContent = "No explanation was returned.";
    answering = false;
    el("ask").disabled = false;
    el("question").value = "";
  } else if (message.type === "error") {
    el("notice").textContent = message.message;
    if (activeAnswer) {
      const error = document.createElement("p");
      error.className = "error";
      error.textContent = message.message;
      activeAnswer.appendChild(error);
    } else {
      el("threadStatus").textContent = message.message;
    }
    answering = false;
    el("ask").disabled = false;
  } else if (message.type === "copied") {
    el("threadStatus").textContent = "Prompt copied. Paste it into your existing chat client.";
  }
});

host.postMessage({ type: "ready" });
