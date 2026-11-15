"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { comparisonSources } = require("../comparison");
const { visualContext, explainVisual } = require("../visual");

function document(label, text) {
  return { label, target: { filename: label }, version: "test", index: {
    sha256: label, word_pages: [[], text.split(" ").map(word => [word, 0, 0])], skipped_pages: [1]
  } };
}

test("comparison preserves document and word coordinates and reports missing evidence", () => {
  const docs = [document("first.pdf", "The report recommends AI oversight."),
    document("second.pdf", "The memo questions AI oversight."), document("third.pdf", "Dormant volcanoes.")];
  const { sources, coverage } = comparisonSources(docs, "How do the PDFs differ on AI oversight?");
  assert.deepEqual(sources.map(s => [s.id, s.document, s.page, s.start_word, s.end_word, s.fingerprint]),
    [["s1", "first.pdf", 2, 0, 4, "first.pdf"], ["s2", "second.pdf", 2, 0, 4, "second.pdf"]]);
  assert.match(coverage[2], /0 matching excerpts/);
});

test("visual context limits text to the neighborhood of the selected image", () => {
  const page = { width: 500, height: 800, words: [
    [100, 300, 160, 320, "Axis"], [100, 400, 160, 420, "Caption"],
    [255, 400, 285, 420, "Other panel"], [100, 700, 160, 720, "Unrelated"]
  ] };
  assert.deepEqual(visualContext(page, [.1, .3, .5, .45]), { inside: "Axis", nearby: "Caption" });
  assert.throws(() => visualContext(page, [0, 0, 2, 2]), /larger region/);
});

test("a visual answer requires an affirmative review of the exact draft", async () => {
  for (const supported of [false, true]) {
    const prompts = [];
    const explanation = "The vertical axis shows the number of responses.";
    const text = await explainVisual({ question: "What does the axis represent?", context: { inside: "Number of responses" }, page: 2,
      sendModel: async prompt => {
        prompts.push(prompt);
        return JSON.stringify(prompts.length === 1 ? { explanation } : { supported });
      }
    });
    assert.equal(text, supported ? explanation : "");
    assert.ok(prompts[1].includes(explanation));
  }
});

test("repeated boilerplate cannot consume all comparison slots for one PDF", () => {
  const doc = document("trial.pdf", "Study eligibility rules are in the report.");
  const words = doc.index.word_pages[1];
  const decisive = "Study eligibility rules required age over 65.".split(" ").map(word => [word, 0, 0]);
  doc.index.word_pages = [...Array(5).fill(words), decisive];
  const { sources } = comparisonSources([doc], "What are the study eligibility rules?");
  assert.deepEqual(sources.map(s => s.page), [1, 6]);
});
