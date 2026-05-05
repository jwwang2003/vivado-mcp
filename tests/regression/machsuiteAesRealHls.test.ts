import { mkdtemp, readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { loadConfigFromObject } from "../../src/config.js";
import { submitJobSchema } from "../../src/schemas.js";
import { VivadoService } from "../../src/service.js";
import type { JobSummary } from "../../src/types.js";
import { realVivadoTestsEnabled } from "./realToolEnv.js";

const maybeDescribe = realVivadoTestsEnabled() ? describe : describe.skip;
const repoRoot = process.cwd();
const hlsWorkDirEnv = "VIVADO_MCP_HLS_WORK_DIR";

const payloads = {
  "2022.1": "demos/machsuite-aes/submit-job.2022.1.json",
  "2025.1": "demos/machsuite-aes/submit-job.2025.1.json"
} as const;

function selectedVersions(): Array<keyof typeof payloads> {
  const requested = process.env.VIVADO_MCP_MACHSUITE_AES_VERSIONS;
  if (!requested || requested === "all") {
    return ["2022.1", "2025.1"];
  }
  return requested.split(",").map((version) => {
    if (version !== "2022.1" && version !== "2025.1") {
      throw new Error(`Unsupported MachSuite AES HLS version: ${version}`);
    }
    return version;
  });
}

async function waitForTerminal(service: VivadoService, jobId: string, timeoutMs: number): Promise<JobSummary> {
  const deadline = Date.now() + timeoutMs;
  let lastStatus: JobSummary | undefined;

  while (Date.now() < deadline) {
    lastStatus = await service.status(jobId);
    if (
      lastStatus?.state === "succeeded" ||
      lastStatus?.state === "failed" ||
      lastStatus?.state === "cancelled" ||
      lastStatus?.state === "timed_out"
    ) {
      return lastStatus;
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }

  throw new Error(`Timed out waiting for ${jobId}; last status: ${JSON.stringify(lastStatus)}`);
}

maybeDescribe("MachSuite AES real HLS synthesis", () => {
  for (const version of selectedVersions()) {
    it(
      `runs C synthesis through vivado-mcp for ${version}`,
      async () => {
        const config = loadConfigFromObject({
          ...JSON.parse(await readFile("config/vivado-mcp.example.json", "utf8")),
          workspaceRoot: repoRoot,
          jobRoot: await mkdtemp(path.join(tmpdir(), `vivado-mcp-machsuite-aes-${version}-`))
        });
        const service = new VivadoService({ config });
        const rawPayload = JSON.parse(await readFile(payloads[version], "utf8"));
        const runWorkDir = path.posix.join(
          "demos/machsuite-aes/work",
          `real-hls-${version}-${randomUUID()}`
        );
        const payload = submitJobSchema.parse({
          ...rawPayload,
          artifacts: [`${runWorkDir}/**/*.rpt`, `${runWorkDir}/**/*.log`]
        });
        const previousWorkDir = process.env[hlsWorkDirEnv];

        try {
          process.env[hlsWorkDirEnv] = runWorkDir;
          const submitted = await service.submitJob(payload);
          const completed = await waitForTerminal(
            service,
            submitted.jobId,
            Number(process.env.VIVADO_MCP_MACHSUITE_AES_TIMEOUT_MS ?? 900_000)
          );

          const stdout = await service.logs(submitted.jobId, { stream: "stdout", tailLines: 500 });
          const stderr = await service.logs(submitted.jobId, { stream: "stderr", tailLines: 500 });
          expect(
            completed,
            `stdout tail:\n${stdout}\n\nstderr tail:\n${stderr}`
          ).toMatchObject({ state: "succeeded", exitCode: 0 });

          const artifacts = await service.artifacts(submitted.jobId);
          expect(artifacts.some((artifact) => artifact.path.endsWith(".rpt"))).toBe(true);
        } finally {
          if (previousWorkDir === undefined) {
            delete process.env[hlsWorkDirEnv];
          } else {
            process.env[hlsWorkDirEnv] = previousWorkDir;
          }
        }
      },
      Number(process.env.VIVADO_MCP_MACHSUITE_AES_TIMEOUT_MS ?? 900_000) + 30_000
    );
  }
});
