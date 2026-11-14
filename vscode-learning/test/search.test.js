"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { extractPhrase, resolveQuery, findExactMentions } = require("../search");

const index = () => ({
  complete: true, sha256: "a".repeat(64), pages: 2,
  page_word_counts: [12, 6],
  excerpts: [
    { id:"p1-w0", page:1, start_word:0, end_word:4,
      text:"Deep learning is a black", section:"Reading One" },
    { id:"p1-w5", page:1, start_word:5, end_word:11,
      text:"box. Another Black BOX. The black box.", section:"Reading One" },
    { id:"p2-w0", page:2, start_word:0, end_word:5,
      text:"Here the black box is discussed.", section:"Reading Two" }
  ]
});

test("query-aware routing: quoted locations are exact; explanations remain guided", () => {
  assert.deepEqual(resolveQuery('in what parts it mention the "black box"'), {kind:"exact",phrase:"black box"});
  assert.deepEqual(resolveQuery("Find all mentions of black box"), {kind:"exact",phrase:"black box"});
  assert.deepEqual(resolveQuery("What are the main ideas of this PDF?"), {kind:"guided",phrase:""});
  assert.deepEqual(resolveQuery('Explain why researchers say "black box"'), {kind:"guided",phrase:""});
  assert.deepEqual(resolveQuery("Where does it discuss safety?"), {kind:"guided",phrase:""});
});

test("user can explicitly override auto classification", () => {
  assert.deepEqual(resolveQuery("black box","exact"), {kind:"exact",phrase:"black box"});
  assert.deepEqual(resolveQuery('where is "black box" mentioned?', "guided"), {kind:"guided",phrase:""});
  assert.throws(() => resolveQuery("anything","invalid"), /Unknown/);
  assert.equal(extractPhrase("Which pages mention 'black box'?"), "black box");
});

test("exact search spans sentence excerpt boundaries and covers every PDF page", () => {
  const result = findExactMentions(index(), "black box");
  assert.equal(result.totalMatches, 4);
  assert.equal(result.pageCount, 2);
  assert.deepEqual(result.steps.map(s => [s.page,s.start_word,s.end_word]), [
    [1,4,5],[1,7,8],[1,10,11],[2,2,3]
  ]);
  assert.equal(result.steps[0].quote, "black box.");
  assert.equal(result.steps[0].section,"Reading One");
  assert.equal(result.steps.at(-1).section,"Reading Two");
  assert.equal(result.fingerprint,"a".repeat(64));
});

test("result limits do not truncate the reported exhaustive match count", () => {
  const result = findExactMentions(index(), "black box", 2);
  assert.equal(result.totalMatches, 4);
  assert.equal(result.shownMatches, 2);
  assert.equal(result.steps.length, 2);
  assert.match(result.overview, /Showing the first 2 matches/);
});

test("no exact matches are reported without fabricated evidence", () => {
  const result = findExactMentions(index(),"quantum");
  assert.equal(result.totalMatches,0);
  assert.deepEqual(result.steps,[]);
  assert.match(result.overview,/No exact occurrences/);
});

test("fail closed on incomplete or inconsistent PDF word index", () => {
  const a=index(); a.excerpts[1].start_word=6;
  assert.throws(() => findExactMentions(a,"black box"), /Invalid PDF evidence range|missing or overlapping/);
  const b=index(); b.page_word_counts[1]=999;
  assert.throws(() => findExactMentions(b,"black box"), /does not cover every word/);
  const c=index(); c.excerpts[0].text="wrong number of words";
  assert.throws(() => findExactMentions(c,"black box"), /word count/);
  const d=index(); d.complete=false;
  assert.throws(() => findExactMentions(d,"black box"), /Incomplete/);
});

test("short strict phrases reject empty input and oversized queries", () => {
  assert.throws(() => findExactMentions(index(), ""), /valid exact phrase/);
  assert.throws(() => resolveQuery("one two three four five six seven eight nine ten eleven twelve thirteen", "exact"), /exact phrase of up to 12 words/);
});

test("model-upload path is separate from exact local search", () => {
  const fs=require("node:fs");
  const path=require("node:path");
  const controller=fs.readFileSync(path.join(__dirname,"../guided_controller.js"),"utf8");
  assert.match(controller, /route\.kind === "exact"/);
  assert.ok(controller.indexOf('route.kind === "exact"') < controller.indexOf("showWarningMessage("));
  assert.match(controller,/findExactMentions\(index, route\.phrase\)/);
  assert.match(controller,/case "guideRelated"/);
});

test("short bare phrases and quoted phrases run exact local search in Automatic mode", () => {
  for (const input of ["black box", "black boxes", '"black box"', "model opacity", "AI safety"]) {
    assert.equal(resolveQuery(input).kind,"exact",input);
  }
  assert.deepEqual(resolveQuery("black box"),{kind:"exact",phrase:"black box"});
  assert.deepEqual(resolveQuery('"black box"'),{kind:"exact",phrase:"black box"});
  assert.deepEqual(resolveQuery("black box","guided"),{kind:"guided",phrase:""});
});

test("questions and explanation commands are not silently routed to literal search", () => {
  for (const input of [
    "Explain the black-box problem", "Why are models difficult to interpret?",
    "What are the main ideas of this PDF?", "Describe opacity in neural networks",
    "How does this connect to safety?", "Where does it discuss safety?"
  ]) {
    assert.equal(resolveQuery(input).kind,"guided",input);
  }
});

test("reader search retains punctuation, rejoins line breaks and reports skipped pages", () => {
  const index = { complete: true, pages: 2, skipped_pages: [2], sections: [],
    word_pages: [[["C", 0, 0], ["C++", 0, 0], ["inter-", 0, 0], ["pretability", 0, 1]], []] };
  assert.deepEqual(findExactMentions(index, "C++").steps.map(step => step.quote), ["C++"]);
  const result = findExactMentions(index, "interpretability");
  assert.equal(result.steps[0].quote, "inter- pretability");
  assert.match(result.overview, /1 without selectable text skipped/);
  assert.equal(resolveQuery("explain the basics", "exact").phrase, "explain the basics");
});

test("definition lookup returns original words and ignores incidental mentions", () => {
  const { findDefinitions } = require("../search");
  const index = { sha256: "test", word_pages: [
    "The chapter discusses RAG.".split(" ").map(word => [word, 0]),
    "Retrieval Augmented Generation (RAG) improves relevance.".split(" ").map(word => [word, 0]),
    "A harness refers to the runtime around a model.".split(" ").map(word => [word, 0])
  ] };
  assert.equal(findDefinitions(index, "RAG").steps[0].page, 2);
  assert.equal(findDefinitions(index, "harness").steps[0].quote, "harness refers to the runtime around a model.");
  assert.equal(findDefinitions(index, "chapter").steps.length, 0);
});
