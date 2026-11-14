"use strict";

function setupStudy({ host, el, selected, remember, highlight, pause }) {
  const dialog = el("studyDialog");
  const status = el("studyStatus");
  const exercise = el("studyExercise");
  const list = el("studyList");
  let active = null;
  let reviewing = false;
  let pendingFeedback = false;
  let jumpSource = false;

  function showDialog(title) {
    el("studyTitle").textContent = title;
    status.textContent = "";
    if (!dialog.open) {
      pause();
      dialog.showModal();
    }
  }

  function openExercise(card, review) {
    showDialog(review ? "Review question" : "Check understanding");
    active = card;
    reviewing = review;
    list.hidden = true;
    exercise.hidden = false;
    el("studyPrompt").hidden = review;
    el("studyPrompt").previousElementSibling.hidden = review;
    el("studyPrompt").replaceChildren(...(card.prompts || []).map(prompt => new Option(prompt, prompt)));
    el("studyQuestion").value = review ? card.question : card.prompts[0];
    el("studyQuestion").readOnly = review;
    el("studyAnswer").value = "";
    el("studyQuote").textContent = "";
    el("studySavedAnswer").textContent = "";
    el("studyFeedback").textContent = "";
    el("studyEvidence").hidden = true;
    el("studyReveal").disabled = false;
    el("studyAsk").disabled = false;
    el("studyDraftQuestion").hidden = review;
    el("studyDraftQuestion").disabled = false;
    el("studySave").hidden = review;
    el("studyAgain").hidden = true;
    el("studyGotIt").hidden = true;
    el("studyAnswer").focus();
  }

  function showCards(cards) {
    showDialog("Review questions");
    active = null;
    el("studyResume").hidden = true;
    exercise.hidden = true;
    list.hidden = false;
    const sorted = [...cards].sort((a, b) => a.due - b.due);
    if (!sorted.length) {
      list.textContent = "Select a passage and save an understanding check to review it here.";
      return;
    }
    list.replaceChildren(...sorted.map(card => {
      const row = document.createElement("div");
      row.className = "review-row";
      const details = document.createElement("div");
      const question = document.createElement("p");
      question.textContent = card.question;
      const due = document.createElement("p");
      due.className = "hint";
      due.textContent = "Page " + card.source.page + " · " +
        (card.due <= Date.now() ? "Due now" : new Date(card.due).toLocaleDateString());
      details.append(question, due);
      const open = document.createElement("button");
      open.textContent = "Review";
      open.addEventListener("click", () => openExercise(card, true));
      const remove = document.createElement("button");
      remove.textContent = "Remove";
      remove.addEventListener("click", () => {
        if (window.confirm("Remove this saved question?")) host.postMessage({ type: "studyDelete", id: card.id });
      });
      row.append(details, open, remove);
      return row;
    }));
  }

  function start(source) {
    showDialog("Check understanding");
    el("studyResume").hidden = true;
    exercise.hidden = true;
    list.hidden = true;
    status.textContent = "Preparing passage…";
    host.postMessage({ type: "studyStart", ...source });
  }

  el("studyStart").addEventListener("click", () => start(selected()));
  el("studyResume").addEventListener("click", () => {
    if (!active) return;
    dialog.showModal();
    pause();
    el("studyResume").hidden = true;
  });
  el("studyOpen").addEventListener("click", () => host.postMessage({ type: "studyOpen" }));
  el("studyClose").addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => {
    if (el("studyResume").hidden) active = null;
    pendingFeedback = false;
    host.postMessage({ type: "studyClose" });
  });
  el("studyPrompt").addEventListener("change", event => {
    el("studyQuestion").value = event.target.value;
  });
  el("studyReveal").addEventListener("click", () => {
    if (!active) return;
    el("studyQuote").textContent = "PDF page " + active.source.page + (active.source.ocr ? " · OCR" : "") + " — " + active.source.quote;
    el("studySavedAnswer").textContent = reviewing && active.answer ? "Saved answer · " + active.answer : "";
    el("studyEvidence").hidden = false;
    el("studyReveal").disabled = true;
    el("studyAgain").hidden = !reviewing;
    el("studyGotIt").hidden = !reviewing;
  });
  el("studyJump").addEventListener("click", () => {
    if (!active) return;
    jumpSource = true;
    el("studyResume").hidden = false;
    remember();
    dialog.close();
    host.postMessage({ type: "studyReveal", id: active.id });
  });
  for (const [button, type] of [["studySave", "studySave"], ["studyAsk", "studyFeedback"], ["studyDraftQuestion", "studyDraftQuestion"],
    ["studyAgain", "studyRate"], ["studyGotIt", "studyRate"]]) {
    el(button).addEventListener("click", () => {
      const usesModel = type === "studyFeedback" || type === "studyDraftQuestion";
      if (!active || (usesModel && pendingFeedback)) return;
      if (usesModel) {
        pendingFeedback = true;
        el("studyAsk").disabled = true;
        el("studyDraftQuestion").disabled = true;
        status.textContent = type === "studyFeedback" ? "Requesting feedback…" : "Drafting a question…";
      }
      host.postMessage({ type, id: active.id, question: el("studyQuestion").value,
        answer: el("studyAnswer").value, again: button === "studyAgain" });
    });
  }

  el("definitionStart").addEventListener("click", () => {
    el("definitionResults").hidden = false;
    el("definitionList").replaceChildren();
    el("definitionStatus").textContent = "Looking for a definition in this PDF…";
    host.postMessage({ type: "definitionStart", question: selected().quote });
  });

  function onMessage(message) {
    switch (message.type) {
      case "study-count":
        el("studyOpen").textContent = message.due ? "Review " + message.due + " due" : "Review questions";
        break;
      case "study-draft":
        if (dialog.open) openExercise(message, false);
        break;
      case "study-cards":
        showCards(message.cards);
        break;
      case "study-question":
      case "study-feedback":
        if (dialog.open && active?.id === message.id) {
          if (message.type === "study-question") el("studyQuestion").value = message.text;
          else el("studyFeedback").textContent = message.text;
        }
        pendingFeedback = false;
        el("studyAsk").disabled = false;
        el("studyDraftQuestion").disabled = false;
        status.textContent = "";
        break;
      case "study-status":
        status.textContent = message.message;
        pendingFeedback = false;
        el("studyAsk").disabled = false;
        el("studyDraftQuestion").disabled = false;
        if (jumpSource && !dialog.open) {
          el("notice").textContent = message.message;
          jumpSource = false;
        }
        break;
      case "study-source":
        highlight(message, "found");
        jumpSource = false;
        break;
      case "definition-progress":
      case "definition-error":
        el("definitionStatus").textContent = message.message;
        break;
      case "definition-plan":
        el("definitionStatus").textContent = message.plan.steps.length
          ? "Possible definitions in this PDF" : "No explicit definition found. Try Find for other uses of the term.";
        el("definitionList").replaceChildren(...message.plan.steps.map((step, number) => {
          const button = document.createElement("button");
          button.textContent = "Page " + step.page + " · " + step.quote;
          button.addEventListener("click", () => { remember(); host.postMessage({ type: "definitionGoto", number }); });
          return button;
        }));
        break;
      case "definition-activate":
        highlight(message, "found");
        break;
      default: return false;
    }
    return true;
  }

  el("definitionClose").addEventListener("click", () => { el("definitionResults").hidden = true; });
  return { onMessage, start };
}

globalThis.setupPrecisionPDFStudy = setupStudy;
