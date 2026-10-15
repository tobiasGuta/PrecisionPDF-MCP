"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { parseMarkdown, parseInline, renderMarkdown } = require("../markdown");

test("parses headings, lists, fenced code, inline formatting and math", () => {
  const blocks = parseMarkdown("## Author's explanation\n\n* **Evidence** here\n* *Second* item\n\n```python\nprint('ok')\n```\n\nAn equation \\(a+b\\) matters.\n\n$$\nx^2 + y^2\n$$");
  assert.deepEqual(blocks.map(b => b.kind), ["heading", "ul", "code", "paragraph", "math"]);
  assert.equal(blocks[1].items[0][0].kind, "strong");
  assert.equal(blocks[2].language, "python");
  assert.equal(blocks[4].text, "x^2 + y^2");
  assert.equal(parseInline("Math $E=mc^2$")[1].kind, "math");
});

test("malicious HTML and Markdown links remain inert text", () => {
  const nodes = [];
  const document = {
    createTextNode(text) { return { text }; },
    createElement(tag) {
      return { tag, textContent: "", appendChild(child) { this.children ??= []; this.children.push(child); } };
    }
  };
  const target = { ownerDocument: document, replaceChildren(...parts) { nodes.push(...parts); } };
  renderMarkdown(target, "<img src=x onerror=alert(1)> [click](javascript:alert(1))");
  assert.equal(nodes.length, 1);
  assert.equal(nodes[0].tag, "p");
  assert.match(nodes[0].children[0].text, /onerror=alert/);
  assert.match(nodes[0].children[0].text, /javascript:alert/);
});

test("unfinished streaming markdown does not throw", () => {
  assert.equal(parseMarkdown("### Heading\n\n```js\nconsole.log('still typing')").at(-1).kind, "code");
});
