# Debugger stack provenance

Both `DebugSession.stackTrace(threadId)` and `CilDebugSession.stackTrace(threadId)`
retain their existing frame ordering, source positions and execution addresses.
The optional thread identifier selects the same scheduler thread as before.

For a verified project graph, source-backed frames additionally expose:

| Field | Meaning |
| --- | --- |
| `assemblyKey` | Full identity of the original owning assembly |
| `originalMethodToken` | MethodDef token valid only inside that assembly |
| `originalUri` | Original source URI before graph collision qualification |
| `project` | Supplied project provenance, when present |
| `contextId` | Supplied evaluated project context, when present |

The existing direct CIL `methodToken` remains a token in the logical execution
view. Source frames retain their original source-to-CIL offsets; synthesized
adapters have no original physical method token. A qualified executable source URI
is never replaced by an ambiguous unqualified name.

Ordinary source images may omit optional IL inspection maps or supply partial
maps. Their frames remain usable and report absent method tokens/offsets as null.
No graph provenance is fabricated for single-module source images.

Frame projection is a focused shared helper. The legacy debugger entries shrink;
VM instruction dispatch, stepping and scheduler behavior remain unchanged. Three
existing source/direct CIL cases cover same-path documents, original MethodDef
resolution and partial optional maps in the completed joint runtime scopes.
