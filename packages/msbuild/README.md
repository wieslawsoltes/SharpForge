# @sharpforge/msbuild

[Portable test declaration records](docs/test-symbols.md) expose a lazy lossless
syntax frontend for framework adapters without executing user source.

Browser-safe MSBuild contracts/client and a separately imported Node native backend. MIT, ES modules, Node 22+ for native APIs. The native engine invokes an installed SDK or MSBuild executable; .NET is not bundled.

```js
// Browser-safe imports: no fs/process/child_process dependency.
import { MSBuildClient, normalizeBuildRequest, inspectSlnx } from '@sharpforge/msbuild';
// Node-only backend:
import { NativeWorkspace, NativeMSBuild, startMSBuildHost } from '@sharpforge/msbuild/node';
```

```sh
sharpforge-msbuild serve --root /path/to/workspace --studio /path/to/browser-dist --trust-projects
sharpforge-msbuild build App/App.csproj --root /path/to/workspace --trust-projects --restore
sharpforge-msbuild evaluate App/App.csproj --root /path/to/workspace --trust-projects --json
```

Open the host's printed token URL. Native calls require both host permission and per-request `trusted:true`. Do not enable this for untrusted project inputs. Property functions, SDKs, imports, tasks, packages and analyzers can execute with your OS permissions; this is **not a sandbox**. API file boundaries do not restrict native task execution. Never expose the loopback service publicly.

The adapter provides build/rebuild/clean/restore/pack/publish/VSTest/custom target jobs; authoritative property/item queries, target results/preprocessing/listing; cursor-based logs/diagnostics, cancellation/timeouts/output limits; hash-checked text saves, existing encoding preservation and bounded artifact discovery. `.slnx` structure inspection is data-only, not an evaluator.

`MSBuildClient.fromLocation()` consumes and clears a session token fragment. Client URLs must use the same origin as the served IDE. The host does not enable cross-origin access. A standalone installed package needs `--studio` pointing to the separately delivered browser distribution.

The 0.7 source distribution includes `docs/msbuild.md` for the complete startup/API/trust/limits contract, four example groups and a separate real-SDK validation gate. Node transport tests use an explicit child-process simulator, not Microsoft MSBuild. Native SDK execution was not qualified in the release container because no SDK was installed.

A default job times out after 30 minutes; default captured output is 32 MiB and retained records are 32. Logs are retained on disk in `.sharpforge/msbuild/` and require owner cleanup after stopping the host. Native tasks can consume resources beyond these adapter limits.

## 0.8 disk explorer API

`MSBuildClient.inspectItem`, `mutate` and `undoMutation` use the authenticated host's file-operation routes. The Node `NativeWorkspace` exposes the same bounded create/mkdir/move/copy/delete/write machinery with SHA-256 snapshots and quarantined undo. Binary reads support managed assembly inspection without source replacement. Read docs/explorer-keymaps.md before embedding: batches are not atomic, conflicts/partial completions are reported, undo receipts are in-memory and quarantined content is not automatically purged. File editing is distinct from native build trust.

[Managed test preparation](docs/test-runtime.md) compiles prepared declarations into
an isolated source or CIL session and retains explicit unsupported-test diagnostics.

## Shared test records and run sessions

The public package entry exports `createTestCase`, `testCaseId`, `createTestResult`,
`TestOutcome`, `TEST_MODEL_VERSION`, `createTestTree`, `defineTestAdapter` and
`TestRunSession`. Providers share stable discovery identity, explicit results and
cancellable progress while retaining separate execution capabilities. See
[the test protocol](docs/test-model.md) for fields, bounds, ownership and lifecycle.

[Portable framework discovery](docs/test-discovery.md) describes the xUnit, NUnit
and MSTest adapter registry, data evaluation controls and explicit boundaries.

[Portable test sessions](docs/portable-testing.md) execute the managed framework
profile with isolated fixtures, cancellation, explicit outcomes and replayable progress.
