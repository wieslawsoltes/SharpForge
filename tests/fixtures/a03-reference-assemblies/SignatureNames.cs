using System;
using System.Collections.Immutable;
using System.Linq;
using System.Reflection.Metadata;

sealed class SignatureNames : ISignatureTypeProvider<string, object?>, ICustomAttributeTypeProvider<string>
{
    public string Name(MetadataReader metadata, EntityHandle handle)
    {
        if (handle.IsNil) return "";
        if (handle.Kind == HandleKind.TypeSpecification)
            return metadata.GetTypeSpecification((TypeSpecificationHandle)handle).DecodeSignature(this, null);
        if (handle.Kind == HandleKind.TypeReference)
        {
            var type = metadata.GetTypeReference((TypeReferenceHandle)handle);
            var space = metadata.GetString(type.Namespace);
            var prefix = type.ResolutionScope.Kind == HandleKind.TypeReference ? Name(metadata, type.ResolutionScope) + "+"
                : space.Length == 0 ? "" : space + ".";
            return prefix + metadata.GetString(type.Name);
        }
        var definition = metadata.GetTypeDefinition((TypeDefinitionHandle)handle);
        var outer = definition.GetDeclaringType();
        var @namespace = metadata.GetString(definition.Namespace);
        return (!outer.IsNil ? Name(metadata, outer) + "+" : @namespace.Length == 0 ? "" : @namespace + ".")
            + metadata.GetString(definition.Name);
    }

    public static string Method(MethodSignature<string> signature) =>
        $"{signature.Header.RawValue}:{signature.GenericParameterCount}:{signature.RequiredParameterCount}:"
        + signature.ReturnType + "(" + string.Join(",", signature.ParameterTypes) + ")";

    public string GetArrayType(string element, ArrayShape shape) => element + "[" + shape.Rank + ";"
        + string.Join(",", shape.Sizes) + ";" + string.Join(",", shape.LowerBounds) + "]";
    public string GetByReferenceType(string element) => element + "&";
    public string GetPointerType(string element) => element + "*";
    public string GetSZArrayType(string element) => element + "[]";
    public string GetPinnedType(string element) => "pinned " + element;
    public string GetFunctionPointerType(MethodSignature<string> signature) => "fnptr " + Method(signature);
    public string GetGenericInstantiation(string type, ImmutableArray<string> arguments) => type + "<" + string.Join(",", arguments) + ">";
    public string GetGenericMethodParameter(object? context, int index) => "!!" + index;
    public string GetGenericTypeParameter(object? context, int index) => "!" + index;
    public string GetModifiedType(string modifier, string element, bool required) =>
        (required ? "modreq(" : "modopt(") + modifier + ") " + element;
    public string GetPrimitiveType(PrimitiveTypeCode code) => code.ToString();
    public string GetTypeFromDefinition(MetadataReader metadata, TypeDefinitionHandle handle, byte raw) =>
        (raw == 0x11 ? "valuetype " : "class ") + Name(metadata, handle);
    public string GetTypeFromReference(MetadataReader metadata, TypeReferenceHandle handle, byte raw) =>
        (raw == 0x11 ? "valuetype " : "class ") + Name(metadata, handle);
    public string GetTypeFromSpecification(MetadataReader metadata, object? context, TypeSpecificationHandle handle, byte raw) =>
        metadata.GetTypeSpecification(handle).DecodeSignature(this, context);

    public string GetSystemType() => "class System.Type";
    public bool IsSystemType(string type) => type == GetSystemType();
    // This fixture serializes only non-generic primitive typeof values; contract assembly versions differ by target.
    public string GetTypeFromSerializedName(string name) => name.Split(',')[0];
    public PrimitiveTypeCode GetUnderlyingEnumType(string type) =>
        throw new BadImageFormatException("The reference fixture declares no enum-valued custom-attribute arguments: " + type);
}
