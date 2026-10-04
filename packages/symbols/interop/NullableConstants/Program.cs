using System;
using System.Collections.Immutable;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Reflection.Metadata;
using System.Reflection.Metadata.Ecma335;
using System.Reflection.PortableExecutable;
using System.Security.Cryptography;
using System.Text.Json;

record ConstantCase(string Name, byte[] Argument, Type RuntimeType);

static class Program
{
    static BlobContentId ContentId(System.Collections.Generic.IEnumerable<Blob> blobs) =>
        BlobContentId.FromHash(SHA256.HashData(blobs.SelectMany(blob => blob.GetBytes()).ToArray()));

    static ConstantCase[] Cases() => [
        new("Boolean", [2], typeof(bool)), new("Char", [3], typeof(char)),
        new("SByte", [4], typeof(sbyte)), new("Byte", [5], typeof(byte)),
        new("Int16", [6], typeof(short)), new("UInt16", [7], typeof(ushort)),
        new("Int32", [8], typeof(int)), new("UInt32", [9], typeof(uint)),
        new("Int64", [10], typeof(long)), new("UInt64", [11], typeof(ulong)),
        new("Single", [12], typeof(float)), new("Double", [13], typeof(double)),
        new("IntPtr", [24], typeof(nint)), new("UIntPtr", [25], typeof(nuint)),
        new("Decimal", [17, 13], typeof(decimal)), new("DateTime", [17, 17], typeof(DateTime))
    ];

    static void Build(string directory, ConstantCase[] cases)
    {
        var metadata = new MetadataBuilder();
        metadata.AddModule(0, metadata.GetOrAddString("NullableDefaults.dll"),
            metadata.GetOrAddGuid(new Guid("7caa2d56-6725-452c-833b-c1d32a6793c7")), default, default);
        metadata.AddAssembly(metadata.GetOrAddString("NullableDefaults"), new Version(1, 0), default, default, 0, AssemblyHashAlgorithm.Sha256);
        var framework = metadata.AddAssemblyReference(metadata.GetOrAddString("System.Runtime"), new Version(10, 0, 0, 0),
            default, metadata.GetOrAddBlob(Convert.FromHexString("B03F5F7F11D50A3A")), 0, default);
        var objectType = metadata.AddTypeReference(framework, metadata.GetOrAddString("System"), metadata.GetOrAddString("Object"));
        metadata.AddTypeReference(framework, metadata.GetOrAddString("System"), metadata.GetOrAddString("Nullable`1"));
        metadata.AddTypeReference(framework, metadata.GetOrAddString("System"), metadata.GetOrAddString("Decimal"));
        metadata.AddTypeReference(framework, metadata.GetOrAddString("System"), metadata.GetOrAddString("DateTime"));
        var firstMethod = MetadataTokens.MethodDefinitionHandle(1);
        var firstField = MetadataTokens.FieldDefinitionHandle(1);
        metadata.AddTypeDefinition(0, default, metadata.GetOrAddString("<Module>"), default, firstField, firstMethod);
        metadata.AddTypeDefinition(TypeAttributes.Public, default, metadata.GetOrAddString("Fixture"), objectType, firstField, firstMethod);
        var instructions = new BlobBuilder();
        var encoder = new InstructionEncoder(instructions);
        encoder.OpCode(ILOpCode.Ret);
        var il = new BlobBuilder();
        var body = new MethodBodyStreamEncoder(il).AddMethodBody(encoder);
        metadata.AddMethodDefinition(MethodAttributes.Public | MethodAttributes.Static, MethodImplAttributes.IL,
            metadata.GetOrAddString("Run"), metadata.GetOrAddBlob(new byte[] { 0, 0, 1 }), body, MetadataTokens.ParameterHandle(1));
        var pdbMetadata = new MetadataBuilder();
        foreach (var item in cases)
        {
            var typeBytes = new byte[] { 0x15, 0x11, 9, 1 }.Concat(item.Argument).ToArray();
            var type = metadata.AddTypeSpecification(metadata.GetOrAddBlob(typeBytes));
            var signature = new BlobBuilder();
            signature.WriteByte(17);
            signature.WriteCompressedInteger((MetadataTokens.GetRowNumber(type) << 2) | 2);
            pdbMetadata.AddLocalConstant(pdbMetadata.GetOrAddString(item.Name), pdbMetadata.GetOrAddBlob(signature));
        }
        pdbMetadata.AddMethodDebugInformation(default, default);
        pdbMetadata.AddLocalScope(firstMethod, default, MetadataTokens.LocalVariableHandle(1), MetadataTokens.LocalConstantHandle(1), 0, 1);
        var pdb = new BlobBuilder();
        var id = new PortablePdbBuilder(pdbMetadata, metadata.GetRowCounts(), default, ContentId).Serialize(pdb);
        var debug = new DebugDirectoryBuilder();
        debug.AddCodeViewEntry("NullableDefaults.pdb", id, 0x0100);
        var pe = new BlobBuilder();
        new ManagedPEBuilder(new PEHeaderBuilder(imageCharacteristics: Characteristics.ExecutableImage | Characteristics.Dll),
            new MetadataRootBuilder(metadata), il, debugDirectoryBuilder: debug, flags: CorFlags.ILOnly,
            deterministicIdProvider: ContentId).Serialize(pe);
        File.WriteAllBytes(Path.Combine(directory, "NullableDefaults.dll"), pe.ToArray());
        File.WriteAllBytes(Path.Combine(directory, "NullableDefaults.pdb"), pdb.ToArray());
    }

    static object Inspect(string directory, ConstantCase[] cases)
    {
        using var pe = new PEReader(File.OpenRead(Path.Combine(directory, "NullableDefaults.dll")));
        using var provider = MetadataReaderProvider.FromPortablePdbStream(File.OpenRead(Path.Combine(directory, "NullableDefaults.pdb")));
        var metadata = pe.GetMetadataReader();
        var pdb = provider.GetMetadataReader();
        return new { runtime = Environment.Version.ToString(), origin = "SRM MetadataBuilder; not C# const declarations",
            constants = pdb.LocalConstants.Select(handle => {
                var constant = pdb.GetLocalConstant(handle);
                var reader = pdb.GetBlobReader(constant.Signature);
                if (reader.ReadByte() != 17) throw new BadImageFormatException("Expected VALUETYPE");
                var encoded = reader.ReadCompressedInteger();
                if ((encoded & 3) != 2 || reader.RemainingBytes != 0) throw new BadImageFormatException("Expected payload-free TypeSpec");
                var type = metadata.GetTypeSpecification(MetadataTokens.TypeSpecificationHandle(encoded >> 2));
                var name = pdb.GetString(constant.Name);
                var runtimeType = typeof(Nullable<>).MakeGenericType(cases.Single(item => item.Name == name).RuntimeType);
                return new { name, typeToken = 0x1b000000 | (encoded >> 2),
                    typeSignature = type.DecodeSignature(new TypeNames(), (object?)null),
                    signature = Convert.ToHexString(pdb.GetBlobBytes(constant.Signature)),
                    typeSpec = Convert.ToHexString(metadata.GetBlobBytes(type.Signature)),
                    boxedDefaultIsNull = Activator.CreateInstance(runtimeType) is null };
            }).ToArray() };
    }

    static void Main(string[] args)
    {
        var directory = args.Single();
        Directory.CreateDirectory(directory);
        var cases = Cases();
        Build(directory, cases);
        Console.WriteLine(JsonSerializer.Serialize(Inspect(directory, cases)));
    }
}
