# Portable PDB reference validation

Implementation draft for #2545; no install, test, check, benchmark or native
process has run in this branch. Ten focused tests are prepared. The source is
based on `0396d28dd2013152e0c14e2a7a2f08f4e27c07d3`.

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
No performance or allocation result is claimed before scheduled measurement.

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
proof and measured control are pending the root's serial validation slot.
