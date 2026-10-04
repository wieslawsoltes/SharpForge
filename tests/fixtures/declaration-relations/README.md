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

The committed `native.json` supplies the offline reference. Replay the complete
focused Node gate in one serial validation slot:

```sh
node scripts/limited.js node --test \
  tests/a13-11-declaration-provider.test.js \
  tests/a13-11-declaration-reference.test.js \
  tests/a13-11-declaration-relations.test.js \
  tests/a13-11-usage-relations.test.js \
  tests/clr-methods-interface-impl.test.js
```

The existing usage and CLR MethodImpl suites are included because this batch
preserves the instruction API and shares row/token validation with the existing
classifier. Tests do not compile code, contact the network or modify fixtures.
Recapture only when the native reference needs regeneration; this explicit command
compiles and executes the reference and writes the output file:

```sh
node scripts/limited.js node tests/fixtures/declaration-relations/capture.mjs tests/fixtures/declaration-relations/native.json
```

## Exact scope

Canonical class roots are expanded to every local ancestor declaration in the same
slot family. A `newslot` method starts a separate family. Interface maps keep their
implementing TypeDef context: an inherited body appears once for every class whose
map uses it. A hider without interface reimplementation does not change the inherited
map; reimplementation can choose a different public virtual slot. Explicit maps use
canonical MethodDef/MemberRef identity and full resolved signature compatibility.
Reimplementation without a matching current declaration preserves the inherited map,
including an explicit implementation, before searching ancestral public methods. A
separate authored case introduces an interface with no inherited mapping and verifies
that its ancestral public method is selected.

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

The root validation run passed **33 of 33 focused Node tests**, with no failures,
skips or cancellations, at implementation commit `902b1fe0`. The exact small output
is retained in [node-results.txt](node-results.txt); [evidence.json](evidence.json)
binds it to source, fixture and test hashes and records replay configuration.

The committed native capture contains **19 relationships: four overridden ancestors
and 15 interface mappings**. The offline JavaScript comparison passed against all
19 exact `(relation, source, target, implementing type)` tuples. Its recorded reference
is .NET SDK 10.0.201, CoreCLR/reference pack 10.0.5 and Roslyn
5.3.0-2.26153.122 on linux-x64. The native capture records a local OS environment,
not an immutable runner image; full hashes, compiler arguments, execution output and
assembly bytes remain in [native.json](native.json), committed as `0efea656`.

The initial native comparison exposed a real inheritance mismatch: reimplementation
selected an older public method instead of preserving an inherited explicit map.
Commit `902b1fe0` corrected the selection order and the authored assertion that had
encoded the defect, then added the newly introduced interface regression. The native
expected observations were not changed to accommodate the implementation.

`browser.mjs` exports `run()` for a browser module harness. It checks the same canonical
families, snapshot ownership after source destruction/context unload, budgets,
cancellation and paging, then fetches and replays the captured native reference. This
harness is prepared, but the browser was never launched successfully for this batch;
**browser qualification remains pending**. Its intended scope is the browser
JavaScript metadata API, with captured CoreCLR observations replayed as data.

These results cover host JavaScript metadata services and the native reference's
Reflection observations. They do not establish source-VM, direct-CIL, Rust-native,
Rust-Wasm or wider platform execution coverage. No benchmark was run for this batch;
test durations are not performance evidence and no speedup is claimed.

The adapter indexes signature identities and MethodImpl owners once, bounds metadata,
retained relation counts and its own work steps, and uses slot lookups along bounded
ancestor chains. Canonical CLR loading/base-root work keeps the existing service's
independent budgets. Logical storage counters are not JavaScript heap measurements.

Specification references:

- [ECMA-335, sixth edition, II.10.3 and II.12.2](https://ecma-international.org/wp-content/uploads/ECMA-335_6th_edition_june_2012.pdf).
- [.NET ECMA-335 addendum](https://github.com/dotnet/runtime/blob/main/docs/design/specs/Ecma-335-Augments.md).
