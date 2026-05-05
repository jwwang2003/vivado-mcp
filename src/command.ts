import type { CommandProfile } from "./types.js";

export type RenderCommandOptions = {
  profile: CommandProfile;
  scriptPath: string;
  args?: string[];
  settingsScript?: string;
};

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

function expandProfileArgs(profileArgs: string[], scriptPath: string, args: string[] = []): string[] {
  const expanded: string[] = [];
  for (const arg of profileArgs) {
    if (arg === "{script}") {
      expanded.push(scriptPath);
    } else if (arg === "{args}") {
      expanded.push(...args);
    } else {
      expanded.push(arg);
    }
  }
  return expanded;
}

export function renderCommand(options: RenderCommandOptions): string[] {
  const argv = [options.profile.executable, ...expandProfileArgs(options.profile.args, options.scriptPath, options.args)];

  if (!options.settingsScript) {
    return argv;
  }

  const command = `source ${shellQuote(options.settingsScript)} && exec ${argv.map(shellQuote).join(" ")}`;
  return ["bash", "-lc", command];
}
