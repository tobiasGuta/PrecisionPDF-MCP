"""Read-only PDF page rendering and word geometry for Learning Mode.

Called by the optional VS Code extension. All access is confined by PDFWorkspace.
This process never edits a PDF, creates an annotation, or makes a network call.
"""

from __future__ import annotations

import argparse
import base64
import json
import math
import sys

import pymupdf

from .core import AnnotationError, PDFWorkspace
from .guided_index import file_sha256, _bookmarks
from .reader_text import read_words, display_box


def _internal_links(page, page_count):
    # PyMuPDF reports GoTo rectangles and destinations in rotated page coordinates.
    links = []
    for link in page.get_links():
        if link["kind"] != pymupdf.LINK_GOTO or not 0 <= link.get("page", -1) < page_count:
            continue
        area = link["from"]
        target = link.get("to")
        if area.is_empty or not all(map(math.isfinite, area)):
            continue
        links.append({
            "from": list(area),
            "page": link["page"] + 1,
            "to": list(target) if target is not None and all(map(math.isfinite, target)) else None,
        })
    return links


def read_learning_page(root: str, filename: str, number: int, ocr_language=None, zoom=1.5, *, outline=False, cached=None) -> dict:
    workspace = PDFWorkspace(root)
    path = workspace.path(filename)
    fingerprint = file_sha256(path)
    with pymupdf.open(path) as document:
        if document.needs_pass:
            raise AnnotationError("Encrypted PDFs are not supported in Learning Mode")
        workspace._check_page(document, number)
        page = document[number - 1]
        width, height = float(page.rect.width), float(page.rect.height)
        if width <= 0 or height <= 0:
            raise AnnotationError("Invalid page dimensions")
        # Bound the rendering work and IPC payload for unexpectedly large pages.
        scale = min(max(1.5, zoom), 2800 / max(width, height), (6_000_000 / (width * height)) ** 0.5)
        if scale <= 0:
            raise AnnotationError("PDF page is too large to render safely")
        words = read_words(page, ocr_language, cached)
        boxes = [display_box(page, word) for word in words]
        preview = page.get_pixmap(matrix=pymupdf.Matrix(scale, scale),
                                 alpha=False, annots=True).tobytes("png")
        text = " ".join(str(word[4]) for word in words)
        if file_sha256(path) != fingerprint:
            raise AnnotationError("PDF changed while rendering. Try again.")
        return {
            "file": str(path.relative_to(workspace.root)),
            "sha256": fingerprint,
            "ocr": bool(ocr_language),
            "sections": _bookmarks(document) if outline or number == 1 else None,
            "ocr_words": words if ocr_language and cached is None else None,
            "page": number,
            "pages": len(document),
            "width": width,
            "height": height,
            "words": boxes,
            "word_lines": [list(word[5:7]) for word in words],
            "internal_links": _internal_links(page, len(document)),
            "text": text[:12000],
            "text_truncated": len(text) > 12000,
            "png_base64": base64.b64encode(preview).decode("ascii"),
        }


def main() -> int:
    parser = argparse.ArgumentParser(description="Read-only PrecisionPDF Learning Mode page")
    parser.add_argument("--root", required=True)
    parser.add_argument("--file", required=True)
    parser.add_argument("--page", required=True, type=int)
    parser.add_argument("--ocr-language")
    parser.add_argument("--zoom", type=float, default=1.5)
    parser.add_argument("--outline", action="store_true")
    parser.add_argument("--cached-ocr", action="store_true")
    args = parser.parse_args()
    try:
        cached = json.load(sys.stdin) if args.cached_ocr else None
        data = read_learning_page(args.root, args.file, args.page, args.ocr_language,
                                  args.zoom, outline=args.outline, cached=cached)
        json.dump(data, sys.stdout)
        sys.stdout.write("\n")
        return 0
    except (AnnotationError, OSError, RuntimeError, ValueError) as error:
        print(f"PrecisionPDF Learning Mode: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
