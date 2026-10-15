"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { focus, sourceAddressesTopic, groundedBridge } = require("../relevance");

test("both singular and plural black-box questions identify the same focus", () => {
  assert.equal(focus("black box").type, "black-box");
  assert.equal(focus("Why are these called black boxes?").type, "black-box");
  assert.equal(sourceAddressesTopic("black box", "Researchers call it a black box."), true);
  assert.equal(sourceAddressesTopic("black boxes", "Models are opaque and hard to explain."), true);
});

test("source text about water, energy, data centers or tobacco is not black-box evidence", () => {
  const topic = "Explain the black-box problem.";
  for (const unrelated of [
    "Data centers use enormous quantities of freshwater.",
    "Energy consumption has significant environmental consequences.",
    "Technology firms face the same criticism as Big Tobacco.",
    "Generative AI can increase carbon emissions and worsen climate change."
  ]) {
    assert.equal(sourceAddressesTopic(topic, unrelated), false, unrelated);
    assert.equal(groundedBridge(topic, unrelated, {
      bridgeQuote: unrelated,
      link: "This is related to black box interpretability because the reviewer says so.",
      reason: "This appears relevant to neural-network opacity."
    }), false, unrelated);
  }
});

test("a broader connection needs exact quoted wording and a substantial explicit link", () => {
  const quote = "Opacity raises important accountability concerns.";
  const valid = {
    bridgeQuote: quote,
    link: "Opacity and the interpretability of models raise downstream accountability concerns.",
    reason: "A legitimate downstream concern, not the original definition."
  };
  assert.equal(groundedBridge("black box", quote, valid), true);
  assert.equal(groundedBridge("black box", quote, {...valid,bridgeQuote:"Invented non-source quote"}), false);
  assert.equal(groundedBridge("black box", quote, {...valid,link:"Somehow related."}), false);
  assert.equal(groundedBridge("black box", quote, {...valid,link:"Water use is a major environmental issue."}), false);
});

test("contradictory direct-answer claims do not survive a broader classification", () => {
  const quote="Opacity raises important accountability concerns.";
  const baseline={
    bridgeQuote: quote,
    link: "Opacity and interpretability may affect accountability in deployment.",
    reason: "Context about accountability, not a primary explanation."
  };
  assert.equal(groundedBridge("black box",quote,baseline), true);
  assert.equal(groundedBridge("black box",quote,{...baseline,reason:"This directly answers the question."}),false);
  assert.equal(groundedBridge("black box",quote,{...baseline,link:"This directly proves interpretability issues in AI models."}),false);
});

test("broad questions are not turned into a brittle keyword rule", () => {
  assert.equal(focus("What are the main ideas of this PDF?").type,"general");
  assert.equal(sourceAddressesTopic("What are the main ideas of this PDF?", "The article concerns water usage."),true);
});

test("named non-black-box topics use identifiable content anchors", () => {
  assert.equal(sourceAddressesTopic("Explain discrimination in AI", "Discriminatory systems can perpetuate bias."),true);
  assert.equal(sourceAddressesTopic("Explain discrimination in AI", "Data center water use is rising."),false);
});
