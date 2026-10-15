"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { TutorSession } = require("../session");

test("follow-up retains its selected passage and earlier explanation", () => {
  const s = new TutorSession();
  assert.deepEqual(s.prepare(3, "black box model"), { changed: false, passage: "black box model" });
  s.record("What does it mean?", "It is hard to interpret.");
  assert.deepEqual(s.prepare(3, ""), { changed: false, passage: "black box model" });
  assert.match(s.history(), /hard to interpret/);
});

test("changing selected passage or page clears stale tutoring context", () => {
  const s = new TutorSession();
  s.prepare(3, "first");
  s.record("Explain", "one");
  assert.equal(s.prepare(3, "second").changed, true);
  assert.equal(s.history(), "");
  s.record("Explain", "two");
  assert.equal(s.prepare(4, "").changed, true);
  assert.equal(s.history(), "");
  assert.equal(s.passage, "");
});

test("retains three bounded turns only and supports manual reset", () => {
  const s = new TutorSession();
  s.prepare(2, "context");
  for (let i = 0; i < 4; i++) s.record("question" + i, "answer" + i);
  assert.equal(s.turns.length, 3);
  assert.doesNotMatch(s.history(), /answer0/);
  s.reset();
  assert.equal(s.page, null);
  assert.equal(s.history(), "");
});

test("switching passages clears existing turns before the next question", () => {
  const s = new TutorSession();
  s.prepare(3, "Old passage");
  s.record("Why?", "Old context");
  const next = s.prepare(3, "Different passage");
  assert.equal(next.changed, true);
  assert.equal(next.passage, "Different passage");
  assert.equal(s.history(), "");
  assert.equal(s.turns.length, 0);
  s.record("What's new?", "Fresh context");
  assert.doesNotMatch(s.history(), /Old context/);
});

test("new discussion clears previous context and history even on the same page", () => {
  const s = new TutorSession();
  s.prepare(2, "Earlier excerpt");
  s.record("Explain", "Old answer");
  s.reset();
  assert.deepEqual(s.prepare(2, ""), { changed: false, passage: "" });
  assert.equal(s.history(), "");
  s.record("New question", "New answer");
  assert.doesNotMatch(s.history(), /Old answer/);
});

test("reselecting the same passage preserves history", () => {
  const s = new TutorSession();
  s.prepare(5, "same words");
  s.record("Explain", "My answer");
  assert.equal(s.prepare(5, "same words").changed, false);
  assert.match(s.history(), /My answer/);
});
