# Test providers and evaluation qualification

The browser-safe `@sharpforge/msbuild` entry point exposes a shared test model,
native report parsers, and portable source discovery. The Node-only
`@sharpforge/msbuild/node` entry point exposes `NativeTestAdapter` and its host
service registration. Compiler, syntax, and runtime packages load lazily when
portable discovery or execution needs them.

## Shared records

`createTestCase({project, fqn, displayName, traits, source, ...metadata})` creates a
versioned record. IDs are deterministic across providers from the project path,
method FQN, and data-row identity. `rowKey` disambiguates parameterized fixture
instances. Keep a project path relative to the same workspace on both providers.
`createTestResult(test, result)` requires an explicit outcome: `passed`, `failed`,
`skipped`, `not-run`, `not-runnable`, `cancelled`, or `timed-out`. Durations use
milliseconds. `createTestTree` groups projects, classes, and tests without
quadratic parent searches.

The adapter contract has `discover`, `run`, `cancel`, and `close`. Providers own
their sessions and do not share global heaps, processes, or cancellation state.
`TestRunSession` retains a bounded progress stream and reports when a replay
cursor has fallen behind retained events.

## Native provider

```js
import {NativeWorkspace, NativeMSBuild, NativeTestAdapter} from '@sharpforge/msbuild/node';

const workspace = await NativeWorkspace.open('/absolute/workspace');
const host = new NativeMSBuild(workspace, {trusted: true});
const adapter = new NativeTestAdapter({host, workspace});
const discovery = await adapter.discover({project: 'Tests/Tests.csproj', trusted: true});
const {id} = await adapter.start({project: 'Tests/Tests.csproj', trusted: true, tests: discovery.tests});
const progress = adapter.snapshot(id);
// adapter.cancel(id) aborts the existing native process-tree runner.
await adapter.close();
await host.close();
```

The host and each request must grant native workspace trust. Test projects can
execute arbitrary native code, just like native builds. The adapter reuses the
host scheduler, environment policy, process-tree cancellation, output limits, and
timeouts. Reports live under the workspace's secured job directory. Artifact
enumeration skips symbolic links and enforces directory/count/size bounds.

`runner` is `vstest` by default. `mtp` selects the .NET 10 MTP command shape;
`mtp-bridge` forwards application options through the VSTest MSBuild bridge.
VSTest selected tests use escaped `FullyQualifiedName` filters. MTP selection
requires native UIDs, supported by MTP 1.8 or later. TRX and coverage switches
require their registered native extensions. Missing extensions remain host
failures. They do not produce synthesized passing results.

Native human-readable `--list-tests` output does not reliably include source
locations, traits, or complete method names in every framework. Supply independent
portable `sourceTests` in the adapter options to enrich matching native names.
Structured discovery events can include those fields directly. Metadata origin
is recorded in each test. Native names and portable names must still match for
the parity harness to succeed; enrichment never invents undiscovered tests.

TRX is authoritative for outcomes, duration, messages, stack traces, stdout,
stderr, and attachment metadata. Console pass/fail lines are provisional progress
only. `mapTestSource` uses failure stack locations, supplied Portable PDB sequence
points, then source declarations. Cobertura parsing reports per-file covered and
uncovered lines and branch totals; paths outside the workspace produce an
explicit diagnostic. `VSTEST_HOST_DEBUG` output yields a debugger PID handoff.

The default service contribution registers `testing/discover`, `testing/run`,
`testing/start`, `testing/snapshot`, `testing/cancel`, and `testing/artifact`. Nonblocking `start`
returns a session ID; polling `snapshot` includes the final result when ready.
Closing the host disposes registered adapters and awaits active operations.

## Portable provider

```js
import {PortableTestAdapter} from '@sharpforge/msbuild';

const adapter = new PortableTestAdapter({backend: 'cil'});
const discovery = await adapter.discover([
  {uri: 'Tests.cs', text: 'public class Tests { [Xunit.Fact] public void Pass() { Xunit.Assert.True(true); } }'}
], {project: 'Tests.csproj'});
const result = await adapter.run(discovery);
adapter.close();
```

Discovery consumes compiler-owned syntax trees or source records. Callers with
semantic information can provide `resolveAttributeType` and `resolveConstant`.
The framework registry is explicit and can register another discoverer without
changing central framework branches.

| Profile | Discovery and lifecycle |
| --- | --- |
| xUnit | Fact/Theory, InlineData, MemberData, ClassData, Skip/Trait, collection and class fixtures, per-test instances, IDisposable/IAsyncLifetime |
| NUnit | Test/TestCase/TestCaseSource, TestFixture arguments, Category/Ignore/Explicit, setup/teardown and one-time fixture lifecycle |
| MSTest | TestClass/TestMethod/DataTestMethod, DataRow/DynamicData, TestCategory/Ignore/Timeout, initialization/cleanup and class lifecycle |

