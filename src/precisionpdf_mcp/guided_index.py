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
from .reader_text import read_words

MAX_PAGES = 60
MAX_EXCERPTS = 1600
MAX_TEXT_CHARS = 350_000
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


def build_guided_index(root: str, filename: str, start=1, end=None, ocr_pages=None) -> dict:
    workspace = PDFWorkspace(root)
    path = workspace.path(filename)
    initial_sha = file_sha256(path)
    excerpts = []
    total_chars = 0
    with pymupdf.open(path) as document:
        if document.needs_pass:
            raise AnnotationError("Encrypted PDFs cannot be analyzed")
        end = len(document) if end is None else end
        if not 1 <= start <= end <= len(document):
            raise AnnotationError("Page range is outside the document")
        if end - start + 1 > MAX_PAGES:
            raise AnnotationError(f"Guided Reading supports 1-{MAX_PAGES} pages at a time. Choose a page range.")
        bookmarks = _bookmarks(document)
        next_mark = 0
        active_section = ""
        page_word_counts = [0] * len(document)
        skipped_pages = []
        for page_number in range(start, end + 1):
            page = document[page_number - 1]
            while next_mark < len(bookmarks) and bookmarks[next_mark]["page"] <= page_number:
                active_section = bookmarks[next_mark]["title"]
                next_mark += 1
            words = read_words(page, cached=(ocr_pages or {}).get(str(page_number)))
            page_word_counts[page_number - 1] = len(words)
            if not words:
                skipped_pages.append(page_number)
            for first_word, last_word, kind in _extract_ranges(words):
                evidence_text = " ".join(str(word[4]) for word in words[first_word:last_word + 1])
                total_chars += len(evidence_text)
                if total_chars > MAX_TEXT_CHARS or len(excerpts) >= MAX_EXCERPTS:
                    raise AnnotationError("Document exceeds Guided Reading evidence limits; no partial overview was generated")
                excerpts.append({
                    "id": f"p{page_number}-w{first_word}",
                    "page": page_number,
                    "start_word": first_word,
                    "end_word": last_word,
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
        "scope": [start, end],
        "skipped_pages": skipped_pages,
        "sections": bookmarks,
        "excerpts": excerpts,
        "complete": True,
    }


def build_search_index(root, filename, ocr_pages=None):
    """Index native words per page without the guide's excerpt or batch limits."""
    workspace = PDFWorkspace(root)
    path = workspace.path(filename)
    fingerprint = file_sha256(path)
    with pymupdf.open(path) as document:
        if document.needs_pass:
            raise AnnotationError("Encrypted PDFs cannot be searched")
        pages = []
        skipped = []
        total_chars = 0
        for page in document:
            number = page.number + 1
            words = read_words(page, cached=(ocr_pages or {}).get(str(number)))
            total_chars += sum(len(word[4]) + 8 for word in words)
            if total_chars > 5_000_000:
                raise AnnotationError("PDF exceeds the local search text limit")
            if not words:
                skipped.append(number)
            pages.append([[word[4], word[5], word[6]] for word in words])
        if file_sha256(path) != fingerprint:
            raise AnnotationError("PDF changed while indexing. Try again.")
        return {"sha256": fingerprint, "pages": len(pages), "word_pages": pages,
                "skipped_pages": skipped, "sections": _bookmarks(document), "complete": True}


def main() -> int:
    parser = argparse.ArgumentParser(description="Read-only Guided Reading PDF index")
    parser.add_argument("--root", required=True)
    parser.add_argument("--file", required=True)
    parser.add_argument("--search", action="store_true")
    parser.add_argument("--start", type=int, default=1)
    parser.add_argument("--end", type=int)
    parser.add_argument("--cached-ocr", action="store_true")
    args = parser.parse_args()
    try:
        ocr_pages = json.load(sys.stdin) if args.cached_ocr else {}
        if args.search:
            data = build_search_index(args.root, args.file, ocr_pages)
        else:
            data = build_guided_index(args.root, args.file, args.start, args.end, ocr_pages)
        json.dump(data, sys.stdout)
        sys.stdout.write("\n")
        return 0
    except (AnnotationError, OSError, RuntimeError, ValueError) as error:
        print(f"Guided Reading: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
