# PrecisionPDF-MCP

A local **MCP server** for reliable PDF highlights using PyMuPDF. Built for a conversational workflow: read a PDF, propose an exact passage, review the proposal, add a color highlight, and inspect the saved result in Okular.

> **Status: v0.1 proof-of-concept.** Word-level matching for horizontal, selectable text only. Compared with the previously validated `clean_highlight_test.py` and covered by a regression test for its missing-prefix text-layer mismatch. Not an embedded PDF viewer. Tested locally on generated PDFs, not yet on the user's course PDF.

## Features

- Six MCP tools: `list_pdfs`, `read_pdf_page`, `propose_highlight`, `apply_highlight`, `list_annotations`, `render_pdf_page`.
- Match normalized full word sequences with explicit ambiguity rejection.
- Group word positions by PDF text line to create clean colored highlights.
- Yellow, blue, green, pink and orange with configurable opacity.
- 1-based page numbering; source SHA-256 fingerprint between proposal and application.
- Confine all PDF and image I/O to a single workspace directory (including symlink resolution).
- Refuse accidental original-file overwrite. Only explicitly update `*-annotated.pdf` copies.
- Atomic replacement when saving an annotated working copy, so Okular can reload after each save.

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

## Suggested workflow

1. Ask the AI to call `read_pdf_page` to inspect a particular page.
2. Ask it to call `propose_highlight` with a passage from the page. Inspect the returned matched text, page and rectangles.
3. Approve and call `apply_highlight` using the exact returned `fingerprint`. Use an output filename such as `lesson-annotated.pdf`.
4. Open the output in Okular and review it. Use `render_pdf_page` to capture a PNG.
5. For the next highlight, propose against the **annotated copy** and apply with `file=output_file=lesson-annotated.pdf`, `overwrite_annotated_copy=true`. Keep the original separate.

**Important:** Proposal/apply separation and client-side manual tool permissions help user review but are *not* a cryptographic human-approval gate. AI clients may call permitted tools automatically; choose **Manual permissions** if you want to inspect each edit before it is allowed.

## Scope and limitations

- No OCR for scanned PDFs, no mathematical semantic parsing and no automatic selection of what is important (the AI decides the text to propose).
- Current geometry relies on word bounding rectangles grouped by line, not full character-level glyph quads; rotated, multi-column or unusual text may need improved handling.
- No network calls made by the server. The AI host/provider may still send document text to its model; consider your privacy needs.
- Verify each visual highlight in Okular before trusting it. PDFs with complex layout need further tests.
- Annotation counts may include annotations that already existed in the source PDF.
- Changes to `*-annotated.pdf` are atomic file replacements, not PDF-incremental saves. Keep backups as appropriate.

## Planned next work

- Test against the actual course PDF (not included here) and extend real-world text-layout fixtures.
- Multiline, hyphenation and complex-layout fixture suite.
- Dedicated user confirmation protocol and batch proposal review.
- Update/remove tools, annotation de-duplication and repeat highlighting protection.
- Optional live viewer integration after the VS Code PDF.js CSP incompatibility is resolved.

MIT License.
