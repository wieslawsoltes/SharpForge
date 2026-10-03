# Versioned gap inventory (SF-A29-T03)

This inventory fixes the denominator before measuring parity. Reference API members,
language features, CLI opcodes/tables, protocol methods/capabilities and explicit
product workflows have independent identities. The scope includes all 30 areas;
it is not an exhaustive claim about every Visual Studio SKU or extension.

Run the complete example after installing the exact SDK in `../oracle-toolchain.json`:

```sh
npm ci --ignore-scripts --no-audit --no-fund
dotnet restore tests/conformance/oracle/WinUI/Oracle.WinUI.csproj --locked-mode -p:EnableWindowsTargeting=true
node scripts/conformance/inventory/generate.js --check
node --test tests/conformance/inventory/*.test.js tests/conformance/inventory/*.native.js
node scripts/conformance/inventory/benchmark.js
npm run build
python tests/conformance/inventory/browser_probe.py
```

Use `--update` explicitly to regenerate checked-in snapshots when inputs change.
Review the input hashes, row statuses, denominator changes, gap ledger and issue
proposals together. Normal qualification writes only ignored `artifacts/results`.
No restore of modified tracked files hides an output-generation failure.

The native metadata reader is original C# compiled twice by the pinned Roslyn and
executed twice by actual CoreCLR. It reads all 167 .NET 10.0.5 reference DLLs and
all WinMD files in the locked Windows App SDK WinUI package, using raw metadata
without WinRT projection. Reference-file SHA256s, compiler/runtime versions and
extractor hashes accompany each inventory. Reading WinMD on another OS qualifies
metadata extraction, not WinUI execution; the separate WinUI oracle requires Windows.

The API denominator contains every public type, public declared method (including
accessors), public field, property and event. Inherited members are counted at
their declaring type, not duplicated on descendants. Protected-only members and
ExportedType forwarding records are outside this public-declaration denominator.
Assembly identity, overload parameters, staticness, generic arity and return types
form method identity; a closed generic specialization cannot qualify an open
generic API. Signature registration says nothing about behavioral parity.

The language history is pinned at a csharplang commit. Every entry has a source
fixture first checked by actual pinned Roslyn and then compiled by SharpForge,
plus malformed-source and previous-major-version
observations. Minor language versions rejected by SharpForge remain visible gaps.
The history includes tooling/publication entries; their declaration probes are
explicitly limited and do not establish generator hosting, NoPIA or reference
assembly emission. Compile acceptance never qualifies lowering or execution.
C# 15 is a frozen preview proposal inventory, not a released language guarantee.
The pinned released SDK does not accept those five proposals; their reference
validity and inventory status remain unknown, while SharpForge diagnostics are
retained. Invalid non-preview reference probes fail generation.

ECMA-335 VI's informative opcode.def omits six instructions specified by normative
Partition III. The extracted reference includes these additions and excludes unused
and reserved opcode prefixes. Every opcode reports encoding separately from actual
compiler emission, canonical loader acceptance, successful interpreted paths and
the constrained stack-height verifier. Unobserved stages are unknown; operations
explicitly rejected by the execution profile are unsupported. No CLI type-verifier
parity is inferred. Reserved metadata tables retain rows with explicit reasons.

The Roslyn ErrorCode enum supplies the complete pinned diagnostic-ID denominator;
source-literal matches are only ID-presence inventory. Enum aliases share an ID.
LSP 3.17 and the pinned DAP schema supply methods and negotiation fields. Fresh
handler probes distinguish accepted dispatch, recognized invalid requests and
unimplemented methods. Outbound LSP methods are marked not-applicable to inbound
server dispatch, with the client obligation still unqualified. Capability
advertisements do not prove behavior. VS workflow checklist rows remain unknown
until their owning leaf supplies exact evidence.

