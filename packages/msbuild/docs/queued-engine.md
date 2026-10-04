# Queued native engine

`NativeMSBuild` accepts explicitly trusted native requests and retains bounded job records. Create it with a `NativeWorkspace`, then call `start(request)`, `wait(id)`, `snapshot(id, cursor)`, `cancel(id)` and `close()`.

## Scheduling and cancellation

User operations have priority over design-time work. Later queued design-time requests for the same project and global properties supersede earlier ones; active work is not replaced silently. The default queue holds at most 128 waiting operations, executes one at a time and retains 32 completed records. A cancelled queued operation never spawns a process. Cancelling an active operation uses the process-tree policy, then releases the queue for subsequent work.

`BuildScheduler` is public from `@sharpforge/msbuild/node` for additional native services. It supports bounded concurrency and prevents overlapping tasks with the same project key. Call `close()` to cancel queued and running work and wait for cleanup.

## Invocation and result lifetime

`createInvocation` builds separate argument tokens for the selected `dotnet` or `msbuild` executable. Each request passes output-path, elevated-switch and response-file validation before entering the queue. Requests can select bounded MSBuild parallelism, graph builds, binary logs, SARIF, target results, and explicit compiler/server reuse. Server reuse defaults to false. When used, host shutdown invokes the SDK's documented `dotnet build-server shutdown` command after its queue drains.

A job becomes terminal after its output log, evaluation result and downloadable artifact inventory have been collected. Text diagnostics receive workspace-relative locations; SARIF metadata enriches matching diagnostics. Result queries and generated inspection files remain available through the retained job. Cursor polling bounds in-memory log retention and reports truncation explicitly. Oversized artifacts remain visible with a non-downloadable reason.

## Native service seam

`engine.runTool(request, options)` runs the configured native executable through the same trust, queue, environment, timeout, output and cancellation policies. The request carries `project`, `trusted`, `arguments`, optional granted-workspace `cwd` and an allowlisted environment. Options can observe process startup and output lines and supply an abort signal. This is the shared seam for test adapters and SDK operations.

`engine.runWorkspaceExecutable(request, options)` additionally accepts `executablePath`, resolves it as a regular file within the granted workspace and uses no PATH lookup. Launch-profile interpretation is a later service layer.

## Workload diagnostics

For literal platform-targeted project frameworks, the default preflight reads the installed workload inventory and reports a missing workload with an explicit installation command. It does not install workloads. Imported or computed framework expressions remain authoritative SDK evaluation. Public `parseWorkloadList` and `explainTargetAvailability` retain the distinction between an unavailable target and one requiring evaluation.

## Qualification

The completed native scope exercised queue priority and supersession, real-child cancellation and subsequent work, bounded output/timeout/retention, diagnostics and artifact collection on Linux/x64 Node22.23.3 and Node26.10.0. SDK10.0.201 native qualification is retained in the source evidence manifest. This projection reuses that evidence and does not repeat the whole native matrix.

This host denies the named-pipe socket operation needed by the reusable parallel MSBuild worker qualification. That specific attempt failed before timing the second build; no measured speedup or reusable-worker cleanup pass is claimed. Windows, macOS and arm64 execution remain unqualified on this host.
