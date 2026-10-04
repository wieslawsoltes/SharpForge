# Binary resource file inspection

`ManagedResourceReader` reads in-memory `.resources` format version 2 files,
including files produced by .NET `ResourceWriter` and MSBuild's resgen task.
The reader owns its input bytes, builds a bounded name index, and decodes values
only when requested. It does not load assemblies or instantiate serialized user
objects.

```js
import { ManagedResourceReader, ResourceTypeCode } from '@sharpforge/clr';

const resources = new ManagedResourceReader(bytes, { maxBytes: 8 * 1024 * 1024 });
try {
  for (const [name, entry] of resources.entries()) {
    if (entry.typeCode === ResourceTypeCode.String) console.log(name, entry.value);
  }
  const entry = resources.get('Caption'); // null means that the key is absent
  const original = resources.getRawData('Caption'); // type name and owned payload bytes
} finally {
  resources.dispose();
}
```

## API and representation

`names` is a frozen array in the file's hash-table order, matching native
`ResourceReader` enumeration. Lookup is ordinal and case-sensitive; hash
collisions are checked against the names and cannot merge distinct keys. Empty
keys are valid. `count` and `header` expose the entry count and the ResourceManager
reader/set names and format versions.

`get(name, { signal })` returns a frozen `{ typeCode, typeName, value, diagnostic }`
record or `null`. A stored null is a record with `typeCode: ResourceTypeCode.Null`
and `value: null`. The exported `ResourceTypeCode` constants are the on-disk
numbers. Built-in `typeName` strings match native `GetResourceData`, such as
`ResourceTypeCode.Int32`; user types retain their declared assembly-qualified
name without binding it.

| Resource values | JavaScript representation |
| --- | --- |
| Null, String, Boolean | `null`, string, boolean |
| Char | One UTF-16 code unit as a string, including surrogate code units |
| Byte through UInt32 | Exact `Number` integers |
| Int64, UInt64 | Exact `BigInt` integers |
| Single, Double | `Number`, preserving negative zero, infinities and NaN |
| Decimal | Frozen `{ coefficient: BigInt, scale: number, negative: boolean }`, retaining scale and negative zero |
| DateTime | Frozen `{ binary: BigInt, kindBits: number }`, retaining the exact .NET `ToBinary` representation |
| TimeSpan | Frozen `{ ticks: BigInt }`, in 100 ns ticks |
| ByteArray, Stream | Owned `Uint8Array` payloads, distinguished by `typeCode` |
| Serialized user type | Owned opaque `Uint8Array` plus an `SFCLR013` warning diagnostic |

DateTime's local encoding contains timezone-dependent wrapped UTC ticks. The
reader preserves that binary value and its two high kind bits; conversion to a
local calendar date is a separate BCL/host operation. It does not substitute a
JavaScript `Date` or consult the current timezone. Decimal and 64-bit values
never pass through floating-point conversion. `getRawData` preserves the original
bytes as well, including floating-point NaN payload bits and any trailing bytes
in the bounded record.

Repeated scalar lookups return the identical frozen descriptor. Aliased data
offsets share the same decoded scalar. Byte arrays, streams and serialized values
return fresh copies, and `getRawData` always returns owned bytes. Mutating input
or returned buffers cannot corrupt another lookup. `dispose()` is idempotent and
releases the input, index and caches; previously returned snapshots remain valid.
Access after disposal produces `SFCLR008`. `get`, `getRawData`, `entries` and the
constructor accept abort signals; warmed caches still check cancellation.

## Integrity and budgets

| Option | Default | Maximum |
| --- | ---: | ---: |
| `maxBytes` | 64 MiB | 256 MiB |
| `maxEntries` | 100,000 | 1,000,000 |
| `maxTypes` | 10,000 | 100,000 |
| `maxNameBytes` | 16 KiB | 1 MiB |
| `maxMetadataBytes` | 16 MiB | 64 MiB |
| `maxHeaderBytes` | 64 KiB | 1 MiB |
| `maxStringBytes` | 16 MiB | 64 MiB |
| `maxValueBytes` | 64 MiB | 256 MiB |

