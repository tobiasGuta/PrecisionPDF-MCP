"use strict";

const { mkdtemp, rm } = require("node:fs/promises");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const os = require("node:os");
const path = require("node:path");
const cases = require("./cases");
const { readerProcess } = require("../../reader_process");
const { comparisonSources } = require("../../comparison");
const { sourceFor } = require("../../study");
const { visualContext } = require("../../visual");

const repo = path.resolve(__dirname, "../../..");
const compact = text => text.replace(/\s+/g, " ").trim();
const covers = (sources, required) => required.filter(item => sources.some(source =>
  item.file === source.document && item.page === source.page && compact(source.quote).includes(item.quote)));

async function withFixtures(run, { repo: backend = repo, uv = process.env.PRECISIONPDF_BENCH_UV || "uv" } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "precisionpdf-accuracy-"));
  try {
    await promisify(execFile)(uv, ["--directory", backend, "run", "--no-sync", "--offline",
      "python", path.join(__dirname, "fixtures.py"), root], { timeout: 60000 });
    return await run({ repo: backend, root, uv });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function prepareCases(config) {
  const read = (filename, module, flags) => readerProcess({ ...config, filename }, module, flags);
  const pages = new Map();
  const indexes = new Map();
  async function page(filename, number, ocr) {
    const key = [filename, number, ocr].join(":");
    if (!pages.has(key)) {
      pages.set(key, read(filename, "reader_bridge", ["--page", String(number),
        ...(ocr ? ["--ocr-language", ocr] : [])]));
    }
    return pages.get(key);
  }
  async function searchIndex(filename) {
    if (!indexes.has(filename)) indexes.set(filename, read(filename, "guided_index", ["--search"]));
    return indexes.get(filename);
  }
  return async function prepare(task) {
    const { file, question } = task;
    if (task.route === "comparison") {
      const documents = [];
      for (const filename of task.files) {
        documents.push({ label: filename, index: await searchIndex(filename) });
      }
      const { sources, coverage } = comparisonSources(documents, question);
      return { sources, coverage };
    }
    if (task.route === "guide") {
      const index = await read(file, "guided_index", ["--start", String(task.start), "--end", String(task.end)]);
      return { index, sources: index.excerpts.map(excerpt => ({ document: file, page: excerpt.page, quote: excerpt.text })) };
    }
    const rendered = await page(file, task.page, task.ocr);
    if (task.route === "visual") {
      const region = await read(file, "reader_bridge",
        ["--page", String(task.page), "--region", ...task.box.map(String)]);
      return { image: region.png_base64, context: visualContext(rendered, task.box), sources: [] };
    }
    const wholePage = sourceFor(rendered, 0, rendered.words.length - 1);
    return { sources: wholePage ? [{ ...wholePage, document: file, id: "s1", role: "current page" }] : [] };
  };
}

async function summarize(config) {
  const prepare = prepareCases(config);
  const results = [];
  for (const task of cases) {
    const { sources } = await prepare(task);
    const matched = covers(sources, task.required);
    if (task.required.length) results.push({
      id: task.id, route: task.route, expectedSpans: task.required.length, availableSpans: matched.length
    });
  }
  return results;
}

if (require.main === module) {
  withFixtures(summarize).then(results => {
    console.log(JSON.stringify({ cases: cases.length, results }, null, 2));
  }).catch(error => { console.error(error.message); process.exitCode = 1; });
}

module.exports = { withFixtures, prepareCases, covers };
