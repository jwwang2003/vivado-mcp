import { describe, expect, it } from "vitest";

import { renderCommand, shellQuote } from "../src/command.js";
import type { CommandProfile } from "../src/types.js";

describe("shellQuote", () => {
  it("quotes shell words with spaces and embedded single quotes", () => {
    expect(shellQuote("/workspace/design script.tcl")).toBe("'/workspace/design script.tcl'");
    expect(shellQuote("it's.tcl")).toBe("'it'\"'\"'s.tcl'");
  });
});

describe("renderCommand", () => {
  const profile: CommandProfile = {
    executable: "/opt/Xilinx/2025.1/Vivado/bin/vivado",
    args: ["-mode", "batch", "-source", "{script}", "-tclargs", "{args}"]
  };

  it("replaces the {script} placeholder with the script path", () => {
    expect(renderCommand({ profile, scriptPath: "/workspace/scripts/build.tcl" })).toEqual([
      "/opt/Xilinx/2025.1/Vivado/bin/vivado",
      "-mode",
      "batch",
      "-source",
      "/workspace/scripts/build.tcl",
      "-tclargs"
    ]);
  });

  it("expands {args} while preserving argv items that contain spaces", () => {
    expect(
      renderCommand({
        profile,
        scriptPath: "/workspace/scripts/build.tcl",
        args: ["top module", "xczu7ev-ffvc1156-2-e"]
      })
    ).toEqual([
      "/opt/Xilinx/2025.1/Vivado/bin/vivado",
      "-mode",
      "batch",
      "-source",
      "/workspace/scripts/build.tcl",
      "-tclargs",
      "top module",
      "xczu7ev-ffvc1156-2-e"
    ]);
  });

  it("wraps settingsScript commands in bash -lc and shell-quotes expanded argv", () => {
    expect(
      renderCommand({
        profile,
        scriptPath: "/workspace/scripts/design build.tcl",
        args: ["top module"],
        settingsScript: "/opt/Xilinx/2025.1/Vivado/settings64.sh"
      })
    ).toEqual([
      "bash",
      "-lc",
      "source '/opt/Xilinx/2025.1/Vivado/settings64.sh' && exec '/opt/Xilinx/2025.1/Vivado/bin/vivado' '-mode' 'batch' '-source' '/workspace/scripts/design build.tcl' '-tclargs' 'top module'"
    ]);
  });
});
