"use strict";

const host = acquireVsCodeApi();
const el = (id) => document.getElementById(id);
const stage = el("stage");
const overlay = el("overlay");
const reader = stage.parentElement;
const guidedUI = globalThis.setupPrecisionPDFGuided({ host, el, overlay, highlight, scope: guideScope, remember,
  stopNarration: () => { speechUI.stopTurn("guide"); speechUI.stopTurn("recap"); } });
const findUI = globalThis.setupPrecisionPDFFind({ host, el, highlight, remember,
  clear: () => clearHighlight("found") });
const speechUI = globalThis.setupPrecisionPDFSpeech({ host, onSpan: followSpeech, continuePlayback: continueRecap });
const studyUI = globalThis.setupPrecisionPDFStudy({ host, el, remember, highlight,
  selected: () => ({ ...requestSource(), quote: selectionText() }),
  pause: () => { guidedUI.pause(); speechUI.stop(); } });
let guideSource = null;
let page = null;
let selectedStart = -1;
let selectedEnd = -1;
let dragging = false;
let answering = false;
let answerText = "";
let activeAnswer = null;
let currentContext = "";
let loading = true;
let zoom = 0;
let sections = [];
let locations = [];
let restoreScroll = null;
let turnFailed = false;
let positionTimer;
let referencePending = false;
let referenceOrigin = null;
let selectingRegion = false;
let regionStart = null;
let region = null;
let recap = null;
let recapIndex = 0;

function requestSource() {
  return { page: page?.page, fingerprint: page?.sha256,
    start: Math.min(selectedStart, selectedEnd), end: Math.max(selectedStart, selectedEnd) };
}

function savePosition() {
  if (!page || loading) return;
  host.postMessage({ type: "position", page: page.page, zoom, scroll: reader.scrollTop, left: reader.scrollLeft });
}

reader.addEventListener("scroll", () => {
  clearTimeout(positionTimer);
  positionTimer = setTimeout(savePosition, 150);
});

function readingPosition() {
  return { page: page.page, scroll: reader.scrollTop, left: reader.scrollLeft, zoom, fingerprint: page.sha256 };
}

function remember(position) {
  if (!page || loading) return;
  position ||= readingPosition();
  const last = locations.at(-1);
  if (last?.page === position.page && last.scroll === position.scroll && last.left === position.left) return;
  locations.push(position);
  if (locations.length > 50) locations.shift();
  el("back").disabled = false;
}

function clearHighlight(kind) {
  overlay.querySelectorAll(".word." + kind).forEach(node => node.classList.remove(kind));
}

function highlight({ step, fingerprint }, kind) {
  clearHighlight(kind);
  if (loading || page?.page !== step.page || page.sha256 !== fingerprint) return false;
  const quote = page.words.slice(step.start_word, step.end_word + 1).map(word => word[4]).join(" ");
  if (quote !== step.quote) return false;
  const first = overlay.children[step.start_word];
  if (!first || !overlay.children[step.end_word]) return false;
  if (kind !== "spoken") clearHighlight(kind === "guided" ? "found" : "guided");
  for (let i = step.start_word; i <= step.end_word; i++) overlay.children[i].classList.add(kind);
  const top = parseFloat(first.style.top) / 100 * stage.clientHeight + stage.offsetTop;
  const left = parseFloat(first.style.left) / 100 * stage.clientWidth + stage.offsetLeft;
  const visibleLeft = left >= reader.scrollLeft && left <= reader.scrollLeft + reader.clientWidth * 0.9;
  reader.scrollTo({ top: Math.max(0, top - reader.clientHeight * 0.32),
    left: visibleLeft ? reader.scrollLeft : Math.max(0, left - reader.clientWidth * 0.15) });
  return true;
}

function followSpeech(span) {
  clearHighlight("spoken");
  if (!span || !el("listenFollow").checked || span.page !== page?.page || span.fingerprint !== page.sha256) return;
  const quote = page.words.slice(span.start, span.end + 1).map(word => word[4]).join(" ");
  highlight({ fingerprint: span.fingerprint, step: { page: span.page, start_word: span.start, end_word: span.end, quote } }, "spoken");
}

