"use strict";

// Deterministic whole-document search. This does not call a model and never
// trusts the model to invent coordinates, matches or PDF evidence.
const MAX_VISIBLE_MATCHES = 150;
const MAX_QUERY_WORDS = 12;

function normalizeWord(value) {
  return String(value).normalize("NFKC").toLocaleLowerCase("en-US")
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
}

function extractPhrase(question, mode = "auto") {
  const q = String(question || "").trim().slice(0, 800);
  const quoted = q.match(/["“]([^"”]+)["”]|'([^']+)'/);
  let phrase = quoted ? (quoted[1] || quoted[2]) : "";
  if (!phrase) {
    const patterns = [
      /\b(?:mentions?|occurrences?|instances?|matches?)\s+(?:of|for)\s+(.+)$/i,
      /\bmentions?\s+(?:the\s+)?(?:exact\s+)?(?:(?:term|phrase|words?)\s+)?(.+)$/i,
      /\bfind\s+(?:all\s+)?(?:the\s+)?(?:exact\s+)?(?:(?:term|phrase|words?)\s+)?(.+)$/i
    ];
    for (const pattern of patterns) {
      const hit = q.match(pattern);
      if (hit) { phrase = hit[1]; break; }
    }
  }
  if (mode === "exact" && !phrase) phrase = q;
  phrase = phrase.replace(/[?.!,\s]+$/g, "").replace(/^[\s"'“”‘’]+|[\s"'“”‘’]+$/g, "").trim();
  // Avoid treating generic concepts like "discuss safety" as exact-word requests.
  if (phrase && /\b(?:discuss(?:es|ed|ing)?|explain(?:s|ed)?|related\s+to)\b/i.test(phrase)) return "";
  const words = phrase.split(/\s+/).filter(Boolean);
  return words.length && words.length <= MAX_QUERY_WORDS && phrase.length <= 120 ? phrase : "";
}

function resolveQuery(question, approach = "auto") {
  if (!["auto", "exact", "guided"].includes(approach)) throw new Error("Unknown search mode.");
  const text = String(question || "").trim();
  if (!text) throw new Error("Enter a question about this PDF.");
  if (approach === "guided") return { kind: "guided", phrase: "" };
  const phrase = extractPhrase(text, approach);
  if (approach === "exact") {
    if (!phrase) throw new Error("Use a short exact phrase (up to 12 words), such as black box.");
    return { kind: "exact", phrase };
  }
  const hasLocationIntent = /\b(?:where|which\s+pages?|what\s+pages?|find|locate|mentions?|occurrences?|instances?|appears?|search)\b/i.test(text);
  return (hasLocationIntent && phrase)
    ? { kind: "exact", phrase }
    : { kind: "guided", phrase: "" };
}

function findExactMentions(index, phrase, limit = MAX_VISIBLE_MATCHES) {
  if (!index || index.complete !== true || !/^[0-9a-f]{64}$/.test(index.sha256 || "") ||
      !Number.isSafeInteger(index.pages) || index.pages < 1 ||
      !Array.isArray(index.page_word_counts) || index.page_word_counts.length !== index.pages ||
      !Array.isArray(index.excerpts) || index.excerpts.length > 1600) {
    throw new Error("Incomplete PDF evidence index.");
  }
  const needle = String(phrase || "").trim().split(/\s+/).map(normalizeWord);
  if (!needle.length || needle.length > MAX_QUERY_WORDS || needle.some(word => !word) ||
      !Number.isSafeInteger(limit) || limit < 1 || limit > MAX_VISIBLE_MATCHES) {
    throw new Error("Enter a short, valid exact phrase.");
  }
  const pages = Array.from({length: index.pages}, () => []);
  const hints = Array.from({length: index.pages}, () => []);
  const ordered = [...index.excerpts].sort((a, b) => a.page - b.page || a.start_word - b.start_word);
  for (const excerpt of ordered) {
    if (!excerpt || !/^p\d+-w\d+$/.test(excerpt.id) ||
        !Number.isSafeInteger(excerpt.page) || excerpt.page < 1 || excerpt.page > index.pages ||
        !Number.isSafeInteger(excerpt.start_word) || !Number.isSafeInteger(excerpt.end_word) ||
        excerpt.start_word < 0 || excerpt.end_word < excerpt.start_word ||
        excerpt.id !== "p" + excerpt.page + "-w" + excerpt.start_word ||
        typeof excerpt.text !== "string" || !excerpt.text.trim()) {
      throw new Error("Invalid PDF evidence range.");
    }
    const pageWords = pages[excerpt.page - 1];
    if (excerpt.start_word !== pageWords.length) throw new Error("PDF index is missing or overlapping words; search refused.");
    const tokens = excerpt.text.split(/\s+/);
    if (tokens.length !== excerpt.end_word - excerpt.start_word + 1) {
      throw new Error("PDF evidence word count is inconsistent.");
    }
    for (const token of tokens) {
      pageWords.push(token);
      hints[excerpt.page - 1].push({
        context: excerpt.text,
        section: typeof excerpt.section === "string" ? excerpt.section.slice(0, 140) : ""
      });
    }
  }
  for (let p = 0; p < pages.length; p++) {
    if (!Number.isSafeInteger(index.page_word_counts[p]) ||
        pages[p].length !== index.page_word_counts[p]) {
      throw new Error("PDF evidence index does not cover every word; search refused.");
    }
  }
  let total = 0;
  const matches = [];
  const hitPages = new Set();
  for (let p = 0; p < pages.length; p++) {
    const tokens = pages[p];
    const folded = tokens.map(normalizeWord);
    for (let i = 0; i <= folded.length - needle.length; i++) {
      if (!needle.every((word, j) => folded[i + j] === word)) continue;
      total++;
      hitPages.add(p + 1);
      if (matches.length >= limit) continue;
      const quote = tokens.slice(i, i + needle.length).join(" ");
      const surrounding = tokens.slice(Math.max(0, i - 8), Math.min(tokens.length, i + needle.length + 12)).join(" ");
      matches.push({
        evidenceId: "exact-p" + (p + 1) + "-w" + i,
        page: p + 1, start_word: i, end_word: i + needle.length - 1,
        quote, context: surrounding.slice(0, 500), section: hints[p][i].section,
        explanation: "Exact wording found on PDF page " + (p + 1) + "."
      });
    }
  }
  return {
    type: "exact", phrase, fingerprint: index.sha256, pages: index.pages,
    totalMatches: total, pageCount: hitPages.size, shownMatches: matches.length,
    overview: total
      ? "Found " + total + " exact " + (total === 1 ? "occurrence" : "occurrences") +
        " of “" + phrase + "” on " + hitPages.size + " PDF " + (hitPages.size === 1 ? "page" : "pages") +
        (total > matches.length ? ". Showing the first " + matches.length + " matches." : ".")
      : "No exact occurrences of “" + phrase + "” in the indexed PDF. Try Guided explanation for related ideas.",
    steps: matches
  };
}

module.exports = { normalizeWord, extractPhrase, resolveQuery, findExactMentions, MAX_VISIBLE_MATCHES };
