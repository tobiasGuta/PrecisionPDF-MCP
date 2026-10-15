"""Read-only bounded evidence index for Guided Reading Mode.

All excerpts are deterministic contiguous ranges of PDF word indices. The
viewer must verify a document fingerprint before displaying them on a page.
No content is altered and there are no network or model calls here.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys

import pymupdf

from .core import AnnotationError, PDFWorkspace

MAX_PAGES = 60
MAX_EXCERPTS = 1600
MAX_TEXT_CHARS = 350_000
WORDS_PER_EXCERPT = 38
MAX_WORDS_PER_PAGE = 5000


def file_sha256(path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def build_guided_index(root: str, filename: str) -> dict:
    workspace = PDFWorkspace(root)
    path = workspace.path(filename)
    initial_sha = file_sha256(path)
    excerpts = []
    total_chars = 0
    with pymupdf.open(path) as document:
        if document.needs_pass:
            raise AnnotationError("Encrypted PDFs cannot be analyzed")
        if not 1 <= len(document) <= MAX_PAGES:
            raise AnnotationError(f"Guided Reading supports 1-{MAX_PAGES} pages in this prototype")
        page_word_counts = []
        for page_number, page in enumerate(document, start=1):
            if page.rotation:
                raise AnnotationError(f"Rotated page {page_number} is not supported in Guided Reading")
            words = page.get_text("words", sort=True)
            if len(words) > MAX_WORDS_PER_PAGE:
                raise AnnotationError(f"Page {page_number} exceeds {MAX_WORDS_PER_PAGE} words")
            page_word_counts.append(len(words))
            # Same sorted word sequence as the existing PDF viewer.
            for start in range(0, len(words), WORDS_PER_EXCERPT):
                part = words[start:start + WORDS_PER_EXCERPT]
                if not part:
                    continue
                evidence_text = " ".join(str(word[4]) for word in part)
                total_chars += len(evidence_text)
                if total_chars > MAX_TEXT_CHARS or len(excerpts) >= MAX_EXCERPTS:
                    raise AnnotationError("Document exceeds Guided Reading evidence limits; no partial overview was generated")
                excerpts.append({
                    "id": f"p{page_number}-w{start}",
                    "page": page_number,
                    "start_word": start,
                    "end_word": start + len(part) - 1,
                    "text": evidence_text,
                })
    if not excerpts:
        raise AnnotationError("No selectable text found. Scanned PDFs need OCR before Guided Reading")
    if file_sha256(path) != initial_sha:
        raise AnnotationError("PDF changed while it was being indexed; reopen the document")
    return {
        "file": str(path.relative_to(workspace.root)),
        "sha256": initial_sha,
        "pages": len(page_word_counts),
        "page_word_counts": page_word_counts,
        "excerpts": excerpts,
        "complete": True,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Read-only Guided Reading PDF index")
    parser.add_argument("--root", required=True)
    parser.add_argument("--file", required=True)
    args = parser.parse_args()
    try:
        json.dump(build_guided_index(args.root, args.file), sys.stdout)
        sys.stdout.write("\n")
        return 0
    except (AnnotationError, OSError, RuntimeError, ValueError) as error:
        print(f"Guided Reading: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