Runtime/GC fixtures exercise both JS VMs independently, including collection,
finalization, weak references, modes, threading, cancellation, disposal, reflection,
integer boundaries and arrays. All outcomes are retained, including compiler gaps
and incorrect execution. Browser jobs run the same fixtures in actual Chromium
under production CSP. Node and browser results have separate target records. The denominator includes
Chromium, Firefox and WebKit independently. Only an actual engine-specific capture
can supply evidence; Firefox/WebKit remain unknown until that capture exists.
`SHARPFORGE_BROWSER_ENGINE` selects the shared launcher's engine. The probe checks
the actual Playwright browser type, so an older Chromium-only launcher cannot
mislabel its output. T06 can run this same command on its browser matrix:
`python tests/conformance/inventory/browser_probe.py`.

DAP request/capability obligations include both source and CIL VM backends. Current
handler observations identify their source-VM context explicitly; CIL debugger
behavior remains unknown until separately observed.
Rust managed execution remains unknown; the inventory never substitutes a schema
reader or JavaScript simulation for a Rust VM. Other hosts remain unknown until
an independent artifact exists. The benchmark reports first/cold and 30 warm
compile/execute samples, median, p95/p99 and managed allocation counters. Its
correctness assertions must pass before any timing result is emitted; JS/native
allocation cost is outside that counter.

`gap-ids.json` is append-only identity history. Removing a reference row adds a
tombstone; reintroducing it restores the same ID. A new signature gets a new ID.
`issue-candidates.json` proposes synchronization records keyed by gap ID; it does
not open issues, change ownership or imply that existing issues are complete.
Every row, including currently implemented signatures, retains its gap ID.

`obligations.json` implements the shared rollup input:
`id`, `leafId`, `area`, `platforms`, `engines`, `specRevisions`. Its denominator is
every row × platform × engine × revision. The owner routing is an explicit initial
triage policy in `denominator.js`; new concrete gaps can be split to new planning
leaves by the planning owner without changing capability IDs. The owned
`revisions-additions.json` is the A00 integration request for pinned protocol,
compiler and product-checklist revisions. Inventory status is deliberately not
exported as passing evidence. The shared evidence verifier additionally requires
exact obligation proof, artifact digest, commit ancestry and a closed leaf.

Reference URLs, immutable commits, file hashes and licenses are in
`references/manifest.json`. Reports record exact repository commit, dirty state,
input digest, toolchain and commands. The input digest includes every workspace
package source/manifest, the package lock, oracle runner, probes and planning owner
snapshot. `outputs.json` seals all generated catalogs, observations, gap identities
and issue proposals. `--check` verifies those exact baseline bytes, then compares
every regenerated output on the baseline platform. Independent platforms verify
the sealed baseline and shared structure while retaining their own observations;
they do not relabel another platform's results. Native diagnostics retain their
complete text and are sorted because Roslyn can reorder independent warnings.

Only manual dispatch launches the native/browser inventory workflow. Its six cells
run serially across job families and matrices. Core-only PR/main or central full-ci
checks do not claim this specialized qualification. See [the schedule](../serial-validation.md).

The inherited planning snapshot contains duplicate work IDs `SF-A01-T28` and
`SF-A02-T18`. The shared rollup correctly refuses that snapshot; this inventory does
not silently rename active ownership records or manufacture a passing rollup.
The planning owner must reconcile those identities before full rollup integration.

A successful inventory job means the complete
catalog was processed; missing, unknown and unsupported capabilities remain gaps.

The workflow actions use the reviewed SHA pins from the A29 supply policy.
The recorded catalogs and seals remain evidence for their original source inputs.
In particular, the capture at `b8b2eab7203317b42b7fc92976d5d582c18b3c62`
does not qualify compiler/runtime changes merged afterward. Integration must retain
the stale-input failure until a complete native capture and status review can be
performed; changing input digests alone would not establish new observations.
Workflow readiness changes have not run local tests, builds or new native/browser
captures. Qualification is deferred to the larger integrated scope.
