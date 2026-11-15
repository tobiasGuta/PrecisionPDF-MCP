"use strict";

const { randomUUID } = require("node:crypto");
const { prepareBatches, generateGuide } = require("./guide");
const { resolveQuery, findExactMentions, findDefinitions } = require("./search");
const { referenceAt, captionAt, pageReferences, authoredLink, findCaptions } = require("./media/references");
const { readerProcess, fileVersion } = require("./reader_process");

function attachGuidedReading({ vscode, backend, send, load, currentPage, ocrPages, panel, tutoringBusy }) {
  let searchCache = null;
  const plans = new Map();
  let active = null;
  let activeGuideStep = null;

  async function verifySource(step, fingerprint, zoom, recap = false) {
    if (tutoringBusy()) throw new Error("Wait for the current explanation to finish.");
    const version = await fileVersion(backend);
    const target = currentPage();
    const page = target?.page === step.page && target.fileVersion === version ? target : await load(step.page, { zoom, recap });
    if (!page || currentPage() !== page || page.page !== step.page || page.sha256 !== fingerprint) {
      throw new Error("The PDF changed or the source is unavailable. The saved text is still available.");
    }
    const quote = page.words.slice(step.start_word, step.end_word + 1).map(w => w[4]).join(" ");
    if (quote !== step.quote) throw new Error("The original source words could not be verified on this page.");
  }

  async function activateStep(channel, number, zoom) {
    const plan = plans.get(channel);
    const step = Number.isInteger(number) ? plan?.steps[number] : null;
    if (!step) throw new Error("Choose another result.");
    if (channel === "reference") send({ type: "reference-leaving" });
    await verifySource(step, plan.fingerprint, zoom);
    if (plans.get(channel) !== plan) return;
    if (channel === "guide") activeGuideStep = step;
    send({ type: channel + "-activate", number, step, fingerprint: plan.fingerprint,
      narrationAvailable: channel === "guide" && plan.type === "guided" && Boolean(step.explanation) });
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

  async function followReference(message, signal, progress) {
    const page = currentPage();
    const version = await fileVersion(backend);
    signal.throwIfAborted();
    if (!page || page !== currentPage() || page.fileVersion !== version ||
        message.page !== page.page || message.fingerprint !== page.sha256) {
      throw new Error("The source page changed. Click the reference again.");
    }
    const rows = pageReferences(page);
    const reference = Number.isInteger(message.start) && rows[message.start] && referenceAt(rows, message.start);
    if (!reference) throw new Error("This figure or table reference is no longer available.");
    const link = authoredLink(page, reference);
    if (link) {
      send({ type: "reference-leaving" });
      const target = link.page === page.page ? page : await load(link.page, { zoom: message.zoom });
      signal.throwIfAborted();
      if (!target || currentPage() !== target || target.sha256 !== page.sha256) {
        throw new Error("The PDF link could not be opened.");
      }
      const targetRows = pageReferences(target);
      const captions = targetRows.map((_, index) => captionAt(targetRows, index))
        .filter(item => item?.label === reference.label);
      send({ type: "reference-link", fingerprint: target.sha256, page: target.page, to: link.to,
        step: captions.length === 1 ? { ...captions[0], page: target.page } : null });
      return;
    }

    const { revision, pages: ocr } = await ocrPages();
    const index = await localIndex(signal, progress, ocr, revision);
    signal.throwIfAborted();
    if (page !== currentPage() || index.sha256 !== page.sha256) {
      throw new Error("The source page changed. Click the reference again.");
    }
    const plan = findCaptions(index, reference.label);
    plans.set("reference", plan);
    if (plan.steps.length === 1) await activateStep("reference", 0, message.zoom);
    else send({ type: "reference-plan", plan, label: reference.label });
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
    if (channel === "guide") activeGuideStep = null;
    try {
      if (channel === "reference") {
        await followReference(message, signal, progress);
        return;
      }
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
        const version = await fileVersion(backend);
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
        if (version !== await fileVersion(backend)) throw new Error("The PDF changed. Run the analysis again.");
        const models = await vscode.lm.selectChatModels({ vendor: "copilot" });
        signal.throwIfAborted();
        const model = models[0];
        if (!model) throw new Error("No Copilot model available. Sign in and verify model access in VS Code.");
        plan = await generateGuide({ index: { ...index, scopeLabel: scope }, question, onProgress: progress, mode: message.grounding,
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
        if (version !== await fileVersion(backend)) throw new Error("The PDF changed during analysis. Run it again.");
        plan.recapId = randomUUID();
        plan.question = question;
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
    const channel = message.type.startsWith("reference") ? "reference"
      : message.type.startsWith("definition") ? "definition" : message.type.startsWith("find") ? "find" : "guide";
    switch (message.type) {
      case "referenceStart":
      case "definitionStart":
      case "findStart":
      case "guideStart": void start(channel, message); return true;
      case "guideRelated": void start(channel, { ...message, approach: "guided" }); return true;
      case "referenceGoto":
      case "definitionGoto":
      case "findGoto":
      case "guideGoto":
        void activateStep(channel, message.number, message.zoom).catch(error => {
          send({ type: channel + "-error", message: error.message });
        });
        return true;
      case "findCancel":
      case "guideCancel": cancel(); return true;
      default: return false;
    }
  }

  panel.onDidDispose(cancel);
  function guideExplanation(evidenceId) {
    const plan = plans.get("guide");
    const page = currentPage();
    if (plan?.type !== "guided" || !activeGuideStep || activeGuideStep.evidenceId !== evidenceId ||
        page?.page !== activeGuideStep.page || page.sha256 !== plan.fingerprint) return "";
    const quote = page.words.slice(activeGuideStep.start_word, activeGuideStep.end_word + 1)
      .map(word => word[4]).join(" ");
    return quote === activeGuideStep.quote ? activeGuideStep.explanation : "";
  }

  async function recapStep(id, number, zoom) {
    const plan = plans.get("guide");
    const step = plan?.type === "guided" && plan.recapId === id && Number.isInteger(number) &&
      number >= 0 && number < Math.min(plan.directCount, 3) ? plan.steps[number] : null;
    if (!step || active) throw new Error("Run Guided Reading to prepare a recap.");
    await verifySource(step, plan.fingerprint, zoom, true);
    if (plans.get("guide") !== plan) throw new Error("The guide changed. Start its new recap.");
    return { step, fingerprint: plan.fingerprint };
  }

  return { handle, verifySource, guideExplanation, recapStep, isWorking: () => Boolean(active) };
}

module.exports = { attachGuidedReading };
