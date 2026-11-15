"""Check spoken math without loading the optional Kokoro model."""

from pathlib import Path
from runpy import run_path


def test_spoken_math_preserves_relations_and_units():
    worker = run_path(str(Path(__file__).resolve().parents[1] / "experiments" / "kokoro_speech_worker.py"))
    spoken_text = worker["spoken_text"]
    assert spoken_text("If x<y and y > z, as t≥0.") == "If x less than y and y greater than z, as t greater than or equal to 0."
    assert spoken_text("Use -2 °C, 5 µg, and a change of −8%.") == "Use minus 2 degrees Celsius, 5 micrograms, and a change of minus 8 percent."
    assert spoken_text("The 10-20 range and long-term condition.") == "The 10-20 range and long-term condition."
