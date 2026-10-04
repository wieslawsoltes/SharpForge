# Native binary permission-set fixture

The .NET SRM `BlobEncoder.PermissionSetBlob` and `PermissionSetArguments` APIs
produce three permission blobs: empty, a SecurityPermission Execution property,
and two permission attributes with Boolean, string and Int32 field/property data.
The type names are never resolved or instantiated. This is binary serialization
evidence, not Roslyn source binding or Code Access Security enforcement.

```sh
PATH=/path/to/dotnet:$PATH node scripts/limited.js node packages/cil/tools/validate-permission-sets.mjs --capture-fixtures
```

Run only in the scheduled exclusive slot. The capture records the installed SDK,
runtime and normalized source hash. Ordinary tests use the pinned JSON offline.
