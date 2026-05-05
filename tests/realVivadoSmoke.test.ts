import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runProcess } from "../src/runner.js";

const realVivadoEnabled = process.env.VIVADO_MCP_RUN_REAL_VIVADO === "1";
const maybeDescribe = realVivadoEnabled ? describe : describe.skip;

const installs = [
  {
    version: "2022.1",
    executable: process.env.VIVADO_2022_1_BIN ?? "/opt/Xilinx/Vivado/2022.1/bin/vivado"
  },
  {
    version: "2025.1",
    executable: process.env.VIVADO_2025_1_BIN ?? "/opt/Xilinx/2025.1/Vivado/bin/vivado"
  }
];

maybeDescribe("real Vivado smoke tests", () => {
  for (const install of installs) {
    it(`runs a lightweight Tcl batch script with Vivado ${install.version}`, async () => {
      const dir = await mkdtemp(path.join(tmpdir(), `vivado-mcp-real-${install.version}-`));
      const script = path.join(dir, "smoke.tcl");
      await writeFile(script, `puts "vivado-mcp-smoke ${install.version}"\nversion\nexit\n`, "utf8");

      const result = await runProcess([install.executable, "-mode", "batch", "-source", script], {
        cwd: dir,
        timeoutMs: 60_000
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout + result.stderr).toContain(`vivado-mcp-smoke ${install.version}`);
    });
  }
});
