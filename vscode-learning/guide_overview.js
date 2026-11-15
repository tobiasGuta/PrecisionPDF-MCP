"use strict";

const NO_DIRECT = "No directly supported answer was identified. Optional contextual connections may be available, but they do not directly answer the question.";

// Show the assessed draft only when its evidence survived review.
function composeReviewedOverview(draft, review, direct) {
  if (!direct.length) return { text: NO_DIRECT, source: "none" };
  const allowed = new Set(direct.map(step => step.evidenceId));
  const refs = review && review.overviewEvidenceIds;
  const summary = typeof draft === "string" ? draft.trim() : "";

  if (review?.overviewSupported === true && Array.isArray(refs) && refs.length === allowed.size &&
      refs.every(id => typeof id === "string" && allowed.has(id)) &&
      new Set(refs).size === allowed.size &&
      summary.length >= 35 && summary.length <= 850 &&
      !/^\s*(?:this|these|each)\s+(?:excerpt|passage|statement|quote|text)/i.test(summary)) {
    return { text: summary, source: "reviewed" };
  }

  // Keep excerpts whole so the fallback cannot cut off a qualification.
  const samples = direct.filter(step => step.quote.length <= 850).slice(0, 3)
    .map(step => "Page " + step.page + ': “' + step.quote + '”');
  return {
    text: samples.length ? "The directly relevant passages state: " + samples.join(" ")
      : "See the reviewed source passages in the guide.",
    source: "source-excerpts"
  };
}

module.exports = { composeReviewedOverview };
