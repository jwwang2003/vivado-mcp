import { describe, expect, it, vi } from "vitest";

import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

import { createVivadoMcpServer, VIVADO_TOOL_NAMES } from "../src/server.js";
import { submitJobSchema } from "../src/schemas.js";

const expectedToolNames = [
  "vivado_submit_job",
  "vivado_job_status",
  "vivado_job_logs",
  "vivado_cancel_job",
  "vivado_artifacts",
  "vivado_versions"
];

function requestHandlers(server: unknown): Map<string, (request: unknown, extra: unknown) => Promise<unknown> | unknown> {
  return (server as { server: { _requestHandlers: Map<string, (request: unknown, extra: unknown) => unknown> } }).server
    ._requestHandlers;
}

async function listTools(server: unknown) {
  const handler = requestHandlers(server).get("tools/list");
  if (!handler) {
    throw new Error("tools/list handler was not registered");
  }
  return handler(ListToolsRequestSchema.parse({ method: "tools/list", params: {} }), {});
}

async function callTool(server: unknown, name: string, args: Record<string, unknown>) {
  const handler = requestHandlers(server).get("tools/call");
  if (!handler) {
    throw new Error("tools/call handler was not registered");
  }
  return handler(CallToolRequestSchema.parse({ method: "tools/call", params: { name, arguments: args } }), {});
}

function textResult(result: unknown): string {
  const content = (result as { content: Array<{ type: string; text: string }> }).content;
  expect(content).toHaveLength(1);
  expect(content[0].type).toBe("text");
  return content[0].text;
}

describe("submitJobSchema", () => {
  it("accepts vivado_submit_job input with flow tool_profile and resource_slots", () => {
    const parsed = submitJobSchema.parse({
      workspace: "designs/blinky",
      vivado_version: "2025.1",
      flow: {
        type: "tcl_script",
        tool_profile: "vivado.report",
        script_path: "scripts/reports.tcl",
        args: ["top"]
      },
      resource_slots: 2,
      timeout_seconds: 300,
      priority: 5,
      artifacts: ["reports/*.rpt"]
    });

    expect(parsed).toMatchObject({
      workspace: "designs/blinky",
      vivado_version: "2025.1",
      flow: {
        type: "tcl_script",
        tool_profile: "vivado.report"
      },
      resource_slots: 2
    });
  });

  it("rejects invalid resource slots and unsupported flow shapes", () => {
    expect(
      submitJobSchema.safeParse({
        workspace: "designs/blinky",
        flow: {
          type: "tcl_script",
          tool_profile: "vivado.batch",
          script_path: "scripts/build.tcl"
        },
        resource_slots: 0
      }).success
    ).toBe(false);

    expect(
      submitJobSchema.safeParse({
        workspace: "designs/blinky",
        flow: {
          type: "managed_project",
          project_file: "project.xpr",
          stages: ["synth", "invalid_stage"]
        }
      }).success
    ).toBe(false);
  });
});

describe("createVivadoMcpServer", () => {
  it("exports and registers the Vivado MCP tool names", async () => {
    const service = {
      submitJob: vi.fn(),
      status: vi.fn(),
      logs: vi.fn(),
      cancel: vi.fn(),
      artifacts: vi.fn(),
      versions: vi.fn()
    };

    const server = createVivadoMcpServer({ service });
    const tools = (await listTools(server)) as { tools: Array<{ name: string }> };

    expect(VIVADO_TOOL_NAMES).toEqual(expectedToolNames);
    expect(tools.tools.map((tool) => tool.name).sort()).toEqual([...expectedToolNames].sort());
  });

  it("returns vivado_versions output from the service as JSON text", async () => {
    const service = {
      submitJob: vi.fn(),
      status: vi.fn(),
      logs: vi.fn(),
      cancel: vi.fn(),
      artifacts: vi.fn(),
      versions: vi.fn(async () => [
        {
          version: "2022.1",
          default: false,
          maxConcurrentJobs: 1,
          toolProfiles: ["vivado.batch"]
        },
        {
          version: "2025.1",
          default: true,
          maxConcurrentJobs: 2,
          toolProfiles: ["vivado.batch", "vivado.report"]
        }
      ])
    };

    const server = createVivadoMcpServer({ service });
    const result = await callTool(server, "vivado_versions", {});

    expect(JSON.parse(textResult(result))).toEqual({
      versions: [
        {
          version: "2022.1",
          default: false,
          maxConcurrentJobs: 1,
          toolProfiles: ["vivado.batch"]
        },
        {
          version: "2025.1",
          default: true,
          maxConcurrentJobs: 2,
          toolProfiles: ["vivado.batch", "vivado.report"]
        }
      ]
    });
    expect(service.versions).toHaveBeenCalledOnce();
  });

  it("routes submit, status, logs, cancel, and artifacts tool calls to the service", async () => {
    const service = {
      submitJob: vi.fn(async () => ({ jobId: "job-1", state: "queued" })),
      status: vi.fn(async () => ({ jobId: "job-1", state: "running" })),
      logs: vi.fn(async () => "line 1\nline 2\n"),
      cancel: vi.fn(async () => ({ jobId: "job-1", state: "cancelled" })),
      artifacts: vi.fn(async () => [{ path: "reports/timing.rpt", sizeBytes: 128 }]),
      versions: vi.fn()
    };
    const server = createVivadoMcpServer({ service });

    await expect(
      callTool(server, "vivado_submit_job", {
        workspace: "designs/blinky",
        flow: {
          type: "tcl_script",
          tool_profile: "vivado.batch",
          script_path: "scripts/build.tcl"
        },
        resource_slots: 1
      })
    ).resolves.toSatisfy((result) => JSON.parse(textResult(result)).jobId === "job-1");
    await expect(callTool(server, "vivado_job_status", { job_id: "job-1" })).resolves.toSatisfy(
      (result) => JSON.parse(textResult(result)).state === "running"
    );
    await expect(callTool(server, "vivado_job_logs", { job_id: "job-1", tail_lines: 20 })).resolves.toSatisfy(
      (result) => textResult(result) === "line 1\nline 2\n"
    );
    await expect(callTool(server, "vivado_cancel_job", { job_id: "job-1" })).resolves.toSatisfy(
      (result) => JSON.parse(textResult(result)).state === "cancelled"
    );
    await expect(callTool(server, "vivado_artifacts", { job_id: "job-1" })).resolves.toSatisfy(
      (result) => JSON.parse(textResult(result)).artifacts[0].path === "reports/timing.rpt"
    );

    expect(service.submitJob).toHaveBeenCalledWith(
      expect.objectContaining({
        workspace: "designs/blinky",
        flow: expect.objectContaining({ tool_profile: "vivado.batch" }),
        resource_slots: 1
      })
    );
    expect(service.status).toHaveBeenCalledWith("job-1");
    expect(service.logs).toHaveBeenCalledWith("job-1", { tailLines: 20 });
    expect(service.cancel).toHaveBeenCalledWith("job-1");
    expect(service.artifacts).toHaveBeenCalledWith("job-1");
  });
});
