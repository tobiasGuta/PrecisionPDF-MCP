"use strict";

// A contextual explanation must cite text actually present in the source.
function groundedBridge(sourceQuote, decision) {
  const bridge = String(decision?.bridgeQuote || "").trim().replace(/\s+/g, " ");
  const actual = String(sourceQuote || "").replace(/\s+/g, " ");
  const link = String(decision?.link || "").trim();
  if (bridge.length < 10 || link.length < 25 || !actual.includes(bridge)) return false;
  return !/\b(?:directly|explicitly)\s+(?:answers?|addresses?|proves?|demonstrates?|establishes?|explains?|supports?)\b|\b(?:direct answer|conclusive proof)\b/i.test(link + " " + String(decision?.reason || ""));
}

module.exports = { groundedBridge };
