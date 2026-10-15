"use strict";

// The guide highlights the existing read-only PDF word overlay, not PDF annotations.
function setupGuidedUI({ host, el, overlay, stage }) {
  const guide = { plan: null, index: -1, playing: false, timer: null, pending: false, showBroader: false };
  const panel = el("guidePanel");

  function visibleCount() {
    if (!guide.plan) return 0;
    return guide.plan.type === "exact" || guide.showBroader
      ? guide.plan.steps.length : guide.plan.directCount;
  }

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
    el("guideActive").hidden = false;
    const exact = guide.plan.type === "exact";
    const label = exact ? "Match " + (guide.index + 1) + " of " + guide.plan.steps.length
      : item.relevance === "broader"
        ? "Broader connection " + (guide.index - guide.plan.directCount + 1) + " of " + guide.plan.broaderCount
        : "Direct evidence " + (guide.index + 1) + " of " + guide.plan.directCount;
    el("guideActiveTitle").textContent = label + " · PDF page " + item.page +
      (item.section ? " · " + item.section : "");
    el("guideActiveExplanation").textContent = exact ? "Context: " + item.context : item.explanation;
    el("guideEvidenceRelation").textContent = exact ? "" :
      (item.relevance === "direct" ? "How this answers your question: " : "Contextual connection (not direct proof): ") + item.why;
    el("guideEvidenceReview").textContent = exact ? "" :
      "AI relevance review: " + item.reviewReason + " (" +
      (item.relevance === "direct" ? "direct evidence" : "broader connection") +
      "; interpretation is not independently verified).";
    el("guideActiveQuote").textContent = item.quote;
    el("guidePrev").disabled = guide.index <= 0;
    el("guideNext").disabled = guide.index >= visibleCount() - 1;
    for (const listId of ["guideSteps", "guideBroaderSteps"]) {
      el(listId).querySelectorAll("button").forEach(button => {
        button.setAttribute("aria-current", Number(button.dataset.index) === guide.index ? "step" : "false");
      });
    }
    applyHighlight();
  }

  function go(number) {
    if (!guide.plan || guide.pending || number < 0 || number >= visibleCount()) return;
    clearClock();
    guide.pending = true;
    host.postMessage({ type: "guideGoto", number });
  }

  function schedule() {
    clearClock();
    if (!guide.playing || guide.pending || !guide.plan) return;
    if (guide.index >= visibleCount() - 1) { pause(); return; }
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
    guide.plan = null; guide.index = -1; guide.pending = false; guide.showBroader = false;
    el("guideResults").hidden = true;
    el("guideSteps").replaceChildren();
    el("guideBroaderSteps").replaceChildren();
    el("guideBroaderSteps").hidden = true;
    el("guideBroaderSection").hidden = true;
    el("guideBroaderToggle").setAttribute("aria-expanded", "false");
    el("guideBroaderToggle").textContent = "Show contextual examples";
    el("guideReviewInfo").hidden = true;
    el("guideActive").hidden = true;
    el("guideRelated").hidden = true;
    el("guidePlay").disabled = true;
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
    host.postMessage({ type: "guideStart", question, approach: el("guideApproach").value });
  });
  el("guideRelated").addEventListener("click", () => {
    const question = el("guideQuestion").value.trim();
    if (!question) return;
    clearResults();
    el("guideStart").disabled = true;
    el("guideCancel").hidden = false;
    host.postMessage({ type: "guideRelated", question });
  });
  el("guideCancel").addEventListener("click", () => {
    host.postMessage({ type: "guideCancel" });
    el("guideStatus").textContent = "Cancelling analysis…";
  });
  el("guideBroaderToggle").addEventListener("click", () => {
    if (!guide.plan || guide.plan.type === "exact") return;
    pause();
    guide.showBroader = !guide.showBroader;
    el("guideBroaderSteps").hidden = !guide.showBroader;
    el("guideBroaderToggle").setAttribute("aria-expanded", String(guide.showBroader));
    el("guideBroaderToggle").textContent = guide.showBroader ? "Hide contextual examples" : "Show contextual examples";
    if (!guide.showBroader && guide.index >= guide.plan.directCount) {
      guide.index = -1;
      el("guideActive").hidden = true;
      overlay.querySelectorAll(".word.guided").forEach(n => n.classList.remove("guided"));
      if (guide.plan.directCount) go(0);
    }
    el("guidePlay").disabled = visibleCount() === 0;
    el("guideNext").disabled = guide.index >= visibleCount() - 1;
    // Showing broader evidence is an explicit opt-in; start with its first
    // verified passage if there were no direct passages to present.
    if (guide.showBroader && guide.plan.directCount === 0 && guide.index < 0 && visibleCount() > 0) go(0);
  });
  el("guidePrev").addEventListener("click", () => { pause(); go(guide.index - 1); });
  el("guideNext").addEventListener("click", () => { pause(); go(guide.index + 1); });
  el("guidePlay").addEventListener("click", () => {
    if (!guide.plan) return;
    if (guide.playing) { pause(); return; }
    if (guide.index >= visibleCount() - 1) go(0);
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
      const exact = guide.plan.type === "exact";
      el("guideStatus").textContent = exact
        ? "Local search complete: " + guide.plan.totalMatches + " exact " +
          (guide.plan.totalMatches === 1 ? "match" : "matches") + " on " +
          guide.plan.pageCount + " " + (guide.plan.pageCount === 1 ? "page" : "pages") +
          " (showing " + guide.plan.shownMatches + "). No Copilot requests."
        : "AI review: " + guide.plan.directCount + " direct, " + guide.plan.broaderCount +
          " optional broader, " + guide.plan.rejectedCount + " excluded.";
      el("guideOverviewTitle").textContent = exact ? "Exact-wording search" : "Answer from reviewed direct evidence";
      el("guideListTitle").textContent = exact ? "Exact matches (click to highlight)" : "Direct explanations (AI-reviewed)";
      el("guideReviewInfo").hidden = exact;
      if (!exact) el("guideReviewInfo").textContent = guide.plan.directCount
        ? "Direct passages explain the question; contextual examples discuss connected effects without establishing the explanation. Context stays optional. These are AI judgments, not independent proof."
        : "No passage directly explained the question. Optional contextual examples are hidden unless you choose to view them.";
      el("guideBroaderSection").hidden = exact || guide.plan.broaderCount === 0;
      el("guideRelated").hidden = !exact;
      el("guidePlay").disabled = visibleCount() === 0;
      el("guidePrev").disabled = true;
      // The first confirmed activation determines where Next can navigate.
      el("guideNext").disabled = true;
      el("guideOverview").textContent = guide.plan.overview;
      el("guideResults").hidden = false;
      el("guideActive").hidden = true;
      const directList = document.createDocumentFragment();
      const broaderList = document.createDocumentFragment();
      const directCount = exact ? guide.plan.steps.length : guide.plan.directCount;
      guide.plan.steps.forEach((item, number) => {
        const button = document.createElement("button");
        button.className = "guide-step";
        button.dataset.index = String(number);
        const label = exact ? "Match " + (number + 1)
          : number < directCount ? "Direct evidence " + (number + 1)
            : "Broader connection " + (number - directCount + 1);
        button.textContent = label + " · Page " + item.page +
          (item.section ? " · " + item.section : "") + " — " +
          (exact ? item.quote.slice(0, 160) : item.explanation.slice(0, 115));
        button.addEventListener("click", () => { pause(); go(number); });
        (number < directCount ? directList : broaderList).appendChild(button);
      });
      el("guideSteps").replaceChildren(directList);
      el("guideBroaderSteps").replaceChildren(broaderList);
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
