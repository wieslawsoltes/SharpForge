using System.Collections.Immutable;
using System.Reflection.Metadata;
using System.Reflection.Metadata.Ecma335;
using System.Reflection.PortableExecutable;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

static object Import(MetadataReader reader, ImportDefinition import)
{
    var kind = (int)import.Kind;
    return new {
        kind,
        alias = kind >= 4 ? Encoding.UTF8.GetString(reader.GetBlobBytes(import.Alias)) : null,
        assembly = kind is 2 or 6 or 8 ? MetadataTokens.GetRowNumber(import.TargetAssembly) : (int?)null,
        @namespace = kind is 1 or 2 or 4 or 7 or 8 ? Encoding.UTF8.GetString(reader.GetBlobBytes(import.TargetNamespace)) : null,
        type = kind is 3 or 9 ? MetadataTokens.GetToken(import.TargetType) : (int?)null
    };
}

static string? ConstantValue(MetadataReader metadata, BlobHandle signature)
{
    var reader = metadata.GetBlobReader(signature);
    var code = reader.ReadByte();
    return code switch {
        2 => reader.ReadByte() == 0 ? "false" : "true",
        3 => reader.ReadUInt16().ToString(System.Globalization.CultureInfo.InvariantCulture),
        4 => reader.ReadSByte().ToString(System.Globalization.CultureInfo.InvariantCulture),
        5 => reader.ReadByte().ToString(System.Globalization.CultureInfo.InvariantCulture),
        6 => reader.ReadInt16().ToString(System.Globalization.CultureInfo.InvariantCulture),
        7 => reader.ReadUInt16().ToString(System.Globalization.CultureInfo.InvariantCulture),
        8 => reader.ReadInt32().ToString(System.Globalization.CultureInfo.InvariantCulture),
        9 => reader.ReadUInt32().ToString(System.Globalization.CultureInfo.InvariantCulture),
        10 => reader.ReadInt64().ToString(System.Globalization.CultureInfo.InvariantCulture),
        11 => reader.ReadUInt64().ToString(System.Globalization.CultureInfo.InvariantCulture),
        12 => reader.ReadSingle().ToString(System.Globalization.CultureInfo.InvariantCulture),
        13 => reader.ReadDouble().ToString(System.Globalization.CultureInfo.InvariantCulture),
        14 => reader.RemainingBytes == 1 ? null : reader.ReadUTF16(reader.RemainingBytes),
        _ => null
    };
}