function guideScope() {
  if (el("guideScope").value === "range") return { start: el("guideFirst").value, end: el("guideLast").value };
  if (el("guideScope").value !== "section" || !page) return {};
  const current = sections.findLast(item => item.page <= page.page);
  if (!current) return { start: page.page, end: page.page };
  const next = sections.find(item => item.page > current.page && item.level <= current.level);
  return { start: current.page, end: next ? next.page - 1 : page.pages };
}

function setZoom(value) {
  zoom = value;
  el("zoom").value = String(value);
  stage.style.width = value && page ? Math.round(page.width * value) + "px" : "";
  stage.classList.toggle("zoomed", Boolean(value));
}

function jump(number, save = true) {
  if (!page || answering || loading) return;
  if (!Number.isInteger(number) || number < 1 || number > page.pages) {
    el("notice").textContent = "Enter a PDF page from 1 to " + page.pages + ".";
    return;
  }
  savePosition();
  if (save) remember();
  host.postMessage({ type: "navigate", page: number, zoom });
}

function setControls() {
  const selected = !loading && selectedStart >= 0 && selectedEnd >= 0;
  el("quote").disabled = !selected;
  el("clear").disabled = !selected;
  el("newThread").disabled = answering || !el("thread").children.length;
  el("zoom").disabled = loading || answering;
  el("visualSelect").disabled = loading || answering;
  el("comparisonChoose").disabled = answering;
  el("ocr").disabled = loading || answering;
  el("pin").disabled = !selected;
  speechUI.setAvailable(0, !loading && Boolean(page?.words.length));
  el("studyStart").disabled = loading || !page?.words.length;
  const term = selectionText();
  el("definitionStart").disabled = !selected || term.length > 120 || term.split(/\s+/).length > 12;
  el("studyGuide").hidden = loading || !guideSource || guideSource.page !== page?.page ||
    guideSource.fingerprint !== page.sha256;
  el("guideSpeech").hidden = el("studyGuide").hidden || !guideSource.narrationAvailable;
  el("ask").disabled = loading || answering || !page;
  el("prev").disabled = loading || answering || !page || page.page <= 1;
  el("next").disabled = loading || answering || !page || page.page >= page.pages;
}

function selectScope() {
  const scope = el("tutorScope").value;
  el("comparisonControls").hidden = scope !== "comparison";
  el("tutorGrounding").disabled = scope === "visual";
  el("copy").disabled = scope === "visual" || scope === "comparison";
}
el("tutorScope").addEventListener("change", selectScope);
el("comparisonChoose").addEventListener("click", () => host.postMessage({ type: "comparisonChoose" }));

function setRegionMode(active) {
  selectingRegion = active;
  regionStart = null;
  overlay.classList.toggle("select-region", active);
  el("visualSelect").setAttribute("aria-pressed", String(active));
  if (active) el("notice").textContent = "Drag a box around a figure, chart, or equation. Include its caption if helpful.";
}

function showRegion(box) {
  const node = el("visualBox");
  node.hidden = !box;
  if (!box) return;
  const [x0, y0, x1, y1] = box;
  Object.assign(node.style, { left: x0 * 100 + "%", top: y0 * 100 + "%",
    width: (x1 - x0) * 100 + "%", height: (y1 - y0) * 100 + "%" });
}

function regionPoint(event) {
  const rect = overlay.getBoundingClientRect();
  const clip = value => Math.min(1, Math.max(0, value));
  return [clip((event.clientX - rect.left) / rect.width), clip((event.clientY - rect.top) / rect.height)];
}

function dragRegion(event) {
  const [x, y] = regionPoint(event);
  const [left, top] = regionStart;
  return [Math.min(left, x), Math.min(top, y), Math.max(left, x), Math.max(top, y)];
}

el("visualSelect").addEventListener("click", () => {
  setRegionMode(!selectingRegion);
  if (!selectingRegion) showRegion(region);
});
overlay.addEventListener("pointermove", event => { if (regionStart) showRegion(dragRegion(event)); });
overlay.addEventListener("pointercancel", () => { setRegionMode(false); showRegion(region); });

