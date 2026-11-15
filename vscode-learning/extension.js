"use strict";

const vscode = require("vscode");
const path = require("node:path");
const fs = require("node:fs");
const { readerProcess, fileVersion } = require("./reader_process");
const { randomBytes } = require("node:crypto");
const { findWorkspacePdfs } = require("./pdf_picker");
const { groundedAnswer, modeFor } = require("./grounding");
const { comparisonSources } = require("./comparison");
const { visualContext, explainVisual } = require("./visual");
const { buildPrompt } = require("./prompt");
const { TutorSession } = require("./session");
const { attachGuidedReading } = require("./guided_controller");
const { attachStudy, sourceFor } = require("./study");
const { SpeechService } = require("./speech");
const { findExistingBackend, isBackendRepo } = require("./backend");

async function resolveRepoPath() {
  const configuration = vscode.workspace.getConfiguration("precisionpdfLearning");
  const configured = configuration.get("repositoryPath");
  const known = findExistingBackend(configured, __dirname);
  if (known) return known;

  const message = configured
    ? "The configured PrecisionPDF Python backend could not be found. Select the root of your PrecisionPDF-MCP clone."
    : "PrecisionPDF Learning Mode needs its local Python backend. Select the root of your PrecisionPDF-MCP clone once.";
  const choice = await vscode.window.showWarningMessage(message, "Select Backend Folder");
  if (choice !== "Select Backend Folder") return null;
  const folders = await vscode.window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: "Use PrecisionPDF Backend",
    title: "Select the PrecisionPDF-MCP repository root"
  });
  if (!folders || !folders.length) return null;
  const selected = path.resolve(folders[0].fsPath);
  if (!isBackendRepo(selected)) {
    vscode.window.showErrorMessage(
      "This folder is not a PrecisionPDF-MCP backend. Choose the updated PrecisionPDF-MCP clone containing the v0.7 reader backend."
    );
    return null;
  }
  try {
    await configuration.update("repositoryPath", selected, vscode.ConfigurationTarget.Global);
  } catch (error) {
    vscode.window.showErrorMessage("Could not save the PrecisionPDF backend path: " + error.message);
    return null;
  }
  return selected;
}

async function pickPdf() {
  const folders = vscode.workspace.workspaceFolders || [];
  if (!folders.length) {
    vscode.window.showWarningMessage("Open your PDF workspace folder before starting Learning Mode.");
    return;
  }
  const results = [];
  for (const folder of folders) {
    try {
      results.push(...await findWorkspacePdfs(vscode, folder));
    } catch (error) {
      vscode.window.showWarningMessage("Could not list PDFs in " + folder.name + ": " + error.message);
    }
  }
  if (!results.length) {
    vscode.window.showInformationMessage("No PDF files found in the open workspace.");
    return;
  }
  const chosen = await vscode.window.showQuickPick(results, {
    placeHolder: "Select a PDF to read in Learning Mode"
  });
  return chosen && {
    root: chosen.folder.uri.fsPath,
    filename: chosen.rel
  };
}

function makeHtml(context, webview) {
  const nonce = randomBytes(16).toString("hex");
  const mediaRoot = vscode.Uri.joinPath(context.extensionUri, "media");
  const uri = (filename) => webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, filename)).toString();
  return fs.readFileSync(path.join(context.extensionPath, "media", "viewer.html"), "utf8")
    .replaceAll("{{NONCE}}", nonce)
    .replaceAll("{{CSP}}", webview.cspSource)
    .replaceAll("{{CSS}}", uri("viewer.css"))
    .replaceAll("{{MARKDOWN_JS}}", uri("markdown.js"))
    .replaceAll("{{GUIDE_JS}}", uri("guide-viewer.js"))
    .replaceAll("{{SPEECH_JS}}", uri("speech-viewer.js"))
    .replaceAll("{{FIND_JS}}", uri("find-viewer.js"))
    .replaceAll("{{STUDY_JS}}", uri("study-viewer.js"))
    .replaceAll("{{REFERENCES_JS}}", uri("references.js"))
    .replaceAll("{{JS}}", uri("viewer.js"));
}