static object Inspect(string path, string? pePath)
{
    using var provider = MetadataReaderProvider.FromPortablePdbStream(File.OpenRead(path));
    var reader = provider.GetMetadataReader();
    var directories = new List<object>();
    if (pePath is not null)
    {
        using var pe = new PEReader(File.OpenRead(pePath));
        foreach (var entry in pe.ReadDebugDirectory())
        {
            if (entry.Type == DebugDirectoryEntryType.CodeView)
            {
                var code = pe.ReadCodeViewDebugDirectoryData(entry);
                directories.Add(new { kind = (int)entry.Type, guid = code.Guid.ToString(), code.Age, code.Path, entry.Stamp });
            }
            else if (entry.Type == DebugDirectoryEntryType.PdbChecksum)
            {
                var checksum = pe.ReadPdbChecksumDebugDirectoryData(entry);
                directories.Add(new { kind = (int)entry.Type, checksum.AlgorithmName, checksum = Convert.ToHexString(checksum.Checksum.AsSpan()) });
            }
            else if (entry.Type == DebugDirectoryEntryType.EmbeddedPortablePdb)
            {
                using var embedded = pe.ReadEmbeddedPortablePdbDebugDirectoryData(entry);
                directories.Add(new { kind = (int)entry.Type, id = Convert.ToHexString(embedded.GetMetadataReader().DebugMetadataHeader!.Id.AsSpan()) });
            }
            else directories.Add(new { kind = (int)entry.Type });
        }
    }
    return new {
        id = Convert.ToHexString(reader.DebugMetadataHeader!.Id.AsSpan()),
        entryPoint = MetadataTokens.GetToken(reader.DebugMetadataHeader.EntryPoint),
        documents = reader.Documents.Select(handle => {
            var document = reader.GetDocument(handle);
            return new { id = MetadataTokens.GetRowNumber(handle), name = reader.GetString(document.Name),
                hashAlgorithm = reader.GetGuid(document.HashAlgorithm).ToString(), hash = Convert.ToHexString(reader.GetBlobBytes(document.Hash)),
                language = reader.GetGuid(document.Language).ToString(), nameBlob = Convert.ToHexString(reader.GetBlobBytes(document.Name)) };
        }).ToArray(),
        imports = reader.ImportScopes.Select(handle => {
            var scope = reader.GetImportScope(handle);
            return new { id = MetadataTokens.GetRowNumber(handle), parent = MetadataTokens.GetRowNumber(scope.Parent),
                definitions = scope.GetImports().Select(import => Import(reader, import)).ToArray() };
        }).ToArray(),
        constants = reader.LocalConstants.Select(handle => {
            var constant = reader.GetLocalConstant(handle);
            return new { name = reader.GetString(constant.Name), value = ConstantValue(reader, constant.Signature),
                signature = Convert.ToHexString(reader.GetBlobBytes(constant.Signature)) };
        }).ToArray(),
        scopes = reader.LocalScopes.Select(handle => {
            var scope = reader.GetLocalScope(handle);
            return new { method = MetadataTokens.GetToken(scope.Method), scope.StartOffset, scope.Length,
                importScope = MetadataTokens.GetRowNumber(scope.ImportScope),
                variables = scope.GetLocalVariables().Select(variable => MetadataTokens.GetRowNumber(variable)).ToArray(),
                constants = scope.GetLocalConstants().Select(constant => MetadataTokens.GetRowNumber(constant)).ToArray() };
        }).ToArray(),
        methods = reader.MethodDebugInformation.Select(handle => {
            var method = reader.GetMethodDebugInformation(handle);
            return new { token = 0x06000000 | MetadataTokens.GetRowNumber(handle),
                kickoff = MetadataTokens.GetToken(method.GetStateMachineKickoffMethod()),
                points = method.GetSequencePoints().Select(point => new { point.Offset, document = MetadataTokens.GetRowNumber(point.Document),
                    point.StartLine, point.StartColumn, point.EndLine, point.EndColumn, point.IsHidden }).ToArray() };
        }).ToArray(),
        custom = reader.CustomDebugInformation.Select(handle => {
            var record = reader.GetCustomDebugInformation(handle);
            return new { parent = MetadataTokens.GetToken(record.Parent), kind = reader.GetGuid(record.Kind).ToString(),
                bytes = Convert.ToHexString(reader.GetBlobBytes(record.Value)) };
        }).ToArray(),
        directories
    };
}

static void DocumentReference(string input, string output)
{
    var documents = JsonDocument.Parse(File.ReadAllText(input)).RootElement;
    var metadata = new MetadataBuilder();
    foreach (var document in documents.EnumerateArray())
    {
        var name = metadata.GetOrAddDocumentName(document.GetProperty("uri").GetString()!);
        var algorithm = Guid.Parse(document.GetProperty("hashAlgorithm").GetString()!);
        var hash = Convert.FromHexString(document.GetProperty("hash").GetString()!);
        var language = Guid.Parse(document.GetProperty("language").GetString()!);
        metadata.AddDocument(name, metadata.GetOrAddGuid(algorithm), metadata.GetOrAddBlob(hash), metadata.GetOrAddGuid(language));
    }
    var pdb = new PortablePdbBuilder(metadata, ImmutableArray.Create(new int[64]), default,
        blobs => BlobContentId.FromHash(SHA256.HashData(blobs.SelectMany(blob => blob.GetBytes()).ToArray())));
    var builder = new BlobBuilder();
    pdb.Serialize(builder);
    File.WriteAllBytes(output, builder.ToArray());
}

if (args.Length < 2) throw new ArgumentException("inspect PDB [PE] | documents INPUT_JSON OUTPUT_PDB");
if (args[0] == "documents") DocumentReference(args[1], args[2]);
else if (args[0] == "inspect") Console.WriteLine(JsonSerializer.Serialize(Inspect(args[1], args.Length > 2 ? args[2] : null)));
else throw new ArgumentException("Unknown command");
