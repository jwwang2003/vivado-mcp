import { mkdir, mkdtemp, realpath, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { resolveExistingWorkspacePath, resolveWorkspacePath } from "../../src/paths.js";

async function expectPathRejection(action: () => unknown | Promise<unknown>, pattern: RegExp): Promise<void> {
  await expect(Promise.resolve().then(action)).rejects.toThrow(pattern);
}

describe("workspace path validation", () => {
  it("accepts workspace-relative paths and resolves them under the workspace root", async () => {
    const workspaceRoot = await realpath(await mkdtemp(path.join(tmpdir(), "vivado-mcp-workspace-")));

    await expect(Promise.resolve(resolveWorkspacePath(workspaceRoot, "src/top.tcl"))).resolves.toBe(
      path.join(workspaceRoot, "src", "top.tcl")
    );
  });

  it("rejects traversal outside the workspace root", async () => {
    const workspaceRoot = await realpath(await mkdtemp(path.join(tmpdir(), "vivado-mcp-workspace-")));

    await expectPathRejection(
      () => resolveWorkspacePath(workspaceRoot, "../outside.tcl"),
      /outside.*workspace|workspace.*outside|travers/i
    );
  });

  it("rejects existing paths that escape the workspace through a symlink", async () => {
    const tempRoot = await realpath(await mkdtemp(path.join(tmpdir(), "vivado-mcp-symlink-")));
    const workspaceRoot = path.join(tempRoot, "workspace");
    const outsideRoot = path.join(tempRoot, "outside");
    const outsideScript = path.join(outsideRoot, "escaped.tcl");

    await mkdir(outsideRoot, { recursive: true });
    await mkdir(workspaceRoot, { recursive: true });
    await writeFile(outsideScript, "puts escaped\n");
    await symlink(outsideScript, path.join(workspaceRoot, "escaped-link.tcl"));

    await expectPathRejection(
      () => resolveExistingWorkspacePath(workspaceRoot, "escaped-link.tcl"),
      /symlink|outside.*workspace|workspace.*outside|escape/i
    );
  });
});
