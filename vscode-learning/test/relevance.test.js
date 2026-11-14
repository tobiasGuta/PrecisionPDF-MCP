"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { groundedBridge } = require("../relevance");

test("context requires a verbatim source fragment and an appropriately qualified connection", () => {
  const quote = "The flight data recorder preserves instrument readings.";
  const review = {
    bridgeQuote: "preserves instrument readings",
    link: "The recorded readings provide context when investigators reconstruct flight conditions."
  };
  assert.equal(groundedBridge(quote, review), true);
  assert.equal(groundedBridge(quote, { ...review, bridgeQuote: "preserves pilot conversations" }), false);
  assert.equal(groundedBridge(quote, { ...review, reason: "This directly answers the question." }), false);
  assert.equal(groundedBridge(quote, { ...review, link: "Related." }), false);
});
