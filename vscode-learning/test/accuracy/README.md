# PrecisionPDF answer accuracy

The 37 cases in [cases.js](cases.js) have hand-written expected answers and source spans. [fixtures.py](fixtures.py) creates fresh synthetic PDFs for each run. Cases cover selected page scope, missing answers, exact quantities and qualifiers, opposing findings in separate PDFs, a two-column layout, OCR, a chart beside an unrelated panel, and an equation. This suite tests fidelity to the assigned PDF evidence.

## Run without a model

From the repository root with the Python backend prepared, run:

```bash
node vscode-learning/test/accuracy/prepare.js
```

This checks whether each annotated passage is available to the answering stage. It runs the normal Python reader, OCR, the comparison search, and region extraction. The four OCR cases use PyMuPDF with English Tesseract language data. The output reports passage coverage. Wording quality, citation support, and correctness still require a model run and grading. For the comparison retrieval regression, the original ranker supplied 34 of 36 annotated spans. Filtering repeated excerpts recovered both missing spans on this fixture set.

## Run in your regular VS Code window

Build the local test companion from the repository root:

```bash
node vscode-learning/test/accuracy/build-companion.js /tmp/precisionpdf-accuracy-review
code --install-extension /tmp/precisionpdf-accuracy-review/precisionpdf-accuracy-check.vsix
```

In your signed-in VS Code window, run **PrecisionPDF: Run Accuracy Check** from
the Command Palette and choose **Six-case accuracy check**. VS Code may ask to
grant the test companion Copilot access. The six cases use up to 12 requests and
save a local report in the build output directory. Use **Full 37-case benchmark**
after reviewing the six-case results.

Choose **Citation and refusal retest** to rerun the six cases that exposed
false refusals, unsupported details, or lost qualifiers in the initial live
benchmark.

Choose **Scope and punctuation retest** to check whether the tutor withholds
out-of-season hours and recovers the supported part of a two-part question.

Choose **Scope regression retest** to rerun the five answerable cases affected
by scope review and check that out-of-season hours are still withheld.

Choose **Claim ID and Guided Reading retest** to check that two previously
discarded tutor approvals survive and that Guided Reading requires evidence
for the question's subject.

Reports include a trace for each synthetic case. For tutor answers, it shows the
draft, any claim dropped during quote resolution, the exact quotes supplied to
the reviewer, and whether the reviewed claim was displayed. A raw response is
recorded even when it is invalid JSON. These traces run only in the synthetic
benchmark.

If VS Code shows **Reload Required** after updating the companion, reload once
before rerunning the check so it uses the new benchmark code.

## Run in a separate VS Code test profile

Use a separate VS Code profile directory and sign in to Copilot there. Close that instance before running extension tests against the same profile directory. The test process makes live Copilot requests (up to about 80 for the full suite). It sends only the generated fixtures and benchmark questions, and writes a local report after each case.

From the repository root:

```bash
PRECISIONPDF_BENCH_REPORT=/tmp/precisionpdf-live.json \
PRECISIONPDF_BENCH_CASE=eligible-age \
  code --user-data-dir /path/to/benchmark-profile \
    --extensionDevelopmentPath="$PWD/vscode-learning" \
    --extensionTestsPath="$PWD/vscode-learning/test/accuracy/live.js"
```

Omit `PRECISIONPDF_BENCH_CASE` to run the full suite. If necessary, use `PRECISIONPDF_BENCH_UV` for an alternate `uv` path. Open the JSON report for results or for a recorded blocker. The model ID and version in each case help make later runs comparable. The harness uses the production answer and review functions and the VS Code Language Model API. It prepares the PDF scope directly, so it measures reasoning and grounded output separately from webview interactions.

## Grade the report

Use the expected facts and cited spans as a reference. Accept accurate paraphrases and equivalent evidence in the same source. For each run record:

- **Retrieval** — number of annotated spans actually supplied, before answer generation.
- **Correctness and completeness** — mark factual correctness and coverage of all supported parts separately. Check numbers, signs, conditions, author attribution, and missing information.
- **Claim support** — for each factual claim, check that its own citation establishes it. Count a real but contradictory, unrelated, or too narrow citation as unsupported. For plots and equations, use the selected crop and the stated units. For guides, read the overview and each displayed explanation.
- **Abstention** — on unanswerable parts, accept a clear statement of what the evidence cannot establish. Count confident guesses and unnecessary refusals separately. An error or unavailable model is a failed run, separate from abstention.

Keep the baseline report before adjusting prompts or model selection. Compare like-for-like cases and models. Review output manually rather than treating the same model's approval as a ground-truth score.
