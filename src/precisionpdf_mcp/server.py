"""FastMCP stdio entry point for PrecisionPDF-MCP."""

from __future__ import annotations

import os

from mcp.server.fastmcp import FastMCP
from .core import PDFWorkspace

mcp = FastMCP("PrecisionPDF-MCP")


def workspace() -> PDFWorkspace:
    root = os.environ.get("PRECISIONPDF_ROOT")
    if not root:
        raise ValueError("Set PRECISIONPDF_ROOT to an existing PDF workspace directory")
    return PDFWorkspace(root)


@mcp.tool()
def list_pdfs() -> dict:
    """List PDF files within the configured local workspace (up to 200)."""
    return workspace().list_pdfs()


@mcp.tool()
def read_pdf_page(file: str, page: int = 1) -> dict:
    """Read selectable text from a 1-based PDF page; includes SHA-256 document fingerprint."""
    return workspace().inspect(file, page)


@mcp.tool()
def propose_highlight(file: str, page: int, exact_quote: str, occurrence: int | None = None) -> dict:
    """Find exact normalized words and report their locations WITHOUT modifying any PDF.

    If passage repeats on the page, specify 1-based occurrence explicitly.
    """
    return workspace().propose(file, page, exact_quote, occurrence)


@mcp.tool()
def apply_highlight(file: str, output_file: str, page: int, exact_quote: str,
                    expected_fingerprint: str, color: str = "yellow", opacity: float = 0.35,
                    occurrence: int | None = None, overwrite_annotated_copy: bool = False) -> dict:
    """Apply a proposed exact-match highlight with a checked source fingerprint.

    New output must not exist. For subsequent updates, the input and output may be
    the same *-annotated.pdf file when overwrite_annotated_copy is true.
    Do NOT call without showing the proposal to the user for review.
    """
    return workspace().apply(file, output_file, page, exact_quote, expected_fingerprint,
                             color, opacity, occurrence, overwrite_annotated_copy)


@mcp.tool()
def list_annotations(file: str, page: int | None = None) -> dict:
    """Read existing PDF annotations, including stored colors and object references."""
    return workspace().annotations(file, page)


@mcp.tool()
def render_pdf_page(file: str, page: int = 1) -> dict:
    """Render a PDF page (including annotations) to a local PNG for visual review."""
    return workspace().render(file, page)


def main() -> None:
    mcp.run(transport="stdio")


if __name__ == "__main__":
    main()
