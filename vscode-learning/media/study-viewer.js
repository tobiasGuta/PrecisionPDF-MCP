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
  let attemptId;
  let previousAnswer = "";
  let previousQuestion = "";
  let sourceChecked = false;
  let followUp = "";
  let parentCard = null;

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
    parentCard = null;
    previousAnswer = "";
    previousQuestion = "";
    resetAttempt();
    reviewing = review;
    list.hidden = true;
    exercise.hidden = false;
    el("studyPrompt").hidden = review;
    el("studyPrompt").previousElementSibling.hidden = review;
    el("studyPrompt").replaceChildren(...(card.prompts || []).map(prompt => new Option(prompt, prompt)));
    el("studyQuestion").value = card.question || card.prompts?.[0] || "";
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

  function resetAttempt() {
    attemptId = crypto.randomUUID();
    sourceChecked = false;
    followUp = "";
    el("studyRetry").hidden = true;
    el("studyRetry").textContent = parentCard ? "Retry follow-up" : "Retry question";
    el("studyFollowUp").hidden = true;
    el("studyOriginal").hidden = !parentCard;
  }

  function recordCurrentAttempt() {
    if (!active) return;
    const answer = el("studyAnswer").value.trim();
    if (answer || sourceChecked) {
      host.postMessage({ type: "studyRecord", id: active.id, attemptId, answer, sourceChecked });
    }
  }

  function retry() {
    const answer = el("studyAnswer").value.trim();
    if (answer) {
      previousAnswer = answer;
      previousQuestion = el("studyQuestion").value;
    }
    recordCurrentAttempt();
    resetAttempt();
    el("studyAnswer").value = "";
    el("studyEvidence").hidden = true;
    el("studyReveal").disabled = false;
    el("studyAgain").hidden = true;
    el("studyGotIt").hidden = true;
    el("studyFeedback").textContent = "";
    el("studyAnswer").focus();
  }

  function showCards(cards) {
    showDialog("Review questions");
    active = null;
    el("studyResume").hidden = true;
    exercise.hidden = true;
    list.hidden = false;
    const sorted = [...cards].sort((a, b) => a.due - b.due);
    const dueCount = sorted.filter(card => card.due <= Date.now()).length;
    status.textContent = dueCount + " due · " + sorted.length + " saved";
    const current = sorted.find(card => card.due <= Date.now());
    const next = document.createElement("button");
    next.textContent = "Review next due";
    next.addEventListener("click", () => { if (current) openExercise(current, true); });
    next.hidden = !current;
    if (!sorted.length) {
      list.textContent = "Select a passage and save an understanding check to review it here.";
      return;
    }
    list.replaceChildren(next, ...sorted.map(card => {
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
      if (card.progress) {
        const progress = document.createElement("p");
        progress.className = "hint";
        const p = card.progress;
        progress.textContent = p.attempts + " written attempts · " + p.sourceChecks + " source reveals · " +
          p.reviews + " reviews · " + p.gotIt + " Got it · " + p.again + " Again" +
          (p.again >= 2 ? " · Worth revisiting" : "");
        details.appendChild(progress);
      }
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
    if (el("studyResume").hidden) {
      recordCurrentAttempt();
      active = null;
    }
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
    sourceChecked = true;
    el("studyEvidence").hidden = false;
    el("studyRetry").hidden = false;
    el("studyReveal").disabled = true;
    el("studyAgain").hidden = !reviewing || Boolean(parentCard);
    el("studyGotIt").hidden = !reviewing || Boolean(parentCard);
  });
  el("studyJump").addEventListener("click", () => {
    if (!active) return;
    jumpSource = true;
    el("studyResume").hidden = false;
    remember();
    dialog.close();
    host.postMessage({ type: "studyReveal", id: active.id });
  });
  el("studyRetry").addEventListener("click", () => {
    if (!pendingFeedback) retry();
  });
  el("studyOriginal").addEventListener("click", () => {
    if (!parentCard || pendingFeedback) return;
    const original = parentCard;
    retry();
    openExercise(original, reviewing);
  });
  el("studyFollowUp").addEventListener("click", () => {
    if (!followUp || !active || pendingFeedback) return;
    const question = followUp;
    retry();
    parentCard ||= { ...active, question: active.question || previousQuestion };
    el("studySave").hidden = true;
    el("studyRetry").textContent = "Retry follow-up";
    el("studyOriginal").hidden = false;
    el("studyQuestion").value = question;
    el("studyAgain").hidden = true;
    el("studyGotIt").hidden = true;
  });

  for (const [button, type] of [["studySave", "studySave"], ["studyAsk", "studyFeedback"], ["studyDraftQuestion", "studyDraftQuestion"],
    ["studyAgain", "studyRate"], ["studyGotIt", "studyRate"]]) {
    el(button).addEventListener("click", () => {
      const usesModel = type === "studyFeedback" || type === "studyDraftQuestion";
      if (!active || pendingFeedback) return;
      if (usesModel) {
        pendingFeedback = true;
        el("studyAsk").disabled = true;
        el("studyDraftQuestion").disabled = true;
        status.textContent = type === "studyFeedback" ? "Requesting feedback…" : "Drafting a question…";
      }
      host.postMessage({ type, id: active.id, question: el("studyQuestion").value,
        answer: el("studyAnswer").value, previousAnswer, previousQuestion, sourceChecked, attemptId,
        followUp: Boolean(parentCard), again: button === "studyAgain" });
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
          else {
            el("studyFeedback").textContent = message.comment + (message.evidence ? " · PDF page " +
              active.source.page + " · “" + message.evidence + "”" : "");
            followUp = message.followUp || "";
            el("studyFollowUp").hidden = !followUp;
            el("studyRetry").hidden = false;
          }
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
