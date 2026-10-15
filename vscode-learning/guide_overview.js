"use strict";

const { sourceAddressesTopic } = require("./relevance");

const NO_DIRECT = "No directly supported answer was identified. Optional contextual connections may be available, but they do not directly answer the question.";

function limitedWords(text, limit) {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  if (value.length <= limit) return value;
  return value.slice(0, limit).replace(/\s+\S*$/, "").trim().replace(/[,:;]+$/, "") + "…";
}

// A review-generated overview is optional. Trust only references to steps
// that actually survived review as direct. This validates provenance IDs,
// not the semantic truth of the reviewer-written summary.
function composeReviewedOverview(review, direct, question) {
  if (!direct.length) return { text: NO_DIRECT, source: "none" };
  const allowed = new Set(direct.map(step => step.evidenceId));
  const refs = review && review.overviewEvidenceIds;
  const summary = typeof review?.directOverview === "string"
    ? review.directOverview.replace(/\s+/g, " ").trim() : "";

  if (Array.isArray(refs) && refs.length === allowed.size &&
      refs.every(id => typeof id === "string" && allowed.has(id)) &&
      new Set(refs).size === allowed.size &&
      summary.length >= 35 && summary.length <= 850 &&
      !/^\s*(?:this|these|each)\s+(?:excerpt|passage|statement|quote|text)/i.test(summary) &&
      sourceAddressesTopic(question, summary)) {
    return { text: summary, source: "reviewed" };
  }

  // Fail closed to short, exact source quotations when model output is
  // missing, malformed or names evidence rejected by the reviewer.
  const samples = direct.slice(0, 3).map(step => {
    const quote = limitedWords(step.quote, 210);
    return "Page " + step.page + ': “' + quote + '”';
  });
  return {
    text: "The directly relevant passages state: " + samples.join(" "),
    source: "source-excerpts"
  };
}

module.exports = { composeReviewedOverview };
