# Portable PDB reference validation

Qualified #2545 source `9614e374bc96a1d6d4dabba34b394717d315e5b6`, based on
`0396d28dd2013152e0c14e2a7a2f08f4e27c07d3`. The scheduled combined #4397/#4417
batch ran serially under `scripts/limited.js`, concurrency/run limits 1 and
1024 MiB Node heap. No native rebuild was needed.

The preflight visits eight debug-table schemas using CIL's existing schema,
blob-extent and coded-index contracts. Direct table/list columns use declared
local or #Pdb external counts, including legal one-past-end list sentinels.
Unknown CDI kinds are allowed and preserve opaque bytes, including empty
payloads, but their parent row and GUID/blob handles must be valid. The public
reader converts bounded CLI binary errors into SymbolError; programming errors
are not broadly caught. Existing import/constant/sequence/CDI decoders retain
their format-specific checks. String offsets are checked without decoding names
a second time; existing bounded name readers check termination and decoding.

The checker is linear in fixed-schema column count times row count, allocates
no per-row record/index and retains no views. Blob extent checks create only
short-lived borrowed views; payload copying still happens in existing readers.
No measured allocation or peak-memory improvement is claimed.

Prepared mutation coverage includes an invalid MDI document with an empty blob;
all 27 allowed CDI parent-table extents; null/invalid-coded parents; local-scope,
import and state-machine row references; every debug heap column; nested import
handles, assembly/type references; truncated/typed constant signatures; local
signature prefixes; document segments; and the optional #Pdb entry point.
The existing Roslyn EffectiveImports, ScopeTree, UnnamedSlots Release and
LocalConstants corpora are reused as positives without a native rebuild.

Primary format reference: [Portable PDB v1.0 specification](https://github.com/dotnet/runtime/blob/main/docs/design/specs/PortablePdb-Metadata.md).
The completed target is the leaf's cross-row/heap checks and consistent error
boundary, not every PDB semantic rule. Unified parse budgets (#2544), generation
aggregation (#2540), fuzz qualification (#2546), unknown CDI payload semantics
and general external type resolution remain separate. Cross-engine/browser
coverage beyond the concrete engines/host below remains unverified.

## Qualification

- Before-source regression proof: both empty-sequence document and opaque CDI
  parent guards failed with the expected missing-exception assertion. The exact
  reference source passed all 10 new tests, including retained native corpora.
- Combined child `9af3ee4b51f66f12c2743060cf508750cd847b49` passed 106/106 affected
  Node tests. Dependencies were installed once; each variant resolved its own
  symbols source, and shared package trees/manifests were proved byte-identical.
- One shared source-module/import-map browser batch passed all 13 check groups
  on Chromium 153.0.8010.12, Firefox 155.0 and WebKit 26.6, macOS 26.6 arm64,
  Python 3.14.7 / Playwright 1.63.0. This includes all 27 CDI parent extents,
  heap columns and the existing native scope/import/slot contracts. This is
  library-browser qualification, not CLR execution, Windows/Linux, VM or Wasm
  coverage. [Runnable combined harness](https://github.com/wieslawsoltes/SharpForge/blob/9af3ee4b51f66f12c2743060cf508750cd847b49/tests/fixtures/portable-pdb-budgets/browser.py)
  is retained with #4417; its recorded module hash identifies the actual run.
- This source passed syntax/static checks (3407/3403 modules, zero errors),
  manifests (895 Node files/37 browser scripts/30 areas, no missing/duplicate
  assignment), and structure (271 inherited findings, none in owned paths).

The one fixed 20-round three-variant comparison retains all 120 chronological
samples, fixture/revision/dependency hashes and its exact runnable harness in
`qualification/`. This PR's baseline→references parse median/p95 was
0.3510022925/0.377783125 → 0.3585678125/0.38549104 ms (+2.155%/+2.040%);
bound-load median/p95 was 0.63937458/0.69274916 → 0.6602625/0.69683583 ms
(+3.267%/+0.590%). These controls stayed below the 5% review threshold.
The same report also retains the distinct child-budget variant for its review;
its cost is not attributed to this PR. No speedup, significance or host-noise
causality claim is made. Every submitted process, browser and server terminated.
