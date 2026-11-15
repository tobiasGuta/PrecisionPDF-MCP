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

test("attempts, source reveals, and ratings survive reopen as separate counts", async () => {
  const storage = new Map();
  const messages = [];
  const options = {
    state: { get: key => storage.get(key), update: async (key, value) => storage.set(key, value) },
    key: "progress.pdf", send: message => messages.push(message), busy: () => false,
    currentPage: () => ({ page: 1, sha256: "hash", words: [[0, 0, 30, 20, "Evidence"]] }),
    panel: { onDidDispose() {} }
  };
  const study = attachStudy(options);
  study.handle({ type: "studyStart", page: 1, fingerprint: "hash", start: -1, end: -1 });
  const { id } = messages.at(-1);
  study.handle({ type: "studyRecord", id, attemptId: "first", answer: "Initial attempt", sourceChecked: true });
  study.handle({ type: "studySave", id, attemptId: "second", question: "What is the claim?", answer: "Revision" });
  await new Promise(resolve => setImmediate(resolve));
  const reopened = attachStudy(options);
  const review = { type: "studyRate", id, attemptId: "third", answer: "", sourceChecked: true, again: true };
  reopened.handle(review);
  reopened.handle(review);
  await new Promise(resolve => setImmediate(resolve));
  reopened.handle({ type: "studyOpen" });
  assert.deepEqual(messages.at(-1).cards[0].progress, { attempts: 2, sourceChecks: 2, reviews: 1, again: 1, gotIt: 0 });
});

test("study feedback omits unsupported excerpts and rejects malformed responses", () => {
  const { parseFeedback } = require("../study");
  const source = { quote: "Rain fell on Tuesday." };
  assert.equal(parseFeedback('{"comment":"Look at the day.","evidence":"on Tuesday","followUp":"When did it rain?"}', source).evidence, "on Tuesday");
  assert.equal(parseFeedback('{"comment":"No rain in March.","evidence":"March","followUp":"When?"}', source).followUp, undefined);
  assert.throws(() => parseFeedback("invalid", source), /structured/);
});

test("study feedback checks consent and the source before asking the model", async () => {
  const messages = [];
  let approved;
  let stale = false;
  let lookups = 0;
  const study = attachStudy({
    state: { get: () => [], update: async () => {} }, key: "study.pdf",
    currentPage: () => ({ page: 1, sha256: "old", words: [[0, 0, 1, 1, "Evidence."]] }),
    send: message => messages.push(message), busy: () => false, panel: { onDidDispose() {} },
    checkSource: async () => { if (stale) throw new Error("PDF changed"); },
    vscode: {
      window: { showWarningMessage: async () => approved },
      lm: { selectChatModels: async () => { lookups++; return []; } },
      CancellationTokenSource: class { token = {}; dispose() {} }
    }
  });
  study.handle({ type: "studyStart", page: 1, fingerprint: "old", start: -1, end: -1 });
  const request = { type: "studyFeedback", id: messages.at(-1).id, question: "What follows?", answer: "My attempt." };
  study.handle(request);
  await new Promise(resolve => setImmediate(resolve));
  assert.match(messages.at(-1).message, /cancelled/);
  approved = "Send to Copilot";
  stale = true;
  study.handle(request);
  await new Promise(resolve => setImmediate(resolve));
  assert.match(messages.at(-1).message, /PDF changed/);
  assert.equal(lookups, 0);
  stale = false;
  study.handle(request);
  await new Promise(resolve => setImmediate(resolve));
  assert.match(messages.at(-1).message, /No Copilot/);
});

test("adaptive feedback can use a prior attempt and drops a follow-up the assessor rejects", async () => {
  const messages = [];
  const prompts = [];
  const model = {
    maxInputTokens: 20000,
    countTokens: async () => 100,
    sendRequest: async ([prompt]) => {
      prompts.push(prompt);
      const response = prompts.length === 1
        ? { comment: "Specify when the event occurred.", evidence: "on Tuesday", followUp: "What happened the following week?" }
        : { feedbackSupported: true, followUpSupported: false };
      return { text: (async function* () { yield JSON.stringify(response); })() };
    }
  };
  const study = attachStudy({
    state: { get: () => [] }, key: "feedback.pdf",
    currentPage: () => ({ page: 1, sha256: "hash", words: "Rain fell on Tuesday.".split(" ").map(word => [0, 0, 1, 1, word]) }),
    send: message => messages.push(message), busy: () => false, panel: { onDidDispose() {} },
    vscode: {
      window: { showWarningMessage: async () => "Send to Copilot" },
      lm: { selectChatModels: async () => [model] },
      LanguageModelChatMessage: { User: text => text },
      CancellationTokenSource: class { token = {}; dispose() {} }
    }
  });
  study.handle({ type: "studyStart", page: 1, fingerprint: "hash", start: -1, end: -1 });
  study.handle({ type: "studyFeedback", id: messages.at(-1).id, question: "What happened?",
    answer: "It rained.", previousAnswer: "It was dry.", previousQuestion: "What happened?" });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(prompts.length, 2);
  assert.match(prompts[0], /It was dry/);
  assert.equal(messages.at(-1).type, "study-feedback");
  assert.equal(messages.at(-1).evidence, "on Tuesday");
  assert.equal(messages.at(-1).followUp, "");
});
