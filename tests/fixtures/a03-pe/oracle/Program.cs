using System.Reflection;
using System.Reflection.Metadata;
using System.Reflection.PortableExecutable;
using System.Runtime.InteropServices;
using System.Runtime.Loader;
using System.Text.Json;

var observations = new List<object>();
foreach (var path in args) {
    using var stream = File.OpenRead(path);
    using var reader = new PEReader(stream);
    var headers = reader.PEHeaders;
    var pe = headers.PEHeader!;
    var cli = headers.CorHeader!;
    var metadata = reader.GetMetadataReader();
    var architecture = RuntimeInformation.ProcessArchitecture;
    bool matchingHost = headers.CoffHeader.Machine switch {
        Machine.I386 => !cli.Flags.HasFlag(CorFlags.Requires32Bit) || architecture == Architecture.X86,
        Machine.Amd64 => architecture == Architecture.X64,
        Machine.Arm64 => architecture == Architecture.Arm64,
        _ => false
    };
    string execution = "unsupported-host";
    int? reflectedKind = null, reflectedMachine = null;
    var name = Path.GetFileName(path);
    if (matchingHost && !name.StartsWith("desktop-")) {
        var context = new AssemblyLoadContext(name, isCollectible: true);
        try {
            var assembly = context.LoadFromAssemblyPath(Path.GetFullPath(path));
            assembly.ManifestModule.GetPEKind(out var kind, out var machine);
            reflectedKind = (int)kind;
            reflectedMachine = (int)machine;
            if (assembly.EntryPoint != null) {
                var previous = Console.Out;
                using var output = new StringWriter();
                try {
                    Console.SetOut(output);
                    assembly.EntryPoint.Invoke(null, assembly.EntryPoint.GetParameters().Length == 0 ? null : new object[] { Array.Empty<string>() });
                } finally { Console.SetOut(previous); }
                if (output.ToString().Replace("\r\n", "\n") != "42\n") throw new Exception("Unexpected emitted program output");
            }
            execution = "passed";
        } finally { context.Unload(); }
    }
    observations.Add(new {
        name, machine = (int)headers.CoffHeader.Machine, magic = (int)pe.Magic,
        characteristics = (int)headers.CoffHeader.Characteristics, flags = (int)cli.Flags,
        subsystem = (int)pe.Subsystem, entryPoint = pe.AddressOfEntryPoint,
        assemblyName = metadata.GetString(metadata.GetAssemblyDefinition().Name),
        sections = headers.SectionHeaders.Select(section => new { section.Name, section.VirtualAddress, section.PointerToRawData,
            section.SizeOfRawData, section.VirtualSize }).ToArray(), execution, reflectedKind, reflectedMachine
    });
}
Console.WriteLine(JsonSerializer.Serialize(new { runtime = RuntimeInformation.FrameworkDescription,
    architecture = RuntimeInformation.ProcessArchitecture.ToString(), observations }, new JsonSerializerOptions { WriteIndented = true }));
