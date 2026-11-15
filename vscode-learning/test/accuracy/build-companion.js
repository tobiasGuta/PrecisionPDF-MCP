"use strict";

const { execFileSync } = require("node:child_process");
const { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const extension = path.resolve(__dirname, "../..");
const output = process.argv[2] ? path.resolve(process.argv[2]) :
  mkdtempSync(path.join(os.tmpdir(), "precisionpdf-accuracy-reports-"));
mkdirSync(output, { mode: 0o700, recursive: true });
const staging = mkdtempSync(path.join(os.tmpdir(), "precisionpdf-accuracy-extension-"));
try {
  const testDir = path.join(staging, "test", "accuracy");
  mkdirSync(testDir, { recursive: true });
  for (const filename of ["LICENSE", "grounding.js", "guide.js", "guide_overview.js", "relevance.js",
    "reader_process.js", "comparison.js", "study.js", "visual.js"]) {
    copyFileSync(path.join(extension, filename), path.join(staging, filename));
  }
  for (const filename of ["README.md", "cases.js", "fixtures.py", "live.js", "prepare.js", "companion.js"]) {
    copyFileSync(path.join(__dirname, filename), path.join(testDir, filename));
  }
  const project = require("../../package.json");
  writeFileSync(path.join(staging, "package.json"), JSON.stringify({
    name: "precisionpdf-accuracy-check",
    displayName: "PrecisionPDF Accuracy Check",
    description: "Local test companion for the PrecisionPDF synthetic PDF benchmark",
    license: project.license,
    version: "0.0.8",
    publisher: project.publisher,
    repository: project.repository,
    engines: project.engines,
    main: "./test/accuracy/companion.js",
    contributes: { commands: [{ command: "precisionpdfAccuracy.run", title: "PrecisionPDF: Run Accuracy Check" }] }
  }));
  writeFileSync(path.join(testDir, "benchmark-build.json"), JSON.stringify({
    repo: path.dirname(extension), reportDirectory: output
  }));
  const vsix = path.join(output, "precisionpdf-accuracy-check.vsix");
  execFileSync(process.execPath, [require.resolve("@vscode/vsce/vsce"), "package", "--no-dependencies", "--out", vsix],
    { cwd: staging, stdio: "inherit" });
  process.stdout.write(vsix + "\n");
} finally {
  rmSync(staging, { recursive: true, force: true });
}
