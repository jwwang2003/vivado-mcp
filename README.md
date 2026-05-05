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

Real Vivado/HLS tests are opt-in through one global environment variable. Lightweight Vivado Tcl smoke tests:

```bash
VIVADO_MCP_RUN_VIVADO=1 pnpm exec vitest run tests/regression/realVivadoSmoke.test.ts
```

Run the whole suite including real Vivado and HLS regressions:

```bash
VIVADO_MCP_RUN_VIVADO=1 pnpm test
```

## Regression Demo

The MachSuite AES HLS regression demo lives in `demos/machsuite-aes` and uses the `3rdParty/MachSuite/aes/aes` benchmark from the MachSuite submodule.

The demo provides submit payloads for both local tool layouts:

- `demos/machsuite-aes/submit-job.2022.1.json` uses `vitis_hls.legacy`
- `demos/machsuite-aes/submit-job.2025.1.json` uses `vitis_run.hls_tcl`

The Tcl script runs HLS C synthesis only and writes tool output under `demos/machsuite-aes/work/`, which is ignored.

The fast regression checks structure and MCP submission without launching HLS:

```bash
pnpm exec vitest run tests/regression/machsuiteAesDemo.test.ts --reporter=verbose
```

The full HLS synthesis regression is opt-in and can take minutes:

```bash
VIVADO_MCP_RUN_VIVADO=1 pnpm exec vitest run tests/regression/machsuiteAesRealHls.test.ts --reporter=verbose
```

Run a single installed tool version with:

```bash
VIVADO_MCP_RUN_VIVADO=1 VIVADO_MCP_MACHSUITE_AES_VERSIONS=2022.1 pnpm exec vitest run tests/regression/machsuiteAesRealHls.test.ts --reporter=verbose
```

## License

This project is licensed under the GNU Affero General Public License v3.0 only. See `LICENSE`.
