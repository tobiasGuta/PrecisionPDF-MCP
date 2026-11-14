"use strict";

const referencePattern = /^(fig(?:ure)?\.?|table)\s*([a-z]?\d+(?:[.\-]\d+)*(?:[a-z])?)(?:\([a-z]\))?([.:,;!?–—)\]]*)$/i;
const captionSeparator = /^[.:–—-]$/;

function referenceAt(rows, index) {
  const [word, block, line] = rows[index];
  const next = rows[index + 1];
  const sameLine = next && next[1] === block && next[2] === line;
  const own = word.match(referencePattern);
  const match = own || (sameLine && (word + " " + next[0]).match(referencePattern));
  if (!match) return null;
  const kind = match[1].toLowerCase().startsWith("fig") ? "Figure" : "Table";
  return { label: kind + " " + match[2].toUpperCase(), start: index,
    end: own ? index : index + 1, punctuation: match[3] };
}

function lineStart(rows, index) {
  const prev = rows[index - 1];
  return !prev || prev[1] !== rows[index][1] || prev[2] !== rows[index][2];
}

function captionAt(rows, index) {
  if (!lineStart(rows, index)) return null;
  const ref = referenceAt(rows, index);
  if (!ref) return null;
  const next = rows[ref.end + 1];
  const standalone = !next || lineStart(rows, ref.end + 1);
  if (!standalone && !/^[.:–—]/.test(ref.punctuation) && !captionSeparator.test(next[0])) return null;
  let end = ref.end;
  while (end + 1 < rows.length && end - index < 30 && !lineStart(rows, end + 1)) end++;
  return { label: ref.label, start_word: index, end_word: end,
    quote: rows.slice(index, end + 1).map(row => row[0]).join(" ") };
}

function pageReferences(page) {
  return page.words.map((word, i) => [word[4], ...(page.word_lines?.[i] || [0, 0])]);
}

function authoredLink(page, reference) {
  const words = page.words.slice(reference.start, reference.end + 1);
  return (page.internal_links || []).find(({ from }) => words.some(([x0, y0, x1, y1]) =>
    (x0 + x1) / 2 >= from[0] && (x0 + x1) / 2 <= from[2] &&
    (y0 + y1) / 2 >= from[1] && (y0 + y1) / 2 <= from[3]));
}

function findCaptions(index, label) {
  const steps = [];
  for (const [p, rows] of index.word_pages.entries()) {
    for (let i = 0; i < rows.length; i++) {
      const caption = captionAt(rows, i);
      if (caption?.label === label) steps.push({ ...caption, page: p + 1 });
    }
  }
  return { type: "reference", fingerprint: index.sha256, steps };
}

const references = { referenceAt, captionAt, pageReferences, authoredLink, findCaptions };
if (typeof module !== "undefined" && module.exports) module.exports = references;
else globalThis.precisionPDFReferences = references;
