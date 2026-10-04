# Manifest resources

`RuntimeAssembly.openManifestResources(options)` creates a disposable reader for
the assembly's ManifestResource table. It reuses the CIL resource-directory
parser and the assembly load context's canonical AssemblyRef resolution.
Resource payloads remain ordinary bytes; their contents are not executed or
deserialized. A `.resources` payload can be handed to `ManagedResourceReader`
after reading it.

```js
const reader = assembly.openManifestResources({
  maxResourceBytes: 8 * 1024 * 1024,
  fileProvider: ({ assembly, name, maxBytes, signal }) =>
    resourceFiles.get(assembly.identity.name)?.get(name) ?? null,
});

const declaredNames = reader.names;
const location = await reader.getInfo('Assets.Messages.resources');
const bytes = await reader.read('Assets.Messages.resources', { signal });
reader.dispose();
```

The host supplies the already obtained assembly and a finite map of external
file bytes in this example. The reader does not discover paths or make network
requests. A file provider may be asynchronous and should honor its supplied
signal and `maxBytes` before acquiring input.

## Lookup and returned data

`names` and `getNames({ signal })` return the same frozen array in manifest-row
order. Names are case-sensitive and include both public and private resources.
Enumeration reads the declaring manifest only, without binding AssemblyRefs or
calling the file provider. Duplicate/empty names, invalid visibility flags and
invalid implementation handles produce `SFCLR005`.

`read(name, { signal })` returns an owned `Uint8Array`, or `null` when that name
does not exist in the resolved assembly. Every call returns a fresh snapshot.
An existing declaration whose file/assembly is missing is a diagnostic, not a
missing-name result. Empty resources return a zero-length array.

| Implementation | Byte selection |
| --- | --- |
| Nil | Four-byte length prefix and payload at `Offset` in the declaring image's CLI resource directory |
| File, no metadata | Entire supplied data file; `Offset` must be zero |
| File, contains metadata | Four-byte length prefix and payload at the **declaring manifest's** `Offset` in the supplied netmodule's CLI resource directory |
| AssemblyRef | Bind through the owning assembly load context and continue lookup by the same resource name |

The File hash is verified over the complete supplied file before interpreting
any of its contents. A linked netmodule must have one Module row and no Assembly
row. Its own ManifestResource name table does not override the parent's byte
offset, and an invalid offset never falls back to a name lookup. Metadata
inspection permits a secondary module that contains a managed entry point;
resource reads do not decode or invoke that method. The module is not registered
as an executable runtime module.

`getInfo(name, { signal })` returns `null` for an absent name, otherwise a frozen
`{ fileName, referencedAssembly, resourceLocation, size }` object. A raw data-file
declaration can be described without invoking its provider; embedded and linked
module descriptions validate the selected range. `referencedAssembly` is the
canonical final foreign `RuntimeAssembly`, or `null` for the original owner.
`fileName` is the physical linked filename, or `null` for the final assembly's
manifest image. `size` is the embedded payload length, or `null` for a raw data
file whose bytes need not have been requested.

The exported `ManifestResourceLocation` flags are `Embedded = 1`,
`ContainedInAnotherAssembly = 2`, and `ContainedInManifestFile = 4`. The last flag
means the final assembly's actual manifest image, so a linked netmodule reports
`1` and its filename. An AssemblyRef leading to another assembly's embedded
resource reports `7`, the final assembly, and a null filename.

## External files, hashing and lifetime

The frozen provider request is
`{ assembly, name, metadataToken, containsMetadata, hashAlgorithm, hashValue, maxBytes, signal }`.
`hashValue` is an independent byte copy. The provider must return an
`ArrayBuffer`, `Uint8Array`, or nullish missing result. Filenames are portable
basenames; separators, colons, NUL, `.` and `..` are rejected. Metadata flags and
hash lengths are validated before requesting the file.

| Assembly hash algorithm | Value | Verification |
| --- | ---: | --- |
| None | `0` | CLI multi-file SHA-1 default |
| MD5 | `0x8003` | Bounded legacy-format compatibility routine |
| SHA-1 | `0x8004` | Existing public CIL hash utility |
| SHA-256 | `0x800c` | Existing public CIL hash utility |
| SHA-384 | `0x800d` | Host Web Crypto |
| SHA-512 | `0x800e` | Host Web Crypto |

Hashes validate consistency with the manifest; they do not authenticate the
publisher. Unknown algorithms and malformed hash lengths are invalid metadata.
Missing Web Crypto for SHA-384/SHA-512 produces `SFCLR013`, not an unverified
read. A hash mismatch or provider rejection produces `SFCLR015`
(`System.IO.FileLoadException`). A missing provider/file produces `SFCLR014`
(`System.IO.FileNotFoundException`). Existing diagnostic identifiers, including
`SFCLR013`, retain their meanings.

Only verified, owned file snapshots enter the per-reader cache. Provider and
hash failures are retryable. Concurrent initial reads may make independent
provider calls so cancellation remains local to each request; both calls count
toward pending and byte reservations. One verified snapshot becomes canonical
for that filename and owning assembly. Conflicting declarations or differing
concurrent verified snapshots are rejected. Retained files never change when
the provider's arrays are subsequently modified.

`dispose()` is idempotent. It drops the reader's callbacks and caches and prevents
new operations or late asynchronous results from publishing data (`SFCLR008`).
Previously returned names, location objects and bytes remain usable. Context
unloading follows the existing assembly contract: retained metadata remains
readable, while new assembly binding requires an active context. An already
aborted operation fails before returning a cached result (`SFCLR009`).

## Budgets and complexity

All limits are nonnegative safe integers; `maxSources` must be at least one.
Limit exhaustion produces `SFCLR007`; invalid options produce `SFCLR006`.

