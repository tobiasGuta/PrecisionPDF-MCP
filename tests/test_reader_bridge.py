"""Read-only Learning Mode IPC bridge tests."""

import base64

import pymupdf
import pytest

from precisionpdf_mcp.core import AnnotationError
from precisionpdf_mcp.reader_bridge import read_learning_page


@pytest.fixture
def document(tmp_path):
    source = tmp_path / "lesson.pdf"
    with pymupdf.open() as doc:
        page = doc.new_page()
        page.insert_text((50, 70), "The model learns from examples.")
        page.insert_text((50, 90), "A second sentence is available.")
        doc.new_page().insert_text((50, 70), "Page two has a different explanation.")
        doc.save(source)
    return source


def test_read_learning_page_returns_render_and_word_positions(document):
    before = document.read_bytes()
    page = read_learning_page(str(document.parent), document.name, 1)
    assert page["pages"] == 2
    assert page["page"] == 1
    assert page["file"] == "lesson.pdf"
    assert "The model learns" in page["text"]
    assert page["words"][0][4] == "The"
    assert page["width"] > 0 and page["height"] > 0
    assert base64.b64decode(page["png_base64"])[:8] == b"\x89PNG\r\n\x1a\n"
    assert document.read_bytes() == before
    assert sorted(p.name for p in document.parent.iterdir()) == ["lesson.pdf"]


def test_page_bounds_and_workspace_confinement(document, tmp_path):
    with pytest.raises(AnnotationError, match="Page must"):
        read_learning_page(str(tmp_path), document.name, 3)
    with pytest.raises(AnnotationError, match="outside"):
        read_learning_page(str(tmp_path), "../elsewhere.pdf", 1)
    (tmp_path / "escape.pdf").symlink_to(tmp_path.parent / "outside.pdf")
    with pytest.raises(AnnotationError, match="outside"):
        read_learning_page(str(tmp_path), "escape.pdf", 1)


def test_rotated_pages_are_rejected(tmp_path):
    file = tmp_path / "rotated.pdf"
    with pymupdf.open() as doc:
        page = doc.new_page()
        page.set_rotation(90)
        doc.save(file)
    with pytest.raises(AnnotationError, match="Rotated"):
        read_learning_page(str(tmp_path), file.name, 1)
