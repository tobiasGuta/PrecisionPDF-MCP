"""Generate synthetic accuracy fixtures with PyMuPDF, already a reader dependency."""
import argparse
from pathlib import Path

import pymupdf


def write(page, x, y, lines, size=13):
    for offset, line in enumerate(lines):
        page.insert_text((x, y + 22 * offset), line, fontsize=size)


def add_page(pdf, title, lines=()):
    page = pdf.new_page()
    write(page, 48, 52, [title], size=19)
    write(page, 48, 100, lines)
    return page


def build(output):
    output.mkdir(parents=True, exist_ok=True)
    with pymupdf.open() as pdf:
        for _ in range(5):
            add_page(pdf, "Field trial", ["Study eligibility is covered in the full report."])
        add_page(pdf, "Field trial", [
            "Study eligibility was limited to adults over age 65.",
            "The trial enrolled 48 people and followed them for six weeks.",
            "The intervention group improved by 12 points on the test.",
            "The comparison group improved by 7 points on the same test.",
            "The trial did not measure long-term outcomes.",
            "The authors described the findings as preliminary.",
        ])
        page = add_page(pdf, "Two separate experiments")
        # Insert the right column first so authored and visual order differ.
        write(page, 320, 110, [
            "Experiment B used four sites.",
            "It measured fuel use in liters.",
            "Fuel use rose by 8%."
        ])
        write(page, 48, 110, [
            "Experiment A used two sites.",
            "It measured total travel time.",
            "Travel time fell by 8%."
        ])
        add_page(pdf, "Rule and units", [
            "The alert triggers only if x < y and y > z.",
            "A negative change of -2 degrees is allowed.",
            "The sensor limit is 5 mg, equivalent to 5000 micrograms.",
            "The allowance applies only to indoor tests."
        ])
        pdf.save(output / "field.pdf")

    with pymupdf.open() as pdf:
        add_page(pdf, "Field trial replication", [
            "Study eligibility included adults ages 18 through 25.",
            "The replication enrolled 31 people and lasted two weeks.",
            "The intervention group improved by 3 points.",
            "The comparison group improved by 4 points.",
            "The authors did not find evidence of an intervention benefit."
        ])
        pdf.save(output / "replication.pdf")

    with pymupdf.open() as pdf:
        page = add_page(pdf, "Water use by machine")
        write(page, 58, 115, ["Water use (liters)"])
        page.draw_line((100, 145), (100, 320))
        page.draw_line((100, 320), (345, 320))
        for x, name, value in [(151, "Alpha", 4), (253, "Beta", 6)]:
            top = 320 - value * 24
            page.draw_rect((x, top, x + 43, 320), color=(0, .25, .55), fill=(.3, .65, .9))
            write(page, x + 14, top - 9, [str(value)])
            write(page, x, 344, [name])
        write(page, 105, 374, ["Figure A. Water used in one cycle."])
        page.draw_line((378, 90), (378, 395))
        write(page, 400, 115, ["Electricity (kWh)"])
        page.draw_rect((455, 175, 490, 320), fill=(.9, .55, .2))
        write(page, 460, 165, ["22"])
        write(page, 405, 344, ["Figure B. Electricity."])
        add_page(pdf, "Rate equation", [
            "R = distance / time",
            "Distance is in meters. Time is in seconds.",
            "For positive time, doubling time while keeping distance fixed halves R."
        ])
        pdf.save(output / "visuals.pdf")

    with pymupdf.open() as scan_source:
        page = add_page(scan_source, "Archive scan", [
            "The west gate closes at 16:30 on Fridays.",
            "The east gate stays open until 18:00.",
            "These hours apply from April through September."
        ])
        image = page.get_pixmap(matrix=pymupdf.Matrix(2, 2), alpha=False)
        with pymupdf.open() as scan:
            scan.new_page().insert_image(page.rect, pixmap=image)
            scan.save(output / "scan.pdf")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    build(parser.parse_args().output)
