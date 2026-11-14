"use strict";

const { prepareBatches, generateGuide } = require("./guide");
const { resolveQuery, findExactMentions, findDefinitions } = require("./search");
const { readerProcess, fileVersion } = require("./reader_process");

function attachGuidedReading({ vscode, backend, send, load, currentPage, ocrPages, panel, tutoringBusy }) {
  let searchCache = null;
  const plans = new Map();
  let active = null;

  async function verifySource(step, fingerprint) {
    if (tutoringBusy()) throw new Error("Wait for the current explanation to finish.");
    const version = await fileVersion(backend);
    const target = currentPage();
    const page = target?.page === step.page && target.fileVersion === version ? target : await load(step.page);
    if (!page || currentPage() !== page || page.page !== step.page || page.sha256 !== fingerprint) {
      throw new Error("The PDF changed or the source is unavailable. The saved text is still available.");
    }
    const quote = page.words.slice(step.start_word, step.end_word + 1).map(w => w[4]).join(" ");
    if (quote !== step.quote) throw new Error("The original source words could not be verified on this page.");
  }

  async function activateStep(channel, number) {
    const plan = plans.get(channel);
    const step = plan?.steps[number];
    if (!step) throw new Error("Choose another result.");
    await verifySource(step, plan.fingerprint);
    if (plans.get(channel) !== plan) return;
    send({ type: channel + "-activate", number, step, fingerprint: plan.fingerprint });
  }

  async function localIndex(signal, progress, ocr, revision) {
    const version = await fileVersion(backend);
    if (searchCache?.version !== version || searchCache.revision !== revision) {
      progress("Indexing selectable text locally…");
      const index = await readerProcess(backend, "guided_index", ["--cached-ocr", "--search"], signal, ocr);
      if (version !== await fileVersion(backend)) throw new Error("PDF changed while indexing. Try again.");
      searchCache = { version, revision, index };
    }
    return searchCache.index;
  }

  async function start(channel, message) {
    if (active || tutoringBusy()) {
      send({ type: channel + "-error", message: "Finish or cancel the current request first." });
      return;
    }
    const operation = { abort: new AbortController(), token: new vscode.CancellationTokenSource() };
    active = operation;
    const { signal } = operation.abort;
    const progress = message => send({ type: channel + "-progress", message });
    plans.delete(channel);
    try {
      const question = String(message.question || "").trim().slice(0, 800);
      const route = resolveQuery(question, channel !== "guide" ? "exact" : (message.approach || "auto"));
      const { revision, pages: ocr } = await ocrPages();
      const flags = ["--cached-ocr"];
      let plan;
      if (route.kind === "exact") {
        const index = await localIndex(signal, progress, ocr, revision);
        plan = channel === "definition" ? findDefinitions(index, route.phrase) : findExactMentions(index, route.phrase);
      } else {
        if (message.start !== undefined || message.end !== undefined) {
          const first = Number(message.start);
          const last = Number(message.end);
          if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last) || first < 1 || first > last) {
            throw new Error("Enter a valid first and last PDF page.");
          }
          flags.push("--start", String(first), "--end", String(last));
        }
        progress("Indexing selected PDF pages locally…");
        const index = await readerProcess(backend, "guided_index", flags, signal, ocr);
        const count = prepareBatches(index).length + 2;
        const [first, last] = index.scope;
        const scope = "PDF pages " + first + "–" + last;
        const skipped = index.skipped_pages.length;
        const coverage = skipped ? " · " + skipped + " pages without selectable text skipped" : "";
        const agreed = await vscode.window.showWarningMessage(
          "Send extracted text from " + scope + " to GitHub Copilot using up to " + count +
          " requests?" + coverage, { modal: true }, "Analyze PDF"
        );
        signal.throwIfAborted();
        if (agreed !== "Analyze PDF") {
          send({ type: channel + "-cancelled" });
          return;
        }
        const models = await vscode.lm.selectChatModels({ vendor: "copilot" });
        signal.throwIfAborted();
        const model = models[0];
        if (!model) throw new Error("No Copilot model available. Sign in and verify model access in VS Code.");
        plan = await generateGuide({ index: { ...index, scopeLabel: scope }, question, onProgress: progress,
          sendModel: async prompt => {
            signal.throwIfAborted();
            const request = vscode.LanguageModelChatMessage.User(prompt);
            if (await model.countTokens(request, operation.token.token) > model.maxInputTokens) {
              throw new Error("This request exceeds the model’s context limit. Choose a smaller page range.");
            }
            signal.throwIfAborted();
            const response = await model.sendRequest([request], {}, operation.token.token);
            let body = "";
            for await (const fragment of response.text) {
              signal.throwIfAborted();
              body += fragment;
              if (body.length > 25000) throw new Error("Copilot returned an oversized guide response.");
            }
            return body;
          }
        });
        plan.overview = scope + coverage + "\n\n" + plan.overview;
      }
      signal.throwIfAborted();
      plans.set(channel, plan);
      send({ type: channel + "-plan", plan });
      if (channel !== "definition" && (plan.type === "exact" ? plan.steps.length : plan.directCount > 0)) {
        await activateStep(channel, 0);
      }
    } catch (error) {
      send(signal.aborted ? { type: channel + "-cancelled" }
        : { type: channel + "-error", message: error.message || String(error) });
    } finally {
      operation.token.dispose();
      active = null;
    }
  }

  function cancel() {
    active?.abort.abort();
    active?.token.cancel();
  }

  function handle(message) {
    const channel = message.type.startsWith("definition") ? "definition" : message.type.startsWith("find") ? "find" : "guide";
    switch (message.type) {
      case "definitionStart":
      case "findStart":
      case "guideStart": void start(channel, message); return true;
      case "guideRelated": void start(channel, { ...message, approach: "guided" }); return true;
      case "definitionGoto":
      case "findGoto":
      case "guideGoto":
        void activateStep(channel, message.number).catch(error => {
          send({ type: channel + "-error", message: error.message });
        });
        return true;
      case "findCancel":
      case "guideCancel": cancel(); return true;
      default: return false;
    }
  }

  panel.onDidDispose(cancel);
  return { handle, verifySource, isWorking: () => Boolean(active) };
}

module.exports = { attachGuidedReading };
