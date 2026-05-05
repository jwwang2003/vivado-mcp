import path from "node:path";

import { listArtifacts, readLogTail, type ArtifactInfo } from "./artifacts.js";
import { renderCommand } from "./command.js";
import { prepareFlow } from "./flows.js";
import { InMemoryJobQueue, type JobRecord, type QueueRunner } from "./jobQueue.js";
import { resolveWorkspacePath } from "./paths.js";
import { runProcess } from "./runner.js";
import { ToolchainRegistry } from "./toolchains.js";
import type { JobSummary, SubmitJobInput, VivadoMcpConfig } from "./types.js";

export type ServiceQueue = {
  submit(request: unknown): Promise<JobSummary> | JobSummary;
  status(jobId: string): Promise<JobSummary | undefined> | JobSummary | undefined;
  logs(jobId: string, options: { tailLines?: number; stream?: string }): Promise<string> | string;
  cancel(jobId: string): Promise<JobSummary | undefined> | JobSummary | undefined;
  artifacts(jobId: string): Promise<ArtifactInfo[]> | ArtifactInfo[];
};

export type VivadoServiceOptions = {
  config: VivadoMcpConfig;
  queue?: ServiceQueue;
  flowDirs?: string[];
};

type RealQueueSubmit = {
  workspace: string;
  vivadoVersion: string;
  toolProfile: string;
  resourceSlots: number;
  timeoutSeconds: number;
  priority?: number;
  artifacts?: string[];
  command: string[];
  cwd: string;
  jobDir: string;
};

export class VivadoService {
  private readonly registry: ToolchainRegistry;
  private readonly queue: ServiceQueue;

  constructor(private readonly options: VivadoServiceOptions) {
    this.registry = new ToolchainRegistry(options.config);
    this.queue = options.queue ?? this.createQueue();
  }

  async versions(): Promise<
    Array<{ version: string; default: boolean; maxConcurrentJobs: number; toolProfiles: string[] }>
  > {
    return Object.values(this.options.config.toolchains)
      .sort((a, b) => a.version.localeCompare(b.version))
      .map((toolchain) => ({
        version: toolchain.version,
        default: toolchain.version === this.options.config.defaultVivadoVersion,
        maxConcurrentJobs: toolchain.maxConcurrentJobs,
        toolProfiles: Object.keys(toolchain.commands).sort()
      }));
  }

  async submitJob(input: SubmitJobInput): Promise<JobSummary> {
    const workspace = resolveWorkspacePath(this.options.config.workspaceRoot, input.workspace);
    const preliminaryProfile =
      input.flow.type === "tcl_script" || input.flow.type === "named_flow" ? input.flow.tool_profile : undefined;
    const resolution = this.registry.resolve({
      workspaceRoot: workspace,
      version: input.vivado_version,
      profile: preliminaryProfile ?? "vivado.batch"
    });
    const jobDir = path.join(this.options.config.jobRoot, `${Date.now()}-${Math.random().toString(16).slice(2)}`);
    const prepared = await prepareFlow({
      workspaceDir: workspace,
      jobDir,
      flow: input.flow,
      flowDirs: this.options.flowDirs
    });
    const finalResolution =
      prepared.toolProfile === resolution.profileName
        ? resolution
        : this.registry.resolve({
            workspaceRoot: workspace,
            version: resolution.version,
            profile: prepared.toolProfile
          });
    const command = renderCommand({
      profile: finalResolution.command,
      scriptPath: prepared.scriptPath,
      args: prepared.args,
      settingsScript: finalResolution.command.settingsScript ?? finalResolution.toolchain.settingsScript
    });

    return this.queue.submit({
      workspace,
      vivadoVersion: finalResolution.version,
      toolProfile: finalResolution.profileName,
      resourceSlots: input.resource_slots ?? 1,
      timeoutSeconds: input.timeout_seconds ?? this.options.config.queue.defaultTimeoutSeconds,
      priority: input.priority,
      artifacts: input.artifacts,
      command,
      cwd: workspace,
      jobDir
    });
  }

  async status(jobId: string): Promise<JobSummary | undefined> {
    return this.queue.status(jobId);
  }

  async logs(jobId: string, options: { tailLines?: number; stream?: string } = {}): Promise<string> {
    return this.queue.logs(jobId, options);
  }

  async cancel(jobId: string): Promise<JobSummary | undefined> {
    return this.queue.cancel(jobId);
  }

  async artifacts(jobId: string): Promise<ArtifactInfo[]> {
    return this.queue.artifacts(jobId);
  }

  private createQueue(): ServiceQueue {
    const queue = new InMemoryJobQueue({
      maxConcurrentJobs: this.options.config.queue.maxConcurrentJobs,
      maxPendingJobs: this.options.config.queue.maxPendingJobs,
      perVersionConcurrency: Object.fromEntries(
        Object.values(this.options.config.toolchains).map((toolchain) => [
          toolchain.version,
          toolchain.maxConcurrentJobs
        ])
      ),
      runner: this.realRunner()
    });

    return {
      submit: (request: unknown) => {
        const typed = request as RealQueueSubmit;
        return queue.submit({
          workspace: typed.workspace,
          vivadoVersion: typed.vivadoVersion,
          toolProfile: typed.toolProfile,
          resourceSlots: typed.resourceSlots,
          timeoutSeconds: typed.timeoutSeconds,
          priority: typed.priority,
          artifacts: typed.artifacts,
          command: typed.command,
          cwd: typed.cwd,
          jobDir: typed.jobDir,
          artifactRoot: typed.workspace
        });
      },
      status: (jobId: string) => queue.get(jobId),
      logs: async (jobId: string, options: { tailLines?: number; stream?: string }) => {
        const job = queue.get(jobId);
        if (!job) {
          return "";
        }
        const stream = options.stream ?? "stdout";
        if (stream === "stdout") {
          return job.result?.stdout ?? "";
        }
        if (stream === "stderr") {
          return job.result?.stderr ?? "";
        }
        return readLogTail(path.join(job.jobDir ?? path.join(this.options.config.jobRoot, jobId), stream), options.tailLines ?? 200);
      },
      cancel: (jobId: string) => {
        queue.cancel(jobId);
        return queue.get(jobId);
      },
      artifacts: async (jobId: string) => {
        const job = queue.get(jobId);
        if (!job) {
          return [];
        }
        const artifactPatterns = job.artifacts ?? [];
        return listArtifacts(job.artifactRoot ?? job.jobDir ?? path.join(this.options.config.jobRoot, jobId), artifactPatterns);
      }
    };
  }

  private realRunner(): QueueRunner {
    return async (job, signal) => {
      const typed = job as JobRecord & { command?: string[]; cwd?: string };
      if (!typed.command) {
        return { exitCode: 1, stderr: "Job is missing rendered command" };
      }
      const result = await runProcess(typed.command, {
        cwd: typed.cwd,
        timeoutMs: job.timeoutSeconds ? job.timeoutSeconds * 1_000 : undefined,
        signal
      });
      return result;
    };
  }
}
