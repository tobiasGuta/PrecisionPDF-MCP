"""Reviewed edits to existing PDF highlights; never reconstruct the document.

The xref identifies a single annotation within a fingerprinted annotated copy.
No original PDF can be edited using this module.
"""

from __future__ import annotations

from pathlib import Path
from tempfile import mkstemp
import os

import pymupdf

from .core import AnnotationError, COLORS, PDFWorkspace


def _annotation_record(annotation: pymupdf.Annot) -> dict:
    """Return stable fields needed for review and preservation checks."""
    return {
        "xref": annotation.xref,
        "type": annotation.type[1],
        "rect": [round(float(v), 3) for v in annotation.rect],
        "vertices": [[round(float(p[0]), 3), round(float(p[1]), 3)]
                     for p in (annotation.vertices or [])],
        "colors": annotation.colors,
        "opacity": annotation.opacity,
        "content": (annotation.info or {}).get("content", "")[:250],
        "info": annotation.info or {},
    }


def _snapshot(doc: pymupdf.Document) -> dict[tuple[int, int], dict]:
    return {
        (number + 1, annot.xref): _annotation_record(annot)
        for number, page in enumerate(doc)
        for annot in (page.annots() or [])
    }


class AnnotationEditor:
    def __init__(self, workspace: PDFWorkspace):
        self.workspace = workspace

    def _source(self, file: str) -> Path:
        source = self.workspace.path(file)
        if not source.stem.endswith("-annotated"):
            raise AnnotationError("Editing requires an existing *-annotated.pdf copy; original PDFs are protected")
        return source

    @staticmethod
    def _target(doc: pymupdf.Document, page: int, xref: int) -> tuple[pymupdf.Page, pymupdf.Annot]:
        if not isinstance(xref, int) or isinstance(xref, bool) or xref <= 0:
            raise AnnotationError("xref must be a positive annotation object number")
        PDFWorkspace._check_page(doc, page)
        pdf_page = doc[page - 1]
        for annot in pdf_page.annots() or []:
            if annot.xref == xref:
                if annot.type[1] != "Highlight":
                    raise AnnotationError("Only existing Highlight annotations can be edited")
                return pdf_page, annot
        raise AnnotationError("Annotation xref not found on specified page; list annotations again")

    @staticmethod
    def _settings(color: str, opacity: float | None) -> None:
        if color not in COLORS:
            raise AnnotationError(f"Color must be one of: {', '.join(COLORS)}")
        if opacity is not None and not (0.1 <= opacity <= 0.7):
            raise AnnotationError("Opacity must be between 0.1 and 0.7")

    def propose_update(self, file: str, page: int, xref: int, color: str,
                       opacity: float | None = None) -> dict:
        self._settings(color, opacity)
        source = self._source(file)
        with pymupdf.open(source) as doc:
            pdf_page, target = self._target(doc, page, xref)
            record = _annotation_record(target)
        return {
            "file": str(source.relative_to(self.workspace.root)),
            "fingerprint": self.workspace._fingerprint(source),
            "page": page, "xref": xref, "current": record,
            "proposed_color": color,
            "proposed_opacity": record["opacity"] if opacity is None else opacity,
            "note": "Proposal only; no PDF changed. Review the annotation and approve the exact edit.",
        }

    def propose_removal(self, file: str, page: int, xref: int) -> dict:
        source = self._source(file)
        with pymupdf.open(source) as doc:
            pdf_page, target = self._target(doc, page, xref)
            record = _annotation_record(target)
        return {
            "file": str(source.relative_to(self.workspace.root)),
            "fingerprint": self.workspace._fingerprint(source),
            "page": page, "xref": xref, "current": record,
            "note": "Proposal only; no PDF changed. Removing this annotation is irreversible without a backup.",
        }

    def _edit(self, file: str, page: int, xref: int, expected_fingerprint: str,
              *, color: str | None = None, opacity: float | None = None,
              remove: bool = False) -> dict:
        source = self._source(file)
        if not remove:
            if color is None:
                raise AnnotationError("New color is required")
            self._settings(color, opacity)
        if self.workspace._fingerprint(source) != expected_fingerprint:
            raise AnnotationError("File changed after proposal; propose the annotation operation again")

        temp: Path | None = None
        try:
            with pymupdf.open(source) as doc:
                pdf_page, target = self._target(doc, page, xref)
                before = _snapshot(doc)
                previous = before[(page, xref)]
                if remove:
                    pdf_page.delete_annot(target)
                else:
                    target.set_colors(stroke=COLORS[color])
                    if opacity is not None:
                        target.set_opacity(opacity)
                    target.update()
                fd, temp_name = mkstemp(prefix=".precisionpdf-edit-", suffix=".pdf", dir=source.parent)
                os.close(fd)
                temp = Path(temp_name)
                # Keep object numbers stable, including unrelated annotations.
                doc.save(temp, garbage=0, deflate=True)

            with pymupdf.open(temp) as verified:
                after = _snapshot(verified)
                unrelated_before = {k: v for k, v in before.items() if k != (page, xref)}
                unrelated_after = {k: v for k, v in after.items() if k != (page, xref)}
                if unrelated_before != unrelated_after:
                    raise AnnotationError("Unrelated annotations changed; refusing to save")
                if remove:
                    if (page, xref) in after:
                        raise AnnotationError("Target annotation still exists after removal")
                else:
                    updated = after.get((page, xref))
                    if updated is None or updated["type"] != "Highlight":
                        raise AnnotationError("Target annotation was not preserved")
                    expected_rgb = COLORS[color]
                    actual_rgb = (updated["colors"] or {}).get("stroke") or ()
                    if len(actual_rgb) != 3 or any(abs(a - b) > 0.002 for a, b in zip(actual_rgb, expected_rgb)):
                        raise AnnotationError("Saved highlight color does not match requested color")
                    expected_opacity = previous["opacity"] if opacity is None else opacity
                    if abs(updated["opacity"] - expected_opacity) > 0.002:
                        raise AnnotationError("Saved highlight opacity does not match expected opacity")
                    if (updated["rect"] != previous["rect"] or updated["vertices"] != previous["vertices"]
                            or updated["content"] != previous["content"]):
                        raise AnnotationError("Highlight geometry or content changed unexpectedly")

            # Recheck before the atomic replacement to reject edits based on stale content.
            if self.workspace._fingerprint(source) != expected_fingerprint:
                raise AnnotationError("File changed during edit; refusing to overwrite")
            os.replace(temp, source)
            temp = None
        finally:
            if temp is not None:
                temp.unlink(missing_ok=True)

        return {
            "saved": str(source), "page": page, "xref": xref,
            "action": "removed" if remove else "updated",
            "previous": previous,
            "color": None if remove else color,
            "opacity": None if remove else (previous["opacity"] if opacity is None else opacity),
            "remaining_annotations": len(after),
            "sha256": self.workspace._fingerprint(source),
        }

    def apply_update(self, file: str, page: int, xref: int, expected_fingerprint: str,
                     color: str, opacity: float | None = None) -> dict:
        return self._edit(file, page, xref, expected_fingerprint, color=color, opacity=opacity)

    def apply_removal(self, file: str, page: int, xref: int, expected_fingerprint: str) -> dict:
        return self._edit(file, page, xref, expected_fingerprint, remove=True)
