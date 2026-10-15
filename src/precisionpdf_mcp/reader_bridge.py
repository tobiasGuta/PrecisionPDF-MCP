"""Read-only PDF page rendering and word geometry for Learning Mode.

Called by the optional VS Code extension. All access is confined by PDFWorkspace.
This process never edits a PDF, creates an annotation, or makes a network call.
"""

from __future__ import annotations

import argparse
import base64
import json
import sys

import pymupdf

from .core import AnnotationError, PDFWorkspace
from .guided_index import file_sha256


def read_learning_page(root: str, filename: str, number: int) -> dict:
    workspace = PDFWorkspace(root)
    path = workspace.path(filename)
    with pymupdf.open(path) as document:
        if document.needs_pass:
            raise AnnotationError("Encrypted PDFs are not supported in Learning Mode")
        workspace._check_page(document, number)
        page = document[number - 1]
        if page.rotation:
            raise AnnotationError("Rotated PDF pages are not supported in Learning Mode v0.1")
        width, height = float(page.rect.width), float(page.rect.height)
        if width <= 0 or height <= 0:
            raise AnnotationError("Invalid page dimensions")
        # Bound the rendering work and IPC payload for unexpectedly large pages.
        scale = min(1.5, 2200 / max(width, height))
        if scale <= 0 or width * height * scale * scale > 6_000_000:
            raise AnnotationError("PDF page is too large to render safely")
        words = page.get_text("words", sort=True)
        if len(words) > 5000:
            raise AnnotationError("More than 5000 words on one page; selection view unavailable")
        boxes = [
            [round(float(x0), 3), round(float(y0), 3),
             round(float(x1), 3), round(float(y1), 3), str(text)]
            for x0, y0, x1, y1, text, *_ in words
        ]
        preview = page.get_pixmap(matrix=pymupdf.Matrix(scale, scale),
                                 alpha=False, annots=True).tobytes("png")
        text = page.get_text("text", sort=True)
        return {
            "file": str(path.relative_to(workspace.root)),
            "sha256": file_sha256(path),
            "page": number,
            "pages": len(document),
            "width": width,
            "height": height,
            "words": boxes,
            "text": text[:12000],
            "text_truncated": len(text) > 12000,
            "png_base64": base64.b64encode(preview).decode("ascii"),
        }


def main() -> int:
    parser = argparse.ArgumentParser(description="Read-only PrecisionPDF Learning Mode page")
    parser.add_argument("--root", required=True)
    parser.add_argument("--file", required=True)
    parser.add_argument("--page", required=True, type=int)
    args = parser.parse_args()
    try:
        json.dump(read_learning_page(args.root, args.file, args.page), sys.stdout)
        sys.stdout.write("\n")
        return 0
    except (AnnotationError, OSError, RuntimeError, ValueError) as error:
        print(f"PrecisionPDF Learning Mode: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
