# Input reference assembly identities

Captured with .NET SDK 10.0.201 / runtime 10.0.5 on macOS ARM64. Both consumers match
their source reference identities in `native.json`. The generator reads actual net9/net10 reference-pack System.Runtime and System.Console assemblies, then compiles
consumers. The .NET oracle uses `Assembly.GetReferencedAssemblies` to independently inspect
full-key AssemblyRef versions/cultures/tokens. No SHA-1 implementation is added.

Available reference directories discovered on this host:

- `/Users/wieslawsoltes/.nuget/packages/microsoft.netcore.app.ref/9.0.17/ref/net9.0`
- `/Users/wieslawsoltes/.dotnet/packs/Microsoft.NETCore.App.Ref/10.0.5/ref/net10.0`

Run `prepare.js OUTPUT NET9_REFERENCE_DIRECTORY NET10_REFERENCE_DIRECTORY` through the limiter,
build `oracle/References.csproj` with `--disable-build-servers -m:1` and isolated `/tmp` output/obj,
then run the oracle on the two generated DLLs and capture `native.json`. No browser/platform
or actual CLR execution of the generated consumers is claimed by metadata inspection alone.