Constant data rows are read without execution. Computed public static member data
and enumerable class data execute in a fresh bounded managed session. Set
`evaluateData: false` for inspection without computed data evaluation, or supply a
`resolveData` implementation. Unresolved or unsupported providers create a
not-runnable test with the reason instead of silently disappearing.

Execution compiles an in-memory harness that invokes the original managed methods.
Attribute spans are blanked in that copy; original files and source offsets remain
unchanged. Framework assertion implementations are ordinary managed code in the
explicitly listed `portableAssertionCapabilities` profile. Unknown APIs remain
compiler errors or runtime not-runnable outcomes. They are never substituted with
successful no-ops. Compilation can exclude separately diagnosed invalid test
methods and retain valid neighboring tests.

Each run owns a `ManagedInvocationSession`. It preserves fixture state within
that run and isolates state between runs. Source and direct CIL are supported;
the CIL path verifies each newly invoked reachable method before execution.
Asynchronous faults are awaited and reported. Cancellation and fatal execution
budgets end that session, with remaining tests not-run. Explicit NUnit tests run
only when `includeExplicit` is true. Fixture cleanup failures correct earlier
results and emit `test-result-updated` events.

This is a documented managed profile, not the complete native framework runtime.

After data discovery, pure constant iterator classes referenced only by attributes
are omitted from generated execution sources, with their original offsets and
line breaks preserved. A provider used by executable code, declaring fields or a
constructor, or lacking reference-span evidence stays in the source. Computed
providers run in an isolated managed session. This avoids compiling unused
discovery-only iterator interfaces while preserving referenced user code.
Native plugin discovery, arbitrary framework reflection, external assemblies,
custom assertion extensions, inaccessible lifecycle methods, and unimplemented
framework APIs require native execution. The compiler/runtime diagnostics are
retained. Rust native/Wasm invocation is not implemented by this adapter. Browser
VM behavior requires separate actual-browser qualification; passing Node source
or CIL tests does not qualify a browser.

## Reproducible native qualification

After implementing a complete scope, run the focused `tests/a23-*.test.js` files
and `tests/project-edits-roundtrip.test.js` as one batch. Native commands are
separate, opt-in qualification and never run during normal offline unit tests:

```sh
SHARPFORGE_DOTNET=/path/to/dotnet SHARPFORGE_SDK=10.0.201 \
  node tests/msbuild-differential/run.mjs --output /tmp/evaluation-report.json
SHARPFORGE_DOTNET=/path/to/dotnet SHARPFORGE_SDK=10.0.201 \
  node tests/msbuild-differential/solutions.mjs --output /tmp/solution-mapping-report.json
SHARPFORGE_DOTNET=/path/to/dotnet SHARPFORGE_SDK=10.0.201 \
  node tests/msbuild-differential/frameworks.mjs --output /tmp/test-parity-report.json
```

The evaluation corpus compares selected properties and ordered items against
actual `dotnet msbuild -getProperty/-getItem` output. Every divergence identifies
the feature and property or item. Supported differences fail. Approximated
differences stay visible. Native-only cases must produce their declared blocking
diagnostic. The machine-readable boundary lives in
`packages/project-system/src/evaluation/boundary.json`.

The framework corpus pins Microsoft.NET.Test.Sdk, xUnit, NUnit, MSTest, adapters,
and coverlet versions in `tests/msbuild-differential/framework-fixtures.js`. It
compares native names and TRX outcomes with both managed execution engines. It
requires real package restore access. Reports record native tool versions,
platform, Node version, failures, and unexecuted native cases; unavailable SDKs or
packages never count as a passing native comparison.

The solution corpus builds real `.slnx` and written classic `.sln` fixtures through
the native host, comparing observed per-project globals and build participation
with the parsed model. Small package-free MSBuild targets make platform mapping
observable without requiring an installed C++ toolchain. Builds use one worker
and skip restore. This qualifies solution scheduling and serialization, not
native compilation of every supported language.

If an earlier controlled package restore is already unavailable, set
`SHARPFORGE_NATIVE_TESTS_UNAVAILABLE` to the observed reason to execute only the
portable sides of the exact framework fixtures. The resulting report retains
`nativeExecuted: false` and an unsuccessful native qualification status; this
option cannot turn missing reference results into a pass.

Reference behavior: [VSTest CLI](https://learn.microsoft.com/dotnet/core/tools/dotnet-test-vstest),
[MTP CLI](https://learn.microsoft.com/dotnet/core/tools/dotnet-test-mtp),
[MTP options](https://learn.microsoft.com/dotnet/core/testing/microsoft-testing-platform-cli-options),
[xUnit display names](https://github.com/xunit/xunit/blob/main/src/xunit.v3.common/Extensions/ReflectionExtensions.cs),
[NUnit test names](https://github.com/nunit/nunit/blob/master/src/NUnitFramework/framework/Internal/TestNameGenerator.cs),
and [MSTest data display](https://github.com/microsoft/testfx/blob/main/src/TestFramework/TestFramework/Internal/TestDataSourceUtilities.cs).