function sendRecap() {
  return { type: "recapStep", id: recap?.id, number: recapIndex, zoom, speed: Number(el("listenSpeed").value) };
}

function continueRecap(id) {
  if (id !== "recap" || !recap) return false;
  if (++recapIndex < recap.steps.length) {
    host.postMessage(sendRecap());
    return true;
  }
  el("recapRecall").hidden = false;
  el("recapAnswer").focus();
  return false;
}

function setRecap(plan) {
  speechUI.stopTurn("recap");
  recap = plan?.recapId && plan.directCount
    ? { id: plan.recapId, question: plan.question, steps: plan.steps.slice(0, Math.min(3, plan.directCount)) } : null;
  el("recap").hidden = !recap;
  el("recapRecall").hidden = true;
  el("recapEvidence").hidden = true;
  el("recapEvidence").replaceChildren();
  el("recapAnswer").value = "";
  el("recapQuestion").textContent = recap?.question || "";
}

el("recapSpeech").appendChild(speechUI.createControls("recap", () => {
  guidedUI.pause();
  remember();
  recapIndex = 0;
  el("recapRecall").hidden = true;
  el("recapEvidence").hidden = true;
  return sendRecap();
}, "Listen to recap"));
speechUI.complete("recap", true);
el("recapReveal").addEventListener("click", () => {
  if (!recap) return;
  const entries = recap.steps.map((step, number) => {
    const entry = document.createElement("p");
    const source = document.createElement("button");
    source.textContent = "PDF page " + step.page;
    source.addEventListener("click", () => {
      if (!loading && !answering) {
        remember();
        host.postMessage({ type: "guideGoto", number, zoom });
      }
    });
    entry.textContent = step.quote + " ";
    entry.append(source);
    return entry;
  });
  el("recapEvidence").replaceChildren(...entries);
  el("recapEvidence").hidden = false;
});

el("selectionSpeech").appendChild(speechUI.createControls(0, () => {
  guidedUI.pause();
  return { type: selectionText() ? "readSelection" : "readPage", ...requestSource(),
    speed: Number(el("listenSpeed").value) };
}));
el("guideSpeech").appendChild(speechUI.createControls("guide", () => {
  guidedUI.pause();
  return { type: "speechGuide", evidenceId: guideSource?.evidenceId,
    speed: Number(el("listenSpeed").value) };
}, "Read aloud"));
speechUI.complete("guide", true);
el("studyGuide").addEventListener("click", () => {
  if (!guideSource) return;
  studyUI.start({ page: guideSource.page, fingerprint: guideSource.fingerprint,
    start: guideSource.start_word, end: guideSource.end_word });
});
speechUI.complete(0, true);
el("back").disabled = true;

function selectionText() {
  if (!page || selectedStart < 0 || selectedEnd < 0) return "";
  const first = Math.min(selectedStart, selectedEnd);
  const last = Math.max(selectedStart, selectedEnd);
  return page.words.slice(first, last + 1).map((w) => w[4]).join(" ").slice(0, 2500);
}

function updateComposerContext() {
  const passage = selectionText() || currentContext;
  const source = page ? "Page " + page.page : "Opening PDF…";
  el("composerContext").textContent = source + (passage ? " · Selected passage" : "");
  el("selection").textContent = passage;
  el("selection").hidden = !passage;
}

function drawSelection() {
  const min = Math.min(selectedStart, selectedEnd);
  const max = Math.max(selectedStart, selectedEnd);
  overlay.querySelectorAll(".word").forEach((node) => {
    const idx = Number(node.dataset.index);
    node.classList.toggle("selected", min >= 0 && idx >= min && idx <= max);
  });
  updateComposerContext();
  setControls();
}

function resetSelection() {
  selectedStart = -1;
  selectedEnd = -1;
  dragging = false;
  drawSelection();
}

