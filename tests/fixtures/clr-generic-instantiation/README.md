# CLR generic instantiation: native reference preparation

**Status: the first native attempt compiled the fixture and observer, then
failed before producing reference JSON when an eager `typeof(Node<>)` loaded
an expanding recursive generic definition. The revised observer is prepared
for a separate authorized capture. No successful comparison is claimed.**
The reference JSON and DLLs must come from the approved native capture;
do not create substitute expected values.
A reference comparison must fail when the required JSON, image or source hash
is absent or stale. It must never skip because the fixture is missing.

The independent sources live in
`packages/clr/interop/GenericInstantiation/`. Roslyn compiles `FixtureTypes.cs`
into `Fixture.dll`. The observer uses real CoreCLR reflection and
`System.Reflection.Metadata` (SRM); it does not invoke SharpForge or compile
the existing JavaScript unit-test fixture images.

## Capture

Run only in the scheduled exclusive validation slot:

```sh
node scripts/limited.js node packages/clr/tools/capture-generic-instantiation.mjs \
  --dotnet /absolute/path/to/dotnet-10.0.201/dotnet \
  --output artifacts/clr-generic-instantiation-first-capture
```

The driver pins SDK **10.0.201**, CoreCLR/reference pack **10.0.5** and
`net10.0`. It verifies the selected SDK and observed runtime/architecture.
The absolute host may also be supplied through `SHARPFORGE_ORACLE_DOTNET`
instead of `--dotnet`; the output option remains `--output`.
Roslyn runs directly with the installed reference pack, deterministic output,
mapped source paths, no shared compiler server and no package restore.
The only SharpForge import is the public `@sharpforge/cil`
`createRuntimeConfig` helper. No new runtime dependencies are introduced.

Every native command has a timeout and output limit. The driver retains
stdout, stderr, command arguments, status, generated images and input hashes
on failure. It refuses to overwrite an earlier successful or failed capture;
use a new output directory for any subsequently authorized attempt.

A successful capture produces:

- `native-instantiation.json`: reference observations, source/image hashes,
  exact SDK/compiler/runtime identity and reference-pack file hashes.
- `Fixture.dll`: the independently compiled C# type definitions.
- `GenericConsumerA.dll` and `GenericConsumerB.dll`: separate SRM-built
  assemblies with matching TypeSpecs targeting the shared definition assembly.
- `MalformedGenerics.dll`: isolated arity, signature-category and invalid
  element-code probes.
- `NestedGenericMetadata.dll`: metadata-only generic arity cases.
- `CircularGenericMetadata.dll`: a mutual generic inheritance cycle.
- `GenericInstantiationOracle.dll`, its runtime configuration,
  `capture-inputs.json`, `capture-status.json` and per-command logs.

Review the saved evidence before copying qualified reference files into this
directory. A failed run does not produce a replacement
`native-instantiation.json`.

## Reference schema, version 2

`images[].file` is a basename relative to the fixture directory.
`sources[].path` is relative to the repository root. SHA-256 values cover the
exact bytes; the replay must verify both image and source hashes.

`tokens.definitions` and `tokens.methods` identify declarations in
`Fixture.dll`. The TypeDef inventory comes directly from SRM metadata,
including nested ownership; inventory does not load the represented types.
Each SRM image has its own `specifications` and
`definitions` maps. `signatures[].rows` preserves each raw TypeSpec blob and
its independent SRM decoding, or the SRM error for malformed bytes.

Each `cases[]` entry has an `id`, a replay `request`, an observed `result`
or `error`, and an explicit `comparison` scope. Errors preserve native
managed exception type and HRESULT; they are not fabricated SharpForge
diagnostics. `identities[].left/right` name case IDs. An identity with
`status: "observed"` has a boolean `same` from actual `ReferenceEquals` and
an empty `unavailable` array. If a named operation rejected, the identity has
`status: "unavailable"`, explicit `same: null`, and the unavailable case IDs.
This is an unavailable observation, not a false equality result or a parity
success. The strict replay still requires every rejecting operation to fail;
a product acceptance cannot be hidden by an unavailable identity.

Potentially invalid recursive definitions use symbolic token shapes. Their
resolution, construction and graph requests execute inside the recorded
operation, so a native type-load rejection cannot abort metadata inventory.
Base/interface argument requests can supply an independent `source` shape
instead of relying on a prior successful `of` result. Descriptor serialization
and other observer defects remain outside the operation catch and fail capture.

Type shapes are structural:

