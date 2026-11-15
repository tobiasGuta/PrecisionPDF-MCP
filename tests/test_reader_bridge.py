"""Read-only Learning Mode IPC bridge tests."""

import base64

import pymupdf
import pytest

from precisionpdf_mcp.core import AnnotationError
from precisionpdf_mcp.reader_bridge import read_learning_page, read_learning_region


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


def test_rotated_pages_have_rotated_word_boxes(tmp_path):
    file = tmp_path / "rotated.pdf"
    with pymupdf.open() as doc:
        page = doc.new_page()
        page.insert_text((50, 100), "Rotated text")
        page.set_rotation(90)
        doc.save(file)
    result = read_learning_page(str(tmp_path), file.name, 1)
    assert result["width"] > result["height"]
    assert result["words"][0][4] == "Rotated"
    assert result["words"][0][1] == 50


def test_reader_returns_internal_links_and_ignores_external_actions(tmp_path):
    filename = "references.pdf"
    with pymupdf.open() as doc:
        doc.new_page()
        doc.new_page()
        page = doc[0]
        page.insert_text((50, 100), "Figure 3")
        area = pymupdf.Rect(50, 85, 91, 105)
        page.insert_link({"kind": pymupdf.LINK_GOTO, "from": area, "page": 1,
                          "to": pymupdf.Point(55, 200)})
        page.insert_link({"kind": pymupdf.LINK_URI, "from": area, "uri": "https://example.org"})
        page.set_rotation(90)
        doc[1].set_rotation(90)
        doc.save(tmp_path / filename)
    rendered = read_learning_page(str(tmp_path), filename, 1)
    assert len(rendered["internal_links"]) == 1
    link = rendered["internal_links"][0]
    assert link["page"] == 2
    assert link["to"] == [642, 55]
    assert rendered["word_lines"] == [[0, 0], [0, 0]]
    x0, y0, x1, y1, _ = rendered["words"][0]
    assert pymupdf.Point((x0 + x1) / 2, (y0 + y1) / 2) in pymupdf.Rect(link["from"])


@pytest.mark.parametrize("rotation", [0, 90, 180, 270])
def test_visual_region_contains_only_the_selected_display_area(tmp_path, rotation):
    filename = "region.pdf"
    with pymupdf.open() as doc:
        page = doc.new_page(width=200, height=100)
        page.draw_rect(pymupdf.Rect(20, 20, 60, 60), fill=(1, 0, 0), color=None)
        page.draw_rect(pymupdf.Rect(90, 20, 130, 60), fill=(0, 0, 1), color=None)
        page.set_rotation(rotation)
        target = pymupdf.Rect(25, 25, 55, 55) * page.rotation_matrix
        region = (target.x0 / page.rect.width, target.y0 / page.rect.height,
                  target.x1 / page.rect.width, target.y1 / page.rect.height)
        doc.save(tmp_path / filename)
    result = read_learning_region(str(tmp_path), filename, 1, region)
    pixmap = pymupdf.Pixmap(base64.b64decode(result["png_base64"]))
    assert pixmap.pixel(pixmap.width // 2, pixmap.height // 2) == (255, 0, 0)
    assert pixmap.width <= 91 and pixmap.height <= 91
    with pytest.raises(AnnotationError, match="inside"):
        read_learning_region(str(tmp_path), filename, 1, (0, 0, 1.1, 1))
