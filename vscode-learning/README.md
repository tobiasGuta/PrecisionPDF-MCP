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

## Tutor discussions and formatted explanations (v0.2 experiment)

- Ask a question about selected PDF text, then ask another question without
  reselecting to continue discussing the same passage. The conversation shows
  previous questions and answers while you navigate pages and passages,
  until you click **New discussion**.
- The extension retains only the latest three bounded question/answer turns in
  memory for the model. Discussions are not saved to disk.
- Copilot Markdown responses display headings, lists, basic emphasis, code
  blocks, quotations, and plain-text math notation. This is a deliberately
  minimal offline formatter, **not** a TeX math typesetter or general Markdown
  renderer. Raw HTML and unsafe external links are not interpreted.
- Original PDF selection, rendering, and highlighting behavior remain
  unchanged. The Learning Mode interface remains read-only.
- Run `npm --prefix vscode-learning test` at the repository root to execute
  tests for formatting and discussion history. Verify the UI and Copilot flow
  manually in the VS Code Extension Development Host.

## Follow-up composer and passage switching (v0.2.1)

The question composer stays visible at the bottom of the tutor pane while
the discussion above it scrolls independently. Use **Ctrl+Enter** to send a
question. **New discussion** clears the conversation and its active passage.
Finishing a new text selection changes the active quote but preserves history.
Switching PDF pages changes the active page and clears the active quote, but
preserves earlier discussion. Blank lines between numbered Markdown items no longer
restart ordered lists at 1.

To verify in the Extension Development Host: explain passage A, send a follow-up
without scrolling back to the input, select passage B (the old conversation
should stay visible), ask about B, click New discussion (history should disappear),
then ask a new question without old context. The page and annotation tools
remain read-only in Learning Mode.

## Continuous page-aware discussions (v0.3 experimental)

Keep one visible discussion per open PDF while moving between pages or selecting
new passages. The question composer stays at the bottom of the tutor panel.
Navigation changes the active page, clears the active selection, and leaves all
previous on-screen messages intact. New text selections replace the active
source passage without deleting the conversation. The visible conversation is
ephemeral and ends when you close Learning Mode.

The AI receives the current page's extracted text and current selection, plus
at most three bounded past question-answer turns including their page numbers
and selected quotes. These past turns are context, not a replacement for full
previous page contents. When comparing pages, the tutor must distinguish
earlier quoted evidence from its own prior interpretations and acknowledge any
missing source text. **New discussion** explicitly clears all chat context.
**Clear selection** clears only the active quote, not the conversation.

Suggested test: select a quote on page 3, ask for an explanation, navigate to
page 4, ask to compare the discussion to the current page, return to page 3,
then choose New discussion. Verify the discussion persists on navigation and
vanishes only after New discussion. The PDF text-selection logic remains
unchanged and no document edits are performed by Learning Mode.

## Guided Reading Mode (v0.4 experimental)

Switch from **Manual tutoring** to **Guided Reading** in the same PDF reader.
Ask "What are the main ideas of this PDF?" (or a different whole-document
question) and select **Analyze PDF**. The reader indexes selectable text on
all PDF pages locally first; after indexing it displays the exact estimated
Copilot request count and asks for confirmation before sending anything to
the model. Analysis selects identifiers tied to local word ranges, and a
second model response arranges up to seven guided explanation steps. Each step
opens the source page and temporarily highlights the matched words. Use
**Previous**, **Next**, **Play** (12 seconds per step), or **Pause** to navigate.

**Safety and scope:** no annotations or PDF writes. Workspace confinement,
whole-file SHA-256 and exact word-range text checks guard visual highlights;
if evidence is missing or changed, the highlight is refused. These checks
verify **where the quote comes from**, not whether every AI interpretation is
correct; always inspect the evidence. Extracted PDF text is untrusted model
input, never executable instructions. The tool currently supports up to
60 pages, 350,000 indexed characters, 1,600 excerpts and 30 analysis
batches (plus one final synthesis request). Over-limit documents fail
without a partial "whole-PDF" summary. Scanned, encrypted, rotated and
unusually laid out PDFs may need preprocessing. No OCR is performed.

This remains experimental and separate from the manual tutor conversation.
Model-generated summaries aren't persisted. The full real VS Code/Copilot
integration requires an Extension Development Host test on Fedora.

## More precise Guided Reading evidence (v0.4.1 experiment)

Evidence is now indexed at sentence boundaries within PDF text blocks instead
of using fixed 38-word slices. A sentence spanning several lines stays intact
where possible, and very long sentences are divided into explicitly labeled,
bounded fragments. Each excerpt still maps to an exact contiguous range of the
same sorted PDF words used by the viewer; the fingerprint, position and exact
text are checked before temporary highlighting.

If the PDF has authored outline/bookmarks, these are included as **section
hints** in the AI's analysis and shown beside the guided steps. Copilot is
also told that a PDF might contain several independent readings, and should
not invent a unified argument. Bookmark labels are not proof of distinct
authorship; PDFs without outlines do not have verified reading boundaries.

The default guided playback remains **12 seconds per step**. The original
manual tutoring, annotations and PDF-writing tools are unchanged. Because
sentence-sized excerpts may create additional model batches, the approval
dialog continues to display the estimated Copilot request count before
sending document text. Run both Python and Node regression tests on Fedora
and check that highlighting starts at natural sentence boundaries.
