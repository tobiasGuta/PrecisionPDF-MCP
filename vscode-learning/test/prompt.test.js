"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { buildPrompt } = require("../prompt");

test("includes bounded, page-cited document context and user question", () => {
  const text = buildPrompt({
    file: "reading.pdf", page: 4, selection: "Important passage",
    pageText: "It is important in this context", question: "What does this mean?"
  });
  assert.match(text, /Page: 4/);
  assert.match(text, /Important passage/);
  assert.match(text, /What does this mean\?/);
  assert.match(text, /untrusted reference material/);
});

test("rejects PDFs with no selectable text", () => {
  assert.throws(() => buildPrompt({ file: "scan.pdf", page: 1, question: "Explain" }), /No selectable/);
});

test("caps oversized user input and PDF material", () => {
  const result = buildPrompt({ file: "test.pdf", page: 1,
    selection: "s".repeat(8000), pageText: "c".repeat(50000), question: "q".repeat(7000) });
  assert.equal((result.match(/s/g) || []).length >= 2500, true);
  assert.ok(!result.includes("s".repeat(2501)));
  assert.ok(!result.includes("c".repeat(12001)));
  assert.ok(!result.includes("q".repeat(1501)));
});
