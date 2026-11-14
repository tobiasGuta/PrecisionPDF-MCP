"use strict";

const vscode = require("vscode");
const path = require("node:path");
const fs = require("node:fs");
const { readerProcess, fileVersion } = require("./reader_process");
const { randomBytes } = require("node:crypto");
const { findWorkspacePdfs } = require("./pdf_picker");
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

async function openLearningMode(context, uri) {
  let picked;
  if (uri) {
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    if (!folder || !/\.pdf$/i.test(uri.path)) return;
    picked = { root: folder.uri.fsPath, filename: path.relative(folder.uri.fsPath, uri.fsPath) };
  } else {
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
  const session = new TutorSession();
  const answers = new Map();
  const pins = [];
  let turnSerial = 0;
  let loadSerial = 0;

  const send = (message) => { if (!disposed) void panel.webview.postMessage(message); };
  const speech = new SpeechService({ repo, send });
  panel.onDidDispose(() => {
    disposed = true;
    pageRequest?.abort();
    if (tokenSource) tokenSource.cancel();
    speech.dispose();
  });


  const load = async (pageNumber, { zoom, language, restore } = {}) => {
    const n = Number(pageNumber);
    if (!Number.isSafeInteger(n) || n < 1 || (pageData && n > pageData.pages)) {
      send({ type: "page-error", message: "Page is outside the document." });
      return null;
    }
    const requested = ++loadSerial;
    pageRequest?.abort();
    const request = new AbortController();
    pageRequest = request;
    send({ type: "loading" });
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
      const { passage } = session.prepare(pageData.page, selectedQuote(request));
      const scope = request.scope === "selection" ? "selection" : "page";
      const prompt = promptFor(userQuestion, passage, scope);
      const history = scope === "page" ? session.history() : "";
      busy = true;
      started = true;
      turnId = ++turnSerial;
      tokenSource = new vscode.CancellationTokenSource();
      send({ type: "thinking", question: userQuestion, page: pageData.page, passage, turnId });
      // Model access and authentication prompts occur only following the user's Ask click.
      const models = await vscode.lm.selectChatModels({ vendor: "copilot" });
      if (!models.length) {
        throw new Error("No Copilot model is available to this extension. Sign into GitHub Copilot in VS Code, or use Copy Prompt to ask in your existing chat.");
      }
      const messages = [vscode.LanguageModelChatMessage.User(
        (history ? "Earlier conversation (reference only; not document evidence):\n" + history + "\n\n" : "") + prompt
      )];
      if (await models[0].countTokens(messages[0], tokenSource.token) > models[0].maxInputTokens) {
        throw new Error("The prompt exceeds the model’s context limit. Try Selected passage only.");
      }
      if (tokenSource.token.isCancellationRequested) throw new Error("Explanation cancelled.");
      const response = await models[0].sendRequest(messages, {}, tokenSource.token);
      let answer = "";
      for await (const chunk of response.text) {
        if (tokenSource.token.isCancellationRequested) throw new Error("Explanation cancelled.");
        const fragment = chunk.slice(0, 24000 - answer.length);
        answer += fragment;
        send({ type: "chunk", text: fragment });
        if (fragment.length < chunk.length) {
          tokenSource.cancel();
          throw new Error("The explanation reached its length limit.");
        }
      }
      if (tokenSource.token.isCancellationRequested) throw new Error("Explanation cancelled.");
      session.record(userQuestion, answer);
      if (answer.trim()) {
        answers.set(turnId, answer);
        if (answers.size > 50) answers.delete(answers.keys().next().value);
      }
      success = Boolean(answer.trim());
    } catch (error) {
      send({ type: started ? "tutor-error" : "tutor-rejected", message: error.message || String(error) });
    } finally {
      if (started) {
        busy = false;
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

  function promptFor(question, passage, scope) {
    if (scope === "selection" && !passage) throw new Error("Select a passage first.");
    return buildPrompt({ file: picked.filename, page: pageData.page, selection: passage,
      pageText: scope === "page" ? pageData.text : "", pins: scope === "page" ?
        pins.filter(pin => pin.fingerprint === pageData.sha256) : [],
      question, ocr: pageData.ocr });
  }

  function copy(text) {
    void vscode.env.clipboard.writeText(text).then(() => send({ type: "copied" }),
      error => send({ type: "reader-notice", message: error.message }));
  }

  panel.webview.onDidReceiveMessage((message) => {
    if (!message || typeof message.type !== "string") return;
    if (guided.handle(message) || study.handle(message)) return;
    if (message.type === "speechGuide") {
      const text = pageRequest ? "" : guided.guideExplanation(message.evidenceId);
      if (text) speech.speak("guide", text, { speed: message.speed });
      else send({ type: "speech-error", turnId: "guide", message: "Open a guided passage to hear its explanation." });
      return;
    }
    if (message.type === "speechSpeak") {
      const answer = answers.get(message.turnId);
      if (answer) speech.speak(message.turnId, answer);
      else send({ type: "speech-error", turnId: message.turnId,
        message: "This finished response is no longer available for narration." });
      return;
    }
    if (message.type === "speechStop") { speech.stop(); return; }
    if (message.type === "ready") {
      study.publish();
      void (async () => {
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
    if (message.type === "cancelAsk") tokenSource?.cancel();
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
        try { copy(promptFor(message.question, quote || session.passage, message.scope === "selection" ? "selection" : "page")); }
        catch (error) { send({ type: "reader-notice", message: error.message }); }
      } else if (!quote) {
        send({ type: "reader-notice", message: "Select text on the current page first." });
      } else if (message.type === "quote") {
        copy("“" + quote + "” — " + picked.filename + ", PDF page " + pageData.page +
          (pageData.ocr ? " (OCR)" : ""));
      } else if (pins.length < 3) {
        pins.push({ quote: quote.slice(0, 2500), page: pageData.page, fingerprint: pageData.sha256, ocr: pageData.ocr });
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
