import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { loadConfigFromObject } from "../../src/config.js";
import { submitJobSchema } from "../../src/schemas.js";
import { VivadoService } from "../../src/service.js";

const repoRoot = process.cwd();

describe("MachSuite AES regression demo", () => {
  it("registers MachSuite as the 3rdParty/MachSuite submodule", async () => {
    const gitmodules = await readFile(".gitmodules", "utf8");

    expect(gitmodules).toContain('[submodule "3rdParty/MachSuite"]');
    expect(gitmodules).toContain("path = 3rdParty/MachSuite");
    expect(gitmodules).toContain("url = https://github.com/breagen/MachSuite.git");
    await expect(readFile("3rdParty/MachSuite/aes/aes/aes.c", "utf8")).resolves.toContain(
      "aes256_encrypt_ecb"
    );
  });

  it("ships a synthesis-only HLS Tcl script for the MachSuite AES kernel", async () => {
    const tcl = await readFile("demos/machsuite-aes/machsuite-aes-hls.tcl", "utf8");

    expect(tcl).toContain("3rdParty");
    expect(tcl).toContain("MachSuite");
    expect(tcl).toContain("aes/aes");
    expect(tcl).toContain("set_top aes256_encrypt_ecb");
    expect(tcl).toContain("add_files");
    expect(tcl).toContain("csynth_design");
    expect(tcl).not.toContain("cosim_design");
  });

  it("provides MCP submit payloads for 2022.1 legacy HLS and 2025.1 vitis-run HLS", async () => {
    const legacy = submitJobSchema.parse(
      JSON.parse(await readFile("demos/machsuite-aes/submit-job.2022.1.json", "utf8"))
    );
    const unified = submitJobSchema.parse(
      JSON.parse(await readFile("demos/machsuite-aes/submit-job.2025.1.json", "utf8"))
    );

    expect(legacy).toMatchObject({
      workspace: ".",
      vivado_version: "2022.1",
      flow: {
        type: "tcl_script",
        tool_profile: "vitis_hls.legacy",
        script_path: "demos/machsuite-aes/machsuite-aes-hls.tcl"
      },
      resource_slots: 1
    });
    expect(unified).toMatchObject({
      workspace: ".",
      vivado_version: "2025.1",
      flow: {
        type: "tcl_script",
        tool_profile: "vitis_run.hls_tcl",
        script_path: "demos/machsuite-aes/machsuite-aes-hls.tcl"
      },
      resource_slots: 1
    });
  });

  it("submits the demo through VivadoService without launching a real HLS process", async () => {
    const baseConfig = loadConfigFromObject(
      JSON.parse(await readFile("config/vivado-mcp.example.json", "utf8"))
    );
    const jobRoot = await mkdtemp(path.join(tmpdir(), "vivado-mcp-machsuite-aes-"));
    const config = {
      ...baseConfig,
      workspaceRoot: repoRoot,
      jobRoot
    };
    const queue = {
      submit: vi.fn(async (request) => ({
        jobId: "machsuite-aes-demo",
        state: "queued",
        workspace: repoRoot,
        vivadoVersion: "2022.1",
        toolProfile: "vitis_hls.legacy",
        resourceSlots: 1,
        queuedAt: "2026-05-05T00:00:00.000Z",
        request
      })),
      status: vi.fn(),
      logs: vi.fn(),
      cancel: vi.fn(),
      artifacts: vi.fn()
    };

    const service = new VivadoService({ config, queue });
    const submit = submitJobSchema.parse(
      JSON.parse(await readFile("demos/machsuite-aes/submit-job.2022.1.json", "utf8"))
    );

    await expect(service.submitJob(submit)).resolves.toMatchObject({
      jobId: "machsuite-aes-demo",
      state: "queued",
      vivadoVersion: "2022.1",
      toolProfile: "vitis_hls.legacy"
    });
    expect(queue.submit).toHaveBeenCalledWith(
      expect.objectContaining({
        workspace: repoRoot,
        vivadoVersion: "2022.1",
        toolProfile: "vitis_hls.legacy",
        resourceSlots: 1,
        command: expect.arrayContaining([expect.stringContaining("vitis_hls")])
      })
    );
  });
});
