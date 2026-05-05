import type { JobState, JobSummary } from "./types.js";

export type QueueJobRequest = {
  jobId?: string;
  workspace: string;
  vivadoVersion: string;
  toolProfile: string;
  resourceSlots?: number;
  resource_slots?: number;
  timeoutSeconds?: number;
  priority?: number;
  artifacts?: string[];
  command?: string[];
  cwd?: string;
  jobDir?: string;
  artifactRoot?: string;
};

export type QueueJobResult = {
  exitCode: number | null;
  signal?: NodeJS.Signals | null;
  stdout?: string;
  stderr?: string;
  timedOut?: boolean;
  cancelled?: boolean;
};

export type QueueRunner = (job: JobRecord, signal: AbortSignal) => Promise<QueueJobResult>;

export type JobRecord = JobSummary & {
  priority: number;
  timeoutSeconds?: number;
  abortController: AbortController;
  result?: QueueJobResult;
  artifacts?: string[];
  command?: string[];
  cwd?: string;
  jobDir?: string;
  artifactRoot?: string;
};

type ActiveJob = {
  id: string;
  workspace: string;
  vivadoVersion: string;
  slots: number;
};

export type InMemoryJobQueueOptions = {
  maxConcurrentJobs: number;
  maxPendingJobs?: number;
  perVersionConcurrency?: Record<string, number>;
  runner: QueueRunner;
  idFactory?: () => string;
};

export class InMemoryJobQueue {
  private readonly pending: JobRecord[] = [];
  private readonly jobs = new Map<string, JobRecord>();
  private readonly active = new Map<string, ActiveJob>();
  private sequence = 0;

  constructor(private readonly options: InMemoryJobQueueOptions) {}

  submit(request: QueueJobRequest): JobRecord {
    if ((this.options.maxPendingJobs ?? Number.POSITIVE_INFINITY) <= this.pending.length) {
      throw new Error("Job queue is full");
    }

    const resourceSlots = request.resourceSlots ?? request.resource_slots ?? 1;
    if (resourceSlots < 1) {
      throw new Error("resourceSlots must be at least 1");
    }
    if (resourceSlots > this.options.maxConcurrentJobs) {
      throw new Error(`resourceSlots ${resourceSlots} exceeds maxConcurrentJobs ${this.options.maxConcurrentJobs}`);
    }

    const job: JobRecord = {
      jobId: request.jobId ?? this.nextId(),
      state: "queued",
      workspace: request.workspace,
      vivadoVersion: request.vivadoVersion,
      toolProfile: request.toolProfile,
      resourceSlots,
      queuedAt: new Date().toISOString(),
      priority: request.priority ?? 0,
      timeoutSeconds: request.timeoutSeconds,
      abortController: new AbortController(),
      artifacts: request.artifacts,
      command: request.command,
      cwd: request.cwd,
      jobDir: request.jobDir,
      artifactRoot: request.artifactRoot
    };

    this.jobs.set(job.jobId, job);
    this.pending.push(job);
    this.drain();
    return job;
  }

  get(jobId: string): JobRecord | undefined {
    return this.jobs.get(jobId);
  }

  list(): JobRecord[] {
    return [...this.jobs.values()];
  }

  queuedPosition(jobId: string): number | undefined {
    const index = this.pending.findIndex((job) => job.jobId === jobId);
    return index === -1 ? undefined : index + 1;
  }

  cancel(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    if (!job) {
      return false;
    }
    if (job.state === "queued") {
      const index = this.pending.findIndex((pendingJob) => pendingJob.jobId === jobId);
      if (index !== -1) {
        this.pending.splice(index, 1);
      }
      this.finish(job, "cancelled", { exitCode: null, cancelled: true });
      return true;
    }
    if (job.state === "running") {
      job.abortController.abort();
      return true;
    }
    return false;
  }

  private drain(): void {
    let started = true;
    while (started) {
      started = false;
      for (let index = 0; index < this.pending.length; index += 1) {
        const job = this.pending[index];
        if (this.canStart(job)) {
          this.pending.splice(index, 1);
          this.start(job);
          started = true;
          break;
        }
      }
    }
  }

  private canStart(job: JobRecord): boolean {
    if (this.activeSlots() + job.resourceSlots > this.options.maxConcurrentJobs) {
      return false;
    }
    if (this.activeByWorkspace(job.workspace) > 0) {
      return false;
    }
    const versionLimit = this.options.perVersionConcurrency?.[job.vivadoVersion] ?? Number.POSITIVE_INFINITY;
    if (this.activeSlotsByVersion(job.vivadoVersion) + job.resourceSlots > versionLimit) {
      return false;
    }
    return true;
  }

  private start(job: JobRecord): void {
    job.state = "running";
    job.startedAt = new Date().toISOString();
    this.active.set(job.jobId, {
      id: job.jobId,
      workspace: job.workspace,
      vivadoVersion: job.vivadoVersion,
      slots: job.resourceSlots
    });

    this.options
      .runner(job, job.abortController.signal)
      .then((result) => {
        const terminalState = this.resultState(result);
        this.finish(job, terminalState, result);
      })
      .catch((error: unknown) => {
        this.finish(job, "failed", {
          exitCode: null,
          stderr: error instanceof Error ? error.message : String(error)
        });
      });
  }

  private finish(job: JobRecord, state: JobState, result: QueueJobResult): void {
    job.state = state;
    job.endedAt = new Date().toISOString();
    job.exitCode = result.exitCode;
    job.signal = result.signal ?? null;
    job.error = result.stderr;
    job.result = result;
    this.active.delete(job.jobId);
    queueMicrotask(() => this.drain());
  }

  private resultState(result: QueueJobResult): JobState {
    if (result.timedOut) {
      return "timed_out";
    }
    if (result.cancelled) {
      return "cancelled";
    }
    return result.exitCode === 0 ? "succeeded" : "failed";
  }

  private activeSlots(): number {
    return [...this.active.values()].reduce((sum, job) => sum + job.slots, 0);
  }

  private activeSlotsByVersion(version: string): number {
    return [...this.active.values()]
      .filter((job) => job.vivadoVersion === version)
      .reduce((sum, job) => sum + job.slots, 0);
  }

  private activeByWorkspace(workspace: string): number {
    return [...this.active.values()].filter((job) => job.workspace === workspace).length;
  }

  private nextId(): string {
    if (this.options.idFactory) {
      return this.options.idFactory();
    }
    this.sequence += 1;
    return `job-${this.sequence.toString().padStart(6, "0")}`;
  }
}
