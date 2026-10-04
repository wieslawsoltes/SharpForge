using System;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Reflection.Metadata;
using System.Reflection.Metadata.Ecma335;
using System.Reflection.PortableExecutable;
using System.Text.Json;

public enum Number : short { Value = -1234 }
public sealed class Fixture
{
    public static object?[] Constants()
    {
        const bool Boolean = true;
        const char Character = '\uffff';
        const sbyte SignedByte = -128;
        const byte Byte = 255;
        const short Int16 = -32768;
        const ushort UInt16 = 65535;
        const int Int32 = int.MinValue;
        const uint UInt32 = uint.MaxValue;
        const long Int64 = long.MinValue;
        const ulong UInt64 = ulong.MaxValue;
        const float Single = 1.25f;
        const double Double = -2.5;
        const string Text = "A\0B";
        const string? NullString = null;
        const object? NullObject = null;
        const Fixture? NullClass = null;
        const Number Enumeration = Number.Value;
        const decimal Decimal = -123.4500m;
        return [Boolean, Character, SignedByte, Byte, Int16, UInt16, Int32, UInt32, Int64, UInt64,
            Single, Double, Text, NullString, NullObject, NullClass, Enumeration, Decimal];
    }
}

public static class Program
{
    static int ReadType(ref BlobReader reader)
    {
        var encoded = reader.ReadCompressedInteger();
        var table = (encoded & 3) switch { 0 => 0x02000000, 1 => 0x01000000, 2 => 0x1b000000, _ => throw new BadImageFormatException() };
        return table | (encoded >> 2);
    }
    static string TypeName(MetadataReader metadata, int token)
    {
        var handle = MetadataTokens.EntityHandle(token);
        if (handle.Kind == HandleKind.TypeReference) {
            var type = metadata.GetTypeReference((TypeReferenceHandle)handle);
            return metadata.GetString(type.Namespace) + "." + metadata.GetString(type.Name);
        }
        var definition = metadata.GetTypeDefinition((TypeDefinitionHandle)handle);
        return metadata.GetString(definition.Name);
    }
    static object Constant(MetadataReader pdb, MetadataReader metadata, LocalConstantHandle handle)
    {
        var constant = pdb.GetLocalConstant(handle);
        var reader = pdb.GetBlobReader(constant.Signature);
        var code = reader.ReadByte();
        int? typeToken = code is 17 or 18 ? ReadType(ref reader) : null;
        object? value = code switch {
            2 => reader.ReadByte() != 0, 3 => reader.ReadUInt16(), 4 => reader.ReadSByte(), 5 => reader.ReadByte(),
            6 => reader.ReadInt16(), 7 => reader.ReadUInt16(), 8 => reader.ReadInt32(), 9 => reader.ReadUInt32(),
            10 => reader.ReadInt64(), 11 => reader.ReadUInt64(), 12 => reader.ReadSingle(), 13 => reader.ReadDouble(),
            14 => reader.RemainingBytes == 1 ? null : reader.ReadUTF16(reader.RemainingBytes),
            17 => reader.ReadDecimal(), 18 or 28 => null, _ => throw new BadImageFormatException()
        };
        int? enumTypeToken = code <= 11 && reader.RemainingBytes > 0 ? ReadType(ref reader) : null;
        if (reader.RemainingBytes != 0 && code != 14) throw new BadImageFormatException();
        return new { name = pdb.GetString(constant.Name), code, typeToken, enumTypeToken,
            typeName = typeToken.HasValue ? TypeName(metadata, typeToken.Value) : null,
            value = value is string text ? text : value is bool flag ? flag ? "true" : "false" :
                value is IFormattable number ? number.ToString(null, CultureInfo.InvariantCulture) : null,
            signature = Convert.ToHexString(pdb.GetBlobBytes(constant.Signature)) };
    }
    public static void Main()
    {
        var path = typeof(Program).Assembly.Location;
        using var pe = new PEReader(File.OpenRead(path));
        using var provider = MetadataReaderProvider.FromPortablePdbStream(File.OpenRead(Path.ChangeExtension(path, ".pdb")));
        var pdb = provider.GetMetadataReader();
        Console.WriteLine(JsonSerializer.Serialize(new { runtime = Environment.Version.ToString(),
            constants = pdb.LocalConstants.Select(handle => Constant(pdb, pe.GetMetadataReader(), handle)).ToArray() }));
    }
}
