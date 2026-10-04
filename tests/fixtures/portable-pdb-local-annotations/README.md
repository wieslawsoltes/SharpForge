# Local annotation joins and display

Validated at product/test head `1382e5fff0839ee43ed99f4e4816a17a0ec60da5`.
The required central coded-index bounds dependency is merge
`bd213af2c856423458c6e7984189c49189aa2682`. No new native build was run.

The focused tests reuse DynamicLocalVariables (`01`) and TupleElementNames
(`left\0right\0`) records captured from Roslyn 4.8.0-7.23558.1 and
5.3.0-2.26153.122 in [the existing corpus](../portable-pdb-interop/records.json).
That corpus records compiler/source/PDB hashes. The new tests join those bytes
onto authored PE/PDB local rows and assert the public bound scope display.
This is reuse of native codec evidence plus new offline integration, not a new
Roslyn compile, debugger session, or native end-to-end reference capture.

Other authored inputs cover per-occurrence dynamic flags despite shared
primitive nodes, nested tuples, long tuple rest chains, generic/array/byref
containers, object-null constants and a TypeSpec class-null constant containing
a tuple. The TypeSpec case is explicitly authored metadata, not a C# tuple
constant declaration. Negative cases cover framework-name lookalikes, mismatched
flags/name counts, parent references, duplicates and limits before expansion.
Unresolved enum TypeSpec annotations keep an explicit unsupported reason and the
existing unverified enum/scalar result, rather than attempting a missing type decode.
The public formatter hook is independently covered for unchanged fallback,
AST ownership, result validation and shared depth/node/cancellation budgets.

Primary rules used:

- [Portable PDB dynamic-local record](https://github.com/dotnet/runtime/blob/main/docs/design/specs/PortablePdb-Metadata.md#dynamic-local-variables-c-compiler)
- [Roslyn dynamic transform traversal](https://github.com/dotnet/roslyn/blob/main/src/Compilers/CSharp/Portable/Symbols/Metadata/PE/DynamicTypeDecoder.cs)
- [Roslyn tuple name traversal](https://github.com/dotnet/roslyn/blob/main/src/Compilers/CSharp/Portable/Symbols/Metadata/PE/TupleTypeDecoder.cs)

No runtime values, generic substitution, external assembly resolution or broad
engine/platform qualification are claimed. Validation below covers the touched JavaScript APIs and retained corpus only.


## Validation

One limiter-owned sequential driver ran with Node v24.21.0,
`SHARPFORGE_TEST_CONCURRENCY=1`, `SHARPFORGE_MAX_PARALLEL_RUNS=1` and
`SHARPFORGE_MAX_OLD_SPACE_MB=1024`. Each process ended before the next started.

- Install: `npm ci --ignore-scripts --no-audit --no-fund`, exit 0.
- New `tests/a13-04-local-annotations.test.js`: **10/10 passed**.
- Touched compatibility set: **68/68 passed**, comprising scope-tree,
  effective-imports, native-CDI, LocalConstant reader, Decimal, DateTime,
  Nullable, enum, signatures and signature-compatibility files.
- `npm run check`: **3,258 syntax / 3,254 static modules**, zero errors;
  manifests **842 Node files / 36 browser scripts / 30 areas**, no duplicate
  or unassigned entries.
- `npm run check:structure`: exit 0, 269 existing findings, none in changed
  product/test files. No full suite or browser/native platform matrix ran.

The authored enum boundary regression was run against pre-guard symbols source
`b1ade604df6a917164b83628cb915332cfae585a`, using the current CIL dependency.
Its fixture initially used the nonexistent `Writer.i32`; that setup failure
was retained below and corrected to `u32(7)` in both the regression checkout
and current test. The corrected prior-product test then failed as intended;
current focused tests passed. The fixture correction is commit `1382e5ff`.

```text
Initial fixture failure: 1 test, 0 passed, 1 failed
TypeError: (intermediate value).u8(...).i32 is not a function
  at a13-04-local-annotations.test.js:178:39

Corrected fixture, prior product: 1 test, 0 passed, 1 failed
TypeError: Cannot read properties of null (reading 'get')
  at bindConstantAnnotations (local-annotations.js:99:75)
  at loadSymbols (symbol-loader.js:40:5)
```

## Fixed performance controls

The first and only comparison is retained in [performance.json](performance.json),
including all **80 chronological samples**, source revisions, fixture hashes,
host, protocol and identical control observations. The exact executed harness
is retained as [benchmark.mjs.txt](benchmark.mjs.txt), with its SHA-256 in the
capture. It imports archived baseline symbols/CIL sources at `bd213af2` and
current sources at `1382e5ff`; unchanged archive/bytecode/framework dependencies
resolve through the same current workspace. No full baseline worktree was used.

Host: shared macOS arm64 Apple M3 Pro, Node v24.21.0. Each control used 20
alternating AB/BA pairs with GC before each sample. The existing 18-constant
load control used 30 warmups / 100 loads per sample. The callback-absent public
formatter control used 2,000 warmups / 2,000 batches per sample, each batch
formatting three retained type ASTs. Median is the mean of positions 10/11;
p95 is nearest-rank position 19. Units below are milliseconds per operation
(load, or three-type formatter batch).

| Control | Before median | After median | Before p95 | After p95 |
| --- | ---: | ---: | ---: | ---: |
| Existing LocalConstants load | 0.582968125 | 0.588558745 | 0.628642500 | 0.622117920 |
| Formatter without callback | 0.00085073975 | 0.00092256250 | 0.00087633350 | 0.00101568750 |

The load median changed +0.005590620 ms (+0.959%). The formatter median changed
+0.00007182275 ms (+8.442%), and p95 +0.000139354 ms (+15.902%). **Root reviewer
explicitly accepted the formatter regression** after read-only review: the
callback-absent path adds scalar option checks, allocates no child callback
closure, and preserves shared depth/node accounting. The accepted tradeoff
provides bounded source annotation formatting and the reusable CLR display
seam without a second formatter. No repeat tuning, allocation improvement,
causal explanation, noise attribution, speedup or significance is claimed.
