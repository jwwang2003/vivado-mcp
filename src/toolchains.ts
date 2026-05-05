import { readFileSync } from "node:fs";
import path from "node:path";

import type { CommandProfile, VivadoMcpConfig, VivadoToolchain } from "./types.js";

export type ToolchainResolutionRequest = {
  workspaceRoot: string;
  version?: string;
  profile?: string;
};

export type ToolchainResolution = {
  version: string;
  toolchain: VivadoToolchain;
  profileName: string;
  command: CommandProfile;
};

type ProjectPin = {
  vivadoVersion?: string;
};

export class ToolchainRegistry {
  constructor(private readonly config: VivadoMcpConfig) {}

  resolve(request: ToolchainResolutionRequest): ToolchainResolution {
    const profileName = request.profile ?? "vivado.batch";
    const version = request.version ?? this.readProjectPin(request.workspaceRoot) ?? this.config.defaultVivadoVersion;
    const toolchain = this.config.toolchains[version];
    if (!toolchain) {
      throw new Error(
        `Vivado version ${version} is not configured. Available versions: ${Object.keys(this.config.toolchains).join(
          ", "
        )}`
      );
    }

    const command = toolchain.commands[profileName];
    if (!command) {
      throw new Error(
        `Command profile ${profileName} is missing for Vivado ${version}. Available profiles: ${Object.keys(
          toolchain.commands
        ).join(", ")}`
      );
    }

    return { version, toolchain, profileName, command };
  }

  listVersions(): Array<{
    version: string;
    isDefault: boolean;
    maxConcurrentJobs: number;
    profiles: string[];
  }> {
    return Object.values(this.config.toolchains).map((toolchain) => ({
      version: toolchain.version,
      isDefault: toolchain.version === this.config.defaultVivadoVersion,
      maxConcurrentJobs: toolchain.maxConcurrentJobs,
      profiles: Object.keys(toolchain.commands)
    }));
  }

  private readProjectPin(workspaceRoot: string): string | undefined {
    const pinPath = path.join(workspaceRoot, ".vivado-mcp.json");
    try {
      const parsed = JSON.parse(readFileSync(pinPath, "utf8")) as ProjectPin;
      return parsed.vivadoVersion;
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code === "ENOENT") {
        return undefined;
      }
      throw new Error(`Failed to read project Vivado MCP config at ${pinPath}: ${nodeError.message}`);
    }
  }
}
