"""Bounded read-only, sentence-aware evidence index for Guided Reading.

Evidence coordinates refer to the exact sorted PyMuPDF word sequence used
by the existing VS Code reader. No inferred text coordinates are trusted.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys

import pymupdf

from .core import AnnotationError, PDFWorkspace

MAX_PAGES = 60
MAX_EXCERPTS = 1600
MAX_TEXT_CHARS = 350_000
MAX_WORDS_PER_PAGE = 5000
MAX_EVIDENCE_WORDS = 72
ABBREVIATIONS = frozenset({"dr.", "mr.", "mrs.", "ms.", "prof.", "vs.", "e.g.", "i.e.", "etc.", "fig.", "no.", "st.", "u.s.", "u.k."})
END_SENTENCE = re.compile(r'[.!?]["\u0027\u201d\u2019)\]]*$')


def file_sha256(path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _sentence_end(token: str) -> bool:
    token = token.strip()
    return token.casefold() not in ABBREVIATIONS and bool(END_SENTENCE.search(token)) and not re.fullmatch(r"\d+\.", token)


def _extract_ranges(words):
    """Emit contiguous [start,end] spans at sentences and layout boundaries.

    A sentence longer than the word cap is split into bounded fragments;
    these are labeled as fragments, never as complete sentences.
    """
    if not words:
        return
    start = 0
    for index, word in enumerate(words):
        next_word = words[index + 1] if index + 1 < len(words) else None
        sentence_end = _sentence_end(str(word[4]))
        block_end = next_word is None or word[5] != next_word[5]
        too_long = index - start + 1 >= MAX_EVIDENCE_WORDS
        if sentence_end or block_end or too_long:
            kind = "sentence" if sentence_end else ("paragraph" if block_end else "fragment")
            yield start, index, kind
            start = index + 1


def _bookmarks(document):
    """Use PDF-authored outline when available, not guessed topic boundaries."""
    marks = []
    for level, title, page, *_ in document.get_toc():
        if isinstance(page, int) and 1 <= page <= len(document):
            title = " ".join(str(title).split())[:140]
            if title:
                marks.append({"page": page, "level": int(level), "title": title})
    return sorted(marks, key=lambda x: x["page"])


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
        bookmarks = _bookmarks(document)
        next_mark = 0
        active_section = ""
        page_word_counts = []
        for page_number, page in enumerate(document, start=1):
            if page.rotation:
                raise AnnotationError(f"Rotated page {page_number} is not supported in Guided Reading")
            while next_mark < len(bookmarks) and bookmarks[next_mark]["page"] <= page_number:
                active_section = bookmarks[next_mark]["title"]
                next_mark += 1
            words = page.get_text("words", sort=True)
            if len(words) > MAX_WORDS_PER_PAGE:
                raise AnnotationError(f"Page {page_number} exceeds {MAX_WORDS_PER_PAGE} words")
            page_word_counts.append(len(words))
            for start, end, kind in _extract_ranges(words):
                evidence_text = " ".join(str(word[4]) for word in words[start:end + 1])
                total_chars += len(evidence_text)
                if total_chars > MAX_TEXT_CHARS or len(excerpts) >= MAX_EXCERPTS:
                    raise AnnotationError("Document exceeds Guided Reading evidence limits; no partial overview was generated")
                excerpts.append({
                    "id": f"p{page_number}-w{start}",
                    "page": page_number,
                    "start_word": start,
                    "end_word": end,
                    "text": evidence_text,
                    "boundary": kind,
                    "section": active_section,
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
        "sections": bookmarks,
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
