# Binary permission-set inspection

`decodeBinaryPermissionSet(bytes, options)` reads the ECMA DeclSecurity binary
permission-set format beginning with `.`. It returns `{ format: 'binary',
attributes: [{ typeName, namedArguments }] }`. Each named argument has the same
`{ name, isField, value }` typed-value shape as `decodeCustomAttribute`; enum
underlying types must be supplied through the existing `enumUnderlyingType`
callback or metadata context. Type names are data and never trigger loading.

```js
import { decodeBinaryPermissionSet } from '@sharpforge/cil';
const declaration = decodeBinaryPermissionSet(metadata.blob(declSecurityRow[2]));
```

The decoder reuses the attribute reader and its string, primitive, array, enum
and named-argument rules. It reads each attribute body through a temporary byte
view, with no copy of the body or complete permission blob. Returned strings
and typed values do not alias the supplied Uint8Array/Buffer. Array sizes and
all values share one aggregate attribute-decoder complexity budget.

Defaults are 8 MiB input, 1,000 attributes, 64 KiB strings, 100,000 value/type
nodes, depth 64 and 100,000 array elements. `maxBytes` is capped at 16 MiB and
`maxAttributes` at 100,000. Remaining limits use the existing custom-attribute
options. Parsing is linear in input and output size, bounded before expansion.
A pre-aborted `signal` throws MD0143; attribute traversal also observes it.

Unsupported format (including legacy XML) uses MD0140; malformed framing uses
MD0141; input/attribute limits use MD0142. Named-argument and inherited value
failures preserve MD0100–MD0110, including MD0108 for aggregate complexity and
MD0109 for cancellation during traversal. Errors throw `CilError` and never
return partial declarations. MD0141 offsets are local to the failing reader;
they are not file offsets or an ownership-validation result.

The security action and parent are separate DeclSecurity columns and are not
part of this blob. This API does not validate those columns, instantiate
attributes, enforce Code Access Security, or decode legacy XML. It is another
partial of #2387; no permission execution or whole-platform qualification is
claimed.

Reference grammar is the [Roslyn permission-set serializer](https://github.com/dotnet/roslyn/blob/main/src/Compilers/Core/Portable/PEWriter/MetadataWriter.cs)
and [native SRM BlobEncoder](https://source.dot.net/system.reflection.metadata/System/Reflection/Metadata/Ecma335/Encoding/BlobEncoders.cs.html).
The fixture uses the installed .NET SRM encoder to produce empty, SecurityPermission
and multiple-attribute blobs; it does not claim compiler binding of security attributes.

Validation on Node 24.21.0/macOS ARM64: native SDK 10.0.201 / CoreCLR 10.0.5
confirms all three blobs, 23 focused permission/attribute/compiler-import tests
pass, syntax checks cover 1940 modules and static checks cover 1936 with zero
errors, and structure has no introduced findings. The initial array test used
an unsupported type shorthand; it now supplies the existing typed array AST.

The existing attribute-decoder benchmark measured median 0.80156 → 0.81594 µs
(+1.8%), p95 1.26435 → 1.34694 µs (+6.5%), and sampled allocations 2529 → 2522
bytes/op. Root review accepts the 0.083 µs p95 increase for the shared parsing
seam; this provides permission decoding without copying attribute bodies or
duplicating their grammar. The host was shared, measurements are not proof of
statistical significance, and no speedup is claimed. Command and raw 31-sample
results are in `benchmarks/permission-reader-node24.json`.
