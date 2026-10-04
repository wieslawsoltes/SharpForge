# Source emitter exception regions

The portable source-image emitter builds a lexical region tree before emitting
catch/finally bodies. It reuses the CIL clause geometry and nesting rules through
an internal source-PC boundary adapter, then emits clauses from deepest to
shallowest region. Catch clauses for the same try retain source priority. This
fixes outer finally clauses being recorded before nested clauses in their handler.

Catch ends retain the established source exit-jump convention (or an explicit
handlerEnd boundary); finally ends use the producer's explicit handlerEnd. The
protected range includes the source exit instruction. Byte offsets still come
from the emitter's existing span and handler-prefix maps, preserving debug and
canonical replay boundaries. The existing method-body writer encodes the result.
Source handler objects and arrays are not modified.

Shared try regions are coalesced, partial overlaps and invalid nesting fail with
the existing CILR diagnostics, and unsupported source handler shapes fail with
CILEM0001. This adapter caps methods at one million source instructions, clauses
at 100,000 and nesting depth at 1,024, matching the existing bounded services.
It is internal and does not add a package export.

Construction is O(H log H) in handler count and O(H) extra storage. Handler-entry
lookup is O(1); membership and leave selection use the existing binary-search
region index, O(log H), with no per-branch zone arrays. No-handler methods reuse
an immutable empty layout. Default-path and nested emission timings are prepared
for the scheduled validation slot, not claimed before capture.

This is a partial #2396 increment. Four C# source cases cover try-in-finally,
finally-in-catch, three-level nesting and nested rethrow, with source VM, canonical
CIL reload, ILVerify and CoreCLR checks prepared. Unit cases cover catch priority,
all source/target point pairs, malformed geometry, bounds and unchanged input.
Validation is pending; see the [reference plan](../../tests/fixtures/a03-emitter-regions/README.md).

The source-bytecode producer does not represent catch-when filters. That path
remains outside this increment; the separate A02 bound-CIL producer already emits
filters and is unchanged. Arbitrary source IR shapes and typed catch expansion
are not claimed. Browser, Rust and wider platform qualification remain staged.
