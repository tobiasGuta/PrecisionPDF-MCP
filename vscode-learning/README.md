# PrecisionPDF Learning Mode (experimental)

An **optional read-only VS Code extension** for reading course PDFs and asking
questions about selected passages. It uses the existing PrecisionPDF Python
installation to render pages and extract word locations. This feature does
not alter the MCP server or any annotations.

## Fedora development setup

1. From the PrecisionPDF-MCP repository checkout, run
   `uv sync --extra dev` and `uv run pytest -q`.
2. In VS Code, open the **vscode-learning** subdirectory as a folder.
3. Press **F5** to launch an Extension Development Host.
4. In the new VS Code window, use **File → Open Folder** to open your PDF
   workspace (the directory containing the PDFs).
5. Open the Command Palette and run **PrecisionPDF: Open Learning Mode**.
6. Pick a PDF, select text by dragging across the rendered page, and click
   **Ask with Copilot** to request an explanation. You may be asked to grant
   language-model access to this extension.

The extension requests a model via the official VS Code Language Model API
(`vendor: "copilot"`). A GitHub Copilot account with available model access is
required for in-panel explanations. Requests count against existing plan
quotas; the extension does **not** require or collect an API key. If no Copilot
model is available, click **Copy prompt** and paste into your existing VS Code
chat, Codex, or Antigravity session instead. Those products' subscriptions
are not automatically interchangeable with the Copilot extension API.

If your repository lives somewhere else after packaging/installing the
extension, set `precisionpdfLearning.repositoryPath` to its absolute path.
If VS Code cannot locate uv, set `precisionpdfLearning.uvPath` to the full
executable path returned by `command -v uv`.

## Tests

Run `uv run pytest -q` from the repository root and
`npm test` from `vscode-learning/` (Node.js 20+; no npm install needed).
A manual VS Code Extension Development Host test is still required for the
webview, word selection, and actual Copilot access.

## Scope and safety

- The viewer is a **prototype** for ordinary horizontal, selectable PDF text.
  Scanned, encrypted, rotated, or unusually laid out pages may not work.
- Selection is word-level. Rendering is local using PyMuPDF; PDFs remain
  inside the configured workspace using the existing path checks.
- The bridge never writes files or annotations. Use the regular PrecisionPDF
  MCP tools when you want to highlight or edit annotations.
- The page's extracted text (up to 12,000 characters) and selected quote
  (up to 2,500 characters) are sent to Copilot **only when you click Ask**.
  Review document privacy requirements before using cloud models.
- No outbound network calls are made by PrecisionPDF's Python bridge itself.
- No model requests happen automatically while navigating the PDF.
