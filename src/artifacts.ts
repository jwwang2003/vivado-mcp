import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import { ensureInsideWorkspace } from "./paths.js";

export type ArtifactInfo = {
  path: string;
  absolutePath: string;
  sizeBytes: number;
};

function escapeRegex(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

function globToRegex(pattern: string): RegExp {
  const parts = pattern.split(/([*])/g);
  const regex = parts
    .map((part) => {
      if (part === "*") {
        return "[^/]*";
      }
      return escapeRegex(part);
    })
    .join("");
  return new RegExp(`^${regex}$`);
}

async function walkFiles(root: string, dir = root): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const absolutePath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkFiles(root, absolutePath)));
    } else if (entry.isFile()) {
      files.push(absolutePath);
    }
  }
  return files;
}

export async function listArtifacts(jobWorkspace: string, patterns: string[]): Promise<ArtifactInfo[]> {
  const root = path.resolve(jobWorkspace);
  const regexes = patterns.map((pattern) => {
    if (path.isAbsolute(pattern)) {
      throw new Error(`Artifact pattern may not escape job workspace: ${pattern}`);
    }
    if (pattern.startsWith("..") || pattern.includes("../")) {
      throw new Error(`Artifact pattern may not escape job workspace: ${pattern}`);
    }
    try {
      ensureInsideWorkspace(root, pattern);
    } catch {
      throw new Error(`Artifact pattern may not escape job workspace: ${pattern}`);
    }
    return globToRegex(pattern.split(path.sep).join("/"));
  });

  const files = await walkFiles(root);
  const artifacts: ArtifactInfo[] = [];
  for (const file of files) {
    const relative = path.relative(root, file).split(path.sep).join("/");
    if (regexes.some((regex) => regex.test(relative))) {
      const fileStat = await stat(file);
      artifacts.push({
        path: relative,
        absolutePath: file,
        sizeBytes: fileStat.size
      });
    }
  }

  return artifacts.sort((a, b) => a.path.localeCompare(b.path));
}

export async function readLogTail(logPath: string, tailLines: number): Promise<string> {
  try {
    const content = await readFile(logPath, "utf8");
    return content.split(/\r?\n/).slice(-tailLines).join("\n");
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code === "ENOENT") {
      return "";
    }
    throw error;
  }
}
