# Native generic-instantiation closure observations

This is the source preparation for an independent CoreCLR/SRM fixture for
SF-A04-T05.1 (#2460). No capture, compilation, replay, test or benchmark has run
for these new sources. `preparation.json` records the authored matrix, exact
source hashes, reuse boundaries and pending qualification. It is not native
evidence. No `native-closure.json` or generated fixture DLL is supplied by this
preparation.

The fixture is separate from generic-constraint qualification (#2463). Its only
source reuse is `GenericInstantiation/TypeObservations.cs` and
`GenericInstantiation/SignatureObservations.cs`. The former supplies
`Register`, `Shape` and `Describe`; the latter supplies raw TypeSpec blobs and
SRM signature observations. The older `CaseObservations` helper compiled in the
same reused file is not called. No `GenericConstraints` source or tooling is
required.

## Authored scope

The matrix has 34 isolated cases, 71 observed requests, 38 identity observations
and 14 emitted images. An observed request can execute several native phases,
including module loading, definition resolution, argument resolution and
`MakeGenericType`; 71 is not a count of individual reflection API calls.

Each case executes its primary request and an exact repeat. Three cases add one
companion request each. Every case compares its primary/repeat endpoints, and
three cases add four further identity comparisons. All endpoints are observed
within the same process. No identity is inferred across processes.

The names below describe the authored metadata graph. Neither the source matrix
nor the capture driver contains predicted CoreCLR acceptance or rejection.

| Group | Authored relationship | Cases |
| --- | --- | ---: |
| Simple self-base | `C<T> : Box<C<T>>` | 3 |
| Expanding self-base | `C<T> : Box<C<C<T>>>` | 3 |
| Permuted mutual | `A<T,U> : Box<B<U,T>>`; `B<T,U> : Box<A<U,T>>` | 4 |
| Indirect expanding | `A<T> : Box<B<T>>`; `B<T> : Box<C<Wrap<T>>>`; `C<T> : Box<A<T>>` | 2 |
| Acyclic expansion | `A<T> : Box<B<Wrap<T>>>`; `B<T> : object` | 2 |
| Array expansion | `C<T> : Box<C<T[]>>` | 2 |
| Acyclic array expansion | `A<T> : Box<B<T[]>>`; `B<T> : object` | 2 |
| Constant-argument erased cycle | `A<T> : B<int>`; `B<T> : A<string>` | 2 |
| Nested invalid argument | `Bad<T> : Box<Bad<Bad<T>>>`; `Hidden<T> : Box<Bad<T>>`, plus a direct `Bad` control | 3 |
| Unrelated invalid definition | `Good<T> : Box<T>` in the same image as `Bad` and `Hidden` | 2 |
| Cross-module permutation | Equal-name `Same<T,U>` types refer to the opposite image's `Same<U,T>` through local `Box` | 6 |
| Cross-module expansion | The right image passes `Wrap<U>,T` back to the left image's `Same` | 2 |
| Non-generic self-interface | `C : object, I<C>` | 1 |

The cross-module permutation group includes a closed TypeSpec resolution,
partial construction, distinct type/formal owner identity, and two constructions
that differ only in the actual formal's owner image. The local permutation group
also includes partial construction and construction with both of a definition's
own formals. The simple and expanding self-base groups include separate closed
TypeSpec resolution requests.

The cross-module pairs deliberately have the same namespace, type names, TypeDef
row positions, formal names and formal indices. Their assembly identities, MVIDs,
AssemblyRef scopes and image IDs differ. Identity therefore cannot be replaced
with a name, token or generic-parameter index comparison.

All fixture types are emitted with SRM. Empty `Box<T>` and `Wrap<T>` definitions
derive from `System.Object`; the interface is empty and invariant. There are no
GenericParam constraints, methods, fields or method bodies. This fixture does
not establish constraint, variance, instantiated-member execution, generic
method-scope or collectible cleanup behavior.

## Isolation and operation boundaries

`prepare` constructs all images and reads their metadata with
`System.Reflection.Metadata`. It does not load emitted types through reflection.
Each subsequent `observe` invocation handles exactly one case in its own process,
using a noncollectible assembly load context named `GenericClosure` and the
structural context label `default`.

The observer never enumerates all types in an image. It resolves the requested
metadata token and any explicitly requested argument-owner tokens. Cross-image
assembly resolution is registered with the case's context, so delayed reflection
loads obtain an image scope before their descriptors are produced. An unrelated
definition is still present in the raw metadata inventory but is not eagerly
resolved by the observer.

`RequestBindings` translates definition/specification aliases to the actual SRM
tokens before the case invokes CoreCLR. Unknown aliases, unsupported source
forms and invalid authored identity requests are harness errors. Native
exception handling surrounds the actual assembly/reflection calls. It records
the original managed exception type, signed HResult, message, parameter name,
file name, stack trace and inner exception chain. It does not manufacture a
`TypeLoadException` when another exception was observed.

A fresh progress JSONL file receives each bound request, each native phase,
each native return or exception, descriptor completion, and identity completion.
Every record is flushed. A returned `Type` is recorded before scope registration
and `TypeObservations.Describe`. Description, serialization, registration or
identity-harness failure terminates the observer process and fails the capture;
the raw process output and preceding progress remain retained. Such a failure
does not become a native rejection result.

Unavailable identity endpoints retain their request, `available: false`, a null
shape and `unavailableBecause: "native-operation-exception"`.
`sameReference` is null unless both endpoints are available. Successful identity
endpoints retain their actual type shape and are compared with `ReferenceEquals`
inside their case's process. Source identity requests are cloned before the
matrix document is disposed.

## Capture procedure

The root coordinator owns the serial qualification slot. These commands are
instructions for that future authorized slot; they were not executed while
authoring this fixture. Run from the actual #2460 checkout containing these new
paths and the product candidate to be compared.

```sh
node scripts/limited.js node packages/clr/tools/capture-generic-closure.mjs \
  --dotnet /workspace/scratch/7e3d2a445c44/dotnet-10.0.201/dotnet \
  --output /workspace/scratch/7e3d2a445c44/generic-closure-native-first \
  --evidence /workspace/scratch/7e3d2a445c44/generic-closure-capture-first
```

Both output and evidence paths must be explicit, absolute, fresh and disjoint.
The driver resolves existing ancestors before checking that the paths do not
alias or contain one another. It has no overwrite option and does not install,
restore or download anything. If either path already exists, choose a new pair;
retain the old directories and their receipts.

The exact SDK is 10.0.201, CoreCLR runtime 10.0.5, target framework `net10.0`, and
reference pack 10.0.5. `global.json` disables SDK roll-forward. A retained runtime
configuration disables runtime roll-forward for compilation and every native
observer invocation. The copied toolchain manifest binds the platform-specific
`csc.dll` hash/version and all 167 reference assemblies by their established
aggregate. It is a byte-for-byte copy of the repository qualification pin, not
a dependency on the constraint batch.

The driver stages exactly eight C# files (six new, two reused), the three owned
JSON inputs and its own source. It hashes the staged bytes, compares them with
the live sources immediately, and rechecks the source inventory and all bytes
at completion. It independently snapshots the current CLR product JavaScript
sources as provenance; it neither imports them nor uses their output to decide
native results. A change to either source set during capture fails the capture.

There are exactly 40 sequential child invocations:

1. Four toolchain observations: selected SDK, SDK inventory, runtime inventory
   and compiler version.
2. One compilation of the observer, using the pinned compiler/reference pack.
3. One metadata-only image preparation invocation.
4. Thirty-four isolated case invocations in the authored matrix order.

Each command's exact executable/argv, cwd, controlled environment, start/end
times, exit status, signal, spawn error and stdout/stderr bytes are retained.
The command receipt is marked started before launch. Each child has a 120-second
timeout and a 32-MiB buffering bound; a timeout, signal, buffer failure or nonzero
exit is a capture failure with its available raw bytes retained.

The native assembly inventory is prepared before any emitted type is resolved.
Its files and the compiled observer are hashed before observation and compared
again afterward. The driver preserves the complete workspace, sources, emitted
images, progress journals, command outputs, receipts and retained-file hashes
on success and failure. Failure to retain the evidence also fails the capture.
Later cases are not silently substituted for a case whose process failed.

## Native result schema

Successful capture writes `native-closure.json` with `schemaVersion: 1` and the
14 exact observed fixture DLLs. The JSON contains:

| Field | Meaning |
| --- | --- |
| `sdk`, `runtime`, `platform`, `architecture` | Observed host/toolchain identity, checked against the pins |
| `sources` | Exact staged observer, input and driver file paths/byte counts/SHA-256 hashes |
| `productSources` | Separate snapshot of live CLR JavaScript sources; never native expectations |
| `toolchain` | Compiler, compiler dependency, runtime and reference-pack identities |
| `captureInputsSha256` | Hash of the retained input receipt |
| `counts` | The 34 cases, 71 observed requests, 38 identities and 14 images |
| `images` | Image IDs, file/assembly names, alias-to-token maps, byte counts and hashes |
| `metadata` | Raw SRM metadata facts, keyed by image ID |
| `cases` | Actual case results in the authored order |
| `observer`, `runtimeConfig` | Exact compiled observer and pinned runtime configuration identities |

The raw SRM metadata facts include the assembly/module identity, TypeDef flags
and Extends tokens, InterfaceImpl tokens, GenericParam owner/index/name/flags,
constraint tokens, TypeRef resolution scopes, AssemblyRefs, and each TypeSpec's
raw blob plus the existing independent SRM signature reader's result/error.

Each case has `id`, `group`, `comparison`, `operations` and `identities`.
Comparison labels (`native-parity` or `owner-identity`) describe how a future
replay consumes the observation; they do not predict its outcome.

An operation has `id`, `request`, `stage`, `nativeReturned`,
`descriptionCompleted`, `result` and `error`. Resolve requests contain
`op`, `image`, `context` and the actual `token`. Instantiation requests also
contain a structural `definition` and ordered `arguments`. Definition handles
contain `kind: "definition"`, image/context/token. Formal handles contain
`kind: "parameter"`, image/context/ownerToken/scope/index; an intrinsic handle
contains `kind: "intrinsic"` and its name. Supported authored element and generic
handles preserve their nested shapes.

On native success, the stage is `complete`, both completion flags are true,
`result` is the unchanged existing `TypeObservations.Describe` output and
`error` is null. On native exception, `result` is null, both flags are false and
the stage identifies the failing native phase. A stage of `nativeReturned`
appears in a progress journal if a native return preceded a later harness
failure; that incomplete case cannot qualify a successful capture.

An identity has `id`, `left`, `right` and `sameReference`. Each endpoint contains
its exact source `request`, `available`, `shape` and `unavailableBecause`.
The driver checks every request binding against the actual SRM token maps,
every operation/identity ID and order, every completion/error shape and all
availability flags. It does not assert a predicted acceptance result, HResult
or reference-identity value.

## Reuse and remaining qualification

The authoring checkout is pinned in `preparation.json`. Its entire
`TypeObservations.cs` file differs from the f551 instantiation capture
source in the unused identity helper. The reused `TypeObservations` class body
is identical, and `SignatureObservations.cs` is identical. Both historical
whole-file hashes are recorded so the difference is explicit. When this
dedicated source batch moves to the actual #2460 product candidate, the capture
driver stages and binds that candidate's exact whole files. It contains no
alternate-source allowlist or source-binding exception.

Required next evidence is a real fresh pinned capture, review of every observed
result/failure, and a strict replay against the frozen product candidate using
the captured fixture images and exact source pins. The CLR owner owns the
replay and product tests. Any native boundary disagreement is evidence to
investigate, not a reason to edit the recorded native results. Performance,
browser, additional platform and broader corpus qualification remain separate.
