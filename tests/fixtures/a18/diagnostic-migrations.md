# Reviewed corpus diagnostic migrations

## SF-A18-T12: semantic profile admission after the upstream compiler merge

The gate at `717de8ca75a3c1fed3464f1ea12987dc88344056` compared the complete
qualification snapshots. For these two fixtures, only the compiler diagnostic ID
changed. The source hashes, design documents, source identities, ownership,
warnings, `compilationSucceeded: false`, and execution exclusions remained equal.

| Fixture | Prior diagnostic | Reviewed diagnostic | Source ownership retained |
| --- | --- | --- | --- |
| `38-event-lambda` | `CS0123` | `SF2200`, error | The lambda is protected; `SFD0010` remains a warning and structural editing remains blocked. |
| `48-inline-collection` | `CS0200` | `SF2200`, error | The reader owns the inline children. That ownership does not authorize an executable source write. |

The two golden JSON files were edited by hand. Their source files were not changed
or regenerated. The lambda's manifest explanation now names `SF2200` without
claiming executable event support.

### Compiler provenance

Upstream commit `564cd60d64fe2506803565d1cce1ec162d1db0e7`,
`SF-A05-T01.8: preserve profile receivers and typed delegate defaults`, added
`executionBuiltinAliases` to semantic reconciliation. The matching
`AnalysisCore.executionBuiltin` and `NameBinding` changes resolve profile receiver
shorthands after ordinary lexical names and using-static members. Both corpus
fixtures use `Console.WriteLine` without importing `System`.

Previously, incomplete semantic analysis retained the earlier execution binder's
diagnostics. It can now finish binding these fixtures and reach semantic lowering.
`reconcileWithSemanticAnalysis` reports `SF2200` when valid bound C# needs an
unsupported execution construct, and returns no executable image. It preserves
real C# errors when semantic binding finds them.

The earlier framework binder only recognizes method groups when converting event
handlers, explaining its `CS0123` for a lambda. Its initializer loop requires a
setter for every named entry, explaining its `CS0200` for `Children = { ... }`.
The semantic initializer binder distinguishes assignment from a nested
initializer: a nested collection reads the getter and invokes `Add`. This rule is
also covered by the repository's Roslyn 5.3.0.0 reference, fixture
`member-initializers/nested-collection-initializer`, pinned with no diagnostics in
`packages/compiler/test/differential/pinned/member-initializers.json`.

Semantic lowering still has explicit guards for framework events using lowered
delegates and for unsupported reference conversions. A construction can meet a
reference-conversion guard before reaching its event subscription. The earlier
`App/View.g.cs` protected-event diagnostic capture is a different fixture and is
not used as evidence for these corpus files' exact message or span.

### Regression boundary

`tests/a18-corpus-profile-diagnostics.test.js` checks both unchanged corpus sources
through the public compiler and designer APIs. It requires complete semantic
analysis, one `SF2200` error with a nonempty source-backed span and construct
description, no source-VM image or CIL assembly, and byte-preserved compiler
diagnostics in the designer snapshot. Required-compilation edits must fail
atomically with `SFSYNC_COMPILE`; lambda navigation and the inline child identities
remain intact. Separate invalid variants require genuine `CS0123` and `CS0200`
errors and reject a profile-only substitution.

The root coordinator owns execution of this prepared coverage. This migration
does not claim source-VM, CIL, browser, or native WinUI execution of either fixture.
