using System;
using System.Collections.Immutable;
using System.Linq;
using System.Reflection.Metadata;
using System.Reflection.Metadata.Ecma335;
using System.Reflection.PortableExecutable;
using System.IO;

namespace GenericInstantiationOracle;

internal sealed class SignatureObservations : ISignatureTypeProvider<object, object?>
{
    public object GetArrayType(object elementType, ArrayShape shape) =>
        new { kind = "array", element = elementType, rank = shape.Rank, sizes = shape.Sizes.ToArray(), lowerBounds = shape.LowerBounds.ToArray() };
    public object GetByReferenceType(object elementType) => new { kind = "byref", element = elementType };
    public object GetPointerType(object elementType) => new { kind = "pointer", element = elementType };
    public object GetSZArrayType(object elementType) => new { kind = "szarray", element = elementType };
    public object GetPinnedType(object elementType) => new { kind = "pinned", element = elementType };
    public object GetGenericInstantiation(object genericType, ImmutableArray<object> typeArguments) =>
        new { kind = "genericInstance", type = genericType, arguments = typeArguments.ToArray() };
    public object GetGenericMethodParameter(object? context, int index) => new { kind = "genericParameter", scope = "method", index };
    public object GetGenericTypeParameter(object? context, int index) => new { kind = "genericParameter", scope = "type", index };
    public object GetModifiedType(object modifier, object unmodifiedType, bool required) =>
        new { kind = "modifier", modifier, element = unmodifiedType, required };
    public object GetPrimitiveType(PrimitiveTypeCode typeCode) => new { kind = "primitive", code = (int)typeCode, name = typeCode.ToString() };
    public object GetTypeFromDefinition(MetadataReader reader, TypeDefinitionHandle handle, byte rawTypeKind) =>
        new { kind = rawTypeKind == 0x11 ? "valuetype" : "class", token = MetadataTokens.GetToken(handle) };
    public object GetTypeFromReference(MetadataReader reader, TypeReferenceHandle handle, byte rawTypeKind) =>
        new { kind = rawTypeKind == 0x11 ? "valuetype" : "class", token = MetadataTokens.GetToken(handle) };
    public object GetTypeFromSpecification(MetadataReader reader, object? context, TypeSpecificationHandle handle, byte rawTypeKind) =>
        new { kind = "specification", token = MetadataTokens.GetToken(handle), rawTypeKind };
    public object GetFunctionPointerType(MethodSignature<object> signature) => new
    {
        kind = "functionPointer",
        callingConvention = (int)signature.Header.CallingConvention,
        hasThis = signature.Header.IsInstance,
        explicitThis = signature.Header.HasExplicitThis,
        genericArity = signature.GenericParameterCount,
        returnType = signature.ReturnType,
        parameters = signature.ParameterTypes.ToArray(),
        requiredParameterCount = signature.RequiredParameterCount
    };

    public static object[] Read(string path)
    {
        using var stream = File.OpenRead(path);
        using var pe = new PEReader(stream);
        var reader = pe.GetMetadataReader();
        var provider = new SignatureObservations();
        return Enumerable.Range(1, reader.GetTableRowCount(TableIndex.TypeSpec)).Select(row =>
        {
            var handle = MetadataTokens.TypeSpecificationHandle(row);
            var specification = reader.GetTypeSpecification(handle);
            object? signature = null;
            NativeError? error = null;
            try { signature = specification.DecodeSignature(provider, null); }
            catch (BadImageFormatException exception) { error = new NativeError(exception.GetType().FullName!, exception.HResult); }
            return (object)new { token = MetadataTokens.GetToken(handle),
                blob = Convert.ToBase64String(reader.GetBlobBytes(specification.Signature)), signature, error };
        }).ToArray();
    }
}

