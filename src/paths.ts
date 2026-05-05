import fs from "node:fs";
import { realpath } from "node:fs/promises";
import path from "node:path";

function normalizeRoot(workspaceRoot: string): string {
  return path.resolve(workspaceRoot);
}

function isInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function ensureInsideWorkspace(workspaceRoot: string, candidate: string): string {
  const root = normalizeRoot(workspaceRoot);
  const resolved = path.resolve(root, candidate);
  if (!isInside(root, resolved)) {
    throw new Error(`Path escapes workspace root: ${candidate}`);
  }
  return resolved;
}

export function resolveWorkspacePath(workspaceRoot: string, relativePath: string): string {
  if (path.isAbsolute(relativePath)) {
    throw new Error(`Expected a workspace-relative path, got absolute path: ${relativePath}`);
  }
  return ensureInsideWorkspace(workspaceRoot, relativePath);
}

export async function resolveExistingWorkspacePath(workspaceRoot: string, relativePath: string): Promise<string> {
  const resolved = resolveWorkspacePath(workspaceRoot, relativePath);
  const rootReal = await realpath(workspaceRoot);
  const pathReal = await realpath(resolved);
  if (!isInside(rootReal, pathReal)) {
    throw new Error(`Path escapes workspace root through a symlink: ${relativePath}`);
  }
  return pathReal;
}

export function pathExists(candidate: string): boolean {
  return fs.existsSync(candidate);
}

export function isExecutable(candidate: string): boolean {
  try {
    fs.accessSync(candidate, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
