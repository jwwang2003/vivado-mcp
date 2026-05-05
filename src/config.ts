import { readFile } from "node:fs/promises";
import { z } from "zod";

import type { VivadoMcpConfig, VivadoToolchain } from "./types.js";

const commandProfileSchema = z
  .object({
    executable: z.string().min(1),
    args: z.array(z.string()).min(1),
    env: z.record(z.string()).optional(),
    requiresExitInScript: z.boolean().optional()
  })
  .strict()
  .superRefine((profile, ctx) => {
    if (!profile.args.includes("{script}")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "command profile args must include {script}"
      });
    }
  });

const rawToolchainSchema = z
  .object({
    settingsScript: z.string().min(1).optional(),
    maxConcurrentJobs: z.number().int().positive().default(1),
    commands: z.record(commandProfileSchema).refine((commands) => Object.keys(commands).length > 0, {
      message: "toolchain must define at least one command profile"
    })
  })
  .strict();

const rawConfigSchema = z
  .object({
    workspaceRoot: z.string().min(1),
    jobRoot: z.string().min(1),
    defaultVivadoVersion: z.string().min(1),
    queue: z
      .object({
        maxConcurrentJobs: z.number().int().positive(),
        maxPendingJobs: z.number().int().nonnegative(),
        defaultTimeoutSeconds: z.number().int().positive()
      })
      .strict(),
    toolchains: z.record(rawToolchainSchema).refine((toolchains) => Object.keys(toolchains).length > 0, {
      message: "at least one Vivado toolchain must be configured"
    })
  })
  .strict();

export function loadConfigFromObject(value: unknown): VivadoMcpConfig {
  const parsed = rawConfigSchema.parse(value);

  if (!(parsed.defaultVivadoVersion in parsed.toolchains)) {
    throw new Error(
      `defaultVivadoVersion ${parsed.defaultVivadoVersion} is not configured. Available versions: ${Object.keys(
        parsed.toolchains
      ).join(", ")}`
    );
  }

  const toolchains: Record<string, VivadoToolchain> = {};
  for (const [version, toolchain] of Object.entries(parsed.toolchains)) {
    toolchains[version] = {
      version,
      settingsScript: toolchain.settingsScript,
      maxConcurrentJobs: toolchain.maxConcurrentJobs,
      commands: toolchain.commands
    };
  }

  return {
    workspaceRoot: parsed.workspaceRoot,
    jobRoot: parsed.jobRoot,
    defaultVivadoVersion: parsed.defaultVivadoVersion,
    queue: parsed.queue,
    toolchains
  };
}

export async function loadConfigFromFile(path: string): Promise<VivadoMcpConfig> {
  const raw = await readFile(path, "utf8");
  return loadConfigFromObject(JSON.parse(raw));
}
