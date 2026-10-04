# ECMA-335 verifier corpus

Task: SF-A29-T27 (#497).

`fixtures.json` contains 177 distinct accepting/rejecting IL cases for 93 named
Partition III constraints, with ECMA-335 sixth-edition section references. It
maps all 95 method-body verification diagnostics in the pinned ILVerify
inventory. Shared upstream accepting methods are referenced once across related
constraints, rather than duplicated to increase counts. Cases include exact
stack capacity, slot boundaries, operand types, protected control flow, object
initialization, generic constraints, delegates, access checks and prefixes.
These are declared fixture expectations, not captured oracle results.

`upstream.json` pins dotnet/runtime v10.0.5 commit
`081d220c0a773ffb7c6bea6b48727833576a65ef`. The unmodified MIT-licensed ILVerify
corpus is retained under `upstream/`, along with its license, test convention
README and verifier diagnostic enum. The declaration-based index contains 317
named method tests. Calls to test methods are not separate tests. Type-level
and specially named proxy fixtures remain in the raw source; they are not
silently treated as executable method coverage. The runner selects exactly one
concrete method per case from either authored or unmodified upstream IL.

ILVerify diagnostic IDs are **not** normative ECMA rule IDs. `rules.json`
classifies the full 111-diagnostic enum: 95 mapped verification diagnostics,
14 metadata/signature/encoding diagnostics, one optional sanity check, and one
`localloc` instruction-correctness check. `localloc` is always unverifiable, so
it cannot have an ILVerify-accepting verification case; its distinct stack rule
is not hidden behind a false accepting result. The optional throw/catch subtype
check runs only with ILVerify's `--sanity-checks`, not normal CLI verification.

The versioned constraint inventory identifies each positive/negative case and
section mapping. It does not imply coverage of every opcode/type combination.
No mapped verification constraint is missing an authored pair; all 93 oracle
agreements remain pending capture. #497 stays open until that native evidence
and the relevant platform qualifications are recorded.

## Offline checks and reports

```sh
node --test --test-concurrency=1 tests/conformance/verifier/verifier.test.js
node scripts/conformance/verifier/report.js
```

Without an actual capture, the report contains only `missing-oracle` rows. Tests
of envelope validation use explicitly synthetic inputs and never save them as
native evidence. The source VM has no hand-assembled-IL verifier adapter;
browser, Rust native and Rust Wasm qualification remain unsupported here.

## Opt-in native oracle

Use the existing .NET oracle SDK/reference pins from
`planning/qualification/oracle-toolchain.json`. The ILAsm binary pins are shared
with #492 at `planning/qualification/suites/ilasm-pins.json`; the optional
`SHARPFORGE_ILASM_PINS` path supports replay from that batch before integration.

`planning/qualification/verifier/ilverify-pin.json` records the official
`dotnet-ilverify` 10.0.5 NuGet package digest and every managed tool file digest.
Its nuspec records dotnet/dotnet commit
`a612c2a1056fe3265387ae3ff7c94eba1505caf9`. It is an external oracle prerequisite
explicitly named by #497, not a product or npm dependency. No test or runner
installs packages or downloads tools automatically.

Provision the package from the exact pin URL, verify its package SHA-256, and
extract `tools/net10.0/any/` to a tool directory. Provision the matching ILAsm
using the shared pin. Set `SHARPFORGE_ILASM` to the native assembler executable
and `SHARPFORGE_ILVERIFY` to the extracted **ILVerify.dll**, keeping all sibling
files. Set `SHARPFORGE_ORACLE_DOTNET` if dotnet is outside PATH. Then run:

```sh
node scripts/conformance/verifier/capture.js artifacts/results/verifier-native
node scripts/conformance/verifier/report.js artifacts/results/verifier-native
```

Capture checks tool bytes before execution, reuses the pinned reference pack,
forces the exact CoreCLR version, and runs ILVerify twice per assembled case.
It retains the assembly hash, invocation argv, raw tool logs and normalized
observations. Success requires exactly one verified method; empty includes,
process failures, signals and diagnostic/exit inconsistencies are errors.
Rejecting cases must report their targeted diagnostic; additional diagnostics
are retained. Accepting cases must have no diagnostics. IL is never executed.

The report consumes `verifyCilAssembly` through `@sharpforge/cil` and compares it
on those exact assembly bytes. The public API describes a constrained stack and
executability verifier, not complete CLR type verification. Inspection-only
operations become `unsupported`, and real acceptance/rejection differences
become `disagree` with diagnostics retained. No Project 6 runtime/CIL changes are
made to hide those gaps. Native capture is pending until the serial validation
slot and tool prerequisites are available.

To reproduce imported sources, obtain the pinned runtime commit and copy only
`upstream.json`'s file list, preserving each path below `upstream/`. The offline
loader checks all byte lengths and SHA-256 digests before using this corpus.