function render(data, restore) {
  const changed = page && data.sha256 !== page.sha256;
  if (changed) {
    locations = [];
    el("back").disabled = true;
    el("definitionResults").hidden = true;
    findUI.reset("PDF changed. Search again.");
    guidedUI.clearResults();
    el("pins").replaceChildren();
  }
  if (restore && restore.page === data.page) restoreScroll = restore;
  if (restoreScroll?.page !== data.page || restoreScroll.fingerprint !== data.sha256) restoreScroll = null;
  const scroll = restoreScroll?.scroll || 0;
  const left = restoreScroll?.left || 0;
  const image = el("pageImage");
  page = data;
  region = null;
  showRegion(null);
  setRegionMode(false);
  el("visualScope").disabled = true;
  if (el("tutorScope").value === "visual") {
    el("tutorScope").value = "page";
    selectScope();
  }
  if (!referencePending) { referenceOrigin = null; closeReferenceResults(); }
  loading = false;
  setZoom(restoreScroll?.zoom ?? zoom);
  restoreScroll = null;
  // Keep page geometry stable before the PNG loads so jump-to-source scrolls reliably.
  image.width = Math.round(data.width);
  image.height = Math.round(data.height);
  image.style.aspectRatio = data.width + " / " + data.height;
  el("pageNumber").value = data.page;
  el("pageNumber").max = data.pages;
  if (data.sections) {
    sections = data.sections;
    const select = el("outline");
    select.replaceChildren(new Option("PDF outline", ""));
    for (const item of sections) select.add(new Option("  ".repeat(Math.min(item.level - 1, 10)) + item.title, item.page));
    select.hidden = !sections.length;
    el("guideScope").options[1].disabled = !sections.length;
    if (!sections.length && el("guideScope").value === "section") el("guideScope").value = "all";
  }
  el("ocr").hidden = data.words.length > 0 && !data.ocr;
  el("ocrLanguage").hidden = el("ocr").hidden;
  el("notice").textContent = "";
  stage.hidden = false;
  el("pageImage").src = "data:image/png;base64," + data.png_base64;
  el("pageImage").alt = "PDF page " + data.page + " of " + data.pages;
  el("pages").textContent = "/ " + data.pages;
  const filename = data.file ? data.file.split(/[\\/]/).at(-1).replace(/[\r\n\t]+/g, " ") : "PrecisionPDF";
  el("documentName").textContent = filename;
  el("documentName").title = filename;
  el("prev").disabled = data.page <= 1;
  el("next").disabled = data.page >= data.pages;
  overlay.replaceChildren();
  const fragment = document.createDocumentFragment();
  const { pageReferences, referenceAt, captionAt } = globalThis.precisionPDFReferences;
  const rows = pageReferences(data);
  const references = new Map();
  for (let index = 0; index < rows.length; index++) {
    const item = referenceAt(rows, index);
    if (!item || captionAt(rows, index)) continue;
    for (let word = item.start; word <= item.end; word++) references.set(word, item);
    index = item.end;
  }
  data.words.forEach((word, index) => {
    const [x0, y0, x1, y1, text] = word;
    const box = document.createElement("span");
    box.className = "word";
    box.dataset.index = String(index);
    const reference = references.get(index);
    box.title = reference ? "Go to " + reference.label : text;
    if (reference) {
      box.classList.add("reference");
      box.dataset.reference = reference.start;
      if (index === reference.start) {
        box.tabIndex = 0;
        box.setAttribute("role", "link");
      }
    }
    box.setAttribute("aria-label", reference ? "Go to " + reference.label : text);
    box.style.left = (100 * x0 / data.width) + "%";
    box.style.top = (100 * y0 / data.height) + "%";
    box.style.width = (100 * (x1 - x0) / data.width) + "%";
    box.style.height = (100 * (y1 - y0) / data.height) + "%";
    fragment.appendChild(box);
  });
  overlay.appendChild(fragment);
  guidedUI.onPage();
  // A previous page's passage must not be treated as evidence on this page.
  currentContext = "";
  resetSelection();
  reader.scrollTo({ top: scroll, left });
  savePosition();
  if (data.ocr) el("notice").textContent = "OCR text · check quotations against the page.";
  else if (!data.words.length) el("notice").textContent = "No selectable text on this page. Try OCR this page.";

}

