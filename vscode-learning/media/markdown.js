"use strict";

// Offline, deliberately bounded Markdown subset for untrusted model output.
// Never inject HTML: even-looking tags and links are displayed as text.
function parseInline(text) {
  const parts = [];
  const pattern = /(`[^`\n]+`|\*\*[^*\n]+\*\*|\*[^*\n]+\*|\\\([^\n]*?\\\)|\$[^$\n]+\$)/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > last) parts.push({ kind: "text", text: text.slice(last, match.index) });
    const token = match[0];
    if (token.startsWith("**")) parts.push({ kind: "strong", text: token.slice(2, -2) });
    else if (token.startsWith("*")) parts.push({ kind: "em", text: token.slice(1, -1) });
    else if (token.startsWith("`")) parts.push({ kind: "code", text: token.slice(1, -1) });
    else parts.push({ kind: "math", text: token.replace(/^\\\(|\\\)$/g, "").replace(/^\$|\$$/g, "") });
    last = match.index + token.length;
  }
  if (last < text.length) parts.push({ kind: "text", text: text.slice(last) });
  return parts;
}

function parseMarkdown(input) {
  const lines = String(input || "").replace(/\r\n?/g, "\n").slice(0, 32000).split("\n");
  const blocks = [];
  for (let i = 0; i < lines.length;) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    const fence = line.match(/^\s*(`{3,}|~{3,})([^`]*)$/);
    if (fence) {
      const marker = fence[1][0];
      const length = fence[1].length;
      const language = fence[2].trim().split(/\s+/)[0].slice(0, 40);
      const content = [];
      i++;
      while (i < lines.length && !new RegExp("^\\s*" + marker + "{" + length + ",}\\s*$").test(lines[i])) content.push(lines[i++]);
      if (i < lines.length) i++;
      blocks.push({ kind: "code", language, text: content.join("\n") });
      continue;
    }
    const heading = line.match(/^\s{0,3}(#{1,4})\s+(.+)$/);
    if (heading) {
      blocks.push({ kind: "heading", level: heading[1].length, content: parseInline(heading[2]) });
      i++; continue;
    }
    if (line.trim() === "$$" || line.trim() === "\\[") {
      const terminator = line.trim() === "$$" ? "$$" : "\\]";
      const content = [];
      i++;
      while (i < lines.length && lines[i].trim() !== terminator) content.push(lines[i++]);
      if (i < lines.length) i++;
      blocks.push({ kind: "math", text: content.join("\n") });
      continue;
    }
    if (/^\s*(?:[-*+]\s+|\d+\.\s+)/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items = [];
      while (i < lines.length && /^\s*(?:[-*+]\s+|\d+\.\s+)/.test(lines[i])) {
        items.push(parseInline(lines[i].replace(/^\s*(?:[-*+]\s+|\d+\.\s+)/, "")));
        i++;
      }
      blocks.push({ kind: ordered ? "ol" : "ul", items });
      continue;
    }
    if (/^\s*>\s?/.test(line)) {
      const content = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) content.push(lines[i++].replace(/^\s*>\s?/, ""));
      blocks.push({ kind: "quote", content: parseInline(content.join(" ")) });
      continue;
    }
    const paragraph = [];
    while (i < lines.length && lines[i].trim() &&
           !/^\s*(?:#{1,4}\s+|`{3,}|~{3,}|[-*+]\s+|\d+\.\s+|>\s?|\$\$\s*$|\\\[\s*$)/.test(lines[i])) {
      paragraph.push(lines[i++].trim());
    }
    if (paragraph.length) blocks.push({ kind: "paragraph", content: parseInline(paragraph.join(" ")) });
    else i++;
  }
  return blocks;
}

function renderMarkdown(target, input) {
  const doc = target.ownerDocument;
  const children = [];
  const appendInline = (node, parts) => {
    for (const part of parts) {
      if (part.kind === "text") node.appendChild(doc.createTextNode(part.text));
      else {
        const tag = { strong: "strong", em: "em", code: "code", math: "code" }[part.kind];
        const element = doc.createElement(tag || "span");
        if (part.kind === "math") element.className = "inline-math";
        element.textContent = part.text;
        node.appendChild(element);
      }
    }
  };
  for (const block of parseMarkdown(input)) {
    let node;
    if (block.kind === "heading") {
      node = doc.createElement("h" + Math.min(5, block.level + 2));
      appendInline(node, block.content);
    } else if (block.kind === "ul" || block.kind === "ol") {
      node = doc.createElement(block.kind);
      for (const item of block.items) {
        const li = doc.createElement("li");
        appendInline(li, item);
        node.appendChild(li);
      }
    } else if (block.kind === "code" || block.kind === "math") {
      node = doc.createElement("pre");
      const code = doc.createElement("code");
      code.textContent = block.text;
      if (block.language) code.className = "language-" + block.language.replace(/[^a-z0-9_-]/gi, "");
      if (block.kind === "math") node.className = "display-math";
      node.appendChild(code);
    } else {
      node = doc.createElement(block.kind === "quote" ? "blockquote" : "p");
      appendInline(node, block.content);
    }
    children.push(node);
  }
  target.replaceChildren(...children);
}

if (typeof module !== "undefined" && module.exports) module.exports = { parseInline, parseMarkdown, renderMarkdown };
else globalThis.PrecisionPDFMarkdown = { renderMarkdown };
