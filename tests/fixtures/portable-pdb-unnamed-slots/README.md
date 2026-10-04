# Unnamed and optimized local slots

`symbols.localSlots(methodToken)` reports declared CLI storage and exact PDB
names. An unnamed slot has its actual index/type, `name: null`, `unnamed: true`
and no declarations. A reused slot preserves every declaration without choosing
a synthetic name. Missing/unbound/non-CIL method metadata is explicit. Runtime
values, optimized-away source variables and invented lexical scopes are unsupported.

The PE method header is authoritative. A nonzero PDB local-signature reference
that disagrees with that header, or accompanies a missing CIL body, rejects.
The coordinated CIL `readMethodHeader` API returns owned scalars; its shared
private parser lets the full body reader reuse the Reader without exposing it.

## Reference and focused validation

Product and final qualification revision:
`54c856db3a1b569ce177c3ad4b8af8f39e3f4398`.
The Release/Optimize=true capture passed for two methods using SDK 10.0.201,
Roslyn 5.3.0-2.26153.122 and CoreCLR 10.0.5. `MethodBody.LocalVariables` supplies
slot indices/types; SRM supplies exact names, flags and scope ranges. `Sum` has
two unnamed slots; `Gone` has zero slots, so its eliminated local is not restored.
Source/compiler/DLL/PDB hashes are in [reference.json](reference.json).
Existing Debug/import/annotation/constant native corpora were reused without rebuilding.

- New focused tests: **9/9**; affected contracts: **116/116**.
- After private Reader reuse, header/body/scope tests: **55/55**.
- Static checks: **3,313 syntax / 3,309 static modules**, zero errors; area
  manifests: **860 Node files / 36 browser scripts / 30 areas**, no duplicates
  or unassigned entries.
- Structure check exited 0: 271 existing findings, none in changed files.

All jobs ran serially with both concurrency limits 1 and V8 heap 1024 MiB.
The full suite, Studio build and epic matrix were not run. Exact terminal logs,
including all failed attempts, are retained in [qualification/validation.txt](qualification/validation.txt).
The authored regression first needed two fixture repairs (empty scope array,
then missing PDB document). Against pre-guard symbols `65516e98`, its valid
in-range header/PDB mismatch then failed with `Missing expected exception` as
intended. A hidden point in the no-body case invoked older body validation too
early; a signature-only blob with valid Document1 isolated the new guard.
These were fixture corrections; no assertion was weakened. The old product
used current CIL, whose header implementation was identical at that stage.

```sh
node scripts/limited.js node scripts/validate-pdb-unnamed-slots.mjs --capture tests/fixtures/portable-pdb-unnamed-slots
node scripts/limited.js node --test --test-concurrency=1 tests/a13-04-unnamed-slots.test.js
```

## Shared browser qualification and acceptance audit

The final batch passed **8 grouped checks in each of Chromium 153.0.8010.12,
Firefox 155.0 and WebKit 26.6**, using Playwright 1.63.0 / Python 3.14.7 on
**macOS 26.6 arm64**. It imports public source modules over localhost with CSP,
reuses retained native fixtures, and checks exact type AST ownership, invalid
inputs, annotations, bounds and cancellation. It does not execute the source
VM, direct CIL runtime, Rust native/Wasm, or the Studio UI; these metadata APIs
do not add an execution backend. Windows/Linux browser or runtime results are
not claimed. Broader OS/epic qualification remains separate.

The retained [runner](qualification/browser-scope.py) takes repository root and
output-directory arguments and loads its sibling [module](qualification/browser-scope.mjs).
It closes each browser before the next and shuts down its server in `finally`.
[All attempt reports](qualification/browser-results.json) retain exact product
revisions, module hashes and per-engine failures. The first harness comparison
mistakenly depended on JSON property order; the next passed Chromium/Firefox
but found the pinned WebKit absent. Only missing WebKit2359 was installed, then
the final corrected-product batch passed all three. No failed cell was omitted.

```sh
node scripts/limited.js python3 tests/fixtures/portable-pdb-unnamed-slots/qualification/browser-scope.py "$PWD" /tmp/a13-scope-results
```

The following own-leaf criteria are now demonstrated, subject to this PR's merge
and required main checkpoint; broader general constants and runtime values stay open.

| Issue | Deliverable evidence | Boundary/ownership evidence |
| --- | --- | --- |
| #2536 | Merged #4029; native nested-namespace imports preserve source order and resolve declared names; browser compares all native entries. | Existing seven focused tests, malformed handles/limits and owned import snapshot; three browser hosts. |
| #2537 | Merged #4119; native SRM scope tree/local types, hidden compilerGenerated declarations; browser compares native roots. | Eight focused contracts, scope geometry/RID/name bounds and owned type AST; three browser hosts. |
| #2538 | Merged #4211; dynamic and named tuple locals/constants join retained Roslyn CDI using authored binding fixtures; browser checks exact displays. | Ten annotation/formatter contracts, budgets, unsupported identities and fresh returned arrays; three browser hosts. |
| #2539 | Release CLR/SRM slots preserve null unnamed identifiers and exact declarations; no restored eliminated variable. | Nine new contracts, raw header/signature checks, ownership, bounds/cancellation; three browser hosts. |

## Fixed performance controls

Both complete **80-sample** schedules are retained with full revisions,
chronological samples, fixture/harness hashes and identical control outputs:
[initial](qualification/performance-initial.json), [final](qualification/performance-final.json).
The [exact harness](qualification/benchmark.mjs.txt) takes baseline root, current
root and revision-JSON arguments. Baseline symbols and CIL are archived at
`1e1f86a1de13f90d068e35f3882a1564f3d4ff5b`, using their own package links;
unchanged transitive archive/bytecode/framework dependencies use the current workspace.

Shared host: Apple M3 Pro arm64, Node v24.21.0. Each control uses 20 alternating
AB/BA pairs and GC before each sample. Load: 30 warmups, 100 loads/sample;
25-method body batch: 1,000 warmups, 1,000 batches/sample. Median is mean of
positions 10/11, p95 nearest-rank position 19. Units are milliseconds per load
or per 25-method batch. No query-throughput or allocation measurement is claimed.

| Schedule / control | Before median | After median | Before p95 | After p95 |
| --- | ---: | ---: | ---: | ---: |
| Initial load, `8970944e` | 0.566888125 | 0.610665215 | 0.611080840 | 0.652918750 |
| Initial body batch | 0.0062258335 | 0.0077497915 | 0.008821042 | 0.011525042 |
| Final load, `54c856db` | 0.607936665 | 0.658024580 | 0.666695840 | 0.716507920 |
| Final body batch | 0.0066833125 | 0.0076955210 | 0.009345584 | 0.011313458 |

The first schedule triggered a concrete review: reuse the private parser's
Reader instead of constructing a second Reader in `readMethodBody`. The second
fixed schedule followed that product change; there was no repeat tuning or
sample exclusion. **Root reviewer explicitly accepted final load +8.239%
median (+0.050087915 ms), +7.471% p95 (+0.049812080 ms)** for PE-authoritative
owned facts across all declared slots, and **body batch +15.145% median
(+0.0010122085 ms), +21.057% p95 (+0.001967874 ms)** for shared checked header
facts, raw-token/RVA/code-extent validation and the owned public header API.
The avoidable second Reader is removed; the remaining scalar record/helper
tradeoff is accepted. Both first results remain reported. No speedup, causal
noise attribution, statistical significance or measured peak allocation claim.
