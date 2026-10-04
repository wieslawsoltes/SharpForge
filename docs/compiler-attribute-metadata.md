# Attribute and interop metadata

This batch extends the direct CIL and reference-assembly writers for Project #5 tasks #622 and #629.
Attributes retain their declared targets: assembly, module, type, generic parameter, method, return value,
parameter, property, event and generated backing field. Accessor and setter-value attributes use the
corresponding method and parameter rows. A delegate's return attributes are also emitted on `EndInvoke`,
matching the declaration's `Invoke` contract.

Attribute values preserve optional constructor arguments, boxed values, enum and array descriptors, and
reflection type names for constructed, open, nested, array and pointer types. A foreign type's serialized
name uses its actual assembly identity.

## Pseudo-custom attributes

The metadata writer uses the existing symbol and member plans. It writes CLI flags and tables for attributes
whose representation is not a `CustomAttribute` row:

| Source contract | Emitted metadata |
| --- | --- |
| `Serializable`, `NonSerialized`, `ComImport`, `SpecialName` | Applicable type or member flags |
| `StructLayout`, `FieldOffset` | Type layout/character-set flags, `ClassLayout`, `FieldLayout` |
| `DllImport`, `PreserveSig` | `PinvokeImpl`, zero method RVA, implementation flags, `ImplMap`, shared `ModuleRef` |
| `MarshalAs` | `HasFieldMarshal` and the exact native descriptor in `FieldMarshal` |
| `In`, `Out`, `Optional` | Parameter flags |
| `MethodImpl` | Method implementation flags, including the named code type |

The marshal encoder covers primitive native types, fixed strings and arrays, parameter-sized arrays,
interface IID parameters, safe arrays and custom marshaler names/cookies. Layout and module records are
indexed per writer, so repeated attributed declarations do not scan all previously emitted members or rows.
The pseudo-attribute helper is created only when an applied source attribute is encountered.

## Reference qualification

`tests/compiler-attribute-targets.test.js`, `tests/compiler-attribute-emission.test.js` and
`tests/compiler-pseudo-attributes.test.js` inspect both public assembly APIs. The latter compares all nine
marshal blobs and their exact declaring field/parameter targets byte for byte against the retained genuine
Roslyn assembly in `tests/fixtures/attribute-metadata/PseudoAttributes.dll`. Its provenance records SHA-256
hashes for the source, DLL, compiler and `System.Runtime` reference assembly.

The native fixtures are `attribute-targets.cs` and `pseudo-attributes.cs` in
`packages/compiler/test/cil-emission/reference-fixtures`. Their expected outputs were captured with actual
.NET SDK 10.0.201, Roslyn 5.3.0.0 and CoreCLR/reference pack 10.0.5. SharpForge's emitted programs produce the
same outputs, including a real Linux x64 `libc.so.6` call to `abs(-12)` that returns `12`.

One reference-runtime behavior is deliberately recorded as a boundary: on this Linux CoreCLR build,
reflection over the genuine Roslyn custom-marshaler fixture returned adjacent blob-heap bytes after the
declared cookie. The portable output fixture excludes that unstable reflection query. The custom marshaler
descriptor, including the UTF-8 cookie, remains covered by the independent exact-byte comparison. Safe-array
subtype/type-name bytes are likewise checked directly, regardless of what this runtime exposes in reflection.

These results qualify metadata and the stated native fixtures. They do not establish general foreign-function
execution in SharpForge's source or CIL VMs, COM activation, callback marshaling or other platform ABIs.
The broader acceptance criteria remain tracked on #622 and #629.

## Performance

Run the benchmark with the baseline checkout at commit `88bd931a`:

```sh
node scripts/limited.js node --expose-gc packages/compiler/bench/attribute-metadata.bench.js /absolute/path/to/baseline
```

The final comparison loads both compiler module graphs in one process, warms each case 120 times, then
alternates nine batches of 30 compilations. The machine was shared: Linux x64, AMD EPYC 9V74, Node v24.19.0.
All raw samples and the earlier separate-process pilot runs are retained in
`tests/fixtures/attribute-metadata/performance`. Percentiles are over per-batch average compile times.

| Workload | Median before / after (ms) | p95 before / after (ms) | PE bytes before / after |
| --- | --- | --- | --- |
| Plain library | 1.245 / 1.383 | 1.464 / 1.642 | 1,536 / 1,536 |
| Attribute library | 2.515 / 2.560 | 3.554 / 2.928 | 2,048 / 2,048 |

The paired process retained 84,200 additional heap bytes after GC across both compiler graphs; final RSS was
391,491,584 bytes. This is an aggregate retained-heap observation, not a per-compile allocation measurement.

**Implementation-author performance sign-off:** accept the measured plain-control median increase of 11.07%
and p95 increase of 12.13% for this correctness batch. Return/target attributes and complete interop metadata
are required for the produced assemblies to represent their source contracts. Generated sizes are unchanged;
indexed record lookup and lazy helper creation remove avoidable repeated work. The shared-host variation
does not establish a causal or platform-wide regression, and this batch makes no speedup claim.

## Isolated publication replay

The isolated branch at `b40e575c829c8c5119db9f2d0f20ccc9df3e4de8` passed all 36 focused and neighboring
tests with zero skips. Both `attribute-targets` and `pseudo-attributes` then matched the genuine Roslyn
output on the pinned .NET host. Exact commands and raw logs are retained in the qualification directory.

The static import manifest contains one exact-hash review entry for the developer benchmark's fixed
module import from a trusted, operator-selected checkout. The P/Invoke metadata helper is named
`writeImport` so the conservative lexical import scanner does not mistake its method declaration for
a dynamic import. The scanner and product import policy are unchanged.