| Kind | Identity or shape fields |
| --- | --- |
| `definition` | `image`, `context`, metadata `token` |
| `intrinsic` | Explicit BCL metadata `name`, such as `System.Int32` |
| `parameter` | `image`, `context`, `ownerToken`, `scope` (`type` or `method`), `index` |
| `generic` | Definition shape and ordered argument shapes |
| `szarray`, `array`, `pointer`, `byref` | Element shape and array rank when relevant |
| `functionPointer` | Return/parameter shapes, unmanaged flag and native calling-convention types |

Contexts `default`, `a` and `b` distinguish equal metadata identities loaded
into distinct native assembly load contexts. A generic result uses its
definition's module/context; collectible arguments remain separate shapes.

Results record generic flags, argument order, generic definition, declaring
type, substituted base/interfaces, collectibility and meaningful metadata
token/module information. Native `Name`, `FullName` and assembly strings are
provenance. They are not assertions that current SharpForge diagnostic names
implement reflection-name formatting. Function-pointer descriptors have no
metadata type-definition identity; metadata/name/assembly fields are omitted.

CoreCLR `GetGenericArguments()` includes a definition's own parameters.
The SharpForge replay must use `genericParameters` for definitions and
`genericArguments` for instantiations. Own ordered parameters normalize to
the definition, whose native identity is observed directly.

ResolveType's null environments are omitted from JSON and mean an omitted
JavaScript scope. `instantiate` with `arguments: null` and a null argument
entry are separate explicit native rejection cases.

## Coverage and comparison boundaries

| Area | Native observations |
| --- | --- |
| Tuple identity | Repeated construction, C# `typeof`, two consumer assemblies, reordered arguments, own-parameter normalization |
| Open types | Open/partial/closed flags; equal parameter names with different owners |
| Graphs | Substituted base, diamond interfaces, argument reordering and independently observed expanding recursive Node requests |
| Nesting | Outer/inner argument order, inherited outer arity, open declaring definition, zero-row detached inner, arity without a backtick suffix |
| Scoped signatures | VAR/MVAR, swapped environments, foreign parameters, nested arrays, missing and undersized environments |
| Element types | Vectors, rank-one nonvectors, matrices, jagged arrays, pointer and byref descriptors |
| Function pointers | Open/closed managed signatures, Cdecl, nested pointers/byref parameters and independent raw TypeSpecs |
| Structural failures | Invalid definitions and arguments, malformed signatures and circular inheritance |
| Wrapper probes | Pointer-array and function-pointer-array generic arguments, with actual native success or failure retained |
| Lifetime | Distinct collectible ALCs, mixed default/collectible tuples and retained handles after Unload |

`parity` and `rejection` rows require a corresponding successful comparison
or expected product rejection. A replay must not discard an unexpected row.

`native-compatibility` records actual native results for signature categories
or descriptor forms whose CLR behavior should be measured rather than
inferred from C# source legality. Any product policy stricter than those
observations needs a specific case-ID assertion and documented reason;
this label does not authorize a broad skip.

`identity-only-bcl` compares a real `List<int>` tuple and its generic flags
against an explicitly registered intrinsic generic definition. The observed
BCL graph is retained, but this batch does not load or qualify the entire
CoreLib metadata graph.

`signature-descriptor` reflects actual method-parameter function-pointer
types. A replay can project the independently decoded method signature through
the ordered environments. It does not claim a new MethodSpec API, member
invocation or general reflected-member substitution.

`constraint-unsupported-2463` records one valid and one invalid native
constraint case. The product deliberately rejects constrained target
definitions until #2463; casts/assignability belong to #2464.

The unchanged Node fixture declares `Node<T> : Box<Node<T>>,
IContract<Node<Node<T>>>`. Its nested self-reference is an expanding generic
inheritance dependency; the first native attempt rejected it.
[ECMA-335 II.9.2](https://ecma-international.org/wp-content/uploads/ECMA-335_6th_edition_june_2012.pdf)
requires a finite instantiation closure, beyond finite descriptor printing.
The revised observer records actual rejection or acceptance for all Node
requests without predicting the outcome. Successful simpler self references
must be qualified separately from this expanding shape.

`lifetime.reference` contains deterministic identity/descriptor observations
and counts synchronous Unloading events. It retains handles while observing
them after Unload. `lifetime.collection` separately reports eight bounded GC
rounds and weak-reference state. It is not a GC deadline, cache-size,
reclamation or native-memory parity gate. Product cancellation, race,
budget and cache-disposal policies need their own explicit tests.
