# PrecisionPDF Learning Mode

An **optional read-only VS Code extension** for reading course PDFs and asking
questions about selected passages. It uses the existing PrecisionPDF Python
installation to render pages and extract word locations. This feature does
not alter the MCP server or any annotations.

## Install in normal VS Code on Fedora (local VSIX)

1. Open the [latest GitHub Release](https://github.com/tobiasGuta/PrecisionPDF-MCP/releases/latest) and download the `.vsix` under **Assets**. In VS Code 1.98 or later, run **Extensions: Install from VSIX…** from the Command Palette and select the file.
2. Set up the matching Python backend in a terminal. Replace the tag below if you downloaded a different version.

   ```bash
   git clone --branch v0.8.2 https://github.com/tobiasGuta/PrecisionPDF-MCP.git
   cd PrecisionPDF-MCP
   uv sync
   ```

3. Reload VS Code, open the folder containing your PDFs, and run **PrecisionPDF: Open Learning Mode**. When asked for the backend folder, select the clone containing `pyproject.toml`. If VS Code cannot find `uv`, set `precisionpdfLearning.uvPath` in User settings to the path returned by `command -v uv`.

The VSIX contains the extension and webview assets. The Python backend runs from the clone. Install later updates from GitHub Releases and update the backend to the matching tag. Copilot is required for AI explanations and feedback. Local reading, Find, and self-checks work offline once set up.

For a VSIX downloaded from a GitHub Actions run, use the backend from the commit shown on that run.

### Build from source

With Node.js 22 or later, run these commands from the repository root.

```bash
cd vscode-learning
npm install
npm test
npm run package:vsix
code --install-extension precisionpdf-learning-0.8.6.vsix
```

## Reading a PDF

- Open a PDF from VS Code Explorer with **Open PDF in PrecisionPDF Learning Mode**, or use the Command Palette to browse the workspace. Reopening a PDF restores its page, scroll position, and zoom when the saved document fingerprint still matches.
- Use the page number field, authored PDF outline, or Left and Right arrows. Toggle **Study panel** to give the PDF the full width. **Back** returns to the position before a source jump. **Fit width** and the zoom selector adjust the reader independently of the tutor.
- Use **Find** or **Ctrl+F** inside the reader to search locally and jump to matches. Results show which pages had selectable text and how many were skipped. The count includes all matches within the supported search size. The first 150 hits are available for navigation.
- Select text to **Copy quote** with its PDF page, **Pin passage** for a cross-page comparison, or **Listen** to hear the selection with the optional local Kokoro setup. Up to three pins last for the reader session. **Read aloud** also works on completed tutor responses.
- **OCR this page** appears when a page has no selectable words. Install Tesseract language data first, such as `tesseract-langpack-eng` on Fedora. Set `TESSDATA_PREFIX` to the directory containing the `.traineddata` files if they are not detected. The reader reuses OCR results for selection, Find and Guided Reading during the session. Review OCR quotations against the page.
- In **Manual tutoring**, choose **Selection only** to send the question and selected text with its document and page labels. The full-context option also sends bounded page text, pins, and recent discussion. **Copy prompt** places source context on the clipboard for use in another chat client.
- In **Guided Reading**, choose the whole PDF, the current authored outline section, or a page range. The limit is 60 pages per guided run, with additional evidence and request limits. The confirmation reports the selected pages and maximum Copilot requests. Guide judgments use the question and source evidence across subjects.

## Source grounding and comparing passages

**Strict Source** is the default in Manual Tutoring and Guided Reading. It uses the supplied evidence for document claims and reports when the available evidence is insufficient. **Contextual Explanation** allows additional background or examples in a separate **Additional model context** section. This section is model-generated and can be wrong.

In Manual Tutoring, choose the context to send and click **Ask with Copilot**. Text answers use a draft and a support review, with one extra request if Copilot returns an unreadable reply. The reader resolves the draft’s quotes to the original PDF words before review. The reviewer checks whether those words support each claim and whether the claim directly helps answer your question. If the reviewer identifies a restriction that conflicts with the claim, it must quote the limiting passage. Click a **PDF page** citation to highlight the reviewed words. Citations from OCR are marked, and the tutor indicates when it withheld a claim or sent only part of a long passage. The reader retains citation targets for its latest 50 answers within the session.

For a general question like “Explain this passage,” the tutor focuses on the selection if there is one and otherwise uses the current page. **Pinned passages only** focuses the answer on your pins. Both explanation modes can show a labeled **Hypothetical example** based on verified claims. If the example cannot be supported, the tutor can still show the explanation. When the tutor cannot verify an answer, it keeps your question in the composer so you can refine it.

In Guided Reading, Copilot assesses the drafted overview alongside its proposed steps and additional retrieved excerpts. Before displaying a guide, the reader checks that the reviewer identified verbatim source words for the question’s subject. Equivalent terms in the source can qualify. An overview also needs explicit support and must link to accepted direct evidence. When the overview fails that check, the guide shows verbatim excerpts or points you to the reviewed passages.

To compare passages, pin text from the pages you want to compare, then select **Pinned passages only**. Ask how the passages relate or whether their claims differ under the same conditions. Each pin has a **Show source** button. This scope sends the pins and your question. The tutor treats prior discussion as context in full-page mode. A tutor or Guided Reading assessment can still miss a contradiction or accept weak reasoning. Exact-word and fingerprint checks verify the cited location. Support assessments are model judgments.

## Jump to a figure or table

1. Click an underlined reference such as **Figure 3** in the body text. From the keyboard, tab to the reference and press Enter.
2. If the PDF has an internal link, the reader follows it. Otherwise, it searches the local text index for the matching caption. If several captions match, choose by page number and snippet.
3. Click **Back** to return to your original page, scroll position, and zoom.

Caption lookup relies on selectable text. If a caption is embedded in a scanned page, run **OCR this page** on that page first. Unusual caption formats may require using **Find** or the page number field.

## Compare PDFs

In **Manual tutoring**, choose **Compare PDFs** under **Send to Copilot**, then **Choose PDFs**. Select two to four files from your open workspace and ask a question using terms from the readings. The reader searches their selectable text locally and shows how many excerpts it found for each file. Approving the request sends up to five matching excerpts per PDF and your question to Copilot for drafting and source review. Click a citation to open the referenced PDF and highlight the supporting words. A low match count can mean the readings use different wording or contain scanned pages.

## Explain a figure or equation

Click **Explain figure / equation** and drag a box around the visual. Include its caption if it helps explain the figure. Ask about a specific label, symbol, or relationship in the tutor. After you approve, an image-capable Copilot model receives the selected crop and nearby extracted text. Click the answer’s **Image region** citation to return to the original box.

## Listen in Guided Reading

Open a guided explanation and click **Read aloud** below it. Kokoro uses the speed selected in the PDF toolbar. The supporting passage stays highlighted while the explanation plays. Automatic advancement pauses when narration starts. Switching passages stops narration. Use **Listen** in the PDF toolbar to hear the source text itself. [Kokoro setup](../experiments/KOKORO_VOICE_PROBE.md)

For a section recap, run **Guided Reading** on the current outline section or a page range, then click **Listen to recap**. The reader narrates up to three reviewed explanations and highlights each source as it plays. At the end, answer the guide’s question in your own words, then click **Show evidence** to check your answer against the PDF. The recap reuses the guide and local Kokoro audio.

## Practice while reading

- **Check understanding** opens a short-answer exercise for the selected text or current page. You can also start one from a highlighted Guided Reading step. Try your answer, then **Reveal source** to check it or **Go to source** to inspect the original PDF. **Resume check** returns to the exercise after a jump.
- **Save for review** keeps your question, answer, and source in local VS Code workspace state. **Review questions** lists the current PDF’s saved questions. **Again** schedules another attempt in ten minutes, and **Got it** increases the interval across successful reviews.
- Open **Review questions** to see what is due and continue with **Review next due**. Each saved question distinguishes written attempts, source reveals, completed reviews, and **Again** / **Got it** self-ratings. Repeated **Again** ratings identify questions worth revisiting. These counts describe study activity and self-assessment.
- Local prompts, source reveals, and retries work offline. Copilot can draft a question or assess your answer against the passage, adapting a follow-up to the gap it identifies. After feedback, try the follow-up, retry the current question, or return to the original. Feedback sends your current attempt and, if available, the previous attempt for comparison. The confirmation covers up to two requests for feedback and its support assessment.
- Select a term or acronym and choose **Find definition** to search the PDF for likely definitions and expansions. Click a result to jump to its source.
- Choose **Listen** to hear the current page or selection with the optional English Kokoro voice. **Follow audio** highlights each passage as it plays. Choose 0.8×, 1×, or 1.2× before starting playback. [Kokoro setup](../experiments/KOKORO_VOICE_PROBE.md)

The reader uses the configured Python environment in offline, no-sync mode. Run `uv sync` in the matching backend clone during installation or update. Set the backend and uv paths in VS Code User settings.

## Troubleshooting

- **A PDF is missing.** Open its containing folder in VS Code. The picker lists up to 150 PDFs per workspace folder. Use the Explorer context menu to open a specific PDF directly. Keep the file and any symlink target inside the opened workspace.
- **The Python reader fails after an update.** Update the backend clone to the revision matching the VSIX, run `uv sync` there, and check both PrecisionPDF settings in VS Code User settings.
- **Find or the tutor has no text.** For an image-only page, run **OCR this page**. Search reports pages without selectable text, and OCR results are reused for the current reader session.
- **Copilot is unavailable.** Check that VS Code has access to a Copilot model. You can use **Copy prompt** to take the current source context into another chat client. Reading, local search, and self-checks work offline.
- **A saved question’s source will not highlight.** The reader checks the PDF fingerprint and original words. You can still review the stored quotation and answer if the PDF changed. Create a new check from the updated PDF to get Copilot feedback on that source.

## Fedora development setup

1. Run `uv sync --extra dev` from the repository root.
2. Open the **vscode-learning** folder in VS Code and press **F5**.
3. In the Extension Development Host, open the folder containing your PDFs and run **PrecisionPDF: Open Learning Mode**.

The extension uses the VS Code Language Model API with the Copilot vendor. In-panel explanations require available Copilot model access and use that account's quota.

## Tests

Run `uv run pytest -q` from the repository root and
`npm test` from `vscode-learning/` (Node.js 20+; no npm install needed).
A manual VS Code Extension Development Host test is still required for the
webview, word selection, and actual Copilot access.

The [accuracy benchmark](test/accuracy/README.md) provides 37 synthetic questions
with expected answers and supporting PDF evidence. Run the local evidence
check before comparing live Copilot answers.

## Scope and privacy

- Learning Mode reads PDFs within the workspace and shows temporary highlights. Use the MCP tools for persistent annotations.
- Find, rendering, OCR, saved review questions, and Kokoro run locally. Manual tutoring sends the context chosen in the composer after confirmation. Guided analysis, question drafting, and feedback also ask for confirmation before sending source text. Feedback includes your answer and any previous attempt supplied by the exercise.
- Password-protected PDFs are unsupported. Complex layouts can still affect recognized reading order.

## Release history

- **v0.8.6** recovers citations affected by misencoded letters in the PDF text layer and retries once when Copilot returns an unreadable tutoring reply.
- **v0.8.3** adds Strict Source explanations with clickable evidence, cross-PDF comparison, figure and equation explanations, guided audio recaps, and more detailed practice and review.
- **v0.8.2** adds local figure and table navigation with return-to-position.
- **v0.8.1** adds offline Read Aloud to Guided Reading explanations.
- **v0.8.0** adds follow-along PDF narration, understanding checks, saved review questions, and in-document definition lookup.

The remaining notes describe earlier versions.

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

Copilot assesses the drafted overview during the existing relevance review.
The extension displays the assessed draft when the review endorses it and
its evidence IDs match the direct passages. The fallback uses
**verbatim source excerpts with page numbers** when those excerpts fit,
or points you to the reviewed passages. Inspect the quoted evidence to
confirm the model’s interpretation.

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
