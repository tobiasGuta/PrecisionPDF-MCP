"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { findWorkspacePdfs } = require("../pdf_picker");

test("picker displays a multiline PDF name on one line and opens its original path", async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "precisionpdf-picker-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const filename = "AI Harness Engineering\nFoundation-Model Software Agents.PDF";
  await fs.mkdir(path.join(root, "papers"));
  await fs.mkdir(path.join(root, "node_modules"));
  await fs.writeFile(path.join(root, "papers", filename), "");
  await fs.writeFile(path.join(root, "node_modules", "excluded.pdf"), "");
  const vscode = {
    Uri: { joinPath: path.join },
    FileType: { File: 1, Directory: 2, SymbolicLink: 64 },
    workspace: { fs: {
      async readDirectory(directory) {
        return (await fs.readdir(directory, { withFileTypes: true }))
          .map(entry => [entry.name, entry.isDirectory() ? 2 : 1]);
      }
    } }
  };
  const folder = { name: "Lab", uri: root };
  const results = await findWorkspacePdfs(vscode, folder);
  assert.deepEqual(results, [{
    label: path.join("papers", filename.replace("\n", " ")),
    description: "Lab",
    folder,
    rel: path.join("papers", filename)
  }]);
});
