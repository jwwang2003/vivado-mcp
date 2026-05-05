import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { jobIdSchema, jobLogsSchema, submitJobSchema } from "./schemas.js";
import type { VivadoService } from "./service.js";

export const VIVADO_TOOL_NAMES = [
  "vivado_submit_job",
  "vivado_job_status",
  "vivado_job_logs",
  "vivado_cancel_job",
  "vivado_artifacts",
  "vivado_versions"
] as const;

export type VivadoMcpToolName = (typeof VIVADO_TOOL_NAMES)[number];

type JsonableService = Pick<VivadoService, "submitJob" | "status" | "logs" | "cancel" | "artifacts" | "versions">;

function text(content: string) {
  return { content: [{ type: "text" as const, text: content }] };
}

function json(value: unknown) {
  return text(JSON.stringify(value, null, 2));
}

export function createVivadoMcpServer(options: { service: JsonableService }): McpServer {
  const server = new McpServer({ name: "vivado-mcp", version: "0.1.0" });
  const { service } = options;

  server.registerTool(
    "vivado_versions",
    {
      description: "List configured Vivado versions, execution profiles, and concurrency limits."
    },
    async () => json({ versions: await service.versions() })
  );

  server.registerTool(
    "vivado_submit_job",
    {
      description: "Queue a Vivado or Vitis Tcl job.",
      inputSchema: submitJobSchema.shape
    },
    async (args) => json(await service.submitJob(submitJobSchema.parse(args)))
  );

  server.registerTool(
    "vivado_job_status",
    {
      description: "Get status for a queued or completed Vivado job.",
      inputSchema: jobIdSchema.shape
    },
    async (args) => json(await service.status(jobIdSchema.parse(args).job_id))
  );

  server.registerTool(
    "vivado_job_logs",
    {
      description: "Read captured logs for a Vivado job.",
      inputSchema: jobLogsSchema.shape
    },
    async (args) => {
      const parsed = jobLogsSchema.parse(args);
      return text(await service.logs(parsed.job_id, { tailLines: parsed.tail_lines, stream: parsed.stream }));
    }
  );

  server.registerTool(
    "vivado_cancel_job",
    {
      description: "Cancel a queued or running Vivado job.",
      inputSchema: jobIdSchema.shape
    },
    async (args) => json(await service.cancel(jobIdSchema.parse(args).job_id))
  );

  server.registerTool(
    "vivado_artifacts",
    {
      description: "List retained artifacts for a Vivado job.",
      inputSchema: jobIdSchema.shape
    },
    async (args) => json({ artifacts: await service.artifacts(jobIdSchema.parse(args).job_id) })
  );

  return server;
}
