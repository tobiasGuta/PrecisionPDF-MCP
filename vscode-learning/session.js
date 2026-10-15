"use strict";

// One in-memory discussion per opened PDF. Active evidence is page-scoped;
// prior turns remain available as bounded conversational context.
class TutorSession {
  constructor() { this.reset(); }

  reset() {
    this.page = null;
    this.passage = "";
    this.turns = [];
  }

  // Navigation updates the active page without deleting the conversation.
  setPage(page) {
    if (!Number.isSafeInteger(page) || page < 1) throw new Error("Invalid page number");
    const changed = this.page !== page;
    if (changed) {
      this.page = page;
      this.passage = "";
    }
    return { changed, page: this.page, passage: this.passage };
  }

  // A selection replaces only current evidence; past questions survive.
  prepare(page, selection) {
    const pageState = this.setPage(page);
    const incoming = String(selection || "").trim().slice(0, 2500);
    const changed = Boolean(incoming && incoming !== this.passage);
    if (incoming) this.passage = incoming;
    return { changed: pageState.changed || changed, passage: this.passage };
  }

  clearSelection() {
    this.passage = "";
  }

  history() {
    // Earlier tutor answers aren't independent documentary evidence.
    // Include each turn's actual page and selected quote for cross-page follow-ups.
    return this.turns.slice(-3).map((turn, index) => [
      "Earlier tutoring exchange " + (index + 1) + " (reference only):",
      "PDF page: " + (turn.page ?? "unknown"),
      "Selected source passage: " + (turn.passage ? JSON.stringify(turn.passage) : "(page context; no excerpt retained)"),
      "User question: " + turn.question,
      "Tutor answer (interpretation, not source evidence): " + turn.answer
    ].join("\n")).join("\n\n");
  }

  record(question, answer) {
    if (!String(answer || "").trim()) return;
    this.turns.push({
      page: this.page,
      passage: this.passage.slice(0, 1200),
      question: String(question || "").slice(0, 1500),
      answer: String(answer).slice(0, 2500)
    });
    this.turns = this.turns.slice(-3);
  }
}

module.exports = { TutorSession };
