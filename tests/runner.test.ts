import { access, chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runProcess } from "../src/runner.js";

async function fakeExecutable(script: string): Promise<{ dir: string; executable: string }> {
  const dir = await mkdtemp(path.join(tmpdir(), "vivado-mcp-runner-"));
  const executable = path.join(dir, "fake-tool.sh");
  await writeFile(executable, script, "utf8");
  await chmod(executable, 0o755);
  return { dir, executable };
}

async function waitForFile(filePath: string): Promise<void> {
  const deadline = Date.now() + 1_000;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      await access(filePath);
      return;
    } catch (error) {
      lastError = error;
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
    }
  }

  throw lastError;
}

describe("runProcess", () => {
  it("runs a fake executable successfully and captures stdout and stderr", async () => {
    const { dir, executable } = await fakeExecutable(
      "#!/usr/bin/env bash\nset -euo pipefail\necho \"stdout:$1\"\necho \"stderr:$VIVADO_MCP_TEST_VALUE\" >&2\n"
    );

    const result = await runProcess([executable, "ok"], {
      cwd: dir,
      env: { ...process.env, VIVADO_MCP_TEST_VALUE: "from-env" },
      timeoutMs: 5_000
    });

    expect(result).toMatchObject({
      exitCode: 0,
      signal: null,
      stdout: "stdout:ok\n",
      stderr: "stderr:from-env\n",
      timedOut: false,
      cancelled: false
    });
  });

  it("returns a non-zero exit code while preserving stdout and stderr", async () => {
    const { dir, executable } = await fakeExecutable(
      "#!/usr/bin/env bash\nset -euo pipefail\necho \"stdout before failure\"\necho \"stderr before failure\" >&2\nexit 7\n"
    );

    const result = await runProcess([executable], { cwd: dir, timeoutMs: 5_000 });

    expect(result).toMatchObject({
      exitCode: 7,
      signal: null,
      stdout: "stdout before failure\n",
      stderr: "stderr before failure\n",
      timedOut: false,
      cancelled: false
    });
  });

  it("terminates a process that exceeds its timeout", async () => {
    const { dir, executable } = await fakeExecutable(
      "#!/usr/bin/env bash\nset -euo pipefail\necho \"started\"\nsleep 10\necho \"too late\"\n"
    );

    const result = await runProcess([executable], { cwd: dir, timeoutMs: 100 });

    expect(result.stdout).toBe("started\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBeNull();
    expect(result.signal).toBe("SIGTERM");
    expect(result.timedOut).toBe(true);
    expect(result.cancelled).toBe(false);
  });

  it("terminates a running process when its abort signal is cancelled", async () => {
    const { dir, executable } = await fakeExecutable(
      "#!/usr/bin/env bash\nset -euo pipefail\necho \"started\"\ntouch \"$PWD/started\"\nsleep 10\necho \"too late\"\n"
    );
    const controller = new AbortController();

    const running = runProcess([executable], {
      cwd: dir,
      signal: controller.signal,
      timeoutMs: 5_000
    });
    await waitForFile(path.join(dir, "started"));
    controller.abort();

    const result = await running;

    expect(result.stdout).toBe("started\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBeNull();
    expect(result.signal).toBe("SIGTERM");
    expect(result.timedOut).toBe(false);
    expect(result.cancelled).toBe(true);
  });
});