overlay.addEventListener("pointerdown", (event) => {
  if (selectingRegion && !loading && event.button === 0) {
    event.preventDefault();
    overlay.setPointerCapture(event.pointerId);
    regionStart = regionPoint(event);
    return;
  }
  const word = event.target.closest(".word");
  if (loading || !word || event.button !== 0) return;
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
function followReference(start) {
  if (!page || loading || answering || referencePending) return;
  referenceOrigin = readingPosition();
  resetSelection();
  currentContext = "";
  updateComposerContext();
  guidedUI.pause();
  speechUI.stop();
  el("referenceList").replaceChildren();
  el("referenceResults").hidden = false;
  el("referenceStatus").textContent = "Looking for the caption…";
  referencePending = true;
  host.postMessage({ type: "referenceStart", start, page: page.page, fingerprint: page.sha256, zoom });
}

function closeReferenceResults() {
  el("referenceResults").hidden = true;
  el("referenceList").replaceChildren();
}

el("referenceClose").addEventListener("click", () => {
  if (!referencePending) closeReferenceResults();
});

overlay.addEventListener("keydown", event => {
  const start = event.target.dataset.reference;
  if (start !== undefined && (event.key === "Enter" || event.key === " ")) {
    event.preventDefault();
    followReference(Number(start));
  }
});

window.addEventListener("pointerup", event => {
  if (regionStart) {
    const box = dragRegion(event);
    setRegionMode(false);
    if (box[2] - box[0] < .005 || box[3] - box[1] < .005) {
      showRegion(region);
      el("notice").textContent = "Select a larger area using Explain figure / equation.";
      return;
    }
    region = box;
    showRegion(region);
    if (el("tutorPane").hidden) el("assistantToggle").click();
    guidedUI.setMode("manual");
    el("visualScope").disabled = false;
    el("tutorScope").value = "visual";
    selectScope();
    el("notice").textContent = "Image region selected.";
    el("question").value = "";
    el("question").focus();
    return;
  }
  if (!dragging) return;
  dragging = false;
  const word = event.target?.closest?.(".word");
  if (selectedStart === selectedEnd && word?.dataset.index === String(selectedStart) &&
      word.dataset.reference !== undefined) {
    followReference(Number(word.dataset.reference));
    return;
  }
  const selection = selectionText();
  currentContext = selection;
  updateComposerContext();
});
window.addEventListener("blur", () => { dragging = false; });

function navigate(delta) {
  if (page && page.page + delta >= 1 && page.page + delta <= page.pages) jump(page.page + delta, false);
}

el("assistantToggle").addEventListener("click", event => {
  const panel = el("tutorPane");
  const show = panel.hidden;
  panel.hidden = !show;
  panel.parentElement.classList.toggle("reading-only", !show);
  event.currentTarget.setAttribute("aria-pressed", String(show));
  if (!show) {
    guidedUI.pause();
    speechUI.stopTurn("guide");
  }
});

el("pageNumber").addEventListener("keydown", event => {
  if (event.key === "Enter") jump(Number(event.target.value));
});
el("outline").addEventListener("change", event => jump(Number(event.target.value)));
el("guideScope").addEventListener("change", event => {
  el("guideRange").hidden = event.target.value !== "range";
  if (page && !el("guideFirst").value) {
    el("guideFirst").value = page.page;
    el("guideLast").value = page.page;
  }
});
el("zoom").addEventListener("change", event => {
  if (!page || loading || answering) return;
  setZoom(Number(event.target.value));
  savePosition();
  restoreScroll = { page: page.page, scroll: reader.scrollTop, left: reader.scrollLeft, zoom, fingerprint: page.sha256 };
  jump(page.page, false);
});
el("back").addEventListener("click", () => {
  if (!locations.length || loading || answering) return;
  restoreScroll = locations.pop();
  el("back").disabled = !locations.length;
  setZoom(restoreScroll.zoom);
  jump(restoreScroll.page, false);
});
el("ocr").addEventListener("click", () => {
  if (!page || loading || answering) return;
  const language = el("ocrLanguage").value.trim();
  if (!/^[a-z]{3}(?:\+[a-z]{3})*$/.test(language)) {
    el("notice").textContent = "Enter installed Tesseract languages such as eng or eng+spa.";
    return;
  }
  restoreScroll = { page: page.page, scroll: reader.scrollTop, left: reader.scrollLeft, zoom, fingerprint: page.sha256 };
  host.postMessage({ type: "ocr", page: page.page, zoom, language });
});
for (const type of ["pin", "quote"]) {
  el(type).addEventListener("click", () => host.postMessage({ type, ...requestSource() }));
}

window.addEventListener("keydown", event => {
  if (event.ctrlKey || event.metaKey || event.altKey || event.defaultPrevented ||
      event.target.closest("input, textarea, select, button, [contenteditable]")) return;
  if (event.key === "ArrowLeft") { event.preventDefault(); navigate(-1); }
  if (event.key === "ArrowRight") { event.preventDefault(); navigate(1); }
});

function clearThread(reason, preserveSelection = false) {
  speechUI.clear();
  el("thread").replaceChildren();
  answerText = "";
  activeAnswer = null;
  el("threadStatus").textContent = reason || "";
  el("threadEmpty").hidden = false;
  setControls();
  if (!preserveSelection) currentContext = "";
  updateComposerContext();
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
    message.scope === "pins" ? "Using pinned passages" :
      message.scope === "comparison" ? "Comparing selected PDFs" :
        message.scope === "visual" ? "Using selected image region" : "Using page context";
  const answerLabel = document.createElement("div");
  answerLabel.className = "turn-label tutor-label";
  answerLabel.textContent = "Copilot";
  const answer = document.createElement("div");
  answer.className = "turn-answer";
  answer.textContent = "Thinking…";
  card.append(label, question, evidence, answerLabel, answer, speechUI.createControls(message.turnId));
  el("thread").appendChild(card);
  el("threadEmpty").hidden = true;
  el("threadStatus").textContent = "";
  activeAnswer = answer;
  answerText = "";
  const scroller = el("tutorScroll");
  scroller.scrollTop = scroller.scrollHeight;
}

// Do not re-render the entire page while streaming a response.
function updateAnswer() {
  if (!activeAnswer) return;
  const scroller = el("tutorScroll");
  const nearBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 140;
  globalThis.PrecisionPDFMarkdown.renderMarkdown(activeAnswer, answerText);
  // Follow a streaming answer only when the reader is already near the bottom.
  if (nearBottom) scroller.scrollTop = scroller.scrollHeight;
}

el("guidedMode").addEventListener("click", () => speechUI.stop());
el("listenFollow").addEventListener("change", () => {
  if (!el("listenFollow").checked) clearHighlight("spoken");
});
el("prev").addEventListener("click", () => navigate(-1));
el("next").addEventListener("click", () => navigate(1));
el("clear").addEventListener("click", () => {
  currentContext = "";
  resetSelection();
  host.postMessage({ type: "selectionCleared" });
});
el("newThread").addEventListener("click", () => {
  if (answering) return;
  currentContext = "";
  resetSelection();
  host.postMessage({ type: "reset" });
});
el("ask").addEventListener("click", () => {
  if (!page || answering || loading) return;
  const question = el("question").value.trim();
  if (!question) { el("threadStatus").textContent = "Enter a question first."; return; }
  answering = true;
  turnFailed = false;
  el("question").readOnly = true;
  el("stopAsk").hidden = false;
  setControls();
  const scope = el("tutorScope").value;
  host.postMessage({ type: "ask", ...requestSource(), scope, grounding: el("tutorGrounding").value, question,
    ...(scope === "visual" ? { box: region } : {}) });
});
el("question").addEventListener("keydown", (event) => {
  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    el("ask").click();
  }
});
el("copy").addEventListener("click", () => {
  if (!page || loading || answering) return;
  host.postMessage({ type: "copy", ...requestSource(), scope: el("tutorScope").value, grounding: el("tutorGrounding").value,
    question: el("question").value });
});

el("stopAsk").addEventListener("click", () => host.postMessage({ type: "cancelAsk" }));

function finishTurn(success) {
  answering = false;
  el("stopAsk").hidden = true;
  el("question").readOnly = false;
  if (success) el("question").value = "";
  activeAnswer = null;
  setControls();
}

window.addEventListener("message", (event) => {
  const message = event.data;
  if (!message || typeof message !== "object") return;
  if (message.type === "guide-plan") setRecap(message.plan);
  if (["guide-clear", "guide-error", "reader-text-changed"].includes(message.type)) setRecap(null);
  if (message.type === "recap-source") { highlight(message, "guided"); return; }
  if (message.type === "comparison-list") {
    el("comparisonList").textContent = message.labels.join(" · ");
    return;
  }
  if (message.type === "tutor-status") { el("threadStatus").textContent = message.message; return; }
  if (message.type === "region-source" && page?.sha256 === message.fingerprint && page.page === message.page) {
    showRegion(message.box);
    el("visualBox").scrollIntoView({ block: "center", inline: "nearest" });
    return;
  }
  if (speechUI.onMessage(message) || studyUI.onMessage(message)) return;
  if (message.type === "reference-progress") {
    el("referenceStatus").textContent = message.message;
    return;
  }
  if (message.type === "reference-error") {
    referencePending = false;
    el("referenceStatus").textContent = message.message;
    el("referenceResults").hidden = false;
    return;
  }
  if (message.type === "reference-leaving") {
    remember(referenceOrigin);
    return;
  }
  if (message.type === "reference-plan") {
    referencePending = false;
    const { steps } = message.plan;
    el("referenceStatus").textContent = steps.length ? "Choose a caption for " + message.label :
      "No matching caption found for " + message.label + ".";
    el("referenceList").replaceChildren(...steps.map((step, number) => {
      const button = document.createElement("button");
      button.textContent = "Page " + step.page + " · " + step.quote;
      button.addEventListener("click", () => {
        if (loading || answering || referencePending) return;
        referencePending = true;
        host.postMessage({ type: "referenceGoto", number, zoom });
      });
      return button;
    }));
    return;
  }
  if (message.type === "reference-activate" || message.type === "reference-link") {
    referencePending = false;
    referenceOrigin = null;
    if (message.fingerprint !== page?.sha256) return;
    closeReferenceResults();
    if (message.step && highlight(message, "found")) return;
    if (message.type === "reference-link" && message.page === page.page && message.to) {
      const [x, y] = message.to;
      reader.scrollTo({
        top: Math.max(0, stage.offsetTop + y / page.height * stage.clientHeight - 12),
        left: Math.max(0, stage.offsetLeft + x / page.width * stage.clientWidth - reader.clientWidth * 0.15)
      });
    }
    return;
  }
  if (message.type === "guide-activate") {
    speechUI.stopTurn("guide");
    guideSource = { ...message.step, fingerprint: message.fingerprint, narrationAvailable: message.narrationAvailable };
    setControls();
  }
  if (["guide-clear", "guide-plan", "guide-error", "reader-text-changed"].includes(message.type)) {
    speechUI.stopTurn("guide");
    guideSource = null;
    setControls();
  }
  if (guidedUI.onMessage(message)) return;
  if (findUI.onMessage(message)) return;
  if (message.type === "loading") {
    if (!message.recap) speechUI.stop();
    el("notice").textContent = "Loading page…";
    loading = true;
    setControls();
  } else if (message.type === "page") {
    render(message.data, message.restore);
  } else if (message.type === "page-error") {
    loading = false;
    restoreScroll = null;
    el("notice").textContent = message.message;
    setControls();
  } else if (message.type === "reader-text-changed") {
    guidedUI.clearResults();
    findUI.reset("Page text changed. Search again.");
  } else if (message.type === "pins") {
    el("pins").replaceChildren(...message.pins.map((pin, number) => {
      const card = document.createElement("p");
      card.textContent = "PDF page " + pin.page + (pin.ocr ? " (OCR)" : "") + " · " + pin.quote.slice(0, 180) + " ";
      const remove = document.createElement("button");
      remove.textContent = "Remove pin";
      remove.addEventListener("click", () => host.postMessage({ type: "unpin", number }));
      const go = document.createElement("button");
      go.textContent = "Show source";
      go.addEventListener("click", () => {
        if (loading || answering) return;
        remember();
        host.postMessage({ type: "pinGoto", number, zoom });
      });
      card.append(go, remove);
      return card;
    }));
  } else if (message.type === "evidence-source") {
    highlight(message, "found");
  } else if (message.type === "tutor-reviewing") {
    if (activeAnswer) activeAnswer.textContent = "Checking which claims the supplied passages support…";
  } else if (message.type === "tutor-answer") {
    if (!activeAnswer) return;
    answerText = message.text;
    activeAnswer.replaceChildren();
    if (message.notice) {
      const note = document.createElement("p");
      note.textContent = message.notice;
      activeAnswer.appendChild(note);
    }
    for (const claim of message.claims) {
      const paragraph = document.createElement("p");
      paragraph.textContent = claim.text + " ";
      for (const source of claim.sources) {
        const button = document.createElement("button");
        button.textContent = (source.document ? source.document + " · " : "") +
          "PDF page " + source.page + (source.region ? " · Image region" : source.ocr ? " · OCR" : "");
        if (source.quote) button.title = source.quote;
        button.addEventListener("click", () => {
          if (loading || answering) return;
          remember();
          host.postMessage({ type: "tutorSource", turnId: message.turnId, id: source.id, zoom });
        });
        paragraph.appendChild(button);
      }
      activeAnswer.appendChild(paragraph);
    }
    if (message.coverage?.length) {
      const coverage = document.createElement("p");
      coverage.className = "hint";
      coverage.textContent = "Local retrieval · " + message.coverage.join(" · ");
      activeAnswer.appendChild(coverage);
    }
    if (message.limited || message.truncated) {
      const note = document.createElement("p");
      note.className = "hint";
      note.textContent = [
        message.limited ? "Some drafted claims lacked sufficient support and were omitted." : "",
        message.truncated ? "Some source text was shortened before review." : ""
      ].filter(Boolean).join(" ");
      activeAnswer.appendChild(note);
    }
    for (const [label, text] of [["Hypothetical example", message.example], ["Additional model context", message.context]]) {
      if (!text) continue;
      const heading = document.createElement("h3");
      heading.textContent = label;
      const paragraph = document.createElement("p");
      paragraph.textContent = text;
      activeAnswer.append(heading, paragraph);
    }
  } else if (message.type === "reader-notice") {
    el("notice").textContent = message.message;
  } else if (message.type === "thread-reset") {
    clearThread(message.reason, message.preserveSelection === true);
  } else if (message.type === "context-updated") {
    updateComposerContext();
  } else if (message.type === "thinking") {
    beginTurn(message);
  } else if (message.type === "chunk") {
    answerText += String(message.text || "");
    updateAnswer();
  } else if (message.type === "done") {
    speechUI.complete(message.turnId, message.speechAvailable === true);
    if (activeAnswer && !answerText && !turnFailed) activeAnswer.textContent = "No explanation was returned.";
    finishTurn(message.success && !turnFailed);
  } else if (message.type === "tutor-rejected") {
    el("threadStatus").textContent = message.message;
    finishTurn(false);
  } else if (message.type === "tutor-error") {
    turnFailed = true;
    if (activeAnswer) {
      if (!answerText) activeAnswer.textContent = "";
      const error = document.createElement("p");
      error.className = "error";
      error.textContent = message.message;
      activeAnswer.appendChild(error);
    }
  } else if (message.type === "copied") {
    el("threadStatus").textContent = "Copied to clipboard.";
  }
});

setControls();
host.postMessage({ type: "ready" });
