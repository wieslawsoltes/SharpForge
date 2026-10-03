# Metadata import fixtures

Real assemblies produced by the C# compiler, read by `tests/compiler-metadata-import.test.js`,
`tests/compiler-metadata-attributes.test.js` and `tests/compiler-reference-manager.test.js`.
The tests never invoke `dotnet`; they only read the checked-in DLLs.

Regenerate with `node tests/fixtures/metadata/build-fixtures.mjs` (needs a .NET SDK; built with 10.0.201).
Builds are deterministic. All strongly named fixtures are public-signed with `src/fixtures-public.snk`
(a public key only; there is no private key).

| Assembly | Source | Purpose |
| --- | --- | --- |
| `MiniStandard.dll` (2.1.0.0) | `src/MiniStandard.cs`, `-nostdlib` | A self-contained core library: System.Object, the primitive types, Console, `List<T>`, `IEnumerable<T>`, the well-known attributes and uses of them, nested and generic types, ref/out/in/params parameters, events, pointers and function pointers. |
| `VersionedLib.1.0.0.0.dll`, `.1.0.0.5.dll`, `.2.0.0.0.dll` | `src/VersionedLib.cs` | Three versions of one strongly named library (assembly name `VersionedLib`). |
| `ConsumerOfV1.dll`, `ConsumerOfV2.dll` | `src/Consumer.cs` | Compiled against VersionedLib 1.0.0.0 and 2.0.0.0: unification (CS1701, CS1702), CS1705 and CS0012. |
| `WeakLib.1.0.0.0.dll`, `WeakLib.2.0.0.0.dll` | `src/VersionedLib.cs`, unsigned | Weakly named pair with one simple name (CS1704). |
| `Facade.dll` | `src/Forwarding.cs` (`FACADE`) | Forwards `Lib.Widget` and `Lib.Gadget` to VersionedLib through ExportedType rows. |
| `FacadeConsumer.dll` | `src/Forwarding.cs` (`FACADE_CONSUMER`) | Compiled against an older Facade that defined `Lib.Widget` itself, so its TypeRefs name `Facade`. |
| `CycleA.dll`, `CycleB.dll`, `CycleConsumer.dll` | `src/Forwarding.cs` (`CYCLE_*`) | Two assemblies that forward `Loop.Node` to each other (CS0731) and a consumer of that type. |
