import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { resolveExistingWorkspacePath, resolveWorkspacePath } from "./paths.js";
import type { FlowSpec, VivadoReport, VivadoStage } from "./types.js";

export type PreparedFlow = {
  toolProfile: string;
  scriptPath: string;
  args: string[];
  generated: boolean;
};

export type PrepareFlowOptions = {
  workspaceDir: string;
  jobDir: string;
  flow: FlowSpec;
  flowDirs?: string[];
};

function tclListValue(value: string): string {
  return `{${value.replace(/}/g, "\\}")}}`;
}

async function writeGeneratedTcl(jobDir: string, name: string, lines: string[]): Promise<string> {
  await mkdir(jobDir, { recursive: true });
  const scriptPath = path.join(jobDir, name);
  await writeFile(scriptPath, `${lines.join("\n")}\n`, "utf8");
  return scriptPath;
}

function sortedKeyValueArgs(args: Record<string, string> | undefined): string[] {
  if (!args) {
    return [];
  }
  return Object.entries(args)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`);
}

function reportLines(reports: VivadoReport[], outputDir = "."): string[] {
  const lines: string[] = [];
  for (const report of reports) {
    switch (report) {
      case "timing_summary":
        lines.push(`report_timing_summary -file ${tclListValue(path.join(outputDir, "timing_summary.rpt"))}`);
        break;
      case "utilization":
        lines.push(`report_utilization -file ${tclListValue(path.join(outputDir, "utilization.rpt"))}`);
        break;
      case "power":
        lines.push(`report_power -file ${tclListValue(path.join(outputDir, "power.rpt"))}`);
        break;
      case "drc":
        lines.push(`report_drc -file ${tclListValue(path.join(outputDir, "drc.rpt"))}`);
        break;
      case "methodology":
        lines.push(`report_methodology -file ${tclListValue(path.join(outputDir, "methodology.rpt"))}`);
        break;
    }
  }
  return lines;
}

function includesStage(stages: VivadoStage[], stage: VivadoStage): boolean {
  return stages.includes(stage);
}

function readCommandForSource(sourcePath: string): string {
  const lower = sourcePath.toLowerCase();
  if (lower.endsWith(".vhd") || lower.endsWith(".vhdl")) {
    return `read_vhdl ${sourcePath}`;
  }
  if (lower.endsWith(".sv")) {
    return `read_verilog -sv ${sourcePath}`;
  }
  return `read_verilog ${sourcePath}`;
}

export async function prepareFlow(options: PrepareFlowOptions): Promise<PreparedFlow> {
  const { workspaceDir, jobDir, flow } = options;

  if (flow.type === "tcl_script") {
    return {
      toolProfile: flow.tool_profile ?? "vivado.batch",
      scriptPath: resolveWorkspacePath(workspaceDir, flow.script_path),
      args: flow.args ?? [],
      generated: false
    };
  }

  if (flow.type === "named_flow") {
    if (flow.name.includes("/") || flow.name.includes("\\") || flow.name.includes("..")) {
      throw new Error(`Named flow ${flow.name} is not in an allowlisted flow directory`);
    }
    for (const flowDir of options.flowDirs ?? []) {
      const candidate = path.join(flowDir, `${flow.name}.tcl`);
      try {
        return {
          toolProfile: flow.tool_profile ?? "vivado.batch",
          scriptPath: await resolveExistingWorkspacePath(flowDir, `${flow.name}.tcl`),
          args: sortedKeyValueArgs(flow.args),
          generated: false
        };
      } catch (error) {
        const nodeError = error as NodeJS.ErrnoException;
        if (nodeError.code !== "ENOENT") {
          continue;
        }
      }
      void candidate;
    }
    throw new Error(`Named flow ${flow.name} was not found in an allowlisted flow directory`);
  }

  if (flow.type === "managed_project") {
    const projectPath = await resolveExistingWorkspacePath(workspaceDir, flow.project_file);
    const synthRun = flow.run_names?.synth ?? "synth_1";
    const implRun = flow.run_names?.impl ?? "impl_1";
    const jobsArg = flow.run_jobs ? ` -jobs ${flow.run_jobs}` : "";
    const lines = [`open_project ${projectPath}`];

    if (includesStage(flow.stages, "clean")) {
      lines.push(`reset_run ${synthRun}`);
      lines.push(`reset_run ${implRun}`);
    }
    if (includesStage(flow.stages, "synth")) {
      lines.push(`launch_runs ${synthRun}${jobsArg}`);
      lines.push(`wait_on_run ${synthRun}`);
    }
    if (includesStage(flow.stages, "impl") || includesStage(flow.stages, "bitstream")) {
      const toStep = includesStage(flow.stages, "bitstream") ? " -to_step write_bitstream" : "";
      lines.push(`launch_runs ${implRun}${toStep}${jobsArg}`);
      lines.push(`wait_on_run ${implRun}`);
      lines.push(`open_run ${implRun}`);
    }
    if (includesStage(flow.stages, "reports")) {
      lines.push(...reportLines(["timing_summary", "utilization"], jobDir));
    }
    lines.push("exit");

    return {
      toolProfile: "vivado.batch",
      scriptPath: await writeGeneratedTcl(jobDir, "managed_project.tcl", lines),
      args: [],
      generated: true
    };
  }

  if (flow.type === "managed_non_project") {
    const sources = await Promise.all(flow.sources.map((source) => resolveExistingWorkspacePath(workspaceDir, source)));
    const constraints = await Promise.all(
      (flow.constraints ?? []).map((constraint) => resolveExistingWorkspacePath(workspaceDir, constraint))
    );
    const lines = [`create_project -in_memory -part ${flow.part}`];

    for (const source of sources) {
      lines.push(readCommandForSource(source));
    }
    for (const constraint of constraints) {
      lines.push(`read_xdc ${constraint}`);
    }
    if (includesStage(flow.stages, "synth")) {
      lines.push(`synth_design -top ${flow.top} -part ${flow.part}`);
    }
    if (includesStage(flow.stages, "impl") || includesStage(flow.stages, "bitstream")) {
      lines.push("opt_design");
      lines.push("place_design");
      lines.push("route_design");
    }
    if (includesStage(flow.stages, "bitstream")) {
      lines.push(`write_bitstream -force ${tclListValue(path.join(jobDir, `${flow.top}.bit`))}`);
    }
    if (includesStage(flow.stages, "reports")) {
      lines.push(...reportLines(["timing_summary", "utilization"], jobDir));
    }
    lines.push("exit");

    return {
      toolProfile: "vivado.batch",
      scriptPath: await writeGeneratedTcl(jobDir, "managed_non_project.tcl", lines),
      args: [],
      generated: true
    };
  }

  const checkpointPath = await resolveExistingWorkspacePath(workspaceDir, flow.checkpoint);
  const lines = [`open_checkpoint ${checkpointPath}`, ...reportLines(flow.reports, jobDir), "exit"];
  return {
    toolProfile: "vivado.batch",
    scriptPath: await writeGeneratedTcl(jobDir, "checkpoint_reports.tcl", lines),
    args: [],
    generated: true
  };
}
