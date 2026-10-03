using System.Reflection.Metadata;
using System.Reflection.PortableExecutable;
using System.Runtime.InteropServices;
using System.Runtime.Loader;
using System.Text.Json;

var observations = new List<object>();
foreach (var path in args) {
    using var stream = File.OpenRead(path);
    using var pe = new PEReader(stream);
    var metadata = pe.GetMetadataReader();
    var resources = metadata.ManifestResources.Select(handle => {
        var resource = metadata.GetManifestResource(handle);
        return new { name = metadata.GetString(resource.Name), flags = (int)resource.Attributes, offset = resource.Offset };
    }).ToArray();
    var architecture = RuntimeInformation.ProcessArchitecture;
    bool matchingHost = pe.PEHeaders.CoffHeader.Machine switch {
        Machine.I386 => !pe.PEHeaders.CorHeader!.Flags.HasFlag(CorFlags.Requires32Bit) || architecture == Architecture.X86,
        Machine.Amd64 => architecture == Architecture.X64,
        Machine.Arm64 => architecture == Architecture.Arm64,
        _ => false
    };
    var payloads = new List<object>();
    if (matchingHost) {
        var context = new AssemblyLoadContext(Path.GetFileName(path), isCollectible: true);
        try {
            var assembly = context.LoadFromAssemblyPath(Path.GetFullPath(path));
            foreach (var name in assembly.GetManifestResourceNames()) {
                using var resource = assembly.GetManifestResourceStream(name) ?? throw new Exception($"Missing resource {name}");
                using var memory = new MemoryStream();
                resource.CopyTo(memory);
                payloads.Add(new { name, bytes = Convert.ToBase64String(memory.ToArray()) });
            }
        } finally { context.Unload(); }
    }
    observations.Add(new { platform = Path.GetFileNameWithoutExtension(path), resources, payloads,
        execution = matchingHost ? "passed" : "unsupported-host" });
}
Console.WriteLine(JsonSerializer.Serialize(new { runtime = RuntimeInformation.FrameworkDescription,
    architecture = RuntimeInformation.ProcessArchitecture.ToString(), observations }, new JsonSerializerOptions { WriteIndented = true }));
