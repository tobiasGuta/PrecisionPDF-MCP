"""Regression for the real-world mismatch found in clean_highlight_test.py.

The source document contained 'networks ...' but not the proposed leading
'Neural'. The accepted span must be exact and isolated to its own geometry.
"""

import pymupdf
import pytest

from precisionpdf_mcp.core import AnnotationError, PDFWorkspace


def test_missing_prefix_and_exact_highlight_geometry(tmp_path):
    target = 'are also highly sensitive to changes in their training data.'
    with pymupdf.open() as doc:
        page = doc.new_page()
        page.insert_text((60, 90), 'networks ' + target + ' Feed', fontsize=11)
        doc.save(tmp_path / 'source.pdf')

    ws = PDFWorkspace(tmp_path)
    with pytest.raises(AnnotationError, match='No exact'):
        ws.propose('source.pdf', 1, 'Neural networks ' + target)

    proposed = ws.propose('source.pdf', 1, target)
    assert proposed['match_count'] == 1
    assert proposed['quads'] == 1
    assert proposed['matched_words'] == target

    ws.apply('source.pdf', 'source-annotated.pdf', 1, target, proposed['fingerprint'], color='blue')
    with pymupdf.open(tmp_path / 'source-annotated.pdf') as doc:
        page = doc[0]
        highlights = [a for a in page.annots() or [] if a.type[1] == 'Highlight']
        assert len(highlights) == 1
        assert len(highlights[0].vertices) == 4
        selected = pymupdf.Rect(*proposed['rectangles'][0])
        # The annotation's quad represents the target words, without 'networks' or 'Feed'.
        xs = [point[0] for point in highlights[0].vertices]
        assert min(xs) == pytest.approx(selected.x0, abs=0.01)
        assert max(xs) == pytest.approx(selected.x1, abs=0.01)
        assert highlights[0].colors['stroke'][2] > highlights[0].colors['stroke'][0]
