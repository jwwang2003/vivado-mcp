import { z } from "zod";

const vivadoStageSchema = z.enum(["synth", "impl", "bitstream", "reports", "clean"]);
const vivadoReportSchema = z.enum(["timing_summary", "utilization", "power", "drc", "methodology"]);

export const flowSpecSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("tcl_script"),
      tool_profile: z.string().min(1).optional(),
      script_path: z.string().min(1),
      args: z.array(z.string()).optional()
    })
    .strict(),
  z
    .object({
      type: z.literal("named_flow"),
      name: z.string().min(1),
      tool_profile: z.string().min(1).optional(),
      args: z.record(z.string()).optional()
    })
    .strict(),
  z
    .object({
      type: z.literal("managed_project"),
      project_file: z.string().min(1),
      stages: z.array(vivadoStageSchema).min(1),
      run_names: z.record(z.string()).optional(),
      run_jobs: z.number().int().positive().optional()
    })
    .strict(),
  z
    .object({
      type: z.literal("managed_non_project"),
      top: z.string().min(1),
      part: z.string().min(1),
      sources: z.array(z.string().min(1)).min(1),
      constraints: z.array(z.string().min(1)).optional(),
      stages: z.array(vivadoStageSchema).min(1),
      run_jobs: z.number().int().positive().optional()
    })
    .strict(),
  z
    .object({
      type: z.literal("checkpoint_reports"),
      checkpoint: z.string().min(1),
      reports: z.array(vivadoReportSchema).min(1)
    })
    .strict()
]);

export const submitJobSchema = z
  .object({
    workspace: z.string().min(1),
    vivado_version: z.string().min(1).optional(),
    flow: flowSpecSchema,
    resource_slots: z.number().int().positive().optional(),
    timeout_seconds: z.number().int().positive().optional(),
    priority: z.number().int().optional(),
    artifacts: z.array(z.string()).optional()
  })
  .strict();

export const jobIdSchema = z.object({ job_id: z.string().min(1) }).strict();

export const jobLogsSchema = z
  .object({
    job_id: z.string().min(1),
    stream: z.enum(["stdout", "stderr", "vivado.log", "vivado.jou"]).optional(),
    tail_lines: z.number().int().positive().max(5_000).optional()
  })
  .strict();
