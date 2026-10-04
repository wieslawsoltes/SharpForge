# Nullable and tuple metadata oracles

These assemblies were produced by the installed Roslyn compiler, not by SharpForge. The provenance files record
the compiler version, SDK, reference pack, command options, source SHA-256 and output SHA-256. The JSON files are
read-only extractions of attributes from those assemblies.

The initial capture used SDK 10.0.201, Roslyn 5.3.0-2.26153.122
(`4d3023de605a78ba3e59e50c657eed70f125c68a`) and Microsoft.NETCore.App.Ref 10.0.5 for net10.0.

## Reproduce

Set `DOTNET_ROOT` and `DOTNET` to the intended SDK installation, then run from the repository root:

```sh
node scripts/limited.js node tests/fixtures/nullable-metadata/build-fixture.mjs
node scripts/limited.js node tests/fixtures/nullable-metadata/build-fixture.mjs TupleMetadata
node scripts/limited.js node tests/fixtures/nullable-metadata/build-legacy-fixture.mjs
```

The generator invokes `csc.dll` directly with the installed reference pack and deterministic compilation. It does
not run the SharpForge compiler. Only rerun it when intentionally updating the pinned reference evidence.

## Nullable coverage: SF-A02-T05.3

`NullableMetadata.cs` exercises fields, events, properties, indexers, method returns and parameters, generic
parameters, base classes, implemented interfaces and generic constraints. It includes nested containing generic
types, arrays, tuples, pointers, function pointers, nullable value types, partial declarations with different
annotation contexts, inherited override constraints and generated record class/struct signatures.

The tests compare decoded public signatures against Roslyn on both assembly APIs. They also run a real .NET
`NullabilityInfoContext` inspector over the executable SharpForge assembly and the Roslyn oracle, then compile the
same native consumer against each and compare CS8714, CS8634 and CS8631 constraint warnings. Context compression
need not choose the same row layout as Roslyn; the resulting annotations must be the same.

The source type-parameter regression separately checks enabled/disabled contexts and distinguishes a type parameter
use from its definition constraint. An unconstrained `T` use has transform 1 under enabled annotations, while its
unconstrained generic parameter definition has transform 2. A value-constrained `T` contributes a zero placeholder.

## Targets without nullable attribute definitions

`LegacyNullableMetadata.dll` is a separate Roslyn capture against a controlled reference projection. The generator
copies `System.Runtime.dll` into a temporary directory and changes the first character of the two nullable
attribute TypeDef names, preserving their lengths and every metadata offset. It records hashes of both images,
uses the projected copy only for that compiler invocation, verifies the installed reference is unchanged and
removes the temporary directory. This is a modern reference pack with two deliberately missing compiler contracts;
it is not an actual historical SDK or a claim that every old target pack has been qualified.

The embedded-attribute tests compare the complete local type, field and constructor signatures, flags and custom
attributes with that Roslyn capture on both assembly APIs. The executable native probe invokes the scalar and
array nullable constructors, checks that the array constructor keeps the supplied array (including null), reads
the context flag and instantiates the marker/usage attributes. It also repeats the annotation reflection and
native consumer checks. Existing source constructors are reused, while malformed source contracts produce an
explicit emission diagnostic.

## Tuple relation coverage: SF-A02-T08.4

`TupleMetadata.cs` covers named tuples in a base type, implemented interface, generic parameter constraint,
field-like event, custom event and nested generic base type. The tests compare the exact `TupleElementNames`
attribute rows from both SharpForge assembly APIs with Roslyn and verify names after metadata import, including
the value parameters of synthesized event accessors.

## Focused validation

```sh
node scripts/limited.js node --test --test-concurrency=1 \
  tests/compiler-nullable-metadata-flags.test.js \
  tests/compiler-nullable-metadata.test.js \
  tests/compiler-nullable-metadata-native.test.js \
  tests/compiler-nullable-embedded.test.js \
  tests/compiler-nullable-embedded-native.test.js \
  tests/compiler-tuple-relation-metadata.test.js
```

Native tests report a skip when the required SDK or reference pack is unavailable. Such a skip is not native
qualification. The modern and projected-reference qualification ran all 23 focused tests with the toolchain above
and no skips. Adjacent nullable flow, constraints, lambda annotations, metadata import, record contracts and syntax
wiring were also checked in a separate bounded run.

## Performance measurement

`packages/compiler/bench/nullable-metadata.bench.js` accepts an exact `--baseline` checkout with its own workspace
package links. It compiles this same fixture using the modeled framework registry and the installed reference
pack, warms all four revision/mode combinations for 80 rounds and rotates their order in each of 20 measured
rounds. The reference-mode timing uses an already decoded and bound reference set; pack loading is excluded. Use `--output`
to preserve raw samples, source and commit hashes, output sizes and observed memory deltas. Those deltas include
garbage collection and do not measure total allocations. The report lists all intervening commits: it measures
the complete revisions and does not attribute every timing change solely to nullable metadata.
