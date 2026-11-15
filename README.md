# PrecisionPDF-MCP

A local PDF toolkit combining a **PrecisionPDF MCP server** for reviewable PDF annotations with an optional **VS Code Learning Mode** for interactive reading, exact document search, and Copilot-assisted explanations.

> **Current components:** the MCP annotation server and the experimental **PrecisionPDF Learning Mode v0.8.3** VS Code extension in this checkout. Learning Mode has been tested on real PDFs in VS Code. It is **not** a published VS Code Marketplace extension.

## Features

- Ten MCP tools: `list_pdfs`, `read_pdf_page`, `propose_highlight`, `apply_highlight`, `list_annotations`, `render_pdf_page`, `propose_annotation_update`, `apply_annotation_update`, `propose_annotation_removal`, and `apply_annotation_removal`.
- Match normalized full word sequences with explicit ambiguity rejection.
- Group word positions by PDF text line to create clean colored highlights.
- Yellow, blue, green, pink and orange with configurable opacity.
- 1-based page numbering; source SHA-256 fingerprint between proposal and application.
- Confine all PDF and image I/O to a single workspace directory (including symlink resolution).
- Refuse accidental original-file overwrite. Only explicitly update `*-annotated.pdf` copies.
- Atomic replacement when saving an annotated working copy, so Okular can reload after each save.
- Optional read-only VS Code reader with saved reading position, figure and table jumps, local Find and definition lookup, page OCR, and page-aware Copilot tutoring.
- Guided explanations for a PDF, section, or page range with source highlights. Understanding checks and saved review questions link back to the original passage.
- Offline Kokoro narration for a page, selection, tutor response, or Guided Reading explanation, with follow-along highlighting when reading the PDF.

## Local VS Code installation

