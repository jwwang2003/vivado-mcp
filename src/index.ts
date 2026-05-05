#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { loadConfigFromFile } from "./config.js";
import { isExecutable, pathExists } from "./paths.js";
import { createVivadoMcpServer } from "./server.js";
import { VivadoService } from "./service.js";
import type { VivadoMcpConfig } from "./types.js";

function validateRuntimeConfig(config: VivadoMcpConfig): void {
  if (!pathExists(config.workspaceRoot)) {
    throw new Error(`workspaceRoot does not exist: ${config.workspaceRoot}`);
  }
  if (!pathExists(config.jobRoot)) {
    throw new Error(`jobRoot does not exist: ${config.jobRoot}`);
  }

  for (const toolchain of Object.values(config.toolchains)) {
    if (toolchain.settingsScript && !pathExists(toolchain.settingsScript)) {
      throw new Error(`settingsScript for Vivado ${toolchain.version} does not exist: ${toolchain.settingsScript}`);
    }
    for (const [profileName, profile] of Object.entries(toolchain.commands)) {
      if (!isExecutable(profile.executable)) {
        throw new Error(
          `executable for Vivado ${toolchain.version} profile ${profileName} is not executable: ${profile.executable}`
        );
      }
    }
  }
}

async function main(): Promise<void> {
  const configPath = process.env.VIVADO_MCP_CONFIG ?? "/app/config/vivado-mcp.json";
  const config = await loadConfigFromFile(configPath);

  if (process.argv.includes("--validate-config")) {
    validateRuntimeConfig(config);
    console.error("Vivado MCP config validated");
    return;
  }

  const service = new VivadoService({ config });
  const server = createVivadoMcpServer({ service });
  await server.connect(new StdioServerTransport());
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
