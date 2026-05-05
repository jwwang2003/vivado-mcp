# Vivado MCP

Dockerized MCP server for queued Vivado and Vitis Tcl flows. The container includes the MCP runtime only. Vivado stays installed on the host and is bind-mounted read-only into the container.

## Local Layout

The example config supports the installed layouts found on this machine:

- Vivado 2022.1: `/opt/Xilinx/Vivado/2022.1/bin/vivado`
- Vitis HLS 2022.1: `/opt/Xilinx/Vitis_HLS/2022.1/bin/vitis_hls`
- Vivado 2025.1: `/opt/Xilinx/2025.1/Vivado/bin/vivado`
- Vitis unified 2025.1: `/opt/Xilinx/2025.1/Vitis/bin/vitis-run`

Each invocation is an execution profile in `config/vivado-mcp.example.json`, so site-local wrapper scripts or different binary names can be configured without changing MCP schemas.

## Tools

- `vivado_versions`
- `vivado_submit_job`
- `vivado_job_status`
- `vivado_job_logs`
- `vivado_cancel_job`
- `vivado_artifacts`

`vivado_submit_job` accepts flow specs for workspace Tcl scripts, allowlisted named flows, managed project flows, managed non-project flows, and checkpoint reports.

## Concurrency

The first implementation is single-container:

- `queue.maxConcurrentJobs` limits all external tool sessions.
- Each toolchain has `maxConcurrentJobs`.
- Each workspace path is locked to one active job.
- `resource_slots` reserves more than one external slot for Tcl scripts that launch additional Vivado or HLS processes.

Vivado-managed parallelism such as run jobs belongs in the flow spec as `run_jobs`; external process fan-out belongs in `resource_slots`.

## Docker

Create a host workspace and start the container:

```bash
export HOST_WORKSPACE=/home/wjw/workspace/fpga/vivado-workspaces/project-a
export HOST_XILINX_ROOT=/opt/Xilinx
export UID=$(id -u)
export GID=$(id -g)
docker compose up --build
```

For floating licenses, pass `XILINXD_LICENSE_FILE` or `LM_LICENSE_FILE` through the environment. If your license server rejects Docker bridge networking, use host networking or allow the Docker subnet on the license server.

## Tests

Fake-tool tests do not require Vivado:

```bash
pnpm test
pnpm run typecheck
pnpm run build
```

Real Vivado smoke tests are opt-in and run lightweight Tcl only:

```bash
VIVADO_MCP_RUN_REAL_VIVADO=1 pnpm exec vitest run tests/realVivadoSmoke.test.ts
```

## License

This project is licensed under the GNU Affero General Public License v3.0 only. See `LICENSE`.
