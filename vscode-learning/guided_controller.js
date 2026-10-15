"use strict";

const { execFile } = require("node:child_process");
const { prepareBatches, generateGuide } = require("./guide");
const { resolveQuery, findExactMentions } = require("./search");

function readIndex(vscode, repo, picked) {
  return new Promise((resolve, reject) => {
    const uv = vscode.workspace.getConfiguration("precisionpdfLearning").get("uvPath") || "uv";
    execFile(uv, ["--directory", repo, "run", "python", "-m", "precisionpdf_mcp.guided_index",
      "--root", picked.root, "--file", picked.filename],
    { cwd: repo, timeout: 60000, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) return reject(new Error((stderr || error.message).trim().slice(0, 1000)));
      try { resolve(JSON.parse(stdout)); }
      catch (_) { reject(new Error("Unexpected Guided Reading evidence response.")); }
    });
  });
}

function attachGuidedReading({ vscode, repo, picked, send, load, currentPage, panel, tutoringBusy }) {
  let index = null;
  let plan = null;
  let working = false;
  let cancelled = false;
  let tokenSource = null;
  let disposed = false;

  async function askModel(model, question) {
    if (cancelled || disposed) throw new Error("Guided analysis cancelled.");
    const response = await model.sendRequest([vscode.LanguageModelChatMessage.User(question)], {}, tokenSource.token);
    let body = "";
    for await (const fragment of response.text) {
      if (cancelled || disposed) throw new Error("Guided analysis cancelled.");
      body += fragment;
      if (body.length > 25000) throw new Error("Copilot exceeded the bounded guide response size.");
    }
    return body;
  }

  async function activateStep(number) {
    if (!plan || working || tutoringBusy()) return;
    if (!Number.isSafeInteger(number) || number < 0 || number >= plan.steps.length) return;
    const step = plan.steps[number];
    let page = currentPage();
    if (!page || page.page !== step.page) page = await load(step.page);
    if (!page || page.page !== step.page) throw new Error("PDF navigation could not confirm the target page.");
    if (page.sha256 !== plan.fingerprint) {
      plan = null;
      throw new Error("The PDF changed after indexing; close and reopen Guided Reading before highlighting.");
    }
    // Verify that this exact word range is still present before highlighting.
    const range = page.words.slice(step.start_word, step.end_word + 1);
    if (range.length !== step.end_word - step.start_word + 1 ||
        range.map(word => String(word[4])).join(" ") !== step.quote) {
      throw new Error("Evidence coordinates no longer match the PDF; highlight refused.");
    }
    send({ type: "guide-activate", number, step });
  }

  async function start(question, approach = "auto") {
    if (working || tutoringBusy() || disposed) return;
    working = true;
    cancelled = false;
    index = null;
    plan = null;
    send({ type: "guide-clear" });
    send({ type: "guide-progress", message: "Indexing PDF text locally…" });
    try {
      // Classify locally. Exact quote search never invokes Copilot or asks
      // permission to upload document text.
      const route = resolveQuery(question, approach);
      index = await readIndex(vscode, repo, picked);
      if (cancelled || disposed) { send({ type: "guide-cancelled" }); return; }
      if (route.kind === "exact") {
        plan = findExactMentions(index, route.phrase);
        send({ type: "guide-plan", plan });
        working = false;
        if (plan.steps.length) await activateStep(0);
        return;
      }
      const batches = prepareBatches(index);
      send({ type: "guide-progress", message: "Indexed " + index.pages + " pages; " + batches.length + " analysis sections." });
      const count = batches.length + 1;
      const agreed = await vscode.window.showWarningMessage(
        "Guided Reading will send extracted PDF text to GitHub Copilot using up to " + count +
        " model requests (" + index.pages + " pages). This may use your plan quota. Continue?",
        { modal: true }, "Analyze PDF"
      );
      if (agreed !== "Analyze PDF" || cancelled || disposed) {
        send({ type: "guide-cancelled" });
        return;
      }
      const models = await vscode.lm.selectChatModels({ vendor: "copilot" });
      if (!models.length) throw new Error("No Copilot model available. Sign in and verify model access in VS Code.");
      tokenSource = new vscode.CancellationTokenSource();
      plan = await generateGuide({ index, question,
        sendModel: prompt => askModel(models[0], prompt),
        onProgress: message => send({ type: "guide-progress", message }) });
      if (cancelled || disposed) throw new Error("Guided analysis cancelled.");
      send({ type: "guide-plan", plan });
      working = false;
      await activateStep(0);
    } catch (error) {
      plan = null;
      if (!disposed) send({ type: "guide-error", message: error.message || String(error) });
    } finally {
      working = false;
      if (tokenSource) { tokenSource.dispose(); tokenSource = null; }
    }
  }

  function handle(message) {
    if (message.type === "guideStart") {
      void start(String(message.question || "").slice(0, 800), message.approach || "auto");
      return true;
    }
    if (message.type === "guideRelated") {
      // Related/conceptual evidence is selected by Copilot, not exhaustive.
      void start(String(message.question || "").slice(0, 800), "guided");
      return true;
    }
    if (message.type === "guideGoto") {
      void activateStep(message.number).catch(error => send({ type: "guide-error", message: error.message }));
      return true;
    }
    if (message.type === "guideCancel") {
      cancelled = true;
      if (tokenSource) tokenSource.cancel();
      return true;
    }
    return false;
  }

  panel.onDidDispose(() => {
    disposed = true; cancelled = true;
    if (tokenSource) tokenSource.cancel();
  });
  return { handle, isWorking: () => working };
}

module.exports = { attachGuidedReading };
