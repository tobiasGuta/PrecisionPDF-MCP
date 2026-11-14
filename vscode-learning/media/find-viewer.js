"use strict";

function setupFind({ host, el, highlight, clear, remember }) {
  const bar = el("findBar");
  const matches = el("findMatches");
  const status = el("findStatus");
  let plan = null;
  let index = -1;

  function setOpen(open) {
    bar.hidden = !open;
    el("findToggle").setAttribute("aria-expanded", String(open));
    if (open) el("findQuery").focus();
    else clear();
  }

  function go(number) {
    if (!plan?.steps[number]) return;
    remember();
    host.postMessage({ type: "findGoto", number });
  }

  el("findToggle").addEventListener("click", () => setOpen(bar.hidden));
  window.addEventListener("keydown", event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
      event.preventDefault();
      setOpen(true);
    }
    if (event.key === "Escape" && !bar.hidden && bar.contains(document.activeElement)) {
      setOpen(false);
      el("findToggle").focus();
    }
  });
  el("findForm").addEventListener("submit", event => {
    event.preventDefault();
    if (el("findCancel").hidden === false) return;
    const question = el("findQuery").value.trim();
    if (!question) return;
    remember();
    reset("Searching…");
    el("findCancel").hidden = false;
    host.postMessage({ type: "findStart", question });
  });
  matches.addEventListener("change", () => go(Number(matches.value)));
  el("findPrev").addEventListener("click", () => go(index - 1));
  el("findNext").addEventListener("click", () => go(index + 1));
  el("findCancel").addEventListener("click", () => host.postMessage({ type: "findCancel" }));

  function reset(message) {
    plan = null;
    index = -1;
    matches.hidden = true;
    matches.replaceChildren();
    el("findPrev").disabled = true;
    el("findNext").disabled = true;
    el("findCancel").hidden = true;
    clear();
    status.textContent = message;
  }

  function onMessage(message) {
    if (message.type === "find-progress") status.textContent = message.message;
    if (message.type === "find-cancelled") reset("Search cancelled.");
    if (message.type === "find-error") reset(message.message);
    if (message.type === "find-plan") {
      plan = message.plan;
      el("findCancel").hidden = true;
      status.textContent = plan.totalMatches + " matches. " + plan.overview +
        (plan.totalMatches > plan.shownMatches ? " Showing the first " + plan.shownMatches + "." : "");
      matches.hidden = !plan.steps.length;
      plan.steps.forEach((step, number) => {
        const option = document.createElement("option");
        option.value = number;
        option.textContent = "Page " + step.page + " · " + step.context;
        matches.appendChild(option);
      });
    }
    if (message.type === "find-activate" && plan?.steps[message.number]?.evidenceId === message.step.evidenceId) {
      if (!bar.hidden && !highlight(message, "found")) return;
      index = message.number;
      matches.value = index;
      el("findPrev").disabled = index <= 0;
      el("findNext").disabled = index >= plan.steps.length - 1;
    }
    return message.type.startsWith("find-");
  }

  return { onMessage, reset };
}

globalThis.setupPrecisionPDFFind = setupFind;
