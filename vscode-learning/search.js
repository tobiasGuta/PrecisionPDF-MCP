"use strict";

// Deterministic whole-document search. This does not call a model and never
// trusts the model to invent coordinates, matches or PDF evidence.
const MAX_VISIBLE_MATCHES = 150;
const MAX_QUERY_WORDS = 12;

function normalizeWord(value) {
  return String(value).normalize("NFKC").toLocaleLowerCase("en-US")
    .replace(/^[“”"‘’([{]+|[“”"‘’")\]},.!?;:]+$/gu, "");
}

function extractPhrase(question, mode = "auto") {
  const q = String(question || "").trim().slice(0, 800);
  if (mode === "exact") {
    const literal = q.replace(/^(?:"([^"]+)"|“([^”]+)”|'([^']+)')$/, (_, a, b, c) => a || b || c);
    return literal.length <= 120 && literal.split(/\s+/).length <= MAX_QUERY_WORDS ? literal : "";
  }
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
    if (!phrase) throw new Error("Use an exact phrase of up to 12 words and 120 characters.");
    return { kind: "exact", phrase };
  }
  const hasLocationIntent = /\b(?:where|which\s+pages?|what\s+pages?|find|locate|mentions?|occurrences?|instances?|appears?|search)\b/i.test(text);
  if (hasLocationIntent && phrase) return { kind: "exact", phrase };
  // A quoted phrase by itself is an explicit literal-search request.
  if (/^(?:"[^"]+"|“[^”]+”|'[^']+')$/.test(text) && phrase) {
    return { kind: "exact", phrase };
  }
  // A bare search term should behave like Ctrl+F rather than uploading the
  // whole document to a model. Only a short noun-like phrase qualifies;
  // questions and explanatory commands keep the Copilot path.
  const bare = text.replace(/[?.!]+$/g, "").trim();
  const words = bare.split(/\s+/);
  const isPlainPhrase = words.length >= 1 && words.length <= 4 &&
    bare.length <= 80 && /^[\p{L}\p{N}][\p{L}\p{N}\s-]*$/u.test(bare) &&
    !/\b(?:explain|explaining|summarize|summary|overview|describe|compare|tell|show|why|what|where|when|how|who|which|can|could|should|would|please|find|locate|search|mention|discuss|main|ideas|all)\b/i.test(bare);
  return isPlainPhrase
    ? { kind: "exact", phrase: bare }
    : { kind: "guided", phrase: "" };
}

function findText(index, phrase, limit = MAX_VISIBLE_MATCHES) {
  const needle = String(phrase).trim().split(/\s+/).map(normalizeWord);
  if (needle.some(word => !word)) throw new Error("Enter a valid phrase.");
  const steps = [];
  let totalMatches = 0;
  let pageCount = 0;
  index.word_pages.forEach((rows, pageIndex) => {
    const page = pageIndex + 1;
    const words = rows.map(row => row[0]);
    const section = index.sections.findLast(item => item.page <= page)?.title || "";
    const folded = words.map(normalizeWord);
    const joined = new Map();
    for (let i = 0; i + 1 < words.length; i++) {
      if (/\p{L}[-\u00ad]$/u.test(words[i]) && rows[i][1] === rows[i + 1][1] &&
          rows[i][2] !== rows[i + 1][2] && /^\p{L}/u.test(words[i + 1])) {
        joined.set(i, [normalizeWord(words[i].slice(0, -1) + words[i + 1]),
          normalizeWord(words[i].replace(/\u00ad$/, "") + words[i + 1])]);
      }
    }
    let pageHasMatch = false;
    for (let start = 0; start < words.length; start++) {
      let end = start;
      let matched = 0;
      for (const word of needle) {
        if (folded[end] === word) end++;
        else if (joined.get(end)?.includes(word)) end += 2;
        else break;
        matched++;
      }
      if (matched !== needle.length) continue;
      end--;
      if (!pageHasMatch) { pageHasMatch = true; pageCount++; }
      totalMatches++;
      if (steps.length >= limit) continue;
      steps.push({
        evidenceId: "exact-p" + page + "-w" + start, page,
        start_word: start, end_word: end, quote: words.slice(start, end + 1).join(" "),
        context: words.slice(Math.max(0, start - 8), end + 10).join(" "),
        section
      });
    }
  });
  const skipped = index.skipped_pages.length;
  const coverage = "Searched " + (index.pages - skipped) + " of " + index.pages +
    " pages" + (skipped ? " · " + skipped + " without selectable text skipped" : "");
  return { type: "exact", fingerprint: index.sha256, steps, pageCount, totalMatches,
    shownMatches: steps.length, overview: coverage + "." };
}

function findExactMentions(index, phrase, limit = MAX_VISIBLE_MATCHES) {
  if (index?.complete && Array.isArray(index.word_pages)) return findText(index, phrase, limit);
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

function findDefinitions(index, phrase) {
  const term = phrase.trim();
  const needle = term.split(/\s+/).map(normalizeWord);
  const steps = [];
  const marker = /^(?:means|refers to|is defined as|denotes|stands for|is a[n]?)$/i;
  const acronym = /^[A-Z][A-Z0-9]{1,9}$/.test(term);
  for (const [p, rows] of index.word_pages.entries()) {
    const tokens = rows.map(row => row[0]);
    const folded = tokens.map(normalizeWord);
    for (let i = 0; i <= tokens.length - needle.length; i++) {
      if (!needle.every((word, j) => folded[i + j] === word && rows[i + j][1] === rows[i][1])) continue;
      const after = i + needle.length;
      const following = [];
      if (!/[.!?]["'”’)]*$/.test(tokens[after - 1])) {
        for (let j = after; j < after + 3 && rows[j]?.[1] === rows[i][1]; j++) following.push(folded[j]);
      }
      const hasMarker = [1, 2, 3].some(n => marker.test(following.slice(0, n).join(" ")));
      const expansion = acronym && i >= term.length && tokens[i] === "(" + term + ")" &&
        rows[i - term.length][1] === rows[i][1] &&
        tokens.slice(i - term.length, i).map(word => word[0]?.toUpperCase()).join("") === term;
      if (!hasMarker && !expansion) continue;
      const start = expansion ? i - term.length : i;
      let end = i + needle.length - 1;
      while (end + 1 < rows.length && end - start < 44 && rows[end + 1][1] === rows[i][1] &&
          !/[.!?]["'”’)]*$/.test(tokens[end])) end++;
      steps.push({ page: p + 1, start_word: start, end_word: end, quote: tokens.slice(start, end + 1).join(" ") });
      if (steps.length === 8) return { type: "definition", fingerprint: index.sha256, steps };
    }
  }
  return { type: "definition", fingerprint: index.sha256, steps };
}

module.exports = { normalizeWord, extractPhrase, resolveQuery, findExactMentions, findDefinitions, MAX_VISIBLE_MATCHES };
