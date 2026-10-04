# Canonical declaration usage relations — SF-A13-T11.3

This batch adds `overridden-by` and `implemented-by` queries to the existing four
instruction relations through an explicit, versioned CLR-provided snapshot.
The CIL layer validates/copies bounded scalar data and indexes it; canonical type,
signature and base-definition identities remain in the CLR layer.

`input.mjs` independently authors metadata for five classes, two interfaces, an
implicit implementation, an explicit `MethodImpl`, inherited slots, `newslot`
hiding and interface reimplementation. MethodDef and Module-scoped TypeRef/MemberRef
aliases exercise identity independently of a language compiler.

`Program.cs` independently observes the corresponding behavior through CoreCLR
`MethodInfo.GetBaseDefinition`, `Type.IsAssignableFrom` and `Type.GetInterfaceMap`.
It adds generic methods with positional method type parameters. The capture records
source/compiler/reference/image hashes, exact toolchain/environment and raw process
results. Compiler-generated anonymous generic types are avoided so the fixture's
declared slot families are entirely within this batch's supported domain.

The offline comparison requires `native.json`; generate it in the single granted
validation slot using:

```sh
node scripts/limited.js node tests/fixtures/declaration-relations/capture.mjs tests/fixtures/declaration-relations/native.json
node scripts/limited.js node --test tests/a13-11-declaration-provider.test.js tests/a13-11-declaration-relations.test.js tests/a13-11-declaration-reference.test.js
```

Also run existing `tests/a13-11-usage-relations.test.js` and
`tests/clr-methods-interface-impl.test.js` because the batch preserves the former API
and extracts common MethodImpl row/token validation from the latter's classifier.
Tests do not compile code, contact the network or modify fixtures.

## Exact scope

Canonical class roots are expanded to every local ancestor declaration in the same
slot family. A `newslot` method starts a separate family. Interface maps keep their
implementing TypeDef context: an inherited body appears once for every class whose
map uses it. A hider without interface reimplementation does not change the inherited
map; reimplementation can choose a different public virtual slot. Explicit maps use
canonical MethodDef/MemberRef identity and full resolved signature compatibility.

The snapshot covers local source/target method definitions and local implementing
types. External definitions lie outside its query domain. References needed for a
local result bind using the supplied context and its explicit host policy. The
adapter performs no runtime invocation, virtual dispatch or method-body reads.

Generic declaring types/constructed interface slots, default/reabstracted interface
fallback, static virtual interface slots, class MethodImpl/covariant replacement and
base-definition forms unsupported by the existing CLR service produce explicit
per-relation diagnostics. MethodRef bodies can bind for interface maps while the
existing base-definition service still diagnoses that slot family separately.
The issue remains open for those families and wider qualification.

## Validation status

Implementation, focused positive/negative/boundary/cancellation/disposal tests,
native capture source and offline comparison are prepared. No new validation or
benchmark was run by the implementation agent. The root agent owns serial capture,
tests and publishing. JavaScript metadata services are the affected implementation;
source-VM/direct-CIL/Rust-native/Rust-Wasm execution and browser/platform coverage are
not implied by this unexecuted fixture.

The adapter indexes signature identities and MethodImpl owners once, bounds metadata,
retained relation counts and its own work steps, and uses slot lookups along bounded
ancestor chains. Canonical CLR loading/base-root work keeps the existing service's
independent budgets. Logical storage counters are not JavaScript heap measurements.

Specification references:

- [ECMA-335, sixth edition, II.10.3 and II.12.2](https://ecma-international.org/wp-content/uploads/ECMA-335_6th_edition_june_2012.pdf).
- [.NET ECMA-335 addendum](https://github.com/dotnet/runtime/blob/main/docs/design/specs/Ecma-335-Augments.md).