| Option | Default | Ceiling | What it bounds |
| --- | ---: | ---: | --- |
| `maxResources` | 65,535 | 65,535 | Manifest rows per assembly |
| `maxNameBytes` | 16,384 | 1 MiB | A metadata resource/File UTF-8 name and lookup input |
| `maxMetadataCharacters` | 16 Mi | 64 Mi | Total decoded resource/File UTF-16 characters indexed by this reader |
| `maxSources` | 128 | 4,096 | Declaring/forwarded assemblies and inspected linked modules |
| `maxFiles` | 1,024 | 65,535 | File records per manifest and total cached files |
| `maxPendingFiles` | 32 | 1,024 | Simultaneous provider/hash operations |
| `maxHops` | 128 | 1,024 | File/AssemblyRef edges in one lookup |
| `maxResourceBytes` | 64 MiB | 256 MiB | One returned payload, checked before copying |
| `maxDirectoryBytes` | 64 MiB | 256 MiB | One CLI resource directory |
| `maxFileBytes` | 64 MiB | 128 MiB | One external file, checked before owning a copy |
| `maxCachedFileBytes` | 128 MiB | 256 MiB | Retained files plus in-flight byte reservations |

Assembly input bytes also remain bounded by the load context's existing image
limit. Manifest indexing is linear in row count and decoded name bytes; a
successful index is cached once. Indexed name lookup is constant-time per
assembly, apart from validating the supplied name. An AssemblyRef walk is linear
in its bounded hop count and reports a precise path on a cycle (`SFCLR011`).
File hashing and owned payload copies are linear in their byte counts. The host
controls completion of asynchronous I/O; the reader checks cancellation before
work and after every await. It does not create timers or poll a provider.
Cancellation does not preempt a synchronous parser or legacy hash operation;
hosts processing large images should run this metadata service in a worker.

## Reference evidence and platform scope

The native corpus is generated independently with .NET
`System.Reflection.Metadata` and `ManagedPEBuilder`. Its two readers are recorded
separately: executing CoreCLR reflection and `MetadataLoadContext` metadata
inspection. The capture includes tool versions, reference-reader/source hashes,
complete input bytes/hashes, ordered names, stream bytes, and exact location or
error outcomes. No methods from these assemblies are invoked.

CoreCLR 10 does not expose non-nil File resource implementations through its
resource stream/info path. Those native null outcomes are retained as
unsupported coverage. MetadataLoadContext supplies agreeing linked-file/module
byte observations for the ordinary corpus, but resolves linked modules by
name and normalizes some location fields differently. Dedicated parent-offset
and parent-only-name cases record that difference. SharpForge follows ECMA's
normative File-offset semantics and reports physical locations as specified
above; this is not a claim of identical MetadataLoadContext behavior on those
cases. ECMA II.22.24's later informative all-File-zero rule conflicts with the
normative module-offset description; the normative text takes precedence.

The malformed embedded-length case also has distinct observed outcomes. Both
native readers still enumerate its name. CoreCLR's stream throws
`System.BadImageFormatException` (`-2147024885`), while its info query returns
manifest-embedded location flags `5` with null filename and referenced assembly.
MetadataLoadContext's stream and info queries instead throw
`System.OverflowException` (`-2146233066`). SharpForge eagerly validates the
resource index, so enumeration, reading and info all reject that malformed image
with `SFCLR005`. These differences are retained and asserted separately.

Regenerate during a scheduled native validation slot:

```sh
SHARPFORGE_ORACLE_DOTNET=/path/to/dotnet-10.0.201/dotnet node scripts/limited.js node \
  packages/clr/tools/capture-manifest-resources.mjs tests/fixtures/clr-manifest-resources \
  /fresh/path/to/manifest-capture-evidence
node scripts/limited.js node --test tests/clr-resources-manifest*.test.js
node scripts/limited.js node packages/clr/tools/benchmark-manifest-resources.mjs
```

`SHARPFORGE_ORACLE_DOTNET` names the installed .NET executable. Capture pins SDK
10.0.201, CoreCLR/reference pack 10.0.5 and the SDK MetadataLoadContext DLL hash.
It disables package sources and records compiler, runtime and reference-pack
file identities. The optional second positional argument is a fresh external
evidence directory; its default is `artifacts/clr-manifest-resources-capture`.
The capture refuses an existing native JSON file or evidence directory. It
retains the build workspace, complete generated images, copied source inputs,
and each subprocess's raw stdout/stderr, arguments and status on success or
failure. Regeneration requires a new evidence directory and explicit archival
of the previous JSON; failed attempts are not overwritten.
The focused tests are offline and read the retained JSON corpus. The benchmark
reports absolute cold/warm costs, its sampling protocol and machine; there was
no previous equivalent manifest-reader API. Exact allocation counts are not
measured. Qualification results are retained separately; authoring a harness
does not establish a validation pass.

This API is a host JavaScript metadata service. Source VM, direct CIL and Rust
native/Wasm execution integration, runtime linked-netmodule loading and native
method execution are outside this batch.

References: [ECMA-335, 6th edition](https://ecma-international.org/wp-content/uploads/ECMA-335_6th_edition_june_2012.pdf),
II.6.2.2–6.2.3 and II.22.24;
[CoreCLR resource path](https://github.com/dotnet/runtime/blob/v10.0.5/src/coreclr/vm/peassembly.cpp);
[MetadataLoadContext module resources](https://source.dot.net/System.Reflection.MetadataLoadContext/System/Reflection/TypeLoading/Modules/Ecma/EcmaModule.ManifestResources.cs.html);
[assembly hash algorithms](https://learn.microsoft.com/en-us/dotnet/api/system.reflection.assemblyhashalgorithm).
