import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { VivadoService } from "../src/service.js";

const config = {
  workspaceRoot: "/workspace",
  jobRoot: "/workspace/.vivado-mcp/jobs",
  defaultVivadoVersion: "2025.1",
  queue: {
    maxConcurrentJobs: 2,
    maxPendingJobs: 10,
    defaultTimeoutSeconds: 120
  },
  toolchains: {
    "2025.1": {
      version: "2025.1",
      settingsScript: "/opt/Xilinx/2025.1/Vivado/settings64.sh",
      maxConcurrentJobs: 2,
      commands: {
        "vivado.batch": {
          executable: "/opt/Xilinx/2025.1/Vivado/bin/vivado",
          args: ["-mode", "batch", "-source", "{script}", "-tclargs", "{args}"]
        },
        "vivado.report": {
          executable: "/opt/Xilinx/2025.1/Vivado/bin/vivado",
          args: ["-mode", "batch", "-source", "{script}"]
        }
      }
    },
    "2022.1": {
      version: "2022.1",
      settingsScript: "/opt/Xilinx/Vivado/2022.1/settings64.sh",
      maxConcurrentJobs: 1,
      commands: {
        "vivado.batch": {
          executable: "/opt/Xilinx/Vivado/2022.1/bin/vivado",
          args: ["-mode", "batch", "-source", "{script}"]
        }
      }
    }
  }
};

function createFakeQueue() {
  return {
    submit: vi.fn(async () => ({
      jobId: "job-1",
      state: "queued",
      workspace: "/workspace/designs/blinky",
      vivadoVersion: "2025.1",
      toolProfile: "vivado.report",
      resourceSlots: 2,
      queuedAt: "2026-05-05T09:00:00.000Z"
    })),
    status: vi.fn(async () => ({
      jobId: "job-1",
      state: "running",
      workspace: "/workspace/designs/blinky",
      vivadoVersion: "2025.1",
      toolProfile: "vivado.report",
      resourceSlots: 2,
      queuedAt: "2026-05-05T09:00:00.000Z",
      startedAt: "2026-05-05T09:00:01.000Z"
    })),
    logs: vi.fn(async () => "synth_design\nplace_design\nroute_design\n"),
    cancel: vi.fn(async () => ({
      jobId: "job-1",
      state: "cancelled",
      workspace: "/workspace/designs/blinky",
      vivadoVersion: "2025.1",
      toolProfile: "vivado.report",
      resourceSlots: 2,
      queuedAt: "2026-05-05T09:00:00.000Z",
      endedAt: "2026-05-05T09:00:04.000Z",
      signal: "SIGTERM"
    })),
    artifacts: vi.fn(async () => [
      {
        path: "reports/timing_summary.rpt",
        absolutePath: "/workspace/.vivado-mcp/jobs/job-1/reports/timing_summary.rpt",
        sizeBytes: 1024
      },
      {
        path: "build/top.bit",
        absolutePath: "/workspace/.vivado-mcp/jobs/job-1/build/top.bit",
        sizeBytes: 4096
      }
    ])
  };
}

