using System.Reflection.Metadata;
using System.Reflection.Metadata.Ecma335;
using System.Reflection.PortableExecutable;
using System.Runtime.InteropServices;
using System.Text.Json;

var cases = new List<object>();
foreach (string path in args)
{
    using var stream = File.OpenRead(path);
    using var pe = new PEReader(stream);
    var metadata = pe.GetMetadataReader();
    cases.Add(new {
        platform = Path.GetFileNameWithoutExtension(path), isAssembly = metadata.IsAssembly,
        name = metadata.GetString(metadata.GetModuleDefinition().Name), assemblyRows = metadata.GetTableRowCount(TableIndex.Assembly),
        entryPoint = pe.PEHeaders.CorHeader!.EntryPointTokenOrRelativeVirtualAddress,
        types = metadata.TypeDefinitions.Select(handle => metadata.GetString(metadata.GetTypeDefinition(handle).Name)).ToArray(),
    });
}
Console.WriteLine(JsonSerializer.Serialize(new { runtime = RuntimeInformation.FrameworkDescription, cases },
    new JsonSerializerOptions { WriteIndented = true }));
