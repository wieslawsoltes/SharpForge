using System.Reflection.Metadata;
using AttributeFixture;

public sealed record AttributeType(Type RuntimeType, string Name, AttributeType? Element = null);

public sealed class AttributeTypeProvider : ICustomAttributeTypeProvider<AttributeType>
{
    public AttributeType GetPrimitiveType(PrimitiveTypeCode code)
    {
        var type = code switch
        {
            PrimitiveTypeCode.Boolean => typeof(bool), PrimitiveTypeCode.Char => typeof(char),
            PrimitiveTypeCode.SByte => typeof(sbyte), PrimitiveTypeCode.Byte => typeof(byte),
            PrimitiveTypeCode.Int16 => typeof(short), PrimitiveTypeCode.UInt16 => typeof(ushort),
            PrimitiveTypeCode.Int32 => typeof(int), PrimitiveTypeCode.UInt32 => typeof(uint),
            PrimitiveTypeCode.Int64 => typeof(long), PrimitiveTypeCode.UInt64 => typeof(ulong),
            PrimitiveTypeCode.Single => typeof(float), PrimitiveTypeCode.Double => typeof(double),
            PrimitiveTypeCode.String => typeof(string), PrimitiveTypeCode.Object => typeof(object),
            _ => throw new BadImageFormatException("Invalid attribute primitive")
        };
        return new(type, type.FullName!);
    }
    public AttributeType GetSystemType() => new(typeof(Type), "System.Type");
    public bool IsSystemType(AttributeType type) => type.RuntimeType == typeof(Type);
    public AttributeType GetSZArrayType(AttributeType element) => new(element.RuntimeType.MakeArrayType(), element.Name + "[]", element);
    public AttributeType GetTypeFromSerializedName(string name) => name is null ? null! : new(Resolve(name), name);
    public AttributeType GetTypeFromDefinition(MetadataReader reader, TypeDefinitionHandle handle, byte rawTypeKind)
    {
        var type = reader.GetTypeDefinition(handle);
        return Named(reader.GetString(type.Namespace), reader.GetString(type.Name));
    }
    public AttributeType GetTypeFromReference(MetadataReader reader, TypeReferenceHandle handle, byte rawTypeKind)
    {
        var type = reader.GetTypeReference(handle);
        return Named(reader.GetString(type.Namespace), reader.GetString(type.Name));
    }
    static Type Resolve(string name) => Type.GetType(name) ?? typeof(PayloadAttribute).Assembly.GetType(name, throwOnError: true)!;
    static AttributeType Named(string space, string name)
    {
        var full = string.IsNullOrEmpty(space) ? name : space + "." + name;
        return new(Resolve(full), full);
    }
    public PrimitiveTypeCode GetUnderlyingEnumType(AttributeType type) => Type.GetTypeCode(Enum.GetUnderlyingType(type.RuntimeType)) switch
    {
        TypeCode.SByte => PrimitiveTypeCode.SByte, TypeCode.Byte => PrimitiveTypeCode.Byte,
        TypeCode.Int16 => PrimitiveTypeCode.Int16, TypeCode.UInt16 => PrimitiveTypeCode.UInt16,
        TypeCode.Int32 => PrimitiveTypeCode.Int32, TypeCode.UInt32 => PrimitiveTypeCode.UInt32,
        TypeCode.Int64 => PrimitiveTypeCode.Int64, TypeCode.UInt64 => PrimitiveTypeCode.UInt64,
        _ => throw new BadImageFormatException("Invalid enum storage")
    };
}
