"""Shared reading-order text and geometry for the Learning Mode reader."""
from __future__ import annotations

import os
from pathlib import Path
import re

import pymupdf

from .core import AnnotationError

MAX_WORDS_PER_PAGE = 5000
OCR_LANGUAGE = re.compile(r"[a-z]{3}(?:\+[a-z]{3})*")


def read_words(page, ocr_language=None, cached=None):
    if cached is not None:
        return cached
    options = {}
    if ocr_language:
        if not OCR_LANGUAGE.fullmatch(ocr_language):
            raise AnnotationError("Invalid OCR language")
        try:
            tessdata = os.environ.get("TESSDATA_PREFIX")
            if not tessdata and Path("/usr/share/tesseract/tessdata").is_dir():
                tessdata = "/usr/share/tesseract/tessdata"
            options["textpage"] = page.get_textpage_ocr(language=ocr_language, dpi=150,
                                                       full=True, tessdata=tessdata)
        except (RuntimeError, ValueError) as error:
            raise AnnotationError(f"OCR is unavailable. Install the Tesseract language data and check TESSDATA_PREFIX. {error}") from error
    words = page.get_text("words", sort=False, **options)
    if len(words) > MAX_WORDS_PER_PAGE:
        raise AnnotationError(f"Page {page.number + 1} exceeds {MAX_WORDS_PER_PAGE} words")
    # Keep each authored text block together even when neighboring columns
    # have identical baselines. Word order within a block comes from MuPDF.
    return sorted(words, key=lambda word: word[5:8])


def display_box(page, word):
    box = pymupdf.Rect(word[:4]) * page.rotation_matrix
    return [*(round(float(value), 3) for value in box), str(word[4])]
