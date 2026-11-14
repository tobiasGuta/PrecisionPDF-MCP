"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { attachStudy, sourceFor, schedule } = require("../study");

test("study sources preserve exact word ranges and reject invalid ranges", () => {
  const page = { page: 4, sha256: "file-version", words: [[0, 0, 0, 0, "Original"], [0, 0, 0, 0, "words."]] };
  const source = sourceFor(page, 0, 1);
  assert.equal(source.quote, "Original words.");
  assert.equal(source.fingerprint, "file-version");
  assert.equal(source.page, 4);
  assert.equal(sourceFor(page, 0, 2), null);
});

test("Got it extends review intervals and Again brings it back sooner", () => {
  const day = 86400000;
  let card = { level: 0 };
  card = schedule(card, false, 0);
  assert.equal(card.due, day);
  card = schedule(card, false, day);
  assert.equal(card.due, 4 * day);
  card = schedule(card, true, 4 * day);
  assert.equal(card.due, 4 * day + 600000);
  assert.equal(card.level, 0);
});

test("saved questions survive reopening and retain the original source", async () => {
  const storage = new Map();
  const state = { get: key => storage.get(key), update: async (key, value) => storage.set(key, value) };
  const messages = [];
  const page = { page: 1, sha256: "source", words: [[0, 0, 0, 0, "Evidence."]] };
  const options = {
    state, key: "test.pdf", send: message => messages.push(message),
    currentPage: () => page, busy: () => false, panel: { onDidDispose() {} },
    reveal: async source => messages.push({ type: "revealed", source })
  };
  const study = attachStudy(options);
  assert.equal(study.handle({ type: "studyStart", page: 1, fingerprint: "source", start: 0, end: 0 }), true);
  const draft = messages.at(-1);
  study.handle({ type: "studySave", id: draft.id, question: "What is the claim?", answer: "My explanation." });
  await new Promise(resolve => setImmediate(resolve));
  const reopened = attachStudy(options);
  reopened.handle({ type: "studyOpen" });
  const [card] = messages.at(-1).cards;
  assert.equal(card.answer, "My explanation.");
  reopened.handle({ type: "studyReveal", id: card.id });
  assert.deepEqual(messages.at(-1).source, draft.source);
});