All limits are nonnegative safe integers. `maxNameBytes` applies to UTF-16 key
bytes and UTF-8 user type names. `maxMetadataBytes` bounds their combined decoded
input bytes and the reader/set name bytes. `maxHeaderBytes` bounds declared and
actual ResourceManager header sizes. `maxValueBytes` includes a record's payload
after its type code, including length prefixes. The reader checks sizes before
copying input, allocating count-sized arrays or materializing value buffers.

Malformed headers, lengths, offsets, reserved type codes, duplicate names,
unsorted or mismatched hashes, invalid Decimal flags and invalid UTC/unspecified
DateTime ticks produce `SFCLR005`. A value's read range ends at the next distinct
data offset, so malformed lengths cannot consume another resource. File format
version 1 and unknown reader classes produce `SFCLR013` with the managed
`System.NotSupportedException` contract. Exceeded budgets produce `SFCLR007`,
invalid options `SFCLR006`, and cancellation `SFCLR009`. Failed value decoding
does not populate the cache.

The parser deliberately rejects malformed UTF-8 and UTF-16 strings instead of
applying replacement-character fallback. BOM characters inside names and values
are retained as data. Future ResourceManager header versions can be skipped by
their bounded header length when the underlying resource format remains v2.
The standard reader and `System.Resources.Extensions.DeserializingResourceReader`
headers are recognized; custom serializer payloads remain opaque.

Indexing is O(bytes of names + n log n), with the sort determining each value's
bounded extent once. Warm scalar lookup is O(1) and does not decode the value
again. Byte copy cost is proportional to the requested payload. Parsing is
synchronous; hosts can place large-file inspection in their existing worker.

## Reference evidence and boundaries

The native fixture records SDK/runtime versions, source hashes, file hashes,
enumeration order, typed values and the exact native `GetResourceData` bytes.
It includes every v2 built-in code, serialized user data, numeric extremes,
negative zero, non-finite floats, Unicode, BOMs, colliding name hashes, an empty
key, and an independent MSBuild resgen-generated `.resources` file.

The retained capture was produced with .NET SDK 10.0.201 and CoreCLR 10.0.5
on Linux x64. All 11 focused Node tests passed on Node 24.19.0, including
the native ResourceWriter and MSBuild resgen comparison. The capture is stored
in `tests/fixtures/clr-resources/native-resources.json`; the focused test log
and tested source hashes are in its `qualification` directory. Browser and
managed runtime integration have not been qualified by this capture.

The candidate-cost benchmark used the 1,799-byte native file with 38 entries,
100 measured samples, Node 24.19.0 on Linux x64, and an AMD EPYC 9V74 host.
This was a shared machine with one validation job from this team. Allocation
counts were not measured; there is no previous equivalent implementation.

| Operation | Median, microseconds | p95, microseconds |
| --- | ---: | ---: |
| Cold index, including input ownership copy | 20.584 | 35.781 |
| Cold index and full value enumeration | 41.199 | 52.359 |
| Warm scalar lookup | 0.041 | 0.074 |
| Owned byte-array lookup | 0.092 | 0.121 |

The complete measurement is retained in `qualification/cost.json` beside the
native fixture. These numbers describe this corpus and host; they are not a
before-and-after speedup or a guarantee for larger files.

```sh
node scripts/limited.js node packages/clr/tools/capture-resources.mjs artifacts/clr-resources
node scripts/limited.js node --test tests/clr-resources-reader.test.js tests/clr-resources-corruption.test.js tests/clr-resources-reference.test.js
node scripts/limited.js node packages/clr/tools/benchmark-resources.mjs
```

This is a host JavaScript metadata service. `ResourceManager` culture/satellite
fallback, assembly manifest resource resolution, managed stream execution and
source VM/direct CIL/Rust native/Wasm integration belong to separate tasks.
Opaque serialized payloads are not interpreted or validated as object graphs.

Format references: [.NET resource layout](https://source.dot.net/System.Private.CoreLib/src/runtime/src/libraries/System.Private.CoreLib/src/System/Resources/RuntimeResourceSet.cs.html),
[ResourceTypeCode](https://source.dot.net/System.Resources.Writer/src/runtime/src/libraries/System.Private.CoreLib/src/System/Resources/ResourceTypeCode.cs.html),
and [ResourceReader implementation](https://source.dot.net/System.Private.CoreLib/src/runtime/src/libraries/System.Private.CoreLib/src/System/Resources/ResourceReader.cs.html).
