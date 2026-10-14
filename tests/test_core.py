from pathlib import Path

import pymupdf
import pytest

from precisionpdf_mcp.core import AnnotationError, PDFWorkspace


@pytest.fixture()
def pdf_workspace(tmp_path):
    path = tmp_path / "source.pdf"
    with pymupdf.open() as pdf:
        page = pdf.new_page()
        page.insert_text((50, 90), "Neural networks are also highly sensitive to changes in their training data.", fontsize=12)
        page.insert_text((50, 110), "The evidence should be easy to examine.", fontsize=12)
        page.insert_text((50, 140), "A multiline passage starts right here", fontsize=12)
        page.insert_text((50, 160), "and continues on the next line.", fontsize=12)
        old = page.add_highlight_annot(page.search_for("evidence", quads=True))
        old.update()
        pdf.save(path)
    return PDFWorkspace(tmp_path)


def test_propose_and_apply_preserves_old_annotations(pdf_workspace):
    w = pdf_workspace
    p = w.propose("source.pdf", 1, "are also highly sensitive to changes in their training data")
    assert p["match_count"] == 1
    assert p["quads"] == 1
    assert p["matched_words"].startswith("are also")
    assert w.annotations("source.pdf")["count"] == 1
    result = w.apply("source.pdf", "lesson-annotated.pdf", 1, p["requested_quote"], p["fingerprint"], "blue")
    assert result["color"] == "blue"
    assert w.annotations("source.pdf")["count"] == 1
    anns = w.annotations("lesson-annotated.pdf")
    assert anns["count"] == 2
    assert any(a["type"] == "Highlight" and a["colors"].get("stroke") for a in anns["annotations"])
    assert Path(w.render("lesson-annotated.pdf")["preview_png"]).exists()


def test_multiline_single_annotation_two_quads(pdf_workspace):
    w = pdf_workspace
    quote = "passage starts right here and continues on the next line"
    p = w.propose("source.pdf", 1, quote)
    assert p["quads"] == 2
    out = w.apply("source.pdf", "two-lines-annotated.pdf", 1, quote, p["fingerprint"], "green")
    assert out["line_quads"] == 2
    with pymupdf.open(w.path("two-lines-annotated.pdf")) as doc:
        page = doc[0]
        annotations = list(page.annots() or [])
        assert len(annotations) == 2
        added = annotations[-1]
        assert len(added.vertices) == 8


def test_original_cannot_be_overwritten(pdf_workspace):
    w = pdf_workspace
    p = w.propose("source.pdf", 1, "Neural networks")
    with pytest.raises(AnnotationError, match="In-place"):
        w.apply("source.pdf", "source.pdf", 1, "Neural networks", p["fingerprint"])
    w.apply("source.pdf", "existing.pdf", 1, "Neural networks", p["fingerprint"])
    with pytest.raises(AnnotationError, match="already exists"):
        w.apply("source.pdf", "existing.pdf", 1, "Neural networks", p["fingerprint"])


def test_update_annotated_copy_with_fingerprint(pdf_workspace):
    w = pdf_workspace
    p = w.propose("source.pdf", 1, "Neural networks")
    w.apply("source.pdf", "source-annotated.pdf", 1, "Neural networks", p["fingerprint"])
    p2 = w.propose("source-annotated.pdf", 1, "The evidence")
    w.apply("source-annotated.pdf", "source-annotated.pdf", 1, "The evidence",
            p2["fingerprint"], "green", overwrite_annotated_copy=True)
    assert w.annotations("source-annotated.pdf")["count"] == 3
    with pytest.raises(AnnotationError, match="changed"):
        w.apply("source-annotated.pdf", "other.pdf", 1, "Neural networks", p2["fingerprint"])


def test_ambiguity_and_no_fuzzy_guess(pdf_workspace):
    w = pdf_workspace
    with pytest.raises(AnnotationError, match="No exact"):
        w.propose("source.pdf", 1, "Invented Neural networks")
    with pytest.raises(AnnotationError, match="Ambiguous"):
        w.propose("source.pdf", 1, "the")


def test_workspace_restriction_and_symlink(pdf_workspace, tmp_path):
    w = pdf_workspace
    with pytest.raises(AnnotationError, match="outside"):
        w.path("../../etc/passwd")
    outside = tmp_path.parent / "outside.pdf"
    (tmp_path / "escape.pdf").symlink_to(outside)
    with pytest.raises(AnnotationError, match="outside"):
        w.path("escape.pdf")
