"""Filesystem-confined, exact-token PDF highlighting engine.

Proof-of-concept: horizontal, selectable text. No OCR or fuzzy matching.
"""

from __future__ import annotations

from dataclasses import dataclass
from hashlib import sha256
from pathlib import Path
import os
import re
import tempfile
import unicodedata

import pymupdf

COLORS: dict[str, tuple[float, float, float]] = {
    "yellow": (1.0, 0.89, 0.18),
    "blue": (0.33, 0.47, 1.0),
    "green": (0.31, 0.79, 0.43),
    "pink": (1.0, 0.47, 0.70),
    "orange": (1.0, 0.65, 0.23),
}
TOKEN_RE = re.compile(r"[^\W_]+(?:[-‐‑–—'’][^\W_]+)*", flags=re.UNICODE)


class AnnotationError(ValueError):
    """Unsafe, unverified, or ambiguous annotation request."""


def _tokens(text: str) -> list[str]:
    normalized = unicodedata.normalize("NFKC", text).replace("\u00ad", "")
    normalized = normalized.replace("\u2018", "'").replace("\u2019", "'")
    for mark in ("‐", "‑", "–", "—"):
        normalized = normalized.replace(mark, "-")
    return [token.casefold() for token in TOKEN_RE.findall(normalized)]


@dataclass(frozen=True)
class Word:
    index: int
    text: str
    rect: tuple[float, float, float, float]
    block: int
    line: int
    ordinal: int


