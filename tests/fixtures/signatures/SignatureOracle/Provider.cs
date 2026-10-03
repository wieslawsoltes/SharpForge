using System.Collections.Immutable;
using System.Reflection.Metadata;
using System.Reflection.Metadata.Ecma335;

sealed class Provider : ISignatureTypeProvider<object, object?>
{
    public static Dictionary<string, object> Node(string kind, params (string, object)[] fields)
    {
        var result = new Dictionary<string, object> { ["kind"] = kind };
        foreach (var (key, value) in fields) result[key] = value;
        return result;
    }

    public object GetArrayType(object element, ArrayShape shape) => Node("array", ("element", element),
        ("rank", shape.Rank), ("sizes", shape.Sizes), ("lowerBounds", shape.LowerBounds));
    public object GetByReferenceType(object element) => Node("byref", ("element", element));
    public object GetPointerType(object element) => Node("pointer", ("element", element));
    public object GetSZArrayType(object element) => Node("szarray", ("element", element));
    public object GetPinnedType(object element) => Node("pinned", ("element", element));
    public object GetFunctionPointerType(MethodSignature<object> signature) => Node("functionPointer", ("signature", Method(signature)));
    public object GetGenericInstantiation(object type, ImmutableArray<object> args) => Node("genericInstance", ("type", type), ("arguments", args));
    public object GetGenericMethodParameter(object? context, int index) => Node("genericParameter", ("scope", "method"), ("index", index));
    public object GetGenericTypeParameter(object? context, int index) => Node("genericParameter", ("scope", "type"), ("index", index));
    public object GetModifiedType(object modifier, object element, bool required) => Node(required ? "modreq" : "modopt",
        ("token", ((Dictionary<string, object>)modifier)["token"]), ("element", element));
    public object GetPrimitiveType(PrimitiveTypeCode code) => Node("primitive", ("name", code switch
    {
        PrimitiveTypeCode.Void => "void", PrimitiveTypeCode.Boolean => "bool", PrimitiveTypeCode.Char => "char",
        PrimitiveTypeCode.SByte => "sbyte", PrimitiveTypeCode.Byte => "byte", PrimitiveTypeCode.Int16 => "short",
        PrimitiveTypeCode.UInt16 => "ushort", PrimitiveTypeCode.Int32 => "int", PrimitiveTypeCode.UInt32 => "uint",
        PrimitiveTypeCode.Int64 => "long", PrimitiveTypeCode.UInt64 => "ulong", PrimitiveTypeCode.Single => "float",
        PrimitiveTypeCode.Double => "double", PrimitiveTypeCode.String => "string", PrimitiveTypeCode.Object => "object",
        PrimitiveTypeCode.IntPtr => "nint", PrimitiveTypeCode.UIntPtr => "nuint", PrimitiveTypeCode.TypedReference => "typedref",
        _ => throw new BadImageFormatException($"Unexpected primitive {code}")
    }));
    public object GetTypeFromDefinition(MetadataReader reader, TypeDefinitionHandle handle, byte raw) => Named(handle, raw);
    public object GetTypeFromReference(MetadataReader reader, TypeReferenceHandle handle, byte raw) => Named(handle, raw);
    public object GetTypeFromSpecification(MetadataReader reader, object? context, TypeSpecificationHandle handle, byte raw) => Named(handle, raw);
    static object Named(EntityHandle handle, byte raw) => Node(raw == 0x11 ? "valuetype" : "class", ("token", MetadataTokens.GetToken(handle)));

    public static object Method(MethodSignature<object> signature)
    {
        bool property = signature.Header.Kind == SignatureKind.Property;
        var result = Node(property ? "property" : "method", ("hasThis", signature.Header.IsInstance),
            ("returnType", signature.ReturnType), ("parameters", signature.ParameterTypes));
        if (!property)
        {
            result["callingConvention"] = (int)signature.Header.CallingConvention;
            result["explicitThis"] = signature.Header.HasExplicitThis;
            result["genericArity"] = signature.GenericParameterCount;
            result["sentinel"] = signature.RequiredParameterCount < signature.ParameterTypes.Length ? signature.RequiredParameterCount : -1;
        }
        return result;
    }
}
