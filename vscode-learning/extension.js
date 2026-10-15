"use strict";

const vscode = require("vscode");
const path = require("node:path");
const fs = require("node:fs");
const { execFile } = require("node:child_process");
const { randomBytes } = require("node:crypto");
const { buildPrompt } = require("./prompt");

function resolveRepoPath() {
  const setting = vscode.workspace.getConfiguration("precisionpdfLearning").get("repositoryPath");
  return path.resolve(setting || path.join(__dirname, ".."));
}

function readPage(repo, root, filename, page) {
  return new Promise((resolve, reject) => {
    const uv = vscode.workspace.getConfiguration("precisionpdfLearning").get("uvPath") || "uv";
    execFile(uv, [
      "--directory", repo, "run", "python", "-m", "precisionpdf_mcp.reader_bridge",
      "--root", root, "--file", filename, "--page", String(page)
    ], { cwd: repo, timeout: 45000, maxBuffer: 24 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) return reject(new Error((stderr || error.message).trim().slice(0, 800)));
      try { resolve(JSON.parse(stdout)); }
      catch (_) { reject(new Error("Unexpected PDF reader response.")); }
    });
  });
}

async function pickPdf() {
  const folders = vscode.workspace.workspaceFolders || [];
  if (!folders.length) {
    vscode.window.showWarningMessage("Open your PDF workspace folder before starting Learning Mode.");
    return;
  }
  const results = [];
  for (const folder of folders) {
    const matches = await vscode.workspace.findFiles(
      new vscode.RelativePattern(folder, "**/*.pdf"),
      "**/{.git,node_modules,.venv}/**", 150
    );
    for (const uri of matches) {
      const rel = path.relative(folder.uri.fsPath, uri.fsPath);
      if (rel.startsWith("..") || path.isAbsolute(rel)) continue;
      results.push({ label: rel, description: folder.name, folder, rel });
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
    .replaceAll("{{JS}}", uri("viewer.js"));
}

async function openLearningMode(context) {
  const picked = await pickPdf();
  if (!picked) return;
  const repo = resolveRepoPath();
  if (!fs.existsSync(path.join(repo, "src", "precisionpdf_mcp", "reader_bridge.py"))) {
    vscode.window.showErrorMessage(
      "PrecisionPDF repository not found. Set precisionpdfLearning.repositoryPath to your clone directory."
    );
    return;
  }

  const panel = vscode.window.createWebviewPanel(
    "precisionpdfLearning", "PrecisionPDF Learning: " + path.basename(picked.filename),
    vscode.ViewColumn.One,
    { enableScripts: true, retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "media")] }
  );
  panel.webview.html = makeHtml(context, panel.webview);

  let pageData = null;
  let busy = false;
  let tokenSource = null;
  let lastTurns = [];

  const send = (message) => { if (panel.visible) void panel.webview.postMessage(message); };
  panel.onDidDispose(() => { if (tokenSource) tokenSource.cancel(); });

  const load = async (pageNumber) => {
    const n = Number(pageNumber);
    if (!Number.isSafeInteger(n) || n < 1 || (pageData && n > pageData.pages)) {
      send({ type: "error", message: "Page is outside the document." });
      return;
    }
    send({ type: "loading" });
    try {
      pageData = await readPage(repo, picked.root, picked.filename, n);
      send({ type: "page", data: pageData });
    } catch (error) {
      send({ type: "error", message: error.message });
    }
  };

  const explain = async (request) => {
    if (busy) return;
    if (!pageData) return send({ type: "error", message: "Load a PDF page first." });
    const userQuestion = String(request.question || "").trim().slice(0, 1500);
    if (!userQuestion) return send({ type: "error", message: "Enter a question." });
    const selection = String(request.selection || "").slice(0, 2500);
    const prompt = buildPrompt({
      file: picked.filename, page: pageData.page,
      selection, pageText: pageData.text, question: userQuestion
    });
    busy = true;
    tokenSource = new vscode.CancellationTokenSource();
    send({ type: "thinking" });
    try {
      // Model access and authentication prompts occur only following the user's Ask click.
      const models = await vscode.lm.selectChatModels({ vendor: "copilot" });
      if (!models.length) {
        throw new Error("No Copilot model is available to this extension. Sign into GitHub Copilot in VS Code, or use Copy Prompt to ask in your existing chat.");
      }
      const earlier = lastTurns.slice(-2).map(t => (
        "Previous user question: " + t.question + "\nPrevious tutor explanation: " + t.answer.slice(0, 2400)
      )).join("\n\n");
      const messages = [vscode.LanguageModelChatMessage.User(
        (earlier ? "Recent conversation for continuity (reference only):\n" + earlier + "\n\n" : "") + prompt
      )];
      const response = await models[0].sendRequest(messages, {}, tokenSource.token);
      let answer = "";
      for await (const chunk of response.text) {
        answer += chunk;
        if (answer.length > 24000) {
          tokenSource.cancel();
          break;
        }
        send({ type: "chunk", text: chunk });
      }
      if (answer) {
        lastTurns.push({ question: userQuestion, answer });
        lastTurns = lastTurns.slice(-3);
      }
      send({ type: "done" });
    } catch (error) {
      send({ type: "error", message: error.message || String(error) });
      send({ type: "done" });
    } finally {
      busy = false;
      tokenSource.dispose();
      tokenSource = null;
    }
  };

  panel.webview.onDidReceiveMessage((message) => {
    if (!message || typeof message !== "object") return;
    if (message.type === "ready") void load(1);
    if (message.type === "navigate") void load(message.page);
    if (message.type === "ask") void explain(message);
    if (message.type === "copy") {
      if (!pageData) return;
      const prompt = buildPrompt({
        file: picked.filename, page: pageData.page,
        selection: message.selection, pageText: pageData.text,
        question: message.question
      });
      void vscode.env.clipboard.writeText(prompt).then(() => send({ type: "copied" }));
    }
  });
}

function activate(context) {
  context.subscriptions.push(
    vscode.commands.registerCommand("precisionpdfLearning.open", () => openLearningMode(context))
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
