# Project 4 external suite implementation

Tasks: [T21 #491](https://github.com/wieslawsoltes/SharpForge/issues/491),
[T22 #492](https://github.com/wieslawsoltes/SharpForge/issues/492),
[T23 #493](https://github.com/wieslawsoltes/SharpForge/issues/493),
[T24 #494](https://github.com/wieslawsoltes/SharpForge/issues/494).

This is implementation ahead of qualification. Corpus extraction was executed;
Portable extractor/corpus tests passed (8/8); compiler, VM, CLR and platform qualification
were **not** executed for this batch. Strict structure reports 257 pre-existing violations
and zero violations in this batch. See `portable-validation.json` and retained logs.
No imported case has a fabricated passing result. Dependency/qualification status
remains unchanged. Rust native/Wasm execution is unsupported pending A27 artifacts.

## Inputs and provenance

`pins.json` fixes public upstream commits, archive hashes and original notices.
The Roslyn release/dev18.3 source pin is independent of, and in the same release
family as, the existing 5.3 SDK compiler binary pin. Its default test parse profile
is `RegularPreview` (`CSharpTestSource.cs`); a requested explicit Regular version
is retained separately. Native execution verifies the existing oracle toolchain
and reference-assembly hashes; it does not use whichever SDK happens to be installed.

Roslyn/runtime code is MIT; csharpstandard code uses its separate MIT LICENSE-CODE.
The csharplang notice expressly covers `spec`. Its proposal tree has no repository-wide
license declaration, so those rows retain **NOASSERTION**, the original notice, URL,
commit and source hash. No proposal prose is copied or relicensed. Distribution review
of this source remains an explicit release limitation.

Every fixture includes source bytes, a SHA-256, upstream file SHA-256, commit/path,
method/example offset, requested language version, reference/options requirements,
expectations and unsupported reasons. The manifest hashes each complete fixture.
Roslyn rows are distinct source/expectation/version/options combinations, not generated
variations padded to satisfy the 2,000-case requirement.

Regenerate from fresh exact archives (Python 3.12+):

```sh
python3 scripts/conformance/suites/shared/fetch-upstream.py /tmp/sf-upstream
node scripts/conformance/suites/roslyn-import.js /tmp/sf-upstream/roslyn
node scripts/conformance/suites/runtime-il-import.js /tmp/sf-upstream/runtime
node scripts/conformance/suites/libraries-import.js /tmp/sf-upstream/runtime
node scripts/conformance/suites/spec-examples.js /tmp/sf-upstream/csharpstandard /tmp/sf-upstream/csharplang
```

Importers read one upstream file at a time. They extract data, never execute source
or use eval. Rejected Roslyn extraction forms are retained in the manifest with a
reason; they do not count toward imported cases. No upstream source tree is vendored.

## Execution, reporting and limits

Run commands only in the shared sequential qualification slot:

```sh
node --test --test-concurrency=1 tests/conformance/suites/*.test.js
node --test --test-concurrency=1 tests/conformance/suites/adapters.native.js
python3 scripts/conformance/suites/shared/fetch-upstream.py ilasm /tmp/sf-ilasm osx-arm64
export SHARPFORGE_SUITE_ILASM=/tmp/sf-ilasm/ilasm
node scripts/conformance/suites/run.js roslyn artifacts/suites/roslyn.json 2400
node scripts/conformance/suites/run.js runtime-il artifacts/suites/runtime-il.json 10000
node scripts/conformance/suites/run.js libraries artifacts/suites/libraries.json 10000
node scripts/conformance/suites/run.js spec artifacts/suites/spec.json 10000
```

Use linux-x64 or win-x64 ILAsm pins on those platforms; hash mismatch fails closed.
No executable is downloaded during a test run. Missing pinned tools are reported
as host failures or explicit unsupported ILAsm targets, never passing checks.

One child at a time uses the existing reproduction runner's process-tree timeout
and cancellation cleanup. Defaults: 100 cases, 45 seconds per child, 256 MiB V8 heap,
256 MiB CLR GC heap, 2 MiB child report, 10-second engine execution, 65,536 output
bytes, 2 million VM instructions, 128 VM frames and 16 MiB managed VM heap. The CLR
GC limit is not a total OS RSS cap. Cancellation/budget remainder is unmeasured.
Exit 0 means all scheduled cases passed, 1 includes failures, 2 includes unsupported
or unmeasured cases. Reports retain the full imported denominator.

Reports separate pass/fail/unsupported/unmeasured counts per language version,
namespace, language feature, opcode family and engine. Pass rates use pass/(pass+fail)
and retain unsupported/unmeasured counts alongside them. Opcode families for executed
C# programs are decoded from the actual native DLL; static IL families remain available
for unsupported inputs. These are case-level family rates, not branch coverage.

## Deliberate extraction/adaptation boundaries

- Roslyn: literal/verbatim/raw/constant-concatenated sources and directly associated
  `VerifyDiagnostics` calls only. Diagnostic IDs/severity are compared as multisets;
  upstream expression text preserves locations/arguments, which are not qualified by
  this adapter. Dynamic builders, interpolations, generated source arrays, custom
  references/options and harness mutations are rejected or explicitly unsupported.
  Native diagnostics must first match the upstream expectation; reference-profile drift
  is unsupported adaptation, not a SharpForge pass. Default target is a library unless
  ReleaseExe/DebugExe was explicit; top-level auto-detection differences stay unsupported.
- Runtime: curated IL-conformance/Convert/cctor/boxing/array paths. C# only removes
  discovery attributes and renames TestEntryPoint; IL bytes stay intact. Native ILAsm
  consumes IL; CLR and CIL VM run the same resulting DLL. Legacy IL preprocessor and
  external test harness dependencies stay unsupported. The upstream JIT success code
  is 100. Native reference rejection/failure is retained before VM comparison.
- Libraries: original parameterless fact bodies from System.Runtime, Collections and
  Linq are wrapped in Main. The shim implements scalar Equal, True/False, Null/NotNull,
  reference Same and exact-type Throws. Every assertion executes and throws on failure.
  Sequence equality, fixture state, arbitrary helpers, conditional tests, theory/member
  data and other assertions are unsupported. Missing isolated-body dependencies are
  detected by real native compilation, not filled with success stubs.
- Standard: annotated examples from seven chapters map to existing feature inventory
  rows; original metadata/errors/warnings/output are retained. The pinned draft-v8
  language level is distinct from each feature's introduction version. Simple standalone,
  class and Main templates are supported. Ellipsis, additional files, exception/output
  inference and custom templates remain explicit unsupported cases.
- Proposals: C# fences from inventory-linked pinned proposal files map directly to that
  row. Fragments are compiled in library context against the pinned reference, not assumed
  complete programs. Ellipsis is unsupported. Reference diagnostics for incomplete fragments
  do not establish the full feature's semantics or change the inventory's qualification.

Pending: native adapter batch, complete suite executions, actual
Windows/Linux/macOS runs, corpus results review and proposal distribution licensing.
