# Native WinUI measurement oracle

This manual harness requires exactly 20 authored XAML fixtures and loads them
through the pinned Windows App SDK. Each
fixture attaches to a visible native window in a fixed viewport under en-US and
Light theme. Layout observations come from `LayoutInformation.GetLayoutSlot`,
actual/desired sizes and selected native property getters. `hasLocalValue`
distinguishes explicit Width, Height, IsEnabled and IsTabStop values from native
style/default resolution; it does not label effective style values as raw DP metadata.

Automation roots are the highest native peers beneath the fixture. Their children
come from `AutomationPeer.GetChildren()`. Screen coordinates, runtime IDs and focus
are omitted because they depend on desktop placement or interaction. Empty peer
collections remain empty observations. Tree sizes and depth are bounded.

```sh
node scripts/conformance/oracle/winui-measure/run.js --output NEW_REPORT.json
```

On a supported interactive Windows x64 desktop, the runner reuses the existing
WinUI project, locked App SDK dependencies and pinned .NET infrastructure. It builds
once and launches three fresh serial processes. Exact JSON output must agree;
native errors and unexpected XAML success/failure stop capture. The report retains
all attempts, raw native output, build logs, binary/source/input hashes, actual
runtime/toolchain and source revision. Intentional XAML-negative fixtures record
actual exception type and HRESULT. Non-Windows targets report unsupported.

The corpus includes 18 loaded control/layout/boundary fixtures and two intentional
XAML load errors. Each complete capture contains three observations per fixture;
all three native dumps must agree, including the actual negative error types.

Captures are separate from the existing expected store, never overwrite an existing
report, and are marked not baseline-qualified. Native execution, Windows runner
qualification and expected-baseline adoption are separate from authoring. Existing
workflows are unchanged.
