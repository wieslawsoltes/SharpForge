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
  tests/compiler-tuple-relation-metadata.test.js
```

Native tests report a skip when the required SDK or reference pack is unavailable. Such a skip is not native
qualification. The initial qualification ran with the toolchain above and no skips. Adjacent nullable flow,
constraints, lambda annotations, metadata import, record contracts and syntax wiring were also checked.
