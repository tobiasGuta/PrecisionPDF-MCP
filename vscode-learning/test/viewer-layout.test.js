"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

test("question composer lives outside the independently scrolling discussion", () => {
  const html = readFileSync(join(__dirname, "../media/viewer.html"), "utf8");
  const css = readFileSync(join(__dirname, "../media/viewer.css"), "utf8");
  const scroller = html.indexOf('id="tutorScroll"');
  const thread = html.indexOf('id="thread"');
  const scrollerEnd = html.indexOf("</div>", thread);
  const composer = html.indexOf('class="composer"');
  const question = html.indexOf('id="question"');
  assert.ok(scroller > 0 && thread > scroller);
  assert.ok(composer > scrollerEnd && question > composer);
  assert.match(css, /\.tutor\s*\{[^}]*grid-template-rows:\s*minmax\(0,\s*1fr\)\s+auto/s);
  assert.match(css, /\.tutor-scroll\s*\{[^}]*overflow-y:\s*auto/s);
});

test("new discussion and selection-change event hooks remain wired", () => {
  const viewer = readFileSync(join(__dirname, "../media/viewer.js"), "utf8");
  const extension = readFileSync(join(__dirname, "../extension.js"), "utf8");
  assert.match(viewer, /id|newThread/);
  assert.match(viewer, /selectionChanged/);
  assert.match(viewer, /preserveSelection/);
  assert.match(extension, /selectionChanged/);
  assert.match(extension, /session\.reset\(\)/);
});
