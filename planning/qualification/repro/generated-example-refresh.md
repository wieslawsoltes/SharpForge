# Generated example prerequisite

The first actual freshness check at `b07a931a29dd2fc23a800282a8a6d14bfd11c5cf`
found ten stale generated files, with no forward/reverse generator differences.
The existing A00 golden lock exactly matched that pre-refresh tree. The existing
generators also exposed a stale generated Studio mirror. This is an intentional
derived-output refresh, not a suppression or baseline exception.

## Changes outside this workstream

The integration owner authorized these exact generated paths. A fresh Project4
claim audit and 77-worktree status check found no active edits to the ten example
paths. The former broad Studio owner explicitly released the narrow generated
mirror; all eleven paths were added to the T09 claim locks.

- `examples/designer/CanvasCounter.zip`
- `examples/designer/CanvasCounter/DesignedView.g.cs`
- `examples/designer/GridWorkspace.zip`
- `examples/designer/GridWorkspace/DesignedView.g.cs`
- `examples/managed/Finally.exe`
- `examples/managed/Finally.sf.il`
- `examples/managed/Hello.exe`
- `examples/managed/Hello.sf.il`
- `examples/managed/UsingResources.exe`
- `examples/managed/UsingResources.sf.il`
- `apps/studio/samples-designer.js`

Regeneration uses `node scripts/build-managed-examples.js` and
`node scripts/build-designer-examples.js`. No generator, compiler, VM or handwritten
example source was changed. The reviewed derived contract
`planning/contracts/golden-output.lock.json` is refreshed for these same changes;
ABI and diagnostic IDs are untouched.

## Meaning of the changes

Hello and Finally have byte-identical textual IL after excluding the `.image`
PE envelope. The current compiler writes its debug directory and deterministic
PDB reference, increasing each image by 512 bytes. UsingResources also removes
four `nop` instructions in generated `finally` handlers and adjusts the
corresponding branch offsets and exception-region boundaries.

Actual old/new execution in the JavaScript CIL VM has identical output, exit code
zero, terminated state and no fault for all three programs. The committed
regressions check current EXE/IL round trips and the expected acquisition/disposal
order. A native CLR comparison, when captured, is separate evidence and is never
inferred from these VM tests.

Both designer examples now emit the existing generator's explicit
`Style("Microsoft.UI.Xaml.Controls.Button")` instead of its old parameterless
construction, plus the current generated-file provenance comment. The generated
ZIPs and Studio mirror contain the same source. Regression probes execute both
source and CIL VMs, check the style's exact target name, FontSize 15 and blue
channel 184, and verify that applying this style to a TextBox is rejected.

Before-refresh evidence and original binaries are retained under
`artifacts/repro-examples-before/`: freshness report, offline rebuild report,
old/new execution comparison, and all ten original payloads. Final committed
freshness and double-build reports are recorded under `artifacts/results/repro/`.
The freshness checker includes the three generated Studio sample modules as well
as `examples/`, so a future stale mirror cannot remain hidden in a temporary tree.
