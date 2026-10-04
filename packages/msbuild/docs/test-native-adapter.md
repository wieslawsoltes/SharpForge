# Native test adapter

`@sharpforge/msbuild/node` exports `NativeTestAdapter` and
`registerNativeTestingServices`. The adapter reuses `NativeMSBuild.runTool` for
workspace trust, a configured executable, argument/environment policy, process-tree
cancellation, timeout and output bounds. It does not select an arbitrary executable.

```js
import {startMSBuildHost, registerNativeTestingServices} from '@sharpforge/msbuild/node';

const host = await startMSBuildHost({root, port: 0,
  nativeServices: {contributions: [registerNativeTestingServices]}});
// The public browser client calls service('testing', operation, request, {signal}).
```

## Local adapter contract

`new NativeTestAdapter({host, workspace, maxSessions = 32})` requires a host with
`runTool` and a workspace with `jobDirectory`, `artifact` and a granted root.
It retains at most 1–1024 configured sessions, evicting terminal sessions first;
overlapping startup reserves capacity before awaiting directory creation.

Every discover/run request requires `trusted: true` and a workspace project or
solution (`csproj`, `fsproj`, `vbproj`, `sln` or `slnx`). Configuration, framework,
settings, runner, timeout, selected tests, noBuild and coverage are explicit.
`sourceTests` enriches native discovery and is bounded to 100000 records. Run
options may carry signal, sourceTests, source symbols and progress callbacks.

- `discover(request, options)` returns discovered records, diagnostics, bounded
  native output, backend identity and cancellation state.
- `run(request, options)` resolves to a completed snapshot plus native output,
  retained artifact records, parsed coverage, diagnostics and success.
- `start(request, options)` returns `{id}` before execution completes.
- `snapshot(id, after = 0)` returns bounded replay events and the final result when
  available; `cancel(id)` cancels its session and process through the existing host.
- `artifact(id, path)` reads only artifacts recorded for that completed session;
  the workspace independently enforces its existing artifact policy.
- `close()` rejects new work, disposes sessions and awaits all started operations.

The adapter searches its secured job directory for TRX and Cobertura, ignoring
symlinks, bounding traversal depth and retained report sizes. Test outcomes come
from report files; successful console text without TRX yields SFT2305. Execution
or parsing failures yield SFT2306. Cancellation leaves unexecuted selected tests
not-run. Source coordinates use parsed stacks, PDB data or supplied declarations.

## HTTP contribution

`registerNativeTestingServices(registry, {engine, workspace})` returns the adapter,
registers it for disposal and adds the `testing` operations `discover`, `run`,
`start`, `snapshot`, `cancel` and `artifact`. The last three accept `{id}`, with
`after` for replay or `path` for an attachment. Artifact responses contain
`{path, base64}`. Existing authentication, origin checks, transport size limits and
structured errors remain in the generic host/client.

Debug requests set the host's allowed `VSTEST_HOST_DEBUG` variable. Progress records
can expose a PID for debugger handoff; this contribution does not attach a debugger.
Framework packages, coverage collectors and compatible MTP report extensions must
actually exist in the native environment. Their absence remains a native failure,
and a simulator-backed adapter test never counts as framework qualification.