describe("VivadoService", () => {
  it("submits a job with resolved version, flow tool profile, resource slots, timeout, and artifacts", async () => {
    const queue = createFakeQueue();
    const service = new VivadoService({ config, queue });

    const result = await service.submitJob({
      workspace: "designs/blinky",
      vivado_version: "2025.1",
      flow: {
        type: "tcl_script",
        tool_profile: "vivado.report",
        script_path: "scripts/reports.tcl",
        args: ["top"]
      },
      resource_slots: 2,
      timeout_seconds: 300,
      priority: 5,
      artifacts: ["reports/*.rpt", "build/*.bit"]
    });

    expect(result).toMatchObject({
      jobId: "job-1",
      state: "queued",
      vivadoVersion: "2025.1",
      toolProfile: "vivado.report",
      resourceSlots: 2
    });
    expect(queue.submit).toHaveBeenCalledWith(
      expect.objectContaining({
        workspace: "/workspace/designs/blinky",
        vivadoVersion: "2025.1",
        toolProfile: "vivado.report",
        resourceSlots: 2,
        timeoutSeconds: 300,
        priority: 5,
        artifacts: ["reports/*.rpt", "build/*.bit"]
      })
    );
  });

  it("returns configured Vivado versions with command profiles and concurrency limits", async () => {
    const service = new VivadoService({ config, queue: createFakeQueue() });

    await expect(service.versions()).resolves.toEqual([
      {
        version: "2022.1",
        default: false,
        maxConcurrentJobs: 1,
        toolProfiles: ["vivado.batch"]
      },
      {
        version: "2025.1",
        default: true,
        maxConcurrentJobs: 2,
        toolProfiles: ["vivado.batch", "vivado.report"]
      }
    ]);
  });

  it("delegates status, logs, cancel, and artifact lookup to the queue", async () => {
    const queue = createFakeQueue();
    const service = new VivadoService({ config, queue });

    await expect(service.status("job-1")).resolves.toMatchObject({ jobId: "job-1", state: "running" });
    await expect(service.logs("job-1", { tailLines: 50 })).resolves.toBe("synth_design\nplace_design\nroute_design\n");
    await expect(service.cancel("job-1")).resolves.toMatchObject({ jobId: "job-1", state: "cancelled" });
    await expect(service.artifacts("job-1")).resolves.toEqual([
      expect.objectContaining({ path: "reports/timing_summary.rpt", sizeBytes: 1024 }),
      expect.objectContaining({ path: "build/top.bit", sizeBytes: 4096 })
    ]);

    expect(queue.status).toHaveBeenCalledWith("job-1");
    expect(queue.logs).toHaveBeenCalledWith("job-1", { tailLines: 50 });
    expect(queue.cancel).toHaveBeenCalledWith("job-1");
    expect(queue.artifacts).toHaveBeenCalledWith("job-1");
  });

  it("runs a real queued job with a rendered command using a fake HLS executable", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "vivado-mcp-service-real-queue-"));
    const workspaceRoot = path.join(root, "workspace");
    const jobRoot = path.join(root, "jobs");
    const binDir = path.join(root, "bin");
    const fakeHls = path.join(binDir, "fake-hls");
    await mkdir(path.join(workspaceRoot, "scripts"), { recursive: true });
    await mkdir(jobRoot, { recursive: true });
    await mkdir(binDir, { recursive: true });
    await writeFile(path.join(workspaceRoot, "scripts", "build.tcl"), "puts build\n");
    await writeFile(fakeHls, "#!/usr/bin/env bash\necho fake-hls \"$@\"\n", "utf8");
    await chmod(fakeHls, 0o755);

    const service = new VivadoService({
      config: {
        workspaceRoot,
        jobRoot,
        defaultVivadoVersion: "test",
        queue: {
          maxConcurrentJobs: 1,
          maxPendingJobs: 10,
          defaultTimeoutSeconds: 10
        },
        toolchains: {
          test: {
            version: "test",
            maxConcurrentJobs: 1,
            commands: {
              "vitis_hls.legacy": {
                executable: fakeHls,
                args: ["-f", "{script}"]
              }
            }
          }
        }
      }
    });

    const submitted = await service.submitJob({
      workspace: ".",
      vivado_version: "test",
      flow: {
        type: "tcl_script",
        tool_profile: "vitis_hls.legacy",
        script_path: "scripts/build.tcl"
      }
    });

    await waitFor(async () => {
      await expect(service.status(submitted.jobId)).resolves.toMatchObject({ state: "succeeded" });
    });
    await expect(service.logs(submitted.jobId, { stream: "stdout" })).resolves.toContain("fake-hls -f");
  });
});

async function waitFor(assertion: () => Promise<void>): Promise<void> {
  const deadline = Date.now() + 2_000;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      await assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }

  throw lastError;
}
