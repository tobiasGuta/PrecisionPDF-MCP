"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const vscode = require("vscode");
const cases = require("./cases");
const { withFixtures, prepareCases, covers } = require("./prepare");
const { groundedAnswer } = require("../../grounding");
const { generateGuide } = require("../../guide");
const { explainVisual } = require("../../visual");

async function send(model, token, prompt, image) {
  const parts = image ? [new vscode.LanguageModelTextPart(prompt), image] : prompt;
  const message = vscode.LanguageModelChatMessage.User(parts);
  if (await model.countTokens(message, token) > model.maxInputTokens) throw new Error("Model context limit exceeded.");
  const response = await model.sendRequest([message], {}, token);
  let result = "";
  for await (const chunk of response.text) {
    result += chunk;
    if (result.length > 25000) throw new Error("Oversized model response.");
  }
  return result;
}

function modelFor(task, models) {
  if (task.route !== "visual") return models[0];
  return models.find(model => model.capabilities?.supportsImageToText === true) ??
    models.find(model => model.capabilities?.supportsImageToText === undefined);
}

async function runCase(task, prepared, request, onTrace) {
  const { sources, index, context } = prepared;
  const { question, file, page, route } = task;
  if (route === "visual") {
    const answer = await explainVisual({ question, context, page, sendModel: request });
    return { answer, citations: answer ? [{ document: file, page, box: task.box }] : [], context };
  }
  if (route === "guide") {
    let guide;
    try {
      guide = await generateGuide({ index, question, mode: "strict", sendModel: request });
    } catch (error) {
      if (/^No sufficiently relevant source references|^Copilot did not provide relevant, verifiable explanation steps|^Relevance review rejected all passages/.test(error.message)) {
        return { answer: "", citations: [], notice: error.message };
      }
      throw error;
    }
    return { answer: guide.overview, citations: guide.steps.slice(0, guide.directCount).map(step => ({
      document: file, page: step.page, quote: step.quote, explanation: step.explanation
    })) };
  }
  if (!sources.length) return { answer: "", citations: [], notice: "No matching source evidence was prepared." };
  const prompt = route === "comparison"
    ? "Compare the selected PDFs using the supplied passages. Attribute views to the correct document. Lack of a retrieved passage is not proof a document omits the topic."
    : "Use the supplied evidence for document claims and state what cannot be established. A labeled hypothetical may illustrate a supported point. Do not fill gaps from outside knowledge.";
  const inputSources = route === "comparison" ? sources : sources.map(({ document, ...source }) => source);
  const result = await groundedAnswer({
    prompt, question, sources: inputSources, mode: "strict", sendModel: request, onTrace
  });
  const citations = result.claims.flatMap(claim => claim.sources).map(source => ({ document: file, ...source }));
  return { answer: result.text, notice: result.notice, claims: result.claims, citations };
}

async function runBenchmark({ filename, selected, backend, cancellation, onCase }) {
  if (!filename || !path.isAbsolute(filename)) throw new Error("Set PRECISIONPDF_BENCH_REPORT to an absolute path for the local JSON report.");
  if (!selected.length) throw new Error("No benchmark cases selected.");
  const report = { vscode: vscode.version, time: new Date().toISOString(), cases: selected.length, results: [] };
  const save = async () => {
    const temp = filename + ".partial";
    await fs.writeFile(temp, JSON.stringify(report, null, 2) + "\n");
    await fs.rename(temp, filename);
  };
  try {
    const models = await vscode.lm.selectChatModels({ vendor: "copilot" });
    if (!models.length) throw new Error("VS Code returned no Copilot models. Check Copilot availability and sign-in in the benchmark profile.");
    await withFixtures(async config => {
      const prepare = prepareCases(config);
      for (const task of selected) {
        if (cancellation?.isCancellationRequested) break;
        onCase?.(task, report.results.length);
        const row = { ...task, calls: 0, trace: [], scores: {
          answerCorrect: null, answerComplete: null, claimsFullySupported: null, appropriateAbstention: null
        } };
        const token = new vscode.CancellationTokenSource();
        const cancelSubscription = cancellation?.onCancellationRequested(() => token.cancel());
        const timeout = setTimeout(() => token.cancel(), 120000);
        try {
          const model = modelFor(task, models);
          if (!model) throw new Error("No image-capable Copilot model.");
          row.model = { id: model.id, name: model.name, version: model.version };
          const prepared = await prepare(task);
          row.availableExpectedSpans = covers(prepared.sources, task.required);
          row.retrieved = prepared.sources.map(({ document, page, quote }) => ({ document, page, quote }));
          const image = prepared.image
            ? vscode.LanguageModelDataPart.image(Buffer.from(prepared.image, "base64"), "image/png") : undefined;
          row.result = await runCase(task, prepared, async prompt => {
            if (token.token.isCancellationRequested) throw new Error("Benchmark request cancelled.");
            const call = ++row.calls;
            const response = await send(model, token.token, prompt, image);
            row.trace.push({ stage: "model-response", call, response });
            return response;
          }, entry => row.trace.push(entry));
        } catch (error) {
          row.error = error.message;
        } finally {
          clearTimeout(timeout);
          cancelSubscription?.dispose();
          token.dispose();
        }
        report.results.push(row);
        await save();
        // A sign-in/consent failure would repeat on all cases.
        if (row.error && /permission|consent|sign.in|quota|rate.limit/i.test(row.error)) {
          report.stopped = row.error;
          break;
        }
      }
    }, backend);
  } catch (error) {
    report.blocker = error.message;
  }
  if (cancellation?.isCancellationRequested) report.cancelled = true;
  await save();
  return report;
}

async function run() {
  const filter = process.env.PRECISIONPDF_BENCH_CASE;
  const selected = filter ? cases.filter(task => task.id === filter) : cases;
  if (!selected.length) throw new Error("Unknown benchmark case: " + filter);
  const report = await runBenchmark({ filename: process.env.PRECISIONPDF_BENCH_REPORT, selected });
  if (report.blocker || report.stopped) throw new Error(report.blocker || report.stopped);
}

module.exports = { run, runBenchmark };
