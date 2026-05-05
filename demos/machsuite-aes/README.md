# MachSuite AES HLS Demo

This demo submits the MachSuite `aes/aes` benchmark through `vivado_submit_job` as an HLS Tcl flow.

The benchmark source lives in the MachSuite submodule:

```text
3rdParty/MachSuite/aes/aes
```

The demo Tcl script is synthesis-only by default:

```text
demos/machsuite-aes/machsuite-aes-hls.tcl
```

It creates its HLS working directory under:

```text
demos/machsuite-aes/work/machsuite_aes_hls
```

Set `VIVADO_MCP_HLS_WORK_DIR` or pass one Tcl argument to override the working directory. Relative paths are resolved from the repository root:

```text
demos/machsuite-aes/work/my-run
```

That directory is intentionally ignored by Git.

## Submit Payloads

Legacy Vitis HLS / Vivado HLS style:

```json
demos/machsuite-aes/submit-job.2022.1.json
```

Unified Vitis runner style:

```json
demos/machsuite-aes/submit-job.2025.1.json
```

The 2022.1 payload uses the `vitis_hls.legacy` execution profile. The 2025.1 payload uses `vitis_run.hls_tcl`.

Both payloads reserve one external tool slot with `resource_slots: 1`. If you modify the Tcl to launch additional external HLS/Vivado processes, increase `resource_slots` accordingly.
