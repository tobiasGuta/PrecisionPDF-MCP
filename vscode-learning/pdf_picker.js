"use strict";

const path = require("node:path");

const EXCLUDED_DIRECTORIES = new Set([".git", "node_modules", ".venv"]);
const PDF_SUFFIX = /\.pdf$/i;

async function findWorkspacePdfs(vscode, folder, limit = 150) {
  const matches = [];
  const directories = [[]];
  for (let i = 0; i < directories.length && matches.length < limit; i++) {
    const segments = directories[i];
    const directory = segments.length ? vscode.Uri.joinPath(folder.uri, ...segments) : folder.uri;
    const entries = await vscode.workspace.fs.readDirectory(directory);
    entries.sort(([a], [b]) => a.localeCompare(b));
    for (const [name, type] of entries) {
      if (type & vscode.FileType.Directory) {
        if (!(type & vscode.FileType.SymbolicLink) && !EXCLUDED_DIRECTORIES.has(name)) {
          directories.push([...segments, name]);
        }
      } else if (PDF_SUFFIX.test(name)) {
        const rel = path.join(...segments, name);
        matches.push({ label: rel.replace(/[\r\n\t]+/g, " "), description: folder.name, folder, rel });
        if (matches.length >= limit) break;
      }
    }
  }
  return matches;
}

module.exports = { findWorkspacePdfs };
