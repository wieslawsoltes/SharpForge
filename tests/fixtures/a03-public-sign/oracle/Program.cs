using System.Reflection;
using System.Reflection.Metadata;
using System.Reflection.PortableExecutable;
using System.Runtime.InteropServices;
using System.Text.Json;

var cases = new List<object>();
foreach (string path in args)
{
    using var stream = File.OpenRead(path);
    using var pe = new PEReader(stream);
    var metadata = pe.GetMetadataReader();
    var assembly = metadata.GetAssemblyDefinition();
    var name = AssemblyName.GetAssemblyName(path);
    var directory = pe.PEHeaders.CorHeader!.StrongNameSignatureDirectory;
    var signature = pe.GetSectionData(directory.RelativeVirtualAddress).GetContent(0, directory.Size);
    var labels = Path.GetFileNameWithoutExtension(path).Split('-');
    cases.Add(new {
        mode = labels[0], platform = labels[1],
        publicKeyToken = Convert.ToHexString(name.GetPublicKeyToken()!).ToLowerInvariant(),
        publicKeyFlag = assembly.Flags.HasFlag(AssemblyFlags.PublicKey),
        strongNameSigned = pe.PEHeaders.CorHeader.Flags.HasFlag(CorFlags.StrongNameSigned),
        signatureSize = directory.Size, zeroSignature = signature.All(value => value == 0),
    });
}
Console.WriteLine(JsonSerializer.Serialize(new { runtime = RuntimeInformation.FrameworkDescription, cases },
    new JsonSerializerOptions { WriteIndented = true }));
