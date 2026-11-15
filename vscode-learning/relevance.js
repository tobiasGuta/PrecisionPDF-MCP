"use strict";

function edgeWord(word, index, length) {
  if (index === 0) word = word.replace(/^["'“‘(\[]+/, "");
  if (index === length - 1) word = word.replace(/[.,;:!?"'”’)\]]+$/, "");
  return word;
}

// Undefined means no match. Null means more than one occurrence.
function quoteOffset(words, needle, normalizeEdges = false) {
  let offset;
  for (let i = 0; i <= words.length - needle.length; i++) {
    const match = needle.every((word, j) => {
      const original = words[i + j];
      if (word === original) return true;
      if (!normalizeEdges) return false;
      const normalized = edgeWord(word, j, needle.length);
      return Boolean(normalized) && normalized === edgeWord(original, j, needle.length);
    });
    if (!match) continue;
    if (offset !== undefined) return null;
    offset = i;
  }
  return offset;
}

// A contextual explanation must cite text actually present in the source.
function groundedBridge(sourceQuote, decision) {
  const bridge = String(decision?.bridgeQuote || "").trim().replace(/\s+/g, " ");
  const actual = String(sourceQuote || "").replace(/\s+/g, " ");
  const link = String(decision?.link || "").trim();
  if (bridge.length < 10 || link.length < 25 || !actual.includes(bridge)) return false;
  return !/\b(?:directly|explicitly)\s+(?:answers?|addresses?|proves?|demonstrates?|establishes?|explains?|supports?)\b|\b(?:direct answer|conclusive proof)\b/i.test(link + " " + String(decision?.reason || ""));
}

module.exports = { groundedBridge, quoteOffset };
