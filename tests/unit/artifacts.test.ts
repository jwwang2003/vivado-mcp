import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import { listArtifacts, readLogTail } from "../../src/artifacts.js";

async function makeTempDir(name: string): Promise<string> {
  return mkdir(join(tmpdir(), `vivado-mcp-${name}-${Date.now()}-${Math.random().toString(16).slice(2)}`), {
    recursive: true
  });
}

describe("listArtifacts", () => {
  it("lists artifact globs bounded under the job workspace", async () => {
    const jobWorkspace = await makeTempDir("artifact-job-workspace");
    await mkdir(join(jobWorkspace, "reports"), { recursive: true });
    await mkdir(join(jobWorkspace, "build"), { recursive: true });
    await writeFile(join(jobWorkspace, "reports", "timing.rpt"), "timing\n");
    await writeFile(join(jobWorkspace, "reports", "utilization.rpt"), "utilization\n");
    await writeFile(join(jobWorkspace, "build", "top.bit"), "bitstream\n");

    const artifacts = await listArtifacts(jobWorkspace, ["reports/*.rpt", "build/*.bit"]);

    expect(artifacts).toEqual([
      {
        path: "build/top.bit",
        absolutePath: join(jobWorkspace, "build", "top.bit"),
        sizeBytes: 10
      },
      {
        path: "reports/timing.rpt",
        absolutePath: join(jobWorkspace, "reports", "timing.rpt"),
        sizeBytes: 7
      },
      {
        path: "reports/utilization.rpt",
        absolutePath: join(jobWorkspace, "reports", "utilization.rpt"),
        sizeBytes: 12
      }
    ]);
  });

  it("rejects artifact patterns that escape the job workspace", async () => {
    const jobWorkspace = await makeTempDir("artifact-escape-job-workspace");
    const outside = await makeTempDir("artifact-escape-outside");
    await writeFile(join(outside, "secret.rpt"), "outside\n");

    await expect(listArtifacts(jobWorkspace, ["../*.rpt"])).rejects.toThrow(/escape.*job workspace/i);
    await expect(listArtifacts(jobWorkspace, [join(outside, "*.rpt")])).rejects.toThrow(/escape.*job workspace/i);
  });

  it("supports recursive artifact globs", async () => {
    const jobWorkspace = await makeTempDir("recursive-artifact-job-workspace");
    await mkdir(join(jobWorkspace, "demos", "machsuite-aes", "work", "solution", "syn", "report"), {
      recursive: true
    });
    await writeFile(
      join(jobWorkspace, "demos", "machsuite-aes", "work", "solution", "syn", "report", "aes_csynth.rpt"),
      "report\n"
    );

    const artifacts = await listArtifacts(jobWorkspace, ["demos/machsuite-aes/work/**/*.rpt"]);

    expect(artifacts).toEqual([
      {
        path: "demos/machsuite-aes/work/solution/syn/report/aes_csynth.rpt",
        absolutePath: join(
          jobWorkspace,
          "demos",
          "machsuite-aes",
          "work",
          "solution",
          "syn",
          "report",
          "aes_csynth.rpt"
        ),
        sizeBytes: 7
      }
    ]);
  });
});

describe("readLogTail", () => {
  it("returns the requested tail of a log file", async () => {
    const jobWorkspace = await makeTempDir("log-tail-job-workspace");
    const logPath = join(jobWorkspace, "vivado.log");
    await writeFile(logPath, ["line 1", "line 2", "line 3", "line 4", "line 5"].join("\n"));

    await expect(readLogTail(logPath, 3)).resolves.toBe("line 3\nline 4\nline 5");
  });

  it("returns an empty string when the log file is missing", async () => {
    const jobWorkspace = await makeTempDir("missing-log-job-workspace");

    await expect(readLogTail(join(jobWorkspace, "vivado.log"), 20)).resolves.toBe("");
  });
});
