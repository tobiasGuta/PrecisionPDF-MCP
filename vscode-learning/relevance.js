"use strict";

// Conservative lexical relevance guard, not semantic truth verification.
// Only applies to narrowly focused user questions; broad document summaries
// remain subject to Copilot's evidence review and exact-source checks.
const STOP = new Set([
  "a","about","all","an","and","are","as","at","be","because","between","by",
  "can","could","describe","discuss","do","does","explain","find","for","from",
  "how","i","in","is","it","its","main","mention","mentions","more","of",
  "on","or","our","part","parts","pdf","please","read","reading","related",
  "say","says","show","the","their","there","these","this","those","to",
  "us","what","when","where","which","why","with","would","you","your",
  "idea","ideas","document","paper","chapter","topic","topics","summary","overview",
  "ai","artificial","intelligence","model","models","system","systems",
  "technology","technologies","learning","machine","deep"
]);

function tokens(value) {
  return String(value || "").normalize("NFKC").toLocaleLowerCase("en-US")
    .match(/[\p{L}\p{N}]+/gu) || [];
}

function focus(question) {
  const query = String(question || "").slice(0, 800).normalize("NFKC");
  // Interpretability is the meaning of this particular named concept;
  // general AI ethics/environmental topics alone don't answer it.
  if (/\bblack[\s-]+box(?:es)?\b/i.test(query)) return { type: "black-box", terms: [] };
  const quote = query.match(/["“]([^"”]{2,120})["”]|'([^']{2,120})'/);
  const subject = quote ? (quote[1] || quote[2]) : query;
  const terms = [...new Set(tokens(subject).filter(t => t.length >= 4 && !STOP.has(t)))];
  // "What is this PDF about?" or similarly broad questions have no
  // meaningful lexical anchors and must not silently become a keyword hunt.
  if (!terms.length || terms.length > 5) return { type: "general", terms: [] };
  return { type: "terms", terms };
}

function sourceAddressesTopic(question, quote) {
  const topic = focus(question);
  if (topic.type === "general") return true;
  const text = String(quote || "").normalize("NFKC").toLocaleLowerCase("en-US");
  if (topic.type === "black-box") {
    return /\bblack[\s-]+box(?:es)?\b|\b(?:opaque|opacity|interpret\w*|explain\w*|unexplain\w*|inscrutab\w*|transparen\w*|legib\w*|unpredictab\w*)\b/i.test(text) ||
      /\b(?:cannot|can't|unable to|hard to|difficult to)\s+(?:fully\s+)?(?:understand|predict|trace)\b/i.test(text);
  }
  const words = new Set(tokens(text));
  // Morphological prefix matching helps with "discrimination" /
  // "discriminatory" without trusting arbitrary model-proposed synonyms.
  return topic.terms.some(term => words.has(term) ||
    (term.length >= 6 && [...words].some(word => word.startsWith(term.slice(0, 5)))));
}

function groundedBridge(question, sourceQuote, decision) {
  if (!sourceAddressesTopic(question, sourceQuote)) return false;
  // Contradictory reviewer wording is a reason to omit a broader connection,
  // not a reason to display "directly answers" under a broader heading.
  const rhetoric = String(decision?.link || "") + " " + String(decision?.reason || "");
  if (/\b(?:directly|explicitly)\s+(?:answers?|addresses?|proves?|demonstrates?|establishes?|explains?|supports?)\b|\b(?:direct answer|conclusive proof)\b/i.test(rhetoric)) return false;
  const bridge = String(decision?.bridgeQuote || "").trim().replace(/\s+/g," ");
  const actual = String(sourceQuote || "").replace(/\s+/g," ");
  const link = String(decision?.link || "").trim();
  if (bridge.length < 10 || bridge.length > 180 || link.length < 25 || link.length > 500) return false;
  if (!actual.toLocaleLowerCase("en-US").includes(bridge.toLocaleLowerCase("en-US"))) return false;
  // The rationale must actually mention the question's topic; this is only
  // a shallow sanity check, not a semantic entailment or quality guarantee.
  const topic = focus(question);
  if (topic.type === "black-box") {
    return /\bblack[\s-]+box(?:es)?\b|\b(?:interpret\w*|explain\w*|opaque|opacity|transparen\w*|inscrutab\w*)\b/i.test(link);
  }
  if (topic.type === "terms") {
    return sourceAddressesTopic(question, link);
  }
  return true;
}

module.exports = { focus, sourceAddressesTopic, groundedBridge };
