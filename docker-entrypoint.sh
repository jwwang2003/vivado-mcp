#!/usr/bin/env bash
set -euo pipefail

: "${WORKSPACE_ROOT:=/workspace}"
: "${VIVADO_MCP_CONFIG:=/app/config/vivado-mcp.json}"
: "${HOME:=$WORKSPACE_ROOT/.container-home}"
: "${TMPDIR:=$WORKSPACE_ROOT/.tmp}"

if [[ ! -d "$WORKSPACE_ROOT" ]]; then
  echo "workspace missing: $WORKSPACE_ROOT" >&2
  exit 2
fi

if [[ ! -w "$WORKSPACE_ROOT" ]]; then
  echo "workspace is not writable: $WORKSPACE_ROOT" >&2
  exit 2
fi

if [[ ! -f "$VIVADO_MCP_CONFIG" ]]; then
  echo "config missing: $VIVADO_MCP_CONFIG" >&2
  exit 2
fi

mkdir -p "$HOME" "$TMPDIR" "$WORKSPACE_ROOT/.vivado-mcp/jobs"

if [[ "${1:-}" == "validate-config" ]]; then
  node dist/index.js --validate-config
  exit 0
fi

node dist/index.js --validate-config
exec "$@"