class PDFWorkspace:
    def __init__(self, root: str | Path):
        resolved = Path(root).expanduser().resolve(strict=True)
        if not resolved.is_dir():
            raise AnnotationError("PRECISIONPDF_ROOT must be an existing directory")
        self.root = resolved

    def path(self, name: str, suffix: str = ".pdf", must_exist: bool = True) -> Path:
        raw = Path(name).expanduser()
        resolved = (raw if raw.is_absolute() else self.root / raw).resolve(strict=False)
        if not resolved.is_relative_to(self.root):
            raise AnnotationError("Path is outside PRECISIONPDF_ROOT")
        if resolved.suffix.lower() != suffix:
            raise AnnotationError(f"Expected a {suffix} file")
        if must_exist and (not resolved.is_file() or not os.access(resolved, os.R_OK)):
            raise AnnotationError("Input file does not exist or is unreadable")
        if not must_exist and not resolved.parent.is_dir():
            raise AnnotationError("Output folder does not exist")
        return resolved

    def list_pdfs(self) -> dict:
        documents = []
        for p in sorted(self.root.rglob("*.pdf")):
            resolved = p.resolve(strict=False)
            if resolved.is_relative_to(self.root) and resolved.is_file():
                documents.append(str(resolved.relative_to(self.root)))
            if len(documents) >= 200:
                break
        return {"root": str(self.root), "pdfs": documents, "truncated": len(documents) >= 200}

    def _fingerprint(self, path: Path) -> str:
        h = sha256()
        with path.open("rb") as f:
            for chunk in iter(lambda: f.read(1024 * 1024), b""):
                h.update(chunk)
        return h.hexdigest()

    def inspect(self, name: str, page_number: int = 1, max_chars: int = 12000) -> dict:
        path = self.path(name)
        if not 1 <= max_chars <= 50000:
            raise AnnotationError("max_chars must be between 1 and 50000")
        with pymupdf.open(path) as doc:
            self._check_page(doc, page_number)
            text = doc[page_number - 1].get_text("text", sort=True)
            return {"file": str(path.relative_to(self.root)), "fingerprint": self._fingerprint(path),
                    "pages": len(doc), "page": page_number, "text": text[:max_chars],
                    "truncated": len(text) > max_chars}

    @staticmethod
    def _check_page(doc: pymupdf.Document, page: int) -> None:
        if not 1 <= page <= len(doc):
            raise AnnotationError(f"Page must be between 1 and {len(doc)} (1-based)")

    @staticmethod
    def _matches(page: pymupdf.Page, quote: str) -> list[tuple[list[Word], list[list[float]]]]:
        wanted = _tokens(quote)
        if not wanted or len(wanted) > 500:
            raise AnnotationError("Quote must contain between 1 and 500 words")
        words: list[Word] = []
        tokens: list[tuple[str, int]] = []
        for i, entry in enumerate(page.get_text("words", sort=True)):
            x0, y0, x1, y1, raw, block, line, ordinal = entry[:8]
            words.append(Word(i, raw, (x0, y0, x1, y1), block, line, ordinal))
            for token in _tokens(raw):
                tokens.append((token, i))
        result = []
        for start in range(len(tokens) - len(wanted) + 1):
            window = tokens[start:start + len(wanted)]
            if [t for t, _ in window] != wanted:
                continue
            indices = list(dict.fromkeys(idx for _, idx in window))
            # Reject substring geometry: all tokens belonging to an extracted word
            # must be selected. Otherwise we'd color unrequested text in that word.
            if (start and tokens[start - 1][1] == indices[0]) or (
                start + len(wanted) < len(tokens)
                and tokens[start + len(wanted)][1] == indices[-1]
            ):
                continue
            chosen = [words[i] for i in indices]
            rects: list[list[float]] = []
            current: list[Word] = []
            for word in chosen:
                if current and (word.block, word.line) != (current[-1].block, current[-1].line):
                    rects.append(PDFWorkspace._line_rect(current))
                    current = []
                current.append(word)
            if current:
                rects.append(PDFWorkspace._line_rect(current))
            result.append((chosen, rects))
        return result

    @staticmethod
    def _line_rect(words: list[Word]) -> list[float]:
        # Union of contiguous word rectangles for one logical PDF text line.
        # Horizontal text only; rotated/skewed text is unsupported in v0.1.
        return [round(min(w.rect[0] for w in words), 3),
                round(min(w.rect[1] for w in words), 3),
                round(max(w.rect[2] for w in words), 3),
                round(max(w.rect[3] for w in words), 3)]

    def propose(self, name: str, page_number: int, quote: str, occurrence: int | None = None) -> dict:
        source = self.path(name)
        with pymupdf.open(source) as doc:
            self._check_page(doc, page_number)
            matches = self._matches(doc[page_number - 1], quote)
            if not matches:
                raise AnnotationError("No exact normalized word-sequence match; no highlight proposed")
            if occurrence is None and len(matches) > 1:
                raise AnnotationError(f"Ambiguous quote: {len(matches)} matches; provide 1-based occurrence")
            idx = (occurrence if occurrence is not None else 1) - 1
            if idx < 0 or idx >= len(matches):
                raise AnnotationError(f"Occurrence must be between 1 and {len(matches)}")
            selected, rects = matches[idx]
            return {"file": str(source.relative_to(self.root)), "fingerprint": self._fingerprint(source),
                    "page": page_number, "requested_quote": quote,
                    "matched_words": " ".join(w.text for w in selected),
                    "match_count": len(matches), "occurrence": idx + 1,
                    "quads": len(rects), "rectangles": rects,
                    "note": "Proposal only; no file has been modified. Review the matched text before applying."}

    def apply(self, name: str, output: str, page_number: int, quote: str,
              expected_fingerprint: str, color: str = "yellow", opacity: float = 0.35,
              occurrence: int | None = None, overwrite_annotated_copy: bool = False) -> dict:
        source = self.path(name)
        dest = self.path(output, must_exist=False)
        if color not in COLORS:
            raise AnnotationError(f"Color must be one of: {', '.join(COLORS)}")
        if not 0.1 <= opacity <= 0.7:
            raise AnnotationError("Opacity must be between 0.1 and 0.7")
        actual = self._fingerprint(source)
        if actual != expected_fingerprint:
            raise AnnotationError("File changed after proposal; re-run propose_highlight")
        if dest == source:
            if not overwrite_annotated_copy or not source.stem.endswith("-annotated"):
                raise AnnotationError("In-place writes require an *-annotated.pdf input and explicit opt-in")
        elif dest.exists():
            raise AnnotationError("Output already exists; choose a new name or explicitly update an -annotated copy")
        proposal = self.propose(name, page_number, quote, occurrence)
        if proposal["fingerprint"] != actual:
            raise AnnotationError("Source changed during proposal")
        with pymupdf.open(source) as doc:
            page = doc[page_number - 1]
            rects = [pymupdf.Rect(*r) for r in proposal["rectangles"]]
            annot = page.add_highlight_annot(rects)
            if annot is None:
                raise AnnotationError("PDF engine failed to create annotation")
            annot.set_colors(stroke=COLORS[color])
            annot.set_opacity(opacity)
            annot.set_info(content=f"PrecisionPDF: {proposal['matched_words']}")
            annot.update()
            before = sum(1 for p in doc for _ in (p.annots() or []))
            fd, temp_name = tempfile.mkstemp(prefix=".precisionpdf-", suffix=".pdf", dir=dest.parent)
            os.close(fd)
            tmp = Path(temp_name)
            try:
                doc.save(tmp, garbage=3, deflate=True)
                with pymupdf.open(tmp) as verification:
                    after = sum(1 for p in verification for _ in (p.annots() or []))
                    if after != before:
                        raise AnnotationError("Annotation count mismatch after save")
                # In-place annotated-copy updates are atomic replacements.
                # Brand-new outputs use an atomic hard link (O_EXCL equivalent)
                # so a racing writer cannot cause a silent overwrite.
                if dest == source:
                    os.replace(tmp, dest)
                else:
                    try:
                        os.link(tmp, dest)
                    except FileExistsError as exc:
                        raise AnnotationError("Output path appeared during save; refusing to overwrite") from exc
            finally:
                tmp.unlink(missing_ok=True)
        return {"saved": str(dest), "page": page_number, "matched_text": proposal["matched_words"],
                "color": color, "opacity": opacity, "line_quads": len(rects),
                "total_annotations": before, "sha256": self._fingerprint(dest)}

    def annotations(self, name: str, page_number: int | None = None) -> dict:
        path = self.path(name)
        results = []
        with pymupdf.open(path) as doc:
            pages = range(len(doc))
            if page_number is not None:
                self._check_page(doc, page_number)
                pages = [page_number - 1]
            for idx in pages:
                for a in doc[idx].annots() or []:
                    results.append({"page": idx + 1, "xref": a.xref, "type": a.type[1],
                                    "colors": a.colors, "rect": tuple(a.rect),
                                    "content": (a.info or {}).get("content", "")[:250]})
        return {"file": str(path.relative_to(self.root)), "count": len(results), "annotations": results[:500],
                "truncated": len(results) > 500}

    def render(self, name: str, page_number: int = 1) -> dict:
        source = self.path(name)
        with pymupdf.open(source) as doc:
            self._check_page(doc, page_number)
            pix = doc[page_number - 1].get_pixmap(matrix=pymupdf.Matrix(2, 2), alpha=False, annots=True)
            # Deterministic, tool-owned filename: overwrites only a preview of that PDF.
            preview = source.with_name(f"{source.stem}-precisionpdf-preview-p{page_number}.png")
            self.path(str(preview), suffix=".png", must_exist=False)
            pix.save(preview)
            return {"page": page_number, "preview_png": str(preview), "width": pix.width, "height": pix.height}
