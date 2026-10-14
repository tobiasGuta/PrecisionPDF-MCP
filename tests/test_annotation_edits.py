"""Proof that individual edits preserve every other annotation and never change originals."""

import pymupdf
import pytest

from precisionpdf_mcp.annotation_edits import AnnotationEditor
from precisionpdf_mcp.core import AnnotationError, PDFWorkspace


@pytest.fixture
def annotated(tmp_path):
    original = tmp_path / "course.pdf"
    with pymupdf.open() as doc:
        for label in ("Read this important phrase", "Another important phrase"):
            page = doc.new_page()
            page.insert_text((60, 90), label, fontsize=12)
            annot = page.add_highlight_annot(page.search_for("important", quads=True))
            annot.set_info(content=f"Note for {label}")
            annot.set_colors(stroke=(1, 0.89, 0.18))
            annot.set_opacity(.35)
            annot.update()
        doc.save(original)
    copy = tmp_path / "course-annotated.pdf"
    copy.write_bytes(original.read_bytes())
    return AnnotationEditor(PDFWorkspace(tmp_path)), original, copy


def _annotations(path):
    with pymupdf.open(path) as doc:
        return [[(a.xref, a.type[1], dict(a.colors), a.opacity, a.info.get('content'), tuple(a.rect))
                 for a in page.annots() or []] for page in doc]


def test_update_color_in_place_without_duplicating_or_changing_others(annotated):
    editor, original, copy = annotated
    original_data = original.read_bytes()
    before = _annotations(copy)
    xref = before[0][0][0]
    proposal = editor.propose_update(copy.name, 1, xref, "green")
    assert copy.read_bytes() == original_data
    assert proposal['current']['content'].startswith('Note for Read')
    assert proposal['proposed_opacity'] == pytest.approx(.35)
    result = editor.apply_update(copy.name, 1, xref, proposal['fingerprint'], "green")
    after = _annotations(copy)
    assert result['action'] == 'updated'
    assert result['remaining_annotations'] == 2
    assert len(after[0]) == len(before[0]) == 1
    assert after[0][0][0] == xref
    assert after[0][0][2]['stroke'] == pytest.approx((.31, .79, .43), abs=.002)
    assert after[0][0][3] == pytest.approx(.35, abs=.002)
    assert after[0][0][4:] == before[0][0][4:]
    assert after[1] == before[1]
    assert original.read_bytes() == original_data


def test_remove_one_highlight_without_touching_others(annotated):
    editor, original, copy = annotated
    before = _annotations(copy)
    xref = before[0][0][0]
    proposal = editor.propose_removal(copy.name, 1, xref)
    result = editor.apply_removal(copy.name, 1, xref, proposal['fingerprint'])
    after = _annotations(copy)
    assert result['action'] == 'removed'
    assert result['remaining_annotations'] == 1
    assert after[0] == []
    assert after[1] == before[1]
    assert _annotations(original) == before


def test_reject_stale_proposal(annotated):
    editor, _, copy = annotated
    xref = _annotations(copy)[0][0][0]
    proposal = editor.propose_update(copy.name, 1, xref, 'pink')
    other = editor.propose_update(copy.name, 1, xref, 'orange')
    editor.apply_update(copy.name, 1, xref, other['fingerprint'], 'orange')
    with pytest.raises(AnnotationError, match='changed'):
        editor.apply_update(copy.name, 1, xref, proposal['fingerprint'], 'pink')


def test_reject_wrong_xref_page_and_original(annotated):
    editor, original, copy = annotated
    xref = _annotations(copy)[0][0][0]
    with pytest.raises(AnnotationError, match='original PDFs'):
        editor.propose_update(original.name, 1, xref, 'green')
    with pytest.raises(AnnotationError, match='not found'):
        editor.propose_removal(copy.name, 2, xref)
    with pytest.raises(AnnotationError, match='positive'):
        editor.propose_removal(copy.name, 1, -1)
    with pytest.raises(AnnotationError, match='Color'):
        editor.propose_update(copy.name, 1, xref, 'purple')
    with pytest.raises(AnnotationError, match='Opacity'):
        editor.propose_update(copy.name, 1, xref, 'green', 1.0)
    assert len(_annotations(copy)[0]) == 1


def test_reject_nonhighlight_and_outside_symlink(annotated, tmp_path):
    editor, _, copy = annotated
    with pymupdf.open(copy) as doc:
        page = doc[0]
        note = page.add_text_annot((30, 100), 'not a highlight')
        xref = note.xref
        doc.save(tmp_path / 'with-note-annotated.pdf')
    with pytest.raises(AnnotationError, match='Only existing Highlight'):
        editor.propose_removal('with-note-annotated.pdf', 1, xref)
    (tmp_path / 'escape-annotated.pdf').symlink_to(tmp_path.parent / 'out.pdf')
    with pytest.raises(AnnotationError, match='outside'):
        editor.propose_removal('escape-annotated.pdf', 1, xref)
