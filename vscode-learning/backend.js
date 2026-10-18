"use strict";

const fs = require("node:fs");
const path = require("node:path");

const REQUIRED_BACKEND_FILES = [
  "pyproject.toml",
  "src/precisionpdf_mcp/reader_bridge.py",
  "src/precisionpdf_mcp/guided_index.py",
];

function isBackendRepo(directory) {
  if (typeof directory !== "string" || !directory.trim()) return false;
  try {
    return REQUIRED_BACKEND_FILES.every(relative =>
      fs.statSync(path.join(directory, relative)).isFile()
    );
  } catch (_) {
    return false;
  }
}

function findExistingBackend(configuredPath, extensionDirectory) {
  if (typeof configuredPath === "string" && configuredPath.trim()) {
    const configured = path.resolve(configuredPath.trim());
    return isBackendRepo(configured) ? configured : null;
  }
  // Preserve F5 development mode where vscode-learning/ sits inside the clone.
  const developmentRoot = path.resolve(extensionDirectory, "..");
  return isBackendRepo(developmentRoot) ? developmentRoot : null;
}

module.exports = { isBackendRepo, findExistingBackend };
