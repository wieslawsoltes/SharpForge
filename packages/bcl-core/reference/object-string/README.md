# Framework Object.ToString reference

This fixture pins SDK 10.0.201 and runtime 10.0.5. Native Reflection.Emit emits
the actual `call` and `callvirt` instructions against `System.Object.ToString`;
ordinary reflection invocation would not establish their dispatch difference.
The output includes StringBuilder, absolute/relative Uri, null, hidden methods
and primitive controls. Program.cs is hashed in the committed capture.

Root executes this fixture once, with build output separate from the artifact:

```sh
dotnet build ObjectString.csproj --configuration Release --verbosity quiet
dotnet bin/Release/net10.0/ObjectString.dll ../object-string-net10.json
```

The runtime change qualifies explicit framework overrides only. Primitive
nonvirtual formatting retains SharpForge's released profile; native rows expose
that distinction rather than extending the implementation to primitive dispatch.
Relative Uri is retained as native evidence without claiming the unsupported
Uri(string, UriKind) constructor. The executable constructor cases use absolute Uri.
