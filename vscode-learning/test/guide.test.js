"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { prepareBatches, readModelJson, generateGuide } = require("../guide");

function fakeIndex() {
  return { pages: 2, complete: true, sha256: "a".repeat(64), page_word_counts: [8, 5],
    excerpts: [
      { id: "p1-w0", page: 1, start_word: 0, end_word: 7, text: "Neural networks are opaque and difficult to explain." },
      { id: "p2-w0", page: 2, start_word: 0, end_word: 4, text: "Interpretability methods can help researchers." }
    ] };
}

test("batches preserve exact source identifiers and pages", () => {
  const batches = prepareBatches(fakeIndex());
  assert.equal(batches.length, 1);
  assert.match(batches[0], /p1-w0 \[PDF page 1\]/);
  assert.match(batches[0], /p2-w0 \[PDF page 2\]/);
});

test("rejects incomplete, duplicate, and invalid coordinates", () => {
  const idx = fakeIndex(); idx.complete = false;
  assert.throws(() => prepareBatches(idx), /Incomplete/);
  idx.complete = true; idx.excerpts.push({ ...idx.excerpts[0] });
  assert.throws(() => prepareBatches(idx), /duplicate/);
  idx.excerpts.pop(); idx.excerpts[0].end_word = 100;
  assert.throws(() => prepareBatches(idx), /Invalid/);
});

test("rejects unstructured text and accepts complete JSON fences", () => {
  assert.deepEqual(readModelJson('```json\n{"findings":[]}\n```'), {findings: []});
  assert.throws(() => readModelJson("sorry, no JSON today"), /structured/);
  assert.throws(() => readModelJson('{"findings":[]} and extra'), /structured/);
});

test("generates only anchored guide steps, filtering invented or duplicated IDs", async () => {
  const prompts = [];
  const model = async prompt => {
    prompts.push(prompt);
    if (prompts.length === 1) return JSON.stringify({ findings: [
      { evidenceId: "p1-w0", idea: "Neural networks are opaque" },
      { evidenceId: "p2-w0", idea: "There are interpretability methods" },
      { evidenceId: "p99-w0", idea: "Fake invented reference" } ] });
    return JSON.stringify({ overview: "An overview", steps: [
      { evidenceId: "p1-w0", explanation: "Researchers can't explain some results." },
      { evidenceId: "p1-w0", explanation: "Duplicate" },
      { evidenceId: "p99-w0", explanation: "Fake" },
      { evidenceId: "p2-w0", explanation: "Methods help clarify." }
    ] });
  };
  const result = await generateGuide({ index: fakeIndex(), question: "What's this about?", sendModel: model });
  assert.equal(prompts.length, 2);
  assert.equal(result.steps.length, 2);
  assert.deepEqual(result.steps.map(e => e.page), [1,2]);
  assert.deepEqual(result.steps.map(e => e.evidenceId), ["p1-w0", "p2-w0"]);
  assert.equal(result.steps[0].start_word, 0);
  assert.equal(result.fingerprint, "a".repeat(64));
});

test("fails closed when model returns no grounded references", async () => {
  await assert.rejects(generateGuide({ index: fakeIndex(), question: "overview",
    sendModel: async () => '{"findings":[{"evidenceId":"p404-w0","idea":"Invented"}]}' }), /No verifiable/);
});

test("synthesis cannot insert new evidence identifiers", async () => {
  let n = 0;
  await assert.rejects(generateGuide({ index: fakeIndex(), question: "overview",
    sendModel: async () => ++n === 1 ? '{"findings":[{"evidenceId":"p1-w0","idea":"Useful"}]}' :
      '{"overview":"Thing","steps":[{"evidenceId":"p404-w0","explanation":"Unverified"}]}' }), /did not cite any verified/);
});
