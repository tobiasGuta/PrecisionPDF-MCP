"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { composeReviewedOverview } = require("../guide_overview");

const direct = [
  {evidenceId:"p3-w24",page:3,quote:"They cannot explain exactly how the model will behave.",explanation:"This statement elaborates on difficulty."},
  {evidenceId:"p4-w12",page:4,quote:"The patterns a model computes are not legible to humans.",explanation:"This excerpt explains opacity."}
];

test("uses natural reviewer summary grounded only in accepted direct evidence IDs",()=>{
  const result=composeReviewedOverview({
    directOverview:"The reading explains that deep-learning decisions can be difficult to interpret because their learned patterns are not legible to people.",
    overviewEvidenceIds:["p3-w24","p4-w12"]
  },direct,"Explain the black-box problem");
  assert.equal(result.source,"reviewed");
  assert.match(result.text,/difficult to interpret/);
  assert.doesNotMatch(result.text,/This excerpt|This statement/i);
});

test("does not display reviewer summary citing rejected or hidden IDs",()=>{
  for(const refs of [
    ["p3-w24","p99-w0"],["p99-w0"],[],["p3-w24","p3-w24"]
  ]){
    const result=composeReviewedOverview({
      directOverview:"Opaque models are impossible to interpret and data centers consume water.",
      overviewEvidenceIds:refs
    },direct,"black box");
    assert.equal(result.source,"source-excerpts");
    assert.match(result.text,/They cannot explain exactly how/);
    assert.doesNotMatch(result.text,/data centers/i);
  }
});

test("omitted or malformed overview uses only direct source quotations",()=>{
  const result=composeReviewedOverview({},direct,"black box");
  assert.equal(result.source,"source-excerpts");
  assert.match(result.text,/Page 3:/);
  assert.match(result.text,/Page 4:/);
  assert.doesNotMatch(result.text,/This statement elaborates/);
});

test("no direct evidence never claims to answer and never repeats model overview",()=>{
  const result=composeReviewedOverview({
    directOverview:"The text fully proves the answer.",
    overviewEvidenceIds:["p3-w24"]
  },[],"black box");
  assert.equal(result.source,"none");
  assert.match(result.text,/No directly supported answer/);
  assert.doesNotMatch(result.text,/fully proves/);
});

test("generic/repetitive reviewer overview falls back to quotes",()=>{
  const result=composeReviewedOverview({
    directOverview:"This excerpt explains why model decisions are difficult to interpret.",
    overviewEvidenceIds:["p3-w24","p4-w12"]
  },direct,"black box");
  assert.equal(result.source,"source-excerpts");
});
