"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { isBackendRepo, findExistingBackend } = require("../backend");

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "precisionpdf-vsix-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const repo = path.join(root, "PrecisionPDF-MCP");
  const packageDir = path.join(root, "installed", "extension");
  const devDir = path.join(repo, "vscode-learning");
  fs.mkdirSync(path.join(repo, "src", "precisionpdf_mcp"), { recursive: true });
  fs.mkdirSync(packageDir, { recursive: true });
  fs.mkdirSync(devDir, { recursive: true });
  for (const file of ["pyproject.toml", "src/precisionpdf_mcp/reader_bridge.py", "src/precisionpdf_mcp/guided_index.py"]) {
    fs.writeFileSync(path.join(repo, file), "");
  }
  return { repo, packageDir, devDir };
}

test("F5 development layout continues resolving adjacent Python backend", t => {
  const { repo, devDir } = fixture(t);
  assert.equal(findExistingBackend("", devDir), repo);
});

test("installed extension needs configuration; configured clone works", t => {
  const { repo, packageDir } = fixture(t);
  assert.equal(findExistingBackend("", packageDir), null);
  assert.equal(findExistingBackend(repo, packageDir), repo);
});

test("invalid configured clone fails rather than silently loading another", t => {
  const { repo, devDir } = fixture(t);
  assert.equal(findExistingBackend(path.join(repo, "no-such-path"), devDir), null);
});

test("backend detection requires all Python entry points", t => {
  const { repo } = fixture(t);
  fs.unlinkSync(path.join(repo, "src/precisionpdf_mcp/guided_index.py"));
  assert.equal(isBackendRepo(repo), false);
});
