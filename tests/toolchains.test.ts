import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { ToolchainRegistry } from "../src/toolchains.js";
import type { VivadoMcpConfig } from "../src/types.js";

async function expectResolutionRejection(action: () => unknown | Promise<unknown>, pattern: RegExp): Promise<void> {
  await expect(Promise.resolve().then(action)).rejects.toThrow(pattern);
}

const config: VivadoMcpConfig = {
  workspaceRoot: "/workspace",
  jobRoot: "/workspace/.vivado-mcp/jobs",
  defaultVivadoVersion: "2025.1",
  queue: {
    maxConcurrentJobs: 2,
    maxPendingJobs: 10,
    defaultTimeoutSeconds: 120
  },
  toolchains: {
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
    },
    "2025.1": {
      version: "2025.1",
      settingsScript: "/opt/Xilinx/2025.1/Vivado/settings64.sh",
      maxConcurrentJobs: 2,
      commands: {
        "vivado.batch": {
          executable: "/opt/Xilinx/2025.1/Vivado/bin/vivado",
          args: ["-mode", "batch", "-source", "{script}", "-tclargs", "{args}"]
        },
        "vitis_run.hls_tcl": {
          executable: "/opt/Xilinx/2025.1/Vitis/bin/vitis-run",
          args: ["--mode", "hls", "--tcl", "{script}"]
        }
      }
    }
  }
};

describe("ToolchainRegistry", () => {
  it("resolves an explicit Vivado version and command profile", async () => {
    const registry = new ToolchainRegistry(config);

    await expect(
      Promise.resolve(
        registry.resolve({ workspaceRoot: config.workspaceRoot, version: "2022.1", profile: "vivado.batch" })
      )
    ).resolves.toMatchObject({
      version: "2022.1",
      toolchain: config.toolchains["2022.1"],
      profileName: "vivado.batch",
      command: config.toolchains["2022.1"].commands["vivado.batch"]
    });
  });

  it("resolves the default Vivado version when no version is requested", async () => {
    const registry = new ToolchainRegistry(config);

    await expect(
      Promise.resolve(registry.resolve({ workspaceRoot: config.workspaceRoot, profile: "vivado.batch" }))
    ).resolves.toMatchObject({
      version: "2025.1",
      toolchain: config.toolchains["2025.1"]
    });
  });

  it("resolves a project .vivado-mcp.json Vivado version pin", async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "vivado-mcp-project-"));
    await mkdir(path.join(workspaceRoot, "project"), { recursive: true });
    await writeFile(path.join(workspaceRoot, "project", ".vivado-mcp.json"), JSON.stringify({ vivadoVersion: "2022.1" }));

    const registry = new ToolchainRegistry(config);

    await expect(
      Promise.resolve(
        registry.resolve({ workspaceRoot: path.join(workspaceRoot, "project"), profile: "vivado.batch" })
      )
    ).resolves.toMatchObject({
      version: "2022.1",
      toolchain: config.toolchains["2022.1"]
    });
  });

  it("reports available versions when an unknown Vivado version is requested", async () => {
    const registry = new ToolchainRegistry(config);

    await expectResolutionRejection(
      () => registry.resolve({ workspaceRoot: config.workspaceRoot, version: "2024.2", profile: "vivado.batch" }),
      /2024\.2.*2022\.1.*2025\.1|available.*2022\.1.*2025\.1/i
    );
  });

  it("reports a missing command profile for the resolved Vivado version", async () => {
    const registry = new ToolchainRegistry(config);

    await expectResolutionRejection(
      () => registry.resolve({ workspaceRoot: config.workspaceRoot, version: "2022.1", profile: "vitis_run.hls_tcl" }),
      /vitis_run\.hls_tcl.*2022\.1|profile.*not found|missing.*profile/i
    );
  });
});
