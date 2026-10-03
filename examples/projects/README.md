# Disk project examples

Open a folder using File → Open folder. Select the .slnx/.csproj under Project Properties if the folder contains several examples. The default is the first solution, or otherwise the first project path.

- Workshop: multi-project solution, partial class, project reference and inherited properties. Startup: App/App.csproj. Prints 42.
- Linked: explicit Compile items, glob exclusion, and linked display path. Prints 42.
- Configurations: Debug/Release property conditions select different files.
- Library: no Main; select Arithmetic::Add in Assembly Explorer and invoke with [1,1] for 42. The generated .cctor initializes Offset.
- Unsupported: deliberately unresolved PackageReference. Expected SFP1102; build must be blocked. No package is downloaded.
- Generated: enable the JSON schema generator in Generators & Analyzers, paste customer.schema.json, then build. Prints 42. AdditionalFiles is recorded, but enabling a JavaScript generator is an explicit user operation; no project-specified code is executed.

The loader is a bounded evaluation subset. ProjectReference source files are combined, not separately linked; full namespaces, NuGet, MSBuild tasks and arbitrary framework compatibility are not supported. Tests consume ../coverage.json.
