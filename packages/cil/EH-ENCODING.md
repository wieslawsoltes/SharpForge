# Exception section encoding

`writeMethodBody(code, localToken, maxStack, handlers, options)` writes the existing
fat method header and exception clauses. The default exception encoding remains
fat, preserving canonical source-VM replay and existing compiler output.

Pass `exceptionFormat: 'auto'` to use a small section when offsets, lengths and
clause count fit; otherwise it uses fat encoding. `exceptionFormat: 'small'`
requires every clause to fit, with CILEH0003 on overflow. Small clauses use UInt16
offsets and byte lengths, at most 20 clauses in the section. All clauses stay in
one section. Requesting `clausesPerSection` produces CILEH0005: native validation
showed that SRM and CoreCLR 10.0.5 consume only the first of two EH sections. The
negative capture preserves that failure; emitting chained sections is deferred.

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
Encoding is O(code bytes + clauses), with one planning record and no
per-clause copies. The returned bytes are owned. The encoded size is calculated
before allocating the writer, avoiding geometric output-buffer growth.

This is binary encoding, not exception-graph verification: instruction boundaries,
region nesting, accessibility and transfer rules remain under #2395–#2398. The
source VM still rejects filter/fault execution; the inspection reader supports all
four clause kinds. No high-level emitter behavior is changed.

The focused fixture hand-emits filter and nested fault/catch methods for native
CoreCLR execution and independent System.Reflection.Metadata inspection. Five
single-section cases return the expected values. A sixth test-only image splits
the small section into two: SRM sees only the fault clause, and execution throws
NullReferenceException because the catch in the second section is ignored. That
image is built outside the product writer and is an explicit unsupported case.
The initial capture's all-six-success expectation was incorrect and replaced by
this retained negative evidence, not a native success claim. Run the
capture serially with `DOTNET_PATH=/path/to/dotnet node scripts/limited.js node
packages/cil/tools/validate-eh-encoding.mjs tests/fixtures/eh-encoding`, then the
focused `tests/a03-06-eh-encoding.test.js` and CIL compatibility tests. Focused
validation is pending; cross-platform/ILVerify qualification remains open.

The native reader limitation is also visible in
[MethodBodyBlock.Create, .NET 10.0.5](https://github.com/dotnet/runtime/blob/v10.0.5/src/libraries/System.Reflection.Metadata/src/System/Reflection/Metadata/IL/MethodBodyBlock.cs),
which parses one EH section. No claim is made about other runtimes or versions.
