# Native FieldMarshal reference

`oracle/Program.cs` builds fourteen Roslyn FieldMarshal descriptors and records
their raw SRM blob bytes alongside reflection's synthesized MarshalAs properties.
It covers fields, parameters, a return parameter, strings, fixed arrays, LPArray
size combinations, a COM interface, SafeArray subtypes and a custom marshaler
cookie. The native imports and custom marshaler are never invoked.

The captured macOS CoreCLR does not populate SafeArray subtype/user-type and COM
interface IID fields in its synthesized MarshalAs attributes. It also returns
an overlong MarshalType string for the custom descriptor. These tail values
are independently read by native SRM BlobReader and stored in `srmTail`; the
unreliable custom reflection strings are recorded as null. Scalar/array
properties still compare with reflection. No COM/custom reflection parity is claimed.

Capture with .NET 10 installed, during the exclusive validation slot:

```sh
PATH=/path/to/dotnet:$PATH node scripts/limited.js node packages/cil/tools/validate-marshal-descriptors.mjs --capture-fixtures
```

The capture records SDK/runtime versions and the normalized source SHA-256.
Ordinary Node tests read the committed JSON and require no native SDK or network.
This qualifies metadata inspection on the recorded host, not execution of the
marshalling machinery or cross-platform native interop.
