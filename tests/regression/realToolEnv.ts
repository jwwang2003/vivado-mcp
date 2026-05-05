export const RUN_REAL_VIVADO_ENV = "VIVADO_MCP_RUN_VIVADO";

export function realVivadoTestsEnabled(): boolean {
  return process.env[RUN_REAL_VIVADO_ENV] === "1";
}
