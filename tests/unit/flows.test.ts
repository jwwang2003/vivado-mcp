import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import { prepareFlow } from "../../src/flows.js";

async function makeTempDir(name: string): Promise<string> {
  return mkdir(join(tmpdir(), `vivado-mcp-${name}-${Date.now()}-${Math.random().toString(16).slice(2)}`), {
    recursive: true
  });
}

describe("prepareFlow", () => {
  it("prepares a workspace-relative tcl_script without generating Tcl", async () => {
    const workspaceDir = await makeTempDir("tcl-script-workspace");
    const jobDir = await makeTempDir("tcl-script-job");
    await mkdir(join(workspaceDir, "scripts"), { recursive: true });
    await writeFile(join(workspaceDir, "scripts", "build.tcl"), "puts build\n");

    const prepared = await prepareFlow({
      workspaceDir,
      jobDir,
      flow: {
        type: "tcl_script",
        tool_profile: "vivado.custom",
        script_path: "scripts/build.tcl",
        args: ["BOARD=arty", "FAST=1"]
      }
    });

    expect(prepared).toEqual({
      toolProfile: "vivado.custom",
      scriptPath: join(workspaceDir, "scripts", "build.tcl"),
      args: ["BOARD=arty", "FAST=1"],
      generated: false
    });
  });

  it("prepares named_flow only from an allowlisted flow directory", async () => {
    const workspaceDir = await makeTempDir("named-flow-workspace");
    const jobDir = await makeTempDir("named-flow-job");
    const flowDir = await makeTempDir("named-flow-allowlist");
    await writeFile(join(flowDir, "implementation.tcl"), "puts implementation\n");

    const prepared = await prepareFlow({
      workspaceDir,
      jobDir,
      flowDirs: [flowDir],
      flow: {
        type: "named_flow",
        name: "implementation",
        args: { top: "blink", part: "xc7a35ticsg324-1L" }
      }
    });

    expect(prepared).toEqual({
      toolProfile: "vivado.batch",
      scriptPath: join(flowDir, "implementation.tcl"),
      args: ["part=xc7a35ticsg324-1L", "top=blink"],
      generated: false
    });

    await expect(
      prepareFlow({
        workspaceDir,
        jobDir,
        flowDirs: [flowDir],
        flow: { type: "named_flow", name: "../implementation" }
      })
    ).rejects.toThrow(/allowlisted flow/i);
  });

  it("generates managed_project Tcl with run_jobs", async () => {
    const workspaceDir = await makeTempDir("managed-project-workspace");
    const jobDir = await makeTempDir("managed-project-job");
    await writeFile(join(workspaceDir, "design.xpr"), "# project\n");

    const prepared = await prepareFlow({
      workspaceDir,
      jobDir,
      flow: {
        type: "managed_project",
        project_file: "design.xpr",
        stages: ["synth", "impl", "bitstream", "reports"],
        run_names: { synth: "synth_fast", impl: "impl_timing" },
        run_jobs: 6
      }
    });

    expect(prepared.toolProfile).toBe("vivado.batch");
    expect(prepared.generated).toBe(true);
    expect(prepared.scriptPath.startsWith(jobDir)).toBe(true);
    expect(prepared.args).toEqual([]);

    const tcl = await readFile(prepared.scriptPath, "utf8");
    expect(tcl).toContain(`open_project ${join(workspaceDir, "design.xpr")}`);
    expect(tcl).toContain("launch_runs synth_fast -jobs 6");
    expect(tcl).toContain("wait_on_run synth_fast");
    expect(tcl).toContain("launch_runs impl_timing -to_step write_bitstream -jobs 6");
    expect(tcl).toContain("wait_on_run impl_timing");
    expect(tcl).toContain("report_timing_summary");
    expect(tcl).toContain("report_utilization");
  });

  it("generates managed_non_project Tcl with sources, constraints, and requested stages", async () => {
    const workspaceDir = await makeTempDir("managed-non-project-workspace");
    const jobDir = await makeTempDir("managed-non-project-job");
    await mkdir(join(workspaceDir, "rtl"), { recursive: true });
    await mkdir(join(workspaceDir, "constraints"), { recursive: true });
    await writeFile(join(workspaceDir, "rtl", "top.v"), "module top; endmodule\n");
    await writeFile(join(workspaceDir, "rtl", "pkg.vhd"), "entity pkg is end entity;\n");
    await writeFile(join(workspaceDir, "constraints", "top.xdc"), "create_clock\n");

    const prepared = await prepareFlow({
      workspaceDir,
      jobDir,
      flow: {
        type: "managed_non_project",
        top: "top",
        part: "xc7a35ticsg324-1L",
        sources: ["rtl/top.v", "rtl/pkg.vhd"],
        constraints: ["constraints/top.xdc"],
        stages: ["synth", "impl", "bitstream", "reports"],
        run_jobs: 4
      }
    });

    expect(prepared.toolProfile).toBe("vivado.batch");
    expect(prepared.generated).toBe(true);
    expect(prepared.scriptPath.startsWith(jobDir)).toBe(true);
    expect(prepared.args).toEqual([]);

    const tcl = await readFile(prepared.scriptPath, "utf8");
    expect(tcl).toContain("create_project -in_memory -part xc7a35ticsg324-1L");
    expect(tcl).toContain(`read_verilog ${join(workspaceDir, "rtl", "top.v")}`);
    expect(tcl).toContain(`read_vhdl ${join(workspaceDir, "rtl", "pkg.vhd")}`);
    expect(tcl).toContain(`read_xdc ${join(workspaceDir, "constraints", "top.xdc")}`);
    expect(tcl).toContain("synth_design -top top -part xc7a35ticsg324-1L");
    expect(tcl).toContain("opt_design");
    expect(tcl).toContain("place_design");
    expect(tcl).toContain("route_design");
    expect(tcl).toContain("write_bitstream");
    expect(tcl).toContain("report_timing_summary");
    expect(tcl).toContain("report_utilization");
  });

  it("generates checkpoint report Tcl for selected report types", async () => {
    const workspaceDir = await makeTempDir("checkpoint-reports-workspace");
    const jobDir = await makeTempDir("checkpoint-reports-job");
    await writeFile(join(workspaceDir, "post_route.dcp"), "checkpoint\n");

    const prepared = await prepareFlow({
      workspaceDir,
      jobDir,
      flow: {
        type: "checkpoint_reports",
        checkpoint: "post_route.dcp",
        reports: ["timing_summary", "utilization", "power", "drc", "methodology"]
      }
    });

    expect(prepared.toolProfile).toBe("vivado.batch");
    expect(prepared.generated).toBe(true);
    expect(prepared.scriptPath.startsWith(jobDir)).toBe(true);
    expect(prepared.args).toEqual([]);

    const tcl = await readFile(prepared.scriptPath, "utf8");
    expect(tcl).toContain(`open_checkpoint ${join(workspaceDir, "post_route.dcp")}`);
    expect(tcl).toContain("report_timing_summary");
    expect(tcl).toContain("report_utilization");
    expect(tcl).toContain("report_power");
    expect(tcl).toContain("report_drc");
    expect(tcl).toContain("report_methodology");
  });
});
