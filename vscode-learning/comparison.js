"use strict";

const TERMS = /[\p{L}\p{N}]+/gu;
const COMMON = new Set("about across also an and are as at be by can compare could differ difference do does each from have how if in into is it of on or should than that the their them these they this those to us we what when where which who why will with would".split(" "));
const terms = text => (text.toLowerCase().match(TERMS) || []).filter(word => word.length > 1 && !COMMON.has(word));

function comparisonSources(documents, question) {
  const query = new Set(terms(question));
  let id = 0;
  const sources = [];
  const coverage = [];
  for (const { target, label, index, version } of documents) {
    const matches = [];
    for (const [page, words] of index.word_pages.entries()) {
      for (let start = 0; start < words.length; start += 75) {
        const slice = words.slice(start, start + 110);
        const quote = slice.map(word => word[0]).join(" ");
        const score = new Set(terms(quote).filter(term => query.has(term))).size;
        if (score) matches.push({ page: page + 1, start_word: start, end_word: start + slice.length - 1, quote, score });
      }
    }
    matches.sort((a, b) => b.score - a.score);
    const picked = [];
    const seen = new Set();
    for (const match of matches) {
      const key = match.quote.toLowerCase().replace(/\s+/g, " ").trim();
      if (seen.has(key)) continue;
      if (picked.some(previous => previous.page === match.page && previous.end_word >= match.start_word &&
        previous.start_word <= match.end_word)) continue;
      seen.add(key);
      picked.push(match);
      if (picked.length === 5) break;
    }
    coverage.push(label + ": " + picked.length + " matching excerpts" +
      (index.skipped_pages.length ? ", " + index.skipped_pages.length + " pages without text" : ""));
    for (const { page, start_word, end_word, quote } of picked) {
      sources.push({ id: "s" + (++id), page, start_word, end_word, quote, document: label,
        role: "comparison excerpt", fingerprint: index.sha256, target, version, truncated: true });
    }
  }
  return { sources, coverage };
}

module.exports = { comparisonSources };
