import { describe, expect, it } from "vitest";

import { loadConfigFromObject } from "../src/config.js";

const validConfig = {
  workspaceRoot: "/workspace",
  jobRoot: "/workspace/.vivado-mcp/jobs",
  defaultVivadoVersion: "2025.1",
  queue: {
    maxConcurrentJobs: 3,
    maxPendingJobs: 20,
    defaultTimeoutSeconds: 120
  },
  toolchains: {
    "2022.1": {
      settingsScript: "/opt/Xilinx/Vivado/2022.1/settings64.sh",
      maxConcurrentJobs: 1,
      commands: {
        "vivado.batch": {
          executable: "/opt/Xilinx/Vivado/2022.1/bin/vivado",
          args: ["-mode", "batch", "-source", "{script}", "-tclargs", "{args}"]
        },
        "vitis_hls.legacy": {
          executable: "/opt/Xilinx/Vitis_HLS/2022.1/bin/vitis_hls",
          args: ["-f", "{script}"]
        }
      }
    },
    "2025.1": {
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

describe("loadConfigFromObject", () => {
  it("parses Vivado 2022.1 and 2025.1 toolchains with version-specific profiles", () => {
    const config = loadConfigFromObject(validConfig);

    expect(config.defaultVivadoVersion).toBe("2025.1");
    expect(config.toolchains["2022.1"].commands["vivado.batch"].executable).toBe(
      "/opt/Xilinx/Vivado/2022.1/bin/vivado"
    );
    expect(config.toolchains["2025.1"].commands["vitis_run.hls_tcl"].args).toEqual([
      "--mode",
      "hls",
      "--tcl",
      "{script}"
    ]);
  });

  it("rejects a default Vivado version that is not configured", () => {
    expect(() =>
      loadConfigFromObject({
        ...validConfig,
        defaultVivadoVersion: "2024.2"
      })
    ).toThrow(/defaultVivadoVersion.*2024\.2.*not configured/);
  });

  it("rejects command profiles without a script placeholder", () => {
    expect(() =>
      loadConfigFromObject({
        ...validConfig,
        toolchains: {
          "2025.1": {
            ...validConfig.toolchains["2025.1"],
            commands: {
              "vivado.batch": {
                executable: "/opt/Xilinx/2025.1/Vivado/bin/vivado",
                args: ["-mode", "batch"]
              }
            }
          }
        }
      })
    ).toThrow(/must include.*\{script\}/);
  });
});