async function openLearningMode(context, uri, citation) {
  let picked = citation?.target;
  if (!picked && uri) {
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    if (!folder || !/\.pdf$/i.test(uri.path)) return;
    picked = { root: folder.uri.fsPath, filename: path.relative(folder.uri.fsPath, uri.fsPath) };
  } else if (!picked) {
    picked = await pickPdf();
  }
  if (!picked) return;
  const repo = await resolveRepoPath();
  if (!repo) return;

  const panel = vscode.window.createWebviewPanel(
    "precisionpdfLearning", "PrecisionPDF Learning: " + path.basename(picked.filename).replace(/[\r\n\t]+/g, " "),
    vscode.ViewColumn.One,
    { enableScripts: true, retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "media")] }
  );

  const uv = vscode.workspace.getConfiguration("precisionpdfLearning").get("uvPath") || "uv";
  const backend = { uv, repo, ...picked };
  const positionKey = "precisionpdf.position:" + path.join(picked.root, picked.filename);
  const position = context.workspaceState.get(positionKey);
  const ocr = new Map();
  let ocrVersion;
  let ocrRevision = 0;
  let pageRequest = null;
  let disposed = false;
  let pageData = null;
  let busy = false;
  let tokenSource = null;
  let comparison = [];
  let localWork = null;
  const session = new TutorSession();
  const answers = new Map();
  const pins = [];
  let turnSerial = 0;
  let loadSerial = 0;
  let recapSerial = 0;

  const send = (message) => { if (!disposed) void panel.webview.postMessage(message); };
  const speech = new SpeechService({ repo, send });
  panel.onDidDispose(() => {
    disposed = true;
    pageRequest?.abort();
    localWork?.abort();
    if (tokenSource) tokenSource.cancel();
    speech.dispose();
  });

  async function chooseComparison() {
    const uris = await vscode.window.showOpenDialog({
      canSelectFiles: true, canSelectFolders: false, canSelectMany: true,
      filters: { PDF: ["pdf"] }, title: "Choose 2–4 workspace PDFs to compare", openLabel: "Use PDFs"
    });
    if (!uris) return;
    const targets = new Map();
    for (const uri of uris) {
      const folder = vscode.workspace.getWorkspaceFolder(uri);
      if (!folder || !/\.pdf$/i.test(uri.path)) throw new Error("Choose PDFs inside your open workspace.");
      const root = folder.uri.fsPath;
      const filename = path.relative(root, uri.fsPath);
      targets.set(uri.fsPath, { root, filename,
        label: (vscode.workspace.workspaceFolders?.length > 1 ? folder.name + "/" : "") + filename.replace(/\s+/g, " ") });
    }
    if (targets.size < 2 || targets.size > 4) throw new Error("Choose 2–4 PDFs to compare.");
    comparison = [...targets.values()];
    if (new Set(comparison.map(target => target.label)).size !== comparison.length) {
      comparison.forEach((target, index) => { target.label = (index + 1) + " · " + target.label; });
    }
    send({ type: "comparison-list", labels: comparison.map(target => target.label) });
  }

  async function comparisonEvidence(question, signal) {
    const documents = [];
    for (const target of comparison) {
      const config = { uv, repo, ...target };
      const version = await fileVersion(config);
      const index = await readerProcess(config, "guided_index", ["--search"], signal);
      if (version !== await fileVersion(config)) throw new Error("A comparison PDF changed while indexing. Try again.");
      documents.push({ target, label: target.label, index, version });
    }
    return { ...comparisonSources(documents, question),
      documents: documents.map(({ target, version }) => ({ target, version })) };
  }

  const load = async (pageNumber, { zoom, language, restore, recap } = {}) => {
    const n = Number(pageNumber);
    if (!Number.isSafeInteger(n) || n < 1 || (pageData && n > pageData.pages)) {
      send({ type: "page-error", message: "Page is outside the document." });
      return null;
    }
    const requested = ++loadSerial;
    pageRequest?.abort();
    const request = new AbortController();
    pageRequest = request;
    send({ type: "loading", recap });
    try {
      const version = await fileVersion(backend);
      if (ocrVersion !== version) { ocr.clear(); ocrVersion = version; }
      const flags = ["--page", String(n)];
      if (Number.isFinite(zoom) && zoom > 0 && zoom <= 3) flags.push("--zoom", String(zoom));
      const cached = !language ? ocr.get(n) : undefined;
      const ocrLanguage = language || cached?.language;
      if (ocrLanguage) flags.push("--ocr-language", ocrLanguage);
      if (cached) flags.push("--cached-ocr");
      if (!pageData || pageData.fileVersion !== version) flags.push("--outline");
      const loaded = await readerProcess(backend, "reader_bridge", flags, request.signal, cached?.words);
      if (version !== await fileVersion(backend)) throw new Error("PDF changed while rendering. Try again.");
      if (requested !== loadSerial || disposed) return null;
      if (language) {
        ocr.set(n, { language, words: loaded.ocr_words });
        if (ocr.size > 60) ocr.delete(ocr.keys().next().value);
        ocrRevision++;
        send({ type: "reader-text-changed" });
      }
      delete loaded.ocr_words;
      loaded.ocrLanguage = ocrLanguage;
      if (pageData && pageData.sha256 !== loaded.sha256) {
        pins.length = 0;
        session.reset();
        answers.clear();
        speech.stop();
        send({ type: "thread-reset", reason: "The PDF changed. Start a new discussion." });
      }
      session.setPage(loaded.page);
      session.clearSelection();
      pageData = { ...loaded, fileVersion: version };
      const saved = restore?.fingerprint === loaded.sha256 ? restore : undefined;
      send({ type: "page", data: loaded, restore: saved });
      return pageData;
    } catch (error) {
      if (requested === loadSerial && !request.signal.aborted) send({ type: "page-error", message: error.message });
      return null;
    } finally {
      if (pageRequest === request) pageRequest = null;
    }
  };

  const guided = attachGuidedReading({ vscode, backend, send, load, ocrPages: async () => {
    if (ocrVersion !== await fileVersion(backend)) return { revision: -1, pages: {} };
    return { revision: ocrRevision, pages: Object.fromEntries([...ocr].map(([page, data]) => [page, data.words])) };
  }, currentPage: () => pageData, panel, tutoringBusy: () => busy });

  const study = attachStudy({ vscode, state: context.workspaceState, key: path.join(picked.root, picked.filename),
    send, panel, currentPage: () => pageData, busy: () => busy || Boolean(pageRequest) || guided.isWorking(),
    checkSource: async source => {
      const current = pageData;
      if (!current || current.sha256 !== source.fingerprint || current.fileVersion !== await fileVersion(backend)) {
        throw new Error("The PDF changed. Keep the saved question or create a new check from the current PDF.");
      }
    },
    reveal: async source => {
      const version = await fileVersion(backend);
      if (source.ocr && !ocr.has(source.page) && pageData?.sha256 === source.fingerprint &&
          pageData.fileVersion === version) {
        await load(source.page, { language: typeof source.ocrLanguage === "string" ? source.ocrLanguage : "eng" });
      }
      await guided.verifySource(source, source.fingerprint);
      send({ type: "study-source", step: source, fingerprint: source.fingerprint });
    }
  });

  async function askModel(model, token, text, image) {
    if (token.isCancellationRequested) throw new Error("Explanation cancelled.");
    const content = image ? [new vscode.LanguageModelTextPart(text), image] : text;
    const message = vscode.LanguageModelChatMessage.User(content);
    if (await model.countTokens(message, token) > model.maxInputTokens) {
      throw new Error("The prompt exceeds the model’s context limit. Try a smaller selection.");
    }
    if (token.isCancellationRequested) throw new Error("Explanation cancelled.");
    const response = await model.sendRequest([message], {}, token);
    let body = "";
    for await (const chunk of response.text) {
      if (token.isCancellationRequested) throw new Error("Explanation cancelled.");
      body += chunk;
      if (body.length > 16000) throw new Error("Copilot returned too much text.");
    }
    if (token.isCancellationRequested) throw new Error("Explanation cancelled.");
    return body;
  }

  const explain = async (request) => {
    if (busy || pageRequest || guided.isWorking()) {
      return send({ type: "tutor-rejected", message: "Finish or cancel the current request first." });
    }
    if (!pageData || request.page !== pageData.page || request.fingerprint !== pageData.sha256) {
      return send({ type: "tutor-rejected", message: "Wait for the current PDF page to load." });
    }
    const userQuestion = String(request.question || "").trim().slice(0, 1500);
    if (!userQuestion) return send({ type: "tutor-rejected", message: "Enter a question." });
    let started = false;
    let success = false;
    let turnId;
    try {
      const page = pageData;
      const scope = ["pins", "selection", "comparison", "visual"].includes(request.scope) ? request.scope : "page";
      const mode = modeFor(request.grounding);
      const isVisual = scope === "visual";
      const isComparison = scope === "comparison";
      const regionContext = isVisual ? visualContext(page, request.box) : null;
      if (isComparison && !comparison.length) throw new Error("Choose the PDFs you want to compare first.");
      busy = true;
      localWork = new AbortController();
      const signal = localWork.signal;
      if (isComparison) send({ type: "tutor-status", message: "Finding matching passages locally…" });
      const evidence = isComparison ? await comparisonEvidence(userQuestion, signal) : null;
      signal.throwIfAborted();
      const sources = evidence?.sources ?? (isVisual ? [] : tutoringSources(request, scope));
      if (!isVisual && !sources.length) throw new Error(isComparison
        ? "No matching selectable text in the chosen PDFs. Try a question with a term used in the readings."
        : scope === "pins" ? "Pin a passage first." : "Select a passage or open a page with selectable text.");
      const { passage } = session.prepare(page.page, ["pins", "comparison", "visual"].includes(scope) ? "" : selectedQuote(request));
      const prompt = isComparison
        ? "Compare the selected PDFs using the supplied passages. Attribute views to the correct document. Lack of a retrieved passage is not proof a document omits the topic."
        : promptFor(userQuestion, passage, scope, mode, true);
      const history = scope === "page" ? session.history() : "";
      const payload = isVisual ? "the selected PDF image region and nearby text"
        : sources.length + " PDF excerpt(s)" + (history ? " and recent discussion" : "");
      const requestLimit = isVisual ? "two requests" : "three requests, including one retry for an unreadable reply";
      const agreed = await vscode.window.showWarningMessage(
        "Send " + payload + " to GitHub Copilot for an answer and support assessment (up to " + requestLimit + ")?" +
        (evidence ? "\n\n" + evidence.coverage.join("\n") : ""),
        { modal: true }, "Ask Copilot");
      if (agreed !== "Ask Copilot" || disposed || signal.aborted) return send({ type: "tutor-rejected", message: "Question cancelled." });
      const currentVersion = await fileVersion(backend);
      if (page !== pageData || page.fileVersion !== currentVersion) {
        throw new Error("The PDF changed. Reload the source page and try again.");
      }
      started = true;
      turnId = ++turnSerial;
      tokenSource = new vscode.CancellationTokenSource();
      send({ type: "thinking", question: userQuestion, page: page.page, passage, scope, turnId });
      const models = await vscode.lm.selectChatModels({ vendor: "copilot" });
      const model = isVisual ? models.find(candidate => candidate.capabilities?.supportsImageToText === true)
        ?? models.find(candidate => candidate.capabilities?.supportsImageToText === undefined) : models[0];
      if (isVisual && (!model || !vscode.LanguageModelDataPart?.image)) {
        throw new Error("Visual explanations require a Copilot model and VS Code version that support image input.");
      }
      if (!model) throw new Error("No Copilot model is available. Use Copy prompt to continue in another chat.");
      const token = tokenSource.token;
      const verifyDocuments = async () => {
        for (const { target, version } of evidence?.documents ?? []) {
          if (version !== await fileVersion(target)) throw new Error("A comparison PDF changed. Run the comparison again.");
        }
      };
      await verifyDocuments();
      const onReview = () => send({ type: "tutor-reviewing" });
      let result;
      if (isVisual) {
        const crop = await readerProcess(backend, "reader_bridge",
          ["--page", String(page.page), "--region", ...request.box.map(String)], signal);
        if (crop.sha256 !== page.sha256) throw new Error("The PDF changed. Select the region again.");
        const image = vscode.LanguageModelDataPart.image(Buffer.from(crop.png_base64, "base64"), "image/png");
        const text = await explainVisual({ question: userQuestion, context: regionContext, page: page.page, ocr: page.ocr,
          onReview, sendModel: prompt => askModel(model, token, prompt, image) });
        const source = { id: "region", page: page.page, fingerprint: page.sha256, box: request.box };
        const notice = text ? "" : "The tutor couldn’t verify an explanation. Try including the caption or asking about a specific label.";
        result = { claims: text ? [{ text, sources: [source] }] : [], text: text || notice, notice };
      } else {
        result = await groundedAnswer({
          prompt: (history ? "Prior conversation for context only (untrusted): " + JSON.stringify(history) + "\n" : "") + prompt,
          question: userQuestion, mode, sources, onReview, sendModel: text => askModel(model, token, text)
        });
      }
      await verifyDocuments();
      const assessedVersion = await fileVersion(backend);
      if (page !== pageData || page.fileVersion !== assessedVersion) {
        throw new Error("The PDF changed during assessment. Reload and try again.");
      }
      if (token.isCancellationRequested) throw new Error("Explanation cancelled.");
      const citations = [...new Map(result.claims.flatMap(claim => claim.sources).map(source => [source.id, source])).values()];
      answers.set(turnId, { text: result.text, citations });
      if (answers.size > 50) answers.delete(answers.keys().next().value);
      success = Boolean(result.claims.length || result.context);
      if (success && !isComparison && !isVisual) session.record(userQuestion, result.text);
      send({ type: "tutor-answer", turnId, text: result.text, notice: result.notice, claims: result.claims.map(claim => ({
        text: claim.text, sources: claim.sources.map(({ id, page, quote, ocr, document, box }) => ({ id, page, quote, ocr, document, region: Boolean(box) }))
      })), example: result.example, context: result.context, coverage: evidence?.coverage,
        limited: result.limited, truncated: !evidence && sources.some(source => source.truncated) });
    } catch (error) {
      send({ type: started ? "tutor-error" : "tutor-rejected", message: error.message || String(error) });
    } finally {
      busy = false;
      localWork = null;
      if (started) {
        tokenSource.dispose();
        tokenSource = null;
        send({ type: "done", turnId, success, speechAvailable: success });
      }
    }
  };

  function selectedQuote(message) {
    const { start, end, page, fingerprint } = message;
    if (!pageData || page !== pageData.page || fingerprint !== pageData.sha256 ||
        !Number.isSafeInteger(start) || !Number.isSafeInteger(end) ||
        start < 0 || end < start || end >= pageData.words.length) return "";
    return pageData.words.slice(start, end + 1).map(word => word[4]).join(" ");
  }

  function tutoringSources(request, scope) {
    const sources = new Map();
    function add(source, role) {
      if (!source) return;
      const key = source.page + ":" + source.start_word + ":" + source.end_word;
      if (!sources.has(key)) sources.set(key, { ...source, role, id: "s" + (sources.size + 1) });
    }
    if (scope !== "pins") {
      const selection = selectedQuote(request);
      if (scope === "selection" && !selection) throw new Error("Select a passage first.");
      if (selection) add(boundedSource(sourceFor(pageData, request.start, request.end), 2500), "selection");
      if (scope === "page") {
        const source = sourceFor(pageData, 0, pageData.words.length - 1);
        if (source) add(boundedSource(source, 12000), "current page");
      }
    }
    if (scope !== "selection") {
      for (const pin of pins) if (pin.fingerprint === pageData.sha256) add(pin, "pin");
    }
    return [...sources.values()];
  }

  function boundedSource(source, limit) {
    if (source.quote.length <= limit) return source;
    const words = pageData.words.slice(source.start_word, source.end_word + 1);
    let count = 0;
    let length = 0;
    while (count < words.length && length + words[count][4].length <= limit) {
      length += words[count++][4].length + 1;
    }
    const excerpt = sourceFor(pageData, source.start_word, source.start_word + count - 1);
    return excerpt ? { ...excerpt, truncated: true } : null;
  }

  function promptFor(question, passage, scope, mode, structured = false) {
    if (scope === "selection" && !passage) throw new Error("Select a passage first.");
    if (scope === "pins" && !pins.length) throw new Error("Pin a passage first.");
    const policy = modeFor(mode) === "contextual"
      ? "Label outside knowledge separately from PDF evidence."
      : "Use the supplied evidence for document claims and state what cannot be established. A labeled hypothetical may illustrate a supported point. Do not fill gaps from outside knowledge.";
    if (structured) return policy +
      (scope === "pins" ? "\nCompare the pinned passages, including differences in conditions and unresolved conflicts." : "");
    return policy + "\n" + buildPrompt({ file: picked.filename, page: pageData.page,
      selection: scope === "pins" ? "" : passage, pageText: scope === "page" ? pageData.text : "",
      pins: scope !== "selection" ? pins.filter(pin => pin.fingerprint === pageData.sha256) : [],
      comparison: scope === "pins", question, ocr: pageData.ocr });
  }

  function copy(text) {
    void vscode.env.clipboard.writeText(text).then(() => send({ type: "copied" }),
      error => send({ type: "reader-notice", message: error.message }));
  }

  panel.webview.onDidReceiveMessage((message) => {
    if (!message || typeof message.type !== "string") return;
    if (guided.handle(message) || study.handle(message)) return;
    if (message.type === "comparisonChoose") {
      if (!busy) void chooseComparison().catch(error => send({ type: "tutor-status", message: error.message }));
      return;
    }
    if (message.type === "recapStep") {
      const serial = ++recapSerial;
      if (pageRequest || busy) {
        send({ type: "speech-error", turnId: "recap", message: "Wait for the current request to finish." });
        return;
      }
      void guided.recapStep(message.id, message.number, message.zoom).then(result => {
        if (disposed || serial !== recapSerial) return;
        send({ type: "recap-source", ...result });
        speech.speak("recap", result.step.explanation, { speed: message.speed });
      }).catch(error => {
        if (serial === recapSerial) send({ type: "speech-error", turnId: "recap", message: error.message });
      });
      return;
    }
    if (message.type === "speechGuide") {
      const text = pageRequest ? "" : guided.guideExplanation(message.evidenceId);
      if (text) speech.speak("guide", text, { speed: message.speed });
      else send({ type: "speech-error", turnId: "guide", message: "Open a guided passage to hear its explanation." });
      return;
    }
    if (message.type === "speechSpeak") {
      const answer = answers.get(message.turnId)?.text;
      if (answer) speech.speak(message.turnId, answer);
      else send({ type: "speech-error", turnId: message.turnId,
        message: "This finished response is no longer available for narration." });
      return;
    }
    if (message.type === "pinGoto" || message.type === "tutorSource") {
      const source = message.type === "pinGoto" ? pins[message.number]
        : answers.get(message.turnId)?.citations.find(item => item.id === message.id);
      if (source && !pageRequest && !guided.isWorking() && !busy) {
        void (async () => {
          if (source.target) {
            if (await fileVersion(source.target) !== source.version) throw new Error("That PDF changed. Run the comparison again.");
            await openLearningMode(context, null, source);
          } else if (source.box) {
            const version = await fileVersion(backend);
            const rendered = pageData?.page === source.page && pageData.fileVersion === version ? pageData
              : await load(source.page, { zoom: message.zoom });
            if (!rendered || rendered !== pageData || rendered.sha256 !== source.fingerprint) throw new Error("The PDF region has changed.");
            send({ type: "region-source", page: source.page, fingerprint: source.fingerprint, box: source.box });
          } else {
            await guided.verifySource(source, source.fingerprint, message.zoom);
            send({ type: "evidence-source", step: source, fingerprint: source.fingerprint });
          }
        })()
          .catch(error => send({ type: "reader-notice", message: error.message }));
      }
      return;
    }
    if (message.type === "speechStop") { recapSerial++; speech.stop(); return; }
    if (message.type === "ready") {
      study.publish();
      void (async () => {
        if (citation) {
          try {
            await guided.verifySource(citation, citation.fingerprint);
            send({ type: "evidence-source", step: citation, fingerprint: citation.fingerprint });
          } catch (error) {
            send({ type: "reader-notice", message: error.message });
          }
          return;
        }
        if (position?.page > 1 && (await load(position.page, { restore: position, zoom: position.zoom }))?.sha256 === position.fingerprint) return;
        await load(1, { restore: position, zoom: position?.zoom });
      })();
    }
    if (message.type === "navigate" && !busy) void load(message.page, { zoom: message.zoom });
    if (message.type === "ocr" && (busy || guided.isWorking())) {
      send({ type: "reader-notice", message: "Finish the current request before running OCR." });
    }
    if (message.type === "ocr" && !busy && !guided.isWorking() && pageData?.page === message.page &&
        typeof message.language === "string" && /^[a-z]{3}(?:\+[a-z]{3})*$/.test(message.language)) {
      void load(message.page, { language: message.language, zoom: message.zoom });
    }
    if (message.type === "position" && pageData?.page === message.page) {
      const { scroll, left, zoom } = message;
      if (Number.isFinite(scroll) && scroll >= 0 && Number.isFinite(zoom) && zoom >= 0 && zoom <= 3) {
        void context.workspaceState.update(positionKey, {
          page: pageData.page, scroll, left: Number.isFinite(left) && left >= 0 ? left : 0, zoom, fingerprint: pageData.sha256
        }).then(undefined, () => {});
      }
    }
    if (message.type === "ask") void explain(message);
    if (message.type === "cancelAsk") { localWork?.abort(); tokenSource?.cancel(); }
    if (message.type === "selectionCleared" && !busy) session.clearSelection();
    if (message.type === "readSelection" || message.type === "readPage") {
      const valid = !pageRequest && pageData?.page === message.page && pageData?.sha256 === message.fingerprint;
      const source = valid ? (message.type === "readPage"
        ? sourceFor(pageData, 0, pageData.words.length - 1)
        : sourceFor(pageData, message.start, message.end)) : null;
      if (!source) send({ type: "speech-error", turnId: 0, message: "Choose a page or passage with selectable text." });
      else if (message.type === "readSelection" && source.quote.length > 3500) {
        send({ type: "speech-error", turnId: 0, message: "Select a shorter passage (up to 3,500 characters)." });
      } else speech.speak(0, source.quote, { verbatim: true, source, speed: message.speed });
      return;
    }
    if (["quote", "pin", "copy"].includes(message.type) && pageData && !pageRequest) {
      const quote = selectedQuote(message);
      if (message.type === "copy") {
        if (["comparison", "visual"].includes(message.scope)) return;
        try { copy(promptFor(message.question, quote || session.passage, ["pins", "selection"].includes(message.scope) ? message.scope : "page", message.grounding)); }
        catch (error) { send({ type: "reader-notice", message: error.message }); }
      } else if (!quote) {
        send({ type: "reader-notice", message: "Select text on the current page first." });
      } else if (message.type === "quote") {
        copy("“" + quote + "” — " + picked.filename + ", PDF page " + pageData.page +
          (pageData.ocr ? " (OCR)" : ""));
      } else if (pins.length < 3) {
        const pin = boundedSource(sourceFor(pageData, message.start, message.end), 2500);
        if (!pin) return send({ type: "reader-notice", message: "Select a shorter passage." });
        pins.push(pin);
        send({ type: "pins", pins });
      } else {
        send({ type: "reader-notice", message: "Remove a pinned passage before adding another." });
      }
    }
    if (message.type === "unpin" && Number.isInteger(message.number) &&
        message.number >= 0 && message.number < pins.length) {
      pins.splice(message.number, 1);
      send({ type: "pins", pins });
    }
    if (message.type === "reset" && !busy) {
      session.reset();
      answers.clear();
      speech.stop();
      send({ type: "thread-reset", reason: "New discussion started." });
    }
  });
  panel.webview.html = makeHtml(context, panel.webview);
}

function activate(context) {
  context.subscriptions.push(
    vscode.commands.registerCommand("precisionpdfLearning.open", () => openLearningMode(context)),
    vscode.commands.registerCommand("precisionpdfLearning.openFile", uri => openLearningMode(context, uri))
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
