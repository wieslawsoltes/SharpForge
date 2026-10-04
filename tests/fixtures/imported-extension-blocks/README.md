# Imported C# 14 extension blocks

`ExtensionLibrary.dll` is a deterministic Roslyn build of `ExtensionLibrary.cs`.
It contains actual grouping types, marker types, marker-name attributes, and
callable implementation methods. The SDK emits the .NET 10
[`ExtensionMarkerAttribute`](https://learn.microsoft.com/dotnet/api/system.runtime.compilerservices.extensionmarkerattribute?view=net-10.0).
`LegacyMarker.cs` declares the original proposal's attribute name; one test
redirects the marker constructor reference to that declaration to exercise
compatibility without claiming it is output from an earlier compiler.
`provenance.json` records the compiler, SDK,
reference pack, command options, and source/input/output SHA-256 hashes.

Regenerate in the scheduled serial validation slot with an installed .NET SDK:

```sh
node scripts/limited.js node tests/fixtures/imported-extension-blocks/generate.mjs \
  --dotnet "$DOTNET_ROOT/dotnet" \
  --sdk "$DOTNET_ROOT/sdk/10.0.201" \
  --reference-pack "$DOTNET_ROOT/packs/Microsoft.NETCore.App.Ref/10.0.5/ref/net10.0"
```

The generator normalizes the source directory with the compiler's path map,
invokes the selected compiler directly, and does not restore packages or access
the network. The checked-in fixture makes metadata tests
portable; tests never regenerate it. Direct CIL consumer tests use an installed
.NET reference pack and report an explicit skip when one is unavailable.
The cross-assembly execution check uses .NET; the browser source/CIL profiles
do not load this external assembly's method bodies. Existing source extension
regressions exercise those profiles separately.

The importer returns the top-level implementation MethodDefs. It does not emit
new grouping/marker metadata for source declarations, and it shares the current
binder's restrictions on write-only properties, generic static members with
independent method type parameters, and instance compound-assignment operators.
Those are separate remaining obligations under SF-A02-T83.
