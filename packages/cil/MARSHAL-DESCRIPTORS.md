# Native marshal descriptor inspection

`decodeMarshalDescriptor(bytes, options)` reads a complete `FieldMarshal.NativeType`
blob. Pass a `Uint8Array` (including Buffer/subarray views); the result contains no
borrowed bytes. It returns `{ type, name, ...tail }`, where `type` is the numeric
native storage code and `name` is its `UnmanagedType` name.

```js
import { decodeMarshalDescriptor } from '@sharpforge/cil';
const descriptor = decodeMarshalDescriptor(metadata.blob(fieldMarshalRow[1]));
// LPArray: { type: 42, name: 'LPArray', elementType: { type: 7, name: 'I4' },
//            sizeParameterIndex: 1, sizeConstant: 4, flags: 1 }
```

The reader recognizes the current .NET `UnmanagedType` scalar codes and these
tails. Optional fields are omitted when absent; no runtime defaults are invented.

| Descriptor | Tail data |
| --- | --- |
| ByValTStr | Required `sizeConstant` |
| ByValArray | Required `sizeConstant`, optional `elementType` |
| LPArray | Optional `elementType`, `sizeParameterIndex`, `sizeConstant`, `flags`, in that order |
| IUnknown, IDispatch, Interface | Optional `iidParameterIndex` |
| SafeArray | Optional raw `variantType`, then `userDefinedType` string |
| CustomMarshaler | Required `guid`, `nativeTypeName`, `managedTypeName`, `cookie` strings |

An array element code `0x50` is reported as `{ type: 80, name: 'Default' }`.
LPArray flags are preserved: bit 0 indicates that the encoded size parameter is
used, so a zero dummy index with flags 0 must not be treated as a real parameter.
Array sizes are numbers only: inspection never allocates an array of that size.
Variant subtype/flag values are exposed as raw data, without validating whether
the runtime can marshal the corresponding managed signature.

Malformed, truncated, noncanonical compressed integers, invalid UTF-8 or trailing
bytes throw a `CilError` with `MD0130`; unknown native type codes throw `MD0131`.
`maxBytes` defaults to 1 MiB and `maxStringBytes` to 64 KiB (both configurable from
0 through 16 MiB). Budget failures use `MD0132`, and a pre-aborted `signal` uses
`MD0133`. Limits apply before string decoding. Work is linear in the descriptor
bytes; scalar/array descriptors use constant scratch space, and string outputs
are bounded by the input and string limits.

This is metadata inspection. It does not load referenced types, activate custom
marshalers, invoke native imports, validate owner signatures, emit descriptors,
or decode DeclSecurity. Legacy native codes outside the .NET enum remain
unsupported. It implements the FieldMarshal portion of #2387; permission sets
and broader platform qualification remain open.

Reference grammar: [Roslyn marshalling serializer](https://github.com/dotnet/roslyn/blob/main/src/Compilers/Core/Portable/PEWriter/MetadataWriter.cs),
[CoreCLR native-type parser](https://github.com/dotnet/runtime/blob/main/src/coreclr/vm/mlinfo.cpp),
and [.NET UnmanagedType](https://github.com/dotnet/runtime/blob/main/src/libraries/System.Private.CoreLib/src/System/Runtime/InteropServices/UnmanagedType.cs).
Pinned native captures and their source hash are in `tests/fixtures/marshal-descriptors`.

Validation: SDK 10.0.201 / CoreCLR 10.0.5 on macOS ARM64 captured 14 descriptors;
all 7 focused Node tests pass. COM subtype/IID and custom string properties use
native SRM BlobReader because this host's synthesized MarshalAs attributes omit
COM fields and return an overlong custom type string. Those reflection properties
are not claimed as passing. Static checks pass (1895 syntax / 1891 static modules)
with no introduced structure findings. No full platform matrix or throughput
benchmark was run for this new, opt-in inspection API.
