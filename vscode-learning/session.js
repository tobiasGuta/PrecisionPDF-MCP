"use strict";

// Keep only recent, explicitly requested tutoring turns. No disk persistence.
class TutorSession {
  constructor() { this.reset(); }

  reset() {
    this.page = null;
    this.passage = "";
    this.turns = [];
  }

  prepare(page, selection) {
    const incoming = String(selection || "").trim().slice(0, 2500);
    const changed = this.page !== null &&
      (page !== this.page || Boolean(incoming && incoming !== this.passage));
    if (changed) this.reset();
    this.page = page;
    if (incoming) this.passage = incoming;
    return { changed, passage: this.passage };
  }

  history() {
    // Max 3 bounded prior question/answer pairs, quoted as context rather than instructions.
    return this.turns.slice(-3).map((turn, index) => [
      "Earlier tutoring exchange " + (index + 1) + " (reference only):",
      "User question: " + turn.question.slice(0, 1500),
      "Tutor answer: " + turn.answer.slice(0, 2500)
    ].join("\n")).join("\n\n");
  }

  record(question, answer) {
    if (!String(answer || "").trim()) return;
    this.turns.push({ question: String(question).slice(0, 1500), answer: String(answer).slice(0, 2500) });
    this.turns = this.turns.slice(-3);
  }
}

module.exports = { TutorSession };
