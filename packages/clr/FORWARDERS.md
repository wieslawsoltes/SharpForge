# ExportedType forwarding

`context.types.find(module, fullName, { signal })` resolves an exact metadata
name in a manifest module. It first checks local TypeDefs, then follows
ExportedType rows whose implementation is an AssemblyRef. Nested ExportedType
rows inherit their enclosing row's destination. An enclosing forwarder also
allows lookup of nested definitions without redundant nested export rows.
`context.types.load(module,
typeRefToken, { signal })` uses the same resolver after binding its scope;
nested TypeRefs preserve the canonical enclosing type's defining module.

```js
const facade = await context.loadFromAssemblyName('Facade');
const type = await context.types.find(facade.manifestModule, 'Example.Widget');
const implementation = await context.loadFromAssemblyName('Implementation');
const sameType = await context.types.find(implementation.manifestModule, 'Example.Widget');
console.assert(type === sameType);
```

No replacement type descriptor is created for the facade. The result is the
defining module's existing `TypeDesc`, completed through its context's normal
type loader. Assembly identity policy, version binding, host resolution events
and lazy dependency loading remain owned by `AssemblyLoadContext`. A configured
external intrinsic resolver still runs before forwarding when resolving an
AssemblyRef-scoped TypeRef; forwarding does not grant framework authority.

## Bounds, errors and lifetime

`typeOptions.maxForwarderHops` defaults to 128 and accepts integer values from
1 through 1024. One AssemblyRef transition consumes one hop; nested exported
names do not add assembly hops. A destination TypeDef reached on the last
permitted hop succeeds. `maxMetadataRows` bounds each module's combined
ExportedType, AssemblyRef and File rows and the number of cached bindings.
`maxDepth` separately bounds nested
ExportedType ownership, including prefixes already cached during index building.
Heap names are limited to 16 KiB of UTF-8 before decoding, expanded names to
4096 characters each, and all expanded names in one export index to
16,777,216 UTF-16 code units.

| Failure | Diagnostic |
| --- | --- |
| Forwarder cycle, including `A -> B -> A` | `SFCLR012`, `System.TypeLoadException`, with the name and assembly chain |
| Missing name | `SFCLR012`, including the requested type and the assembly searched |
| Missing or incompatible destination assembly | Existing assembly resolver diagnostic, preserved without conversion |
| Malformed flags, duplicate names or nested ownership cycles | `SFCLR005`, `System.BadImageFormatException` |
| Hop, metadata, nesting or name budget exceeded | `SFCLR007` |
| Invalid hop configuration | `SFCLR006` |
| Aborted operation | `SFCLR009`, including already cached lookups |

Export indices and successful name-to-module/token bindings are context-owned
weak maps keyed by source modules. Only successful bindings are cached; failures
and cancellation can be retried. Successful forwarder lookups retain the target
module, as other resolved metadata references do. There is no process-global
cache. Existing resolved types and metadata remain usable while collectible
context roots survive unloading. Resolving an as-yet-unloaded destination still
requires an active load context.

Cold indexing is linear in metadata row count plus the total expanded name
length. A cold lookup then follows at most the configured hop count. A warm
forwarded lookup uses a cached binding and canonical loaded type, independent
of the chain's original length. Methods and executable bodies are not read.
Cached bindings retain their original hop counts, so warming an intermediate
facade cannot bypass the configured limit or change a failure into success.

## Evidence and remaining scope

The focused tests cover chains, nested definitions, AssemblyRef and nested
TypeRefs, canonical identity, concurrent resolution, cross-context sharing,
unload, malformed metadata, cancellation, retry and resource limits. The native
oracle uses the same independently authored PE images, records their SHA-256
hashes and the actual SDK/runtime versions, and compares `Assembly.GetType`
and `Module.ResolveType` results. Capture it without package sources using:

```sh
node scripts/limited.js node packages/clr/tools/capture-forwarders.mjs artifacts/clr-forwarders
node scripts/limited.js node --test tests/clr-types-forwarders.test.js tests/clr-types-forwarders-reference.test.js
node scripts/limited.js node packages/clr/tools/benchmark-forwarders.mjs artifacts/project6-resume/forwarders-feature.json
```

The [retained qualification record](../../artifacts/project6-resume/forwarders-evidence.md)
keeps the integrated 8-test result, the preceding 21-test result, the ten native
observations, and every original before/after benchmark cohort. Initial cohorts
whose `TypeDesc.token` guard compared undefined values are explicitly unqualified.
The later 100-sample cold cohort has a true median of 235.35997 -> 257.93217
microseconds, a 9.59050% increase; the driver's original upper-middle summaries
are retained too. This exceeds the 5% regression budget and requires explicit
justification and PR sign-off. A lower p95 does not establish that the median
regression passed the budget.

The forwarder-specific benchmark checks every returned canonical `Fixture.Widget`
descriptor, keeps chronological samples from 100 measured batches after 20 warm
batches, uses a true median and nearest-rank percentiles, and records source,
fixture, and environment provenance. Its first retained run passed every-result
identity checks: cold median/p95 259.81190/553.61580 microseconds, warm forwarded
0.745495/1.68778, and warm direct 0.908390/4.32005. These measure the host JavaScript
loader and do not replace the separate existing-path regression comparison.

The named lookup consumes exact metadata names; it does not parse reflection
type-name syntax, assembly-qualified names, generic argument lists or escaped
name separators. File-implemented ExportedTypes report that linked netmodule
loading is required. Forwarding does not implement `Assembly.GetForwardedTypes`,
member visibility policy, generic instantiation, or engine token adapters.
Execution integration in the source VM, direct CIL, Rust native and Rust Wasm
remains separate work; this batch qualifies the host JavaScript loader service.

References: [ECMA-335, Partition II §22.14 and §23.1.15](https://ecma-international.org/publications-and-standards/standards/ecma-335/),
[.NET type forwarding](https://learn.microsoft.com/en-us/dotnet/standard/assembly/type-forwarding),
and [ExportedType metadata semantics](https://source.dot.net/system.reflection.metadata/System/Reflection/Metadata/TypeSystem/ExportedType.cs.html).
