using System.Reflection.Metadata;
using System.Reflection.Metadata.Ecma335;
using System.Reflection.PortableExecutable;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text.Json;

using var stream = File.OpenRead(args[0]);
using var pe = new PEReader(stream);
var metadata = pe.GetMetadataReader();
var exports = metadata.ExportedTypes.Select(handle => new {
    token = MetadataTokens.GetToken(handle),
    name = metadata.GetString(metadata.GetExportedType(handle).Name),
    implementation = MetadataTokens.GetToken(metadata.GetExportedType(handle).Implementation),
    typeDefId = metadata.GetExportedType(handle).GetTypeDefinitionId(),
}).ToArray();
int FileFor(int token)
{
    for (int depth = 0; depth < 64; depth++)
    {
        if ((token >> 24) == 0x26) return token;
        token = exports.Single(value => value.token == token).implementation;
    }
    throw new InvalidOperationException("Excessive nesting");
}
var modules = new List<object>();
foreach (var handle in metadata.AssemblyFiles)
{
    var file = metadata.GetAssemblyFile(handle);
    var name = metadata.GetString(file.Name);
    var bytes = File.ReadAllBytes(Path.Combine(Path.GetDirectoryName(args[0])!, name));
    using var modulePe = new PEReader(new MemoryStream(bytes));
    var moduleMetadata = modulePe.GetMetadataReader();
    bool hints = exports.Where(value => FileFor(value.implementation) == MetadataTokens.GetToken(handle))
        .All(value => moduleMetadata.GetString(moduleMetadata.GetTypeDefinition(
            MetadataTokens.TypeDefinitionHandle(value.typeDefId)).Name) == value.name);
    modules.Add(new { name, hashMatches = metadata.GetBlobBytes(file.HashValue).SequenceEqual(SHA256.HashData(bytes)),
        typeHintsMatch = hints, containsMetadata = file.ContainsMetadata });
}
Console.WriteLine(JsonSerializer.Serialize(new { runtime = RuntimeInformation.FrameworkDescription,
    hashAlgorithm = metadata.GetAssemblyDefinition().HashAlgorithm.ToString(), modules, exports },
    new JsonSerializerOptions { WriteIndented = true }));