Download the VSIX from [GitHub Releases](https://github.com/tobiasGuta/PrecisionPDF-MCP/releases/latest), then choose **Extensions: Install from VSIX…** in the VS Code Command Palette. The reader also requires the matching Python backend in a local repository clone. Follow the [installation guide](vscode-learning/README.md#install-in-normal-vs-code-on-fedora-local-vsix) to set it up.

## Fedora install

1. Ensure `uv` and `okular` are available (`sudo dnf install uv okular`).
2. Clone this repo, then from inside it:

```bash
uv sync --extra dev
uv run pytest
```

3. In the PDF workspace `.vscode/mcp.json`, configure:

```json
{
  "servers": {
    "precisionpdf": {
      "type": "stdio",
      "command": "uv",
      "args": ["--directory", "/home/YOU/Development/PrecisionPDF-MCP", "run", "precisionpdf-mcp"],
      "env": {"PRECISIONPDF_ROOT": "${workspaceFolder}"}
    }
  }
}
```

Replace the source directory with your clone location. Open **MCP: List Servers** in VS Code and start `precisionpdf`.


## VS Code Learning Mode — setup and use

The optional extension lives in **[vscode-learning/](vscode-learning/)** and is separate from the MCP server. **Learning Mode is read-only:** selecting or automatically highlighting passages does **not** add annotations or modify your PDF. The [MCP tools](#mcp-tool-reference) handle persistent highlights.

### Start Learning Mode (development installation)

Use the local VSIX for regular reading. The **Extension Development Host** is available for testing changes to the extension.

1. Install VS Code, Python 3.11+, [uv](https://docs.astral.sh/uv/), and (for tests) Node.js 20+. From the repository root, run `uv sync --extra dev`.
2. Open the extension folder in VS Code, **not** the repository root:

   ```bash
   cd /absolute/path/to/PrecisionPDF-MCP
   code vscode-learning
   ```

3. Review and trust the workspace if prompted, then press **F5** (or **Run → Start Debugging**). A separate **Extension Development Host** window opens.
4. **In that new window**, choose **File → Open Folder** and open the folder containing your PDF files. This PDF folder is the *PDF workspace*, not the extension source folder.
5. Open the Command Palette (**Ctrl+Shift+P**) and run **PrecisionPDF: Open Learning Mode**.
6. Choose a PDF. The reader opens with the PDF on the left and learning tools on the right.

If the extension cannot find the repository, set `precisionpdfLearning.repositoryPath` in VS Code Settings to your clone's **absolute path**. If it cannot find `uv`, set `precisionpdfLearning.uvPath` to the executable shown by `command -v uv`.

### Manual tutoring — understand a selected passage

1. Choose **Manual tutoring**.
2. Drag across words in the PDF to select the text you want to discuss.
3. Enter a question, for example, *“Explain this passage simply, with a practical example.”*
4. Click **Ask with Copilot**. VS Code may ask you to authorize this extension to use an available Copilot language model.
5. Type follow-up questions using the composer at the bottom; **Ctrl+Enter** sends a question. Navigating pages or selecting a new passage retains the visible discussion, but changes the active evidence.
6. Use **New discussion** to clear history, or **Clear selection** to drop only the active selection.

**Copy prompt** lets you manually paste a question with page context into another chat, such as Codex or Antigravity. This is not an automatic subscription or account integration.

### Guided Reading — document-wide questions and highlighted evidence

1. Choose **Guided Reading**.
2. Enter a question, then select a **Method**:
   - **Automatic** a short term like `black box` or “Where does it mention ‘black box’?” is treated as a local exact-phrase search. Questions such as “Explain why deep learning models are called black boxes” use Copilot.
   - **Exact wording · local** scan all indexed pages for occurrences of the phrase. Click a result to jump to and temporarily highlight the match. The full match count is reported, with at most 150 clickable results.
   - **Explanation · Copilot** ask, for example, “What are the main ideas of this PDF?” or “Why are neural networks difficult to interpret?”
3. Click **Find / Analyze**.
4. For Copilot-guided analysis, inspect the estimated number of model requests and **approve** before the extension sends extracted PDF text.
5. Read the **Answer from reviewed direct evidence** and navigate its supporting passages with **Previous**, **Next**, or **Play / Pause** (default **12 seconds per step**). Click an evidence item to navigate directly to its page.
6. Optional **contextual examples** are shown separately, not as direct answers. After exact search, **Explore related ideas with Copilot** offers a separate non-exhaustive, AI-assisted tour.

**Exact wording search and AI interpretation are different:** exact search does not detect every semantic discussion of a concept, and the guided tour is not a complete inventory of relevant ideas. The reader checks document fingerprints, page positions, and exact source text before showing guided highlights, but these checks do **not** prove that an AI explanation is correct.

### Copilot access, privacy, and limitations

- **Local exact search:** no Copilot request or additional API key.
- **AI tutoring / guided explanations:** use available GitHub Copilot models through VS Code's Language Model API; existing plan limits and quotas apply. The extension has no automatic Codex or Antigravity model integration.
- The Python PDF-rendering bridge makes no outbound network requests. **PDF text sent to Copilot can leave your machine.** Manual tutoring, Guided Reading, and Copilot study actions request confirmation before sending source text. See [source grounding and comparison](vscode-learning/README.md#source-grounding-and-comparing-passages).
- Use **OCR this page** for pages without selectable text. OCR requires local Tesseract language data. Password-protected PDFs are unsupported, and complex layouts can affect reading order.
- Guided analysis can use the whole PDF, an outline section, or a page range. Each run has limits of **60 pages**, **350,000 indexed characters**, **1,600 excerpts**, and **30 analysis batches**, plus synthesis and relevance-review requests. Oversized documents are rejected rather than summarized as though fully analyzed.
- Neither mode changes the original PDF. To **save** a highlight or change an existing one, use the separate MCP annotation tools.

See the [reader guide](vscode-learning/README.md#reading-a-pdf), [figure and table navigation](vscode-learning/README.md#jump-to-a-figure-or-table), [study and review guide](vscode-learning/README.md#practice-while-reading), and [offline audio setup](experiments/KOKORO_VOICE_PROBE.md).

### Test Learning Mode

From the repository root:

```bash
npm --prefix vscode-learning test
uv run pytest -q
```

The JavaScript suite uses Node's built-in test runner and needs no `npm install` for this repository. Automated tests do not replace testing the webview and Copilot integration in the Extension Development Host.

## MCP tool reference

The server uses stdio. Set `PRECISIONPDF_ROOT` to the folder containing your PDFs. Use paths within that directory and count PDF pages and repeated occurrences from 1. Pass the `fingerprint` from a proposal as `expected_fingerprint` when applying it.

| Tool | Inputs and result |
| --- | --- |
| `list_pdfs` | Lists up to 200 PDFs in the workspace. |
| `read_pdf_page` | Takes `file` and optional `page` (default 1). Returns selectable text and the document fingerprint. |
| `propose_highlight` | Takes `file`, `page`, `exact_quote`, and optional `occurrence`. Returns matched words, highlight coordinates, and the fingerprint. Supply the occurrence if the quote repeats. |
| `apply_highlight` | Takes `file`, `output_file`, `page`, `exact_quote`, and `expected_fingerprint`. Optional inputs are `color` (yellow by default), `opacity` (0.35 by default), `occurrence`, and `overwrite_annotated_copy`. Saves a new copy or explicitly updates the same annotated copy. |
| `list_annotations` | Takes `file` and optional `page`. Returns existing annotations with their page numbers and object references (`xref`). |
| `render_pdf_page` | Takes `file` and optional `page` (default 1). Saves a PNG preview beside the PDF and returns its path and dimensions. |
| `propose_annotation_update` | Takes `file`, `page`, `xref`, `color`, and optional `opacity`. Previews an edit to an existing highlight. |
| `apply_annotation_update` | Takes the update inputs plus `expected_fingerprint`. Updates the highlight on the annotated copy. |
| `propose_annotation_removal` | Takes `file`, `page`, and `xref`. Identifies the highlight to remove and returns the fingerprint. |
| `apply_annotation_removal` | Takes the removal inputs plus `expected_fingerprint`. Removes the specified highlight from the annotated copy. |

## Suggested MCP annotation workflow

1. Ask the AI to call `read_pdf_page` to inspect a particular page.
2. Ask it to call `propose_highlight` with a passage from the page. Inspect the returned matched text, page and rectangles.
3. Approve and call `apply_highlight` using the exact returned `fingerprint`. Use an output filename such as `lesson-annotated.pdf`.
4. Open the output in Okular and review it. Use `render_pdf_page` to capture a PNG.
5. For the next highlight, propose against the **annotated copy** and apply with `file=output_file=lesson-annotated.pdf`, `overwrite_annotated_copy=true`. Keep the original separate.

**Important:** Proposal/apply separation and client-side manual tool permissions help user review but are *not* a cryptographic human-approval gate. AI clients may call permitted tools automatically; choose **Manual permissions** if you want to inspect each edit before it is allowed.

## MCP annotation scope and limitations

- The MCP annotation server does not provide OCR for scanned PDFs or independently decide which text is important. Learning Mode's experimental AI evidence selection is a separate feature.
- Word-level matching, unusual layouts, and rotated text require care; validate highlights on complex PDFs.
- No network calls made by the server. The AI host/provider may still send document text to its model; consider your privacy needs.
- Verify each visual highlight in Okular before trusting it. PDFs with complex layout need further tests.
- Annotation counts may include annotations that already existed in the source PDF.
- Changes to `*-annotated.pdf` are atomic file replacements, not PDF-incremental saves. Keep backups as appropriate.

## Edit or remove an existing highlight

Use `list_annotations(file, page)` on an existing `*-annotated.pdf` document to inspect page, `xref`, color, opacity, and stored annotation content. Identify the exact target before editing.

- To **recolor**: call `propose_annotation_update(file, page, xref, color, opacity?)`, review the current annotation and proposed values, then (only after user permission) pass the returned `fingerprint` to `apply_annotation_update(file, page, xref, expected_fingerprint, color, opacity?)`. Omit opacity to preserve the original.
- To **remove**: call `propose_annotation_removal(file, page, xref)`, review the target, then (only after user permission) call `apply_annotation_removal(file, page, xref, expected_fingerprint)`.
- Proposals never change the PDF. Each application edits exactly one identified highlight in the existing annotated copy; it does **not** delete the file or rebuild highlights from scratch. It saves to a temporary PDF, verifies other annotations are unchanged, then atomically replaces that working copy.
- Editing is limited to `*-annotated.pdf` files inside `PRECISIONPDF_ROOT`. Original PDFs, invalid colors, wrong-page or non-highlight xrefs, and stale SHA-256 fingerprints are rejected. Other annotations and their object references are checked after saving.
- A successful edit changes the PDF fingerprint; run a new proposal before the next edit. Keep backups for important documents, and visually verify changes in Okular.

**Client safety:** MCP tool permission prompts remain the approval mechanism. The server checks the fingerprint and target but cannot independently authenticate a human's approval. Do not grant automatic write permission if you want to review each change. Do not use `rm` or a shell-based rebuild as a workaround for an unsupported edit.

## License

MIT.
