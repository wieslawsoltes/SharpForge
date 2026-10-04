/** The text of `help` and of an unknown command (apps/cli/main.js prints it). */
export const helpText = `SharpForge 0.14 — JavaScript C# / ECMA-335 toolchain

Usage:
  Options: --lang-version 14|preview (loose source), --allow-origin https://host[:port] (repeatable), --compute-backend auto|wasm|scalar, --compute-workers 1..8
  Networking is disabled unless an exact origin is explicitly granted. Browser/OS networking policies still apply.
  node apps/cli/main.js run Program.cs [Other.cs]
  node apps/cli/main.js project-info Workspace.slnx
  node apps/cli/main.js run Workspace.slnx --project App/App.csproj
  node apps/cli/main.js compile Library.csproj -o library.dll
  node apps/cli/main.js run Library.csproj --method Math::Add --args '[20,22]'
  node apps/cli/main.js check Program.cs
  node apps/cli/main.js compile Program.cs -o app.dll
  node apps/cli/main.js compile Program.cs --format dotnet -o app.dll   (then: dotnet app.dll)
  node apps/cli/main.js inspect library.dll
  node apps/cli/main.js verify library.dll --method 'Demo::Add' --args '[2,3]'
  node apps/cli/main.js invoke library.dll --method 'Demo::Add' --args '[2,3]'
  node apps/cli/main.js decompile library.dll
  node apps/cli/main.js il-export library.dll -o library.sf.il
  node apps/cli/main.js il-assemble library.sf.il -o edited.dll
  node apps/cli/main.js exec app.dll
  node apps/cli/main.js disasm app.dll
  node apps/cli/main.js disasm Program.cs
  node apps/cli/main.js compile Program.cs --format ir -o app.sfb.json

Project/workspace commands:
  templates [--items] [--search TEXT]
  new TEMPLATE --name NAME -o DIRECTORY [--zip] [--no-solution]
  zip DIRECTORY -o workspace.zip
  unzip workspace.zip -o NEW_OR_EMPTY_DIRECTORY

Options:
  --root DIRECTORY         Disk boundary (defaults to entry file directory)
  --project PATH           Startup csproj path relative to disk root
  --configuration NAME     Evaluated Configuration (default Debug)
  --target exe|library     Output kind for loose source files
  --checked                Checked integer arithmetic for loose C# source inputs
  --name NAME              Assembly name (defaults to output basename)
  --pdb PATH               PDB output, or sidecar input for symbols
  --embedded-pdb           Embed matching Portable PDB in compiled PE
  --format cil|dotnet|ir   cil: PE/CLI with the SharpForge loader profile (default); dotnet: a .NET
                           assembly bound against reference assemblies, with app.runtimeconfig.json;
                           ir: legacy JSON image
  --reference PATH         Reference assembly for --format dotnet (repeatable)
  --reference-pack DIR     Directory of reference assemblies, or a .NET installation, for --format dotnet
                           (default: the reference pack of the installed .NET SDK; DOTNET_ROOT is honoured)
  --framework net8         Standard .NET 8+ framework references (default)
  --framework mscorlib4    .NET Framework/Mono reference identity
  --no-sources             Keep debug maps but omit source text
  --native-only            Omit #SF source-debug profile
  --method TYPE::METHOD    Select a static method (or hexadecimal MethodDef token)
  --args JSON              Primitive arguments as a JSON array
  --managed-il             Explicit direct-CIL execution instead of the #SF loader
  --max-instructions N     Hard guest instruction limit (default 20000000)

CIL is the default format. Ordinary DLL inspection is broader than execution.
--format dotnet compiles loose sources and projects through the direct CIL pipeline; the output
runs on the installed .NET runtime, not on the SharpForge runtimes (run, exec).
The managed interpreter supports a bounded, explicitly verified subset; external
assemblies, native code and general CLR/BCL compatibility are not provided.
C# decompilation falls back to complete method IL when reconstruction is unsupported.
Editable SharpForge.IL/1 is a metadata-preserving dialect, not Microsoft ilasm.`;
