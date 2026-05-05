export type CommandProfile = {
  executable: string;
  args: string[];
  env?: Record<string, string>;
  requiresExitInScript?: boolean;
};

export type VivadoToolchain = {
  version: string;
  settingsScript?: string;
  maxConcurrentJobs: number;
  commands: Record<string, CommandProfile>;
};

export type QueueConfig = {
  maxConcurrentJobs: number;
  maxPendingJobs: number;
  defaultTimeoutSeconds: number;
};

export type VivadoMcpConfig = {
  workspaceRoot: string;
  jobRoot: string;
  defaultVivadoVersion: string;
  queue: QueueConfig;
  toolchains: Record<string, VivadoToolchain>;
};

export type VivadoStage = "synth" | "impl" | "bitstream" | "reports" | "clean";

export type VivadoReport = "timing_summary" | "utilization" | "power" | "drc" | "methodology";

export type FlowSpec =
  | { type: "tcl_script"; tool_profile?: string; script_path: string; args?: string[] }
  | { type: "named_flow"; name: string; tool_profile?: string; args?: Record<string, string> }
  | {
      type: "managed_project";
      project_file: string;
      stages: VivadoStage[];
      run_names?: Record<string, string>;
      run_jobs?: number;
    }
  | {
      type: "managed_non_project";
      top: string;
      part: string;
      sources: string[];
      constraints?: string[];
      stages: VivadoStage[];
      run_jobs?: number;
    }
  | { type: "checkpoint_reports"; checkpoint: string; reports: VivadoReport[] };

export type JobState = "queued" | "running" | "succeeded" | "failed" | "cancelled" | "timed_out";

export type SubmitJobInput = {
  workspace: string;
  vivado_version?: string;
  flow: FlowSpec;
  resource_slots?: number;
  timeout_seconds?: number;
  priority?: number;
  artifacts?: string[];
};

export type JobSummary = {
  jobId: string;
  state: JobState;
  workspace: string;
  vivadoVersion: string;
  toolProfile: string;
  resourceSlots: number;
  queuedAt: string;
  startedAt?: string;
  endedAt?: string;
  exitCode?: number | null;
  signal?: NodeJS.Signals | null;
  error?: string;
};
