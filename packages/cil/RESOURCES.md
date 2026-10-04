# Embedded managed resources

`emitAssembly(image, { managedResources })` and compiler `compileToIL(source, options)` accept an ordered array:

```js
const managedResources = [
  { name: 'Example.settings', bytes: new TextEncoder().encode('{"theme":"dark"}'), visibility: 'public' },
  { name: 'Example.empty', bytes: new Uint8Array(), visibility: 'private' },
];
```

Names must be nonempty valid Unicode strings without NUL, at most 1,024 UTF-16 code units, and unique within the array.
Payloads are `Uint8Array`; visibility is `public` (default) or `private`. Empty payloads are valid. Invalid entries throw
`CilError` from emission; the compiler reports emission failure in its diagnostics. There are at most 65,535 resources
and 64 MiB of combined length prefixes, payloads and padding. Resources preserve input order and participate in the
existing content-derived build identifier. Emission never reads files or accesses the network.

Every resource receives a ManifestResource row with nil Implementation, a public/private flag, and an offset into the
CLI Resources directory. Each four-byte length prefix starts on an eight-byte boundary. The directory is embedded in
`.text`, after method bodies and before metadata. Linked external resources are outside this emit option's scope.

`readManagedResources(readPE(bytes), { includeBytes: false, maxResourceBytes: 64 * 1024 * 1024 })` returns the metadata
name, flags, offset, implementation token and size. Embedded resource ranges are checked before use. `includeBytes`
adds a copied `bytes` payload to embedded resources. External resources have `size: null` and no bytes; this API does
not resolve or fetch them. `inspectAssembly(bytes).resources` uses the same bounded reader and reports sizes without
copying payloads. Malformed embedded resource ranges throw `CilError`.

The low-level `writeManagedResources(resources, metadataBuilder)` returns the resource directory bytes while adding
rows through the existing manifest writer. `writePE(..., { resources: { offset, size } })` points the CLI header to bytes
already present in its first section; the range cannot overlap metadata. `ManifestResourceVisibility` exposes the
numeric Public/Private flag constants for metadata consumers.

Resources remain ordinary data during canonical source replay and direct CIL execution. These APIs do not add
`System.Reflection.Assembly.GetManifestResourceStream` to the JavaScript runtime. Native .NET consumers can use that
reflection API to read public and private emitted resources.
