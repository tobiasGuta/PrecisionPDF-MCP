"use strict";

const { execFile } = require("node:child_process");
const fs = require("node:fs/promises");
const path = require("node:path");

function readerProcess({ uv, repo, root, filename }, moduleName, flags, signal, input) {
  return new Promise((resolve, reject) => {
    const child = execFile(uv, [
      "--directory", repo, "run", "--no-sync", "--offline", "python", "-m",
      "precisionpdf_mcp." + moduleName, "--root", root, "--file=" + filename, ...flags,
    ], { cwd: repo, timeout: 60000, maxBuffer: 48 * 1024 * 1024, signal }, (error, stdout, stderr) => {
      if (error) return reject(new Error((stderr || error.message).trim().slice(0, 800)));
      try { resolve(JSON.parse(stdout)); }
      catch (_) { reject(new Error("Unexpected PDF reader response.")); }
    });
    child.stdin.on("error", () => {});
    child.stdin.end(input === undefined ? undefined : JSON.stringify(input));
  });
}

async function fileVersion({ root, filename }) {
  const stat = await fs.stat(path.join(root, filename), { bigint: true });
  return [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(":");
}

module.exports = { readerProcess, fileVersion };
