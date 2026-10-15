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

def test_sentence_aware_excerpts_and_exact_rendered_word_ranges(tmp_path):
    source = tmp_path / "sentences.pdf"
    with pymupdf.open() as doc:
        page = doc.new_page()
        page.insert_text((50, 80),
            "Dr. Smith studies AI. Neural networks may be unreliable. Interpretability matters.")
        doc.save(source)
    indexed = build_guided_index(str(tmp_path), source.name)
    texts = [e["text"] for e in indexed["excerpts"]]
    assert texts == [
        "Dr. Smith studies AI.",
        "Neural networks may be unreliable.",
        "Interpretability matters.",
    ]
    assert all(e["boundary"] == "sentence" for e in indexed["excerpts"])
    rendered = read_learning_page(str(tmp_path), source.name, 1)
    for excerpt in indexed["excerpts"]:
        span = rendered["words"][excerpt["start_word"]:excerpt["end_word"] + 1]
        assert " ".join(word[4] for word in span) == excerpt["text"]


def test_pdf_outline_identifies_separate_readings_without_inventing_boundaries(tmp_path):
    source = tmp_path / "packet.pdf"
    with pymupdf.open() as doc:
        one = doc.new_page()
        one.insert_text((50, 80), "The first reading explains machine learning.")
        two = doc.new_page()
        two.insert_text((50, 80), "The second reading covers the environment.")
        doc.set_toc([[1, "Reading One", 1], [1, "Reading Two", 2]])
        doc.save(source)
    indexed = build_guided_index(str(tmp_path), source.name)
    assert [s["title"] for s in indexed["sections"]] == ["Reading One", "Reading Two"]
    assert indexed["excerpts"][0]["section"] == "Reading One"
    assert indexed["excerpts"][-1]["section"] == "Reading Two"
    assert source.read_bytes()  # Original file remains readable


def test_sentence_fragment_cap_still_covers_every_word(tmp_path):
    from precisionpdf_mcp.guided_index import _extract_ranges, MAX_EVIDENCE_WORDS
    words = [(0, 0, 10, 10, f"word{i}", 0, i // 10, i % 10)
             for i in range(MAX_EVIDENCE_WORDS * 2 + 3)]
    ranges = list(_extract_ranges(words))
    assert ranges[0][2] == "fragment"
    assert ranges[0][1] == MAX_EVIDENCE_WORDS - 1
    assert [n for start, end, _ in ranges for n in range(start, end + 1)] == list(range(len(words)))
