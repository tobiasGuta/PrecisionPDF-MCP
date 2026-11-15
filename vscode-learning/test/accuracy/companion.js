"use strict";

const path = require("node:path");
const vscode = require("vscode");
const { randomUUID } = require("node:crypto");
const cases = require("./cases");
const { runBenchmark } = require("./live");
const build = require("./benchmark-build.json");

const smokeIds = new Set([
  "eligible-age", "units", "retrieval-boilerplate", "opposite-differences", "chart-value", "absent-person"
]);
const groundingIds = new Set([
  "sample-size", "scope-of-conclusion", "column-contrast", "both-conditions", "outdoor", "opposite-differences"
]);
const scopeIds = new Set(["partial", "ocr-absent"]);
const restrictionIds = new Set([
  "column-contrast", "negative-number", "units", "outdoor", "opposite-differences", "ocr-absent"
]);
const guideGroundingIds = new Set([
  "sample-size", "column-a", "guide-supported-summary", "guide-comparison", "guide-absent"
]);

function activate(context) {
  let running = false;
  context.subscriptions.push(vscode.commands.registerCommand("precisionpdfAccuracy.run", async () => {
    if (running) {
      void vscode.window.showInformationMessage("The PrecisionPDF accuracy check is already running.");
      return;
    }
    running = true;
    try {
      const suite = await vscode.window.showQuickPick([
        { label: "Claim ID and Guided Reading retest", detail: "Five cases from the live audit",
          cases: cases.filter(task => guideGroundingIds.has(task.id)) },
        { label: "Scope regression retest", detail: "Six cases from the latest live audit",
          cases: cases.filter(task => restrictionIds.has(task.id)) },
        { label: "Scope and punctuation retest", detail: "Two cases from the latest live audit",
          cases: cases.filter(task => scopeIds.has(task.id)) },
        { label: "Citation and refusal retest", detail: "Six cases from the live audit",
          cases: cases.filter(task => groundingIds.has(task.id)) },
        { label: "Six-case accuracy check", detail: "Normally up to 12 Copilot requests", cases: cases.filter(task => smokeIds.has(task.id)) },
        { label: "Full 37-case benchmark", detail: "Typically about 80 Copilot requests", cases }
      ], { placeHolder: "Choose a PrecisionPDF accuracy suite. Only synthetic PDF evidence is sent." });
      if (!suite) return;
      const filename = path.join(build.reportDirectory, "live-" + randomUUID() + ".json");
      const configuration = vscode.workspace.getConfiguration("precisionpdfLearning");
      const backend = { repo: build.repo, uv: configuration.get("uvPath") || "uv" };
      const report = await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: "PrecisionPDF accuracy check",
        cancellable: true
      }, (progress, cancellation) => runBenchmark({
        filename, selected: suite.cases, backend, cancellation,
        onCase: (task, index) => progress.report({ message: (index + 1) + "/" + suite.cases.length + " " + task.id })
      }));
      const message = report.blocker || report.stopped || (report.cancelled
        ? "Accuracy check cancelled. Partial results saved."
        : "Accuracy check finished. " + report.results.length + " cases recorded for grading.");
      const show = report.blocker || report.stopped ? vscode.window.showWarningMessage : vscode.window.showInformationMessage;
      if (await show(message, "Open report") === "Open report") {
        await vscode.window.showTextDocument(vscode.Uri.file(filename), { preview: false });
      }
    } catch (error) {
      void vscode.window.showErrorMessage("The accuracy check failed. " + error.message);
    } finally {
      running = false;
    }
  }));
}

module.exports = { activate };
