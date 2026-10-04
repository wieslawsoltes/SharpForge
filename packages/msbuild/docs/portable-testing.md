# Portable test sessions

`PortableTestAdapter(options)` provides discovery and run operations for the
explicit managed framework profile. It loads compiler/runtime functionality only
when requested through its existing declaration and preparation dependencies.

```js
import {PortableTestAdapter} from '@sharpforge/msbuild';

const adapter = new PortableTestAdapter({backend: 'cil'});
try {
  const discovery = await adapter.discover([
    {uri: 'Tests.cs', text: 'public class Tests { [Xunit.Fact] public void Pass() { Xunit.Assert.True(true); } }'}
  ], {project: 'Tests.csproj'});
  const result = await adapter.run(discovery, {onEvent: event => console.log(event.kind)});
  console.log(result.results);
} finally { adapter.close(); }
```

`discover(input, options)` returns the complete discovery record. `run(discovery,
options)` owns a fresh managed session and returns the shared session snapshot
with results, diagnostics, cancellation and success. Adapter-level options are
combined with operation options. `onSession({id})` reports the session identity;
`cancel(id)` aborts it, `snapshot(id, after)` replays bounded progress, and `close()`
disposes every retained session and rejects future work. A default maximum of
32 retained sessions evicts a finished session before admitting a new one;
configuration is bounded to 1–1024 and active sessions are never silently evicted.

`runPortableTests(discovery, options)` runs the same lifecycle without retaining
an adapter-level session. The default runtime is `createManagedTestRuntime`;
`createRuntime` can provide another implementation of that documented contract.
Every run disposes its runtime in a finally block. Events include test-started,
test-completed and test-result-updated; outcome is a managed result, never a parsed
console claim. Source positions prefer managed failure sequence points and retain
the original declaration as fallback.

Each run initializes shared fixtures, runs group initialization and test methods,
then performs group and suite cleanup. xUnit test instances are created per case,
NUnit instances are shared per fixture and MSTest initialize/cleanup methods run
at their declared stage. Shared collection fixtures live for the run. Async calls
are awaited. Teardown faults correct previous results rather than retaining false
passes. Unsupported compiled tests remain not-runnable alongside runnable cases.

The timeout defaults to 30,000 ms and accepts 1–3,600,000 ms. Per-test timeout
metadata overrides it. Managed instruction/output limits remain independently
bounded by preparation/session options. Cancellation and fatal budgets end the
isolated session; remaining cases are not-run. Explicit NUnit tests require
`includeExplicit: true`. Success permits only passed/skipped outcomes and no error
diagnostics or cancellation.

The shared fixture corpus pins native framework/adapters and exercises the exact
same C# text in source and direct CIL. Native package acquisition is confined to
the separate opt-in oracle. The single recorded native restore timed out without
packages, so this source/CIL evidence does not establish native framework parity.
The supported assertion and discovery profiles remain documented in the preceding
layers. Custom framework plugins/reflection, arbitrary external assemblies and
Rust native/Wasm invocation are outside this adapter's supported profile.
