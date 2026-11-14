"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { authoredLink, findCaptions, referenceAt } = require("../media/references");

const line = text => text.split(" ").map(word => [word, 0, 0]);

test("figure references normalize abbreviations and preserve appendix and compound numbers", () => {
  assert.equal(referenceAt(line("See Fig. A2."), 1).label, "Figure A2");
  assert.equal(referenceAt(line("Table 2.3 shows"), 0).label, "Table 2.3");
  assert.equal(referenceAt([["Figure", 0, 0], ["2", 1, 0]], 0), null);
});

test("caption search preserves original word ranges and returns ambiguous results", () => {
  const index = { sha256: "version", word_pages: [
    line("Figure 3 shows the trend."),
    line("Fig. 3. Main result."),
    line("Figure 3: Alternate result."),
    line("Table 3: Other data.")
  ] };
  const results = findCaptions(index, "Figure 3");
  assert.equal(results.fingerprint, "version");
  assert.deepEqual(results.steps.map(step => [step.page, step.start_word, step.end_word, step.quote]), [
    [2, 0, 3, "Fig. 3. Main result."], [3, 0, 3, "Figure 3: Alternate result."]
  ]);
});

test("authored links match the reference word geometry", () => {
  const link = { from: [60, 10, 70, 22], page: 3, to: [15, 300] };
  const page = { words: [[10, 10, 20, 20, "See"], [24, 10, 56, 22, "Figure"], [60, 10, 70, 22, "3"]],
    internal_links: [link] };
  assert.equal(authoredLink(page, { start: 1, end: 2 }), link);
  assert.equal(authoredLink(page, { start: 0, end: 0 }), undefined);
});
