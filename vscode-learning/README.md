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

## Query-aware exact search and guided explanation (v0.5 experiment)

Guided Reading now has an **Automatic / Find exact wording / Guided explanation**
selector. In Automatic mode, a location question with a short quoted phrase,
such as `Where does it mention "black box"?`, takes the **local exact-search**
path. `Find all mentions of black box` is also understood. Other requests,
such as `Explain why the black-box problem matters` or `What are the main
ideas?`, use the existing Copilot-guided explanation flow. The dropdown lets
you override automatic routing.

**Exact search** examines every indexed PDF word on every page, including
phrases crossing sentence-index boundaries. Matches ignore case and outer
punctuation. It reports the **total number of matching occurrences** and
the number of matching pages. Up to 150 matches are displayed as clickable
page-linked temporary highlights; a larger result set reports the full
count but clearly indicates that only the first 150 are displayed.
The index must be complete and internally consistent, or searching fails
closed; no truncated document can be claimed as fully searched. Local exact
search makes **zero Copilot requests** and never uploads PDF text.

From exact results, **Explore related ideas with Copilot** explicitly switches
to the existing non-exhaustive guided explanation workflow. That workflow
asks permission and estimates the model-request count before any extracted
PDF text is sent to Copilot. Related passages are AI-selected supporting
examples, **not all semantic mentions**; checking that an excerpt exists
does not establish that every explanation is correct. A missing exact match
is reported as zero, without made-up evidence. Previous/Next and Play/Pause
retain the established 12-second interval. None of these functions edit a PDF.

## Relevance-aware Guided Reading (v0.6 experiment)

For Copilot-guided explanations (including **Explore related ideas**),
PrecisionPDF now performs three bounded stages: identify candidate excerpts,
draft an explanation tour, and request a **skeptical relevance review** of
each proposed explanation against its exact source quote and the user
question. The review may classify each source as **direct**, **broader**, or
**reject**; missing or invalid reviews reject that passage. A passage already
classified as broader cannot be upgraded to direct later. Fewer high-quality
passages are preferred; the interface does not try to fill a fixed step quota.

**Direct evidence** appears in the main guided tour by default. **Broader
connections** are separate and initially hidden; click **Show broader
connections** to opt in. If no direct evidence survives review, the guide
does not start playback or claim it answered the question, but allows
optional viewing of broader evidence. Each step shows the proposed relevance
reason and the reviewer's reason. Excluded or unsupported passages are not
presented or highlighted. The overview contains only reviewed direct-step
explanations, not rejected or hidden broader material.

This is an extra model request per guided analysis (the permission prompt
now accounts for **evidence batches + synthesis + review**). These
classifications are **AI judgments, not independent truth verification**;
the underlying quote, page, word positions and PDF fingerprint remain
locally verified as before. Always check that the explanation actually
follows from the source. Exact wording searches are still entirely local,
exhaustive within the supported full document, and require zero Copilot
requests. The Play/Pause cadence remains 12 seconds per step; manual tutoring,
PDF annotations, and original documents are unchanged.

## Focused relevance and accurate counters (v0.6.1 experimental)

For focused Copilot questions such as **black box**, candidate passages must
also satisfy a conservative local topicality check. It accepts a few explicit
interpretability-related expressions, but rejects loosely related AI-industry,
energy, climate or water paragraphs. This deterministic lexical check can
exclude some genuine paraphrases; it is a conservative filter, **not a
semantic-proof system**. Broader evidence additionally requires a reviewer-
supplied exact quotation fragment (verified against the source) and a
substantive connection to the requested concept. Missing, contradictory,
or off-topic connections are rejected. **Zero broader connections is valid**,
and no minimum number of items is forced.

The main tour shows **Direct evidence 1 of N** and optional context shows
**Broader connection 1 of M** with separate counters. Any accepted broader
description is rewritten from the reviewer's qualified, contextual link,
rather than reusing an AI draft that might claim to directly answer.
The source coordinates and SHA-256 checks are unchanged. An exact search
still makes zero Copilot calls.

In Automatic mode, entering a short bare term like `black box` or `AI
safety` is interpreted as a local exact-phrase search. Explicit questions
(e.g. `Explain the black-box problem`) remain Copilot-guided. Quoted
phrases alone are also exact searches, and the dropdown always overrides
routing. No new API calls are added beyond the existing candidate,
synthesis and relevance-review stages. The guided playback delay remains
12 seconds; manual tutoring and all PDF-writing MCP tools are untouched.

Validation: run `npm --prefix vscode-learning test` and
`uv run pytest -q` on Fedora, followed by the Extension Development Host.
Repeat a guided interpretability question and confirm environmental water
and data-center passages are excluded or the answer is conservatively
shorter; inspect actual source passages before trusting the labels.

## Clearer direct explanations and evidence-grounded overviews (v0.6.2)

The existing Copilot relevance-review request now optionally returns a
coherent, brief `directOverview` and the IDs of ALL accepted direct passages
used to write it. The extension only uses that overview if every listed ID
corresponds exactly to a passage that survived the review as direct evidence.
Otherwise it displays short **verbatim source excerpts with page numbers**
instead of joining repeated “this excerpt…” model descriptions. This checks
provenance and source linkage, **not semantic correctness**; inspect the
quoted evidence before accepting an interpretation. No extra Copilot request
is introduced.

The direct-versus-contextual boundary is stricter for *black-box* questions.
Saying a neural network is merely *unreliable* or *unpredictable* does not by
itself establish that its learned mechanisms are hard to interpret. Such an
excerpt can only enter the optional context section with the existing
verified quote and explicit conceptual bridge, or else it is excluded.
The viewer labels direct passages as explanations of the asked concept and
optional broader passages as **contextual examples, not direct proof**.

No changes to exact local search, original text selection, PDF writes,
fingerprint/coordinate verification, Copilot approval flow or the
12-second guided playback cadence. Regression tests cover missing or
mismatched overview provenance, no direct passages, semantic downgrades,
contextual opt-in, and the unchanged search and manual tutor workflows.
