# Native process and trust primitives

These public Node APIs support explicitly authorized native work. The caller chooses the executable;
`runNativeProcess` does not decide whether the workspace is trusted and does not sandbox native code.

```js
import { runNativeProcess, WorkspaceTrustStore } from '@sharpforge/msbuild/node';

const trust = new WorkspaceTrustStore('/host-owned/config/workspace-trust.json');
const grant = await trust.get('/work/project');
if (!grant) throw new Error('The host has not granted native execution for this workspace');

const result = await runNativeProcess({
  executable: '/installed/dotnet', arguments: ['--version'], cwd: '/work/project',
  timeoutMs: 15000, maxOutputBytes: 65536,
}, { signal, onLine: ({ stream, text }) => appendLine(stream, text) });
```

The result includes stdout, stderr, exitCode, signal, durationMs, cancelled, timedOut, reason and
truncated. Shell interpolation is disabled. UTF-8 is decoded across chunk boundaries, and each
stdout/stderr line is delivered with its stream identity. A callback failure terminates the process
and rejects. `onStart({pid})` enables an explicit debugger handoff. Limits reject invalid values;
defaults are 30 minutes and 32 MiB, with a 1 MiB partial-line guard.

`createBuildEnvironment(source, overrides)` inherits only tool-discovery, home, temporary-directory,
locale and platform variables. Host tokens and startup hooks are absent. Overrides allow the named
debug/test and NuGet cache variables implemented by the host; unknown overrides reject.
`createLaunchEnvironment(source, overrides)` permits explicit application variables after the same
restricted inheritance, bounded to 256 variables and 1 MiB in total. Names and NUL characters are
validated; Windows duplicate names are compared without case. To select that policy for an authorized
application invocation, use `environmentMode: 'launch'` and an explicit `environment` record.

Cancellation and timeout terminate the detached POSIX process group, escalating after 750 ms. Windows
uses `taskkill /T`, with `/F` for escalation. `terminateProcessTree` is also exported for hosts that own
their child process lifecycle. Cancellation is recorded separately from a successful exit.

`WorkspaceTrustStore` persists canonical-root SHA-256 identities in a host-owned JSON file. `grant(root,
{elevated})`, `get(root)` and `revoke(root)` serialize writes and use an exclusive temporary file plus
rename. The store is limited to 4096 grants and 1 MiB. A project file cannot grant its own trust. An
embedding engine must combine the host grant with the current request's explicit native authorization.

## Qualification

The implementation is copied unchanged from the completed native Project18 composition. The focused
tests here are extracted from its process/environment/trust acceptance file and use the public Node
entry point. Linux/x64 Node22.23.3 and Node26.10.0 exercised actual child environment filtering,
Unicode output, timeout, and child/grandchild cancellation. Windows process-tree execution was
unavailable on the Linux host; its branch is implemented but is not claimed qualified there. Full
native evidence is retained under `planning/evidence/project18/native.json` in the integration stack.

This batch exports these primitives. The queued engine and authenticated HTTP service adopt them in
dependent PRs, with separate request and host trust checks.
