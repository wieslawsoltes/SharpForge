# Exception section encoding

`writeMethodBody(code, localToken, maxStack, handlers, options)` writes the existing
fat method header and exception clauses. The default exception encoding remains
fat, preserving canonical source-VM replay and existing compiler output.

Pass `exceptionFormat: 'auto'` to use small sections when their offsets, lengths
and clause count fit; otherwise that section uses fat encoding. `exceptionFormat:
'small'` requires every section to fit, with CILEH0003 on overflow. Small clauses
use UInt16 offsets and byte lengths, at most 20 clauses per section. The default
keeps all clauses in one section. `clausesPerSection` explicitly partitions them,
preserving order and emitting MoreSects on every section except the last. Up to
32 sections are supported, matching the existing reader limit.

Each handler uses half-open `start`/`end` and `target`/`handlerEnd` IL byte ranges.
Flags 0, 1, 2 and 4 represent catch, filter, finally and fault. Catch requires a
nonzero TypeDef/TypeRef/TypeSpec token in `catchType`. Filter uses `filterOffset`,
which must precede the handler; the existing `catchType` union slot remains a
compatible alternative. Supplying both requires agreement. Finally/fault require
a zero or omitted payload. Invalid flags, tokens, empty/reversed/out-of-body
ranges, maxStack or local signature tokens produce CILEH0001.

The method body is capped at 64 MiB, and clauses at 100,000 by default (configurable
with `maxClauses` up to 1,000,000). Section/count/size limits produce CILEH0002.
`signal` is checked before work, for each validation/write clause and at completion
(CILEH0004). All clauses are preflighted before the output buffer is allocated.
Encoding is O(code bytes + clauses), with at most 32 planning records and no
per-clause copies. The returned bytes are owned. The encoded size is calculated
before allocating the writer, avoiding geometric output-buffer growth.

This is binary encoding, not exception-graph verification: instruction boundaries,
region nesting, accessibility and transfer rules remain under #2395–#2398. The
source VM still rejects filter/fault execution; the inspection reader supports all
four clause kinds. No high-level emitter behavior is changed.

The focused fixture hand-emits filter and nested fault/catch methods for native
CoreCLR execution and independent System.Reflection.Metadata inspection. Run the
capture serially with `DOTNET_PATH=/path/to/dotnet node scripts/limited.js node
packages/cil/tools/validate-eh-encoding.mjs tests/fixtures/eh-encoding`, then the
focused `tests/a03-06-eh-encoding.test.js` and CIL compatibility tests. Native and
focused validation are pending; cross-platform/ILVerify qualification remains open.
