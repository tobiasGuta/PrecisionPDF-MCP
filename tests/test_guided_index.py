"""Read-only Guided Reading evidence index tests."""

import pymupdf
import pytest

from precisionpdf_mcp.core import AnnotationError
from precisionpdf_mcp.guided_index import build_guided_index
from precisionpdf_mcp.reader_bridge import read_learning_page


@pytest.fixture
def lesson(tmp_path):
    source = tmp_path / "lesson.pdf"
    with pymupdf.open() as doc:
        for n in range(3):
            page = doc.new_page()
            for line in range(7):
                page.insert_text((50, 70 + 20 * line), f"Lesson {n + 1}: explanation {line} includes grounded evidence and examples.")
        doc.save(source)
    return source


def test_index_matches_rendered_word_ranges_and_does_not_mutate(lesson):
    before = lesson.read_bytes()
    indexed = build_guided_index(str(lesson.parent), lesson.name)
    assert indexed["pages"] == 3
    assert indexed["complete"] is True
    assert indexed["sha256"] and len(indexed["sha256"]) == 64
    assert len(indexed["page_word_counts"]) == 3
    for excerpt in indexed["excerpts"]:
        data = read_learning_page(str(lesson.parent), lesson.name, excerpt["page"])
        span = data["words"][excerpt["start_word"]:excerpt["end_word"] + 1]
        assert " ".join(word[4] for word in span) == excerpt["text"]
    assert lesson.read_bytes() == before
    assert [f.name for f in lesson.parent.iterdir()] == [lesson.name]


def test_confinement_and_encryption(lesson, tmp_path):
    with pytest.raises(AnnotationError, match="outside"):
        build_guided_index(str(tmp_path), "../escape.pdf")
    (tmp_path / "alias.pdf").symlink_to(tmp_path.parent / "secret.pdf")
    with pytest.raises(AnnotationError, match="outside"):
        build_guided_index(str(tmp_path), "alias.pdf")
    encrypted = tmp_path / "encrypted.pdf"
    with pymupdf.open(lesson) as doc:
        doc.save(encrypted, encryption=pymupdf.PDF_ENCRYPT_AES_256, owner_pw="owner", user_pw="user")
    with pytest.raises(AnnotationError, match="Encrypted"):
        build_guided_index(str(tmp_path), "encrypted.pdf")


def test_reject_scans_rotation_and_page_limit(tmp_path, monkeypatch):
    scan = tmp_path / "scan.pdf"
    with pymupdf.open() as doc:
        doc.new_page()
        doc.save(scan)
    with pytest.raises(AnnotationError, match="No selectable text"):
        build_guided_index(str(tmp_path), "scan.pdf")
    rotated = tmp_path / "rotated.pdf"
    with pymupdf.open() as doc:
        doc.new_page().set_rotation(90)
        doc.save(rotated)
    with pytest.raises(AnnotationError, match="Rotated"):
        build_guided_index(str(tmp_path), "rotated.pdf")
    from precisionpdf_mcp import guided_index
    monkeypatch.setattr(guided_index, "MAX_PAGES", 2)
    with pymupdf.open() as doc:
        for _ in range(3):
            doc.new_page()
        oversized = tmp_path / "long.pdf"
        doc.save(oversized)
    with pytest.raises(AnnotationError, match="1-2 pages"):
        build_guided_index(str(tmp_path), "long.pdf")


def test_exceed_limits_fails_closed(lesson, monkeypatch):
    from precisionpdf_mcp import guided_index
    monkeypatch.setattr(guided_index, "MAX_EXCERPTS", 1)
    with pytest.raises(AnnotationError, match="no partial overview"):
        build_guided_index(str(lesson.parent), lesson.name)
