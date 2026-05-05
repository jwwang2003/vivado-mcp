import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { loadConfigFromObject } from "../src/config.js";

describe("Docker and example assets", () => {
  it("ships an example config for local Vivado 2022.1 and 2025.1 layouts", async () => {
    const config = loadConfigFromObject(JSON.parse(await readFile("config/vivado-mcp.example.json", "utf8")));

    expect(config.toolchains["2022.1"].commands["vivado.batch"].executable).toBe(
      "/opt/Xilinx/Vivado/2022.1/bin/vivado"
    );
    expect(config.toolchains["2022.1"].commands["vitis_hls.legacy"].executable).toBe(
      "/opt/Xilinx/Vitis_HLS/2022.1/bin/vitis_hls"
    );
    expect(config.toolchains["2025.1"].commands["vivado.batch"].executable).toBe(
      "/opt/Xilinx/2025.1/Vivado/bin/vivado"
    );
    expect(config.toolchains["2025.1"].commands["vitis_run.hls_tcl"].executable).toBe(
      "/opt/Xilinx/2025.1/Vitis/bin/vitis-run"
    );
  });

  it("does not install Vivado in the Dockerfile", async () => {
    const dockerfile = await readFile("Dockerfile", "utf8");

    expect(dockerfile).toContain("node:22");
    expect(dockerfile).not.toMatch(/Vivado.*install|Xilinx.*install/i);
    expect(dockerfile).toContain("docker-entrypoint.sh");
  });

  it("bind-mounts workspace read-write and host Xilinx root read-only in compose", async () => {
    const compose = await readFile("docker-compose.yml", "utf8");

    expect(compose).toContain("${HOST_WORKSPACE");
    expect(compose).toContain(":/workspace:rw");
    expect(compose).toContain("${HOST_XILINX_ROOT");
    expect(compose).toContain(":/opt/Xilinx:ro");
  });

  it("entrypoint validates workspace and Vivado config before launching", async () => {
    const entrypoint = await readFile("docker-entrypoint.sh", "utf8");

    expect(entrypoint).toContain("WORKSPACE_ROOT");
    expect(entrypoint).toContain("VIVADO_MCP_CONFIG");
    expect(entrypoint).toContain("node dist/index.js");
    expect(entrypoint).toContain("validate-config");
  });
});
