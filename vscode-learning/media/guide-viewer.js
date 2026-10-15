"use strict";

// The guide highlights the existing read-only PDF word overlay, not PDF annotations.
function setupGuidedUI({ host, el, overlay, stage }) {
  const guide = { plan: null, index: -1, playing: false, timer: null, pending: false };
  const panel = el("guidePanel");

  function clearClock() { if (guide.timer) clearTimeout(guide.timer); guide.timer = null; }
  function pause() { guide.playing = false; clearClock(); el("guidePlay").textContent = "Play"; }
  function applyHighlight() {
    overlay.querySelectorAll(".word.guided").forEach(node => node.classList.remove("guided"));
    if (panel.hidden || !guide.plan || guide.index < 0) return;
    const item = guide.plan.steps[guide.index];
    const first = overlay.children[item.start_word];
    if (!first) return;
    for (let i = item.start_word; i <= item.end_word; i++) {
      const box = overlay.children[i];
      if (box) box.classList.add("guided");
    }
    const reader = stage.parentElement;
    const firstTop = parseFloat(first.style.top) / 100 * stage.clientHeight + stage.offsetTop;
    reader.scrollTo({ top: Math.max(0, firstTop - reader.clientHeight * 0.32), behavior: "smooth" });
  }

  function showActive() {
    const item = guide.plan.steps[guide.index];
    el("guideActiveTitle").textContent = "Step " + (guide.index + 1) + " of " + guide.plan.steps.length + " · PDF page " + item.page + (item.section ? " · " + item.section : "");
    el("guideActiveExplanation").textContent = item.explanation;
    el("guideActiveQuote").textContent = item.quote;
    el("guidePrev").disabled = guide.index <= 0;
    el("guideNext").disabled = guide.index >= guide.plan.steps.length - 1;
    el("guideSteps").querySelectorAll("button").forEach((button, n) => {
      button.setAttribute("aria-current", n === guide.index ? "step" : "false");
    });
    applyHighlight();
  }

  function go(number) {
    if (!guide.plan || guide.pending || number < 0 || number >= guide.plan.steps.length) return;
    clearClock();
    guide.pending = true;
    host.postMessage({ type: "guideGoto", number });
  }

  function schedule() {
    clearClock();
    if (!guide.playing || guide.pending || !guide.plan) return;
    if (guide.index >= guide.plan.steps.length - 1) { pause(); return; }
    guide.timer = setTimeout(() => go(guide.index + 1), 12000);
  }

  function setMode(name) {
    const guided = name === "guided";
    el("manualMode").setAttribute("aria-pressed", String(!guided));
    el("guidedMode").setAttribute("aria-pressed", String(guided));
    panel.hidden = !guided;
    el("tutorPane").classList.toggle("mode-guide", guided);
    if (!guided) { pause(); overlay.querySelectorAll(".word.guided").forEach(n => n.classList.remove("guided")); }
    else applyHighlight();
  }

  function clearResults() {
    pause();
    guide.plan = null; guide.index = -1; guide.pending = false;
    el("guideResults").hidden = true;
    el("guideSteps").replaceChildren();
    overlay.querySelectorAll(".word.guided").forEach(n => n.classList.remove("guided"));
  }

  el("manualMode").addEventListener("click", () => setMode("manual"));
  el("guidedMode").addEventListener("click", () => setMode("guided"));
  el("guideStart").addEventListener("click", () => {
    const question = el("guideQuestion").value.trim();
    if (!question) { el("guideStatus").textContent = "Enter a question about the PDF."; return; }
    clearResults();
    el("guideStart").disabled = true;
    el("guideCancel").hidden = false;
    host.postMessage({ type: "guideStart", question });
  });
  el("guideCancel").addEventListener("click", () => {
    host.postMessage({ type: "guideCancel" });
    el("guideStatus").textContent = "Cancelling analysis…";
  });
  el("guidePrev").addEventListener("click", () => { pause(); go(guide.index - 1); });
  el("guideNext").addEventListener("click", () => { pause(); go(guide.index + 1); });
  el("guidePlay").addEventListener("click", () => {
    if (!guide.plan) return;
    if (guide.playing) { pause(); return; }
    if (guide.index >= guide.plan.steps.length - 1) go(0);
    guide.playing = true;
    el("guidePlay").textContent = "Pause";
    schedule();
  });

  function onMessage(message) {
    if (message.type === "guide-clear") { clearResults(); return true; }
    if (message.type === "guide-progress") {
      el("guideStatus").textContent = message.message; return true;
    }
    if (message.type === "guide-cancelled" || message.type === "guide-error") {
      el("guideStart").disabled = false;
      el("guideCancel").hidden = true;
      if (message.type === "guide-error") clearResults();
      el("guideStatus").textContent = message.type === "guide-error" ? message.message : "Analysis cancelled. No PDF changes made.";
      return true;
    }
    if (message.type === "guide-plan") {
      guide.plan = message.plan;
      el("guideStart").disabled = false;
      el("guideCancel").hidden = true;
      el("guideStatus").textContent = "Ready: " + guide.plan.pages + " pages analyzed, " + guide.plan.steps.length + " grounded steps.";
      el("guideOverview").textContent = guide.plan.overview;
      el("guideResults").hidden = false;
      const fragment = document.createDocumentFragment();
      guide.plan.steps.forEach((item, number) => {
        const button = document.createElement("button");
        button.className = "guide-step";
        button.textContent = "Step " + (number + 1) + " · Page " + item.page + (item.section ? " · " + item.section : "") + " — " + item.explanation.slice(0, 115);
        button.addEventListener("click", () => { pause(); go(number); });
        fragment.appendChild(button);
      });
      el("guideSteps").replaceChildren(fragment);
      return true;
    }
    if (message.type === "guide-activate") {
      if (!guide.plan || guide.plan.steps[message.number]?.evidenceId !== message.step?.evidenceId) return true;
      guide.index = message.number;
      guide.pending = false;
      showActive();
      schedule();
      return true;
    }
    return false;
  }

  function onPage() {
    overlay.querySelectorAll(".word.guided").forEach(n => n.classList.remove("guided"));
  }

  return { onMessage, onPage, setMode };
}

globalThis.setupPrecisionPDFGuided = setupGuidedUI;
