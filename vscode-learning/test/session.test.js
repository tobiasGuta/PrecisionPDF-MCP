"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { TutorSession } = require("../session");
const { buildPrompt } = require("../prompt");

test("follow-up on same passage retains earlier question and response", () => {
  const s = new TutorSession();
  s.prepare(3, "black box model");
  s.record("What does that mean?", "It is difficult to interpret.");
  assert.deepEqual(s.prepare(3, ""), { changed: false, passage: "black box model" });
  assert.match(s.history(), /PDF page: 3/);
  assert.match(s.history(), /black box model/);
  assert.match(s.history(), /difficult to interpret/);
});

test("switching PDF pages preserves history but clears stale active passage", () => {
  const s = new TutorSession();
  s.prepare(3, "deep learning black box");
  s.record("Explain the black box.", "Neural network decisions can be opaque.");
  assert.deepEqual(s.setPage(4), { changed: true, page: 4, passage: "" });
  assert.equal(s.passage, "");
  assert.equal(s.turns.length, 1);
  assert.match(s.history(), /PDF page: 3/);
  assert.match(s.history(), /deep learning black box/);
  const next = s.prepare(4, "");
  assert.deepEqual(next, { changed: false, passage: "" });
  s.record("How does this compare?", "Different issues are discussed.");
  const history = s.history();
  assert.match(history, /PDF page: 3/);
  assert.match(history, /PDF page: 4/);
  assert.match(history, /How does this compare/);
  assert.match(buildPrompt({ file: "reading.pdf", page: 4, selection: s.passage,
    pageText: "Page four is about algorithmic bias.", question: "Compare to page three" }), /Page: 4/);
});

test("returning to an earlier page retains chat but doesn't silently restore old selection", () => {
  const s = new TutorSession();
  s.prepare(3, "Page three quote");
  s.record("Explain", "An explanation");
  s.setPage(4);
  s.prepare(4, "Page four quote");
  s.record("Compare", "A comparison");
  s.setPage(3);
  assert.equal(s.passage, "");
  assert.equal(s.turns.length, 2);
  assert.match(s.history(), /Page three quote/);
  assert.match(s.history(), /Page four quote/);
});

test("selecting a new passage changes active evidence but keeps previous discussion", () => {
  const s = new TutorSession();
  s.prepare(3, "first quote");
  s.record("Explain first", "first analysis");
  const next = s.prepare(3, "second quote");
  assert.equal(next.changed, true);
  assert.equal(next.passage, "second quote");
  assert.match(s.history(), /first quote/);
  s.record("Explain second", "second analysis");
  assert.match(s.history(), /second quote/);
  assert.equal(s.turns.length, 2);
});

test("clear selection removes active quote but not discussion", () => {
  const s = new TutorSession();
  s.prepare(5, "quote");
  s.record("Explain", "answer");
  s.clearSelection();
  assert.equal(s.passage, "");
  assert.match(s.history(), /quote/);
});

test("new discussion clears history and active passage", () => {
  const s = new TutorSession();
  s.prepare(2, "Earlier excerpt");
  s.record("Explain", "Old answer");
  s.reset();
  assert.deepEqual(s.prepare(2, ""), { changed: true, passage: "" });
  assert.equal(s.history(), "");
  assert.equal(s.turns.length, 0);
});

test("retains three bounded turns with page references only", () => {
  const s = new TutorSession();
  s.prepare(1, "quote");
  for(let i=0;i<4;i++)s.record("q"+i, "a"+i);
  assert.equal(s.turns.length, 3);
  assert.doesNotMatch(s.history(), /Tutor answer.*a0/);
  assert.match(s.history(), /PDF page: 1/);
  s.record("too long", "a".repeat(10000));
  assert.equal(s.turns.at(-1).answer.length, 2500);
});

test("reselecting the same passage leaves session intact", () => {
  const s = new TutorSession();
  s.prepare(5,"same words");
  s.record("Explain","My answer");
  assert.equal(s.prepare(5,"same words").changed,false);
  assert.match(s.history(), /My answer/);
});

test("session does not accept invalid page identifiers", () => {
  const s = new TutorSession();
  assert.throws(() => s.setPage(0), /Invalid page/);
  assert.throws(() => s.setPage("3"), /Invalid page/);
});
