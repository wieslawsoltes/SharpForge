using System;
using System.Collections.Generic;
using System.Collections.Immutable;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Reflection.Metadata;
using System.Reflection.Metadata.Ecma335;
using System.Reflection.PortableExecutable;
using System.Runtime.InteropServices;
using System.Runtime.Loader;
using System.Text.Json;

if (args.Length != 1) throw new ArgumentException("Expected assembly path");
using var stream = File.OpenRead(args[0]);
using var pe = new PEReader(stream);
var metadata = pe.GetMetadataReader();
var provider = new ReturnVoid();
var signatures = new Dictionary<int, object>();
object Shape(MethodSignature<bool> signature) => new {
    parameters = signature.ParameterTypes.Length, returnsVoid = signature.ReturnType,
    hasThis = signature.Header.IsInstance, explicitThis = (signature.Header.RawValue & 0x40) != 0,
    header = signature.Header.RawValue, requiredParameters = signature.RequiredParameterCount,
};
object Signature(EntityHandle handle) => handle.Kind switch {
    HandleKind.MethodDefinition => Shape(metadata.GetMethodDefinition((MethodDefinitionHandle)handle).DecodeSignature(provider, null)),
    HandleKind.MemberReference => Shape(metadata.GetMemberReference((MemberReferenceHandle)handle).DecodeMethodSignature(provider, null)),
    HandleKind.MethodSpecification => Signature(metadata.GetMethodSpecification((MethodSpecificationHandle)handle).Method),
    HandleKind.StandaloneSignature => Shape(metadata.GetStandaloneSignature((StandaloneSignatureHandle)handle).DecodeMethodSignature(provider, null)),
    _ => throw new InvalidDataException(handle.Kind.ToString()),
};
foreach (var handle in metadata.MethodDefinitions) signatures.Add(MetadataTokens.GetToken(handle), Signature(handle));
foreach (var handle in metadata.MemberReferences)
    if (metadata.GetMemberReference(handle).GetKind() == MemberReferenceKind.Method)
        signatures.Add(MetadataTokens.GetToken(handle), Signature(handle));
for (int row = 1; row <= metadata.GetTableRowCount(TableIndex.MethodSpec); row++) {
    var handle = MetadataTokens.MethodSpecificationHandle(row);
    signatures.Add(MetadataTokens.GetToken(handle), Signature(handle));
}
for (int row = 1; row <= metadata.GetTableRowCount(TableIndex.StandAloneSig); row++) {
    var handle = MetadataTokens.StandaloneSignatureHandle(row);
    var reader = metadata.GetBlobReader(metadata.GetStandaloneSignature(handle).Signature);
    if (reader.ReadSignatureHeader().Kind == SignatureKind.Method) signatures.Add(MetadataTokens.GetToken(handle), Signature(handle));
}
var methods = metadata.MethodDefinitions.Select(handle => {
    var method = metadata.GetMethodDefinition(handle);
    if (method.RelativeVirtualAddress == 0) return null;
    var body = pe.GetMethodBody(method.RelativeVirtualAddress);
    var raw = pe.GetSectionData(method.RelativeVirtualAddress).GetContent(0, body.Size);
    var headerSize = (raw[0] & 3) == 2 ? 1 : (raw[1] >> 4) * 4;
    return new {
        token = MetadataTokens.GetToken(handle), name = metadata.GetString(method.Name),
        headerSize, headerHex = Convert.ToHexStringLower(raw.AsSpan(0, headerSize)),
        maxStack = body.MaxStack, codeHex = Convert.ToHexStringLower(body.GetILBytes()!),
        localSignature = MetadataTokens.GetToken(body.LocalSignature), initLocals = body.LocalVariablesInitialized,
        handlers = body.ExceptionRegions.Select(region => new {
            flags = (int)region.Kind, start = region.TryOffset, end = region.TryOffset + region.TryLength,
            target = region.HandlerOffset, handlerEnd = region.HandlerOffset + region.HandlerLength,
            catchType = region.Kind == ExceptionRegionKind.Catch ? MetadataTokens.GetToken(region.CatchType) : 0,
            filterOffset = region.Kind == ExceptionRegionKind.Filter ? (int?)region.FilterOffset : null,
        }).ToArray(),
    };
}).Where(method => method is not null).ToArray();
var context = new AssemblyLoadContext("header-observer", isCollectible: true);
var executions = new Dictionary<string, object>();
string? loadError = null;
try {
    var assembly = context.LoadFromAssemblyPath(Path.GetFullPath(args[0]));
    foreach (var type in assembly.GetTypes()) foreach (var method in type.GetMethods(BindingFlags.Public | BindingFlags.Static | BindingFlags.DeclaredOnly)) {
        if (method.GetParameters().Length != 0 || method.ContainsGenericParameters) continue;
        object? value = null;
        string? error = null;
        try { value = method.Invoke(null, null); }
        catch (TargetInvocationException exception) { error = exception.InnerException?.GetType().FullName; }
        executions.Add(type.FullName + "::" + method.Name, new { value, error });
    }
} catch (Exception exception) { loadError = exception.GetType().FullName; }
context.Unload();
Console.WriteLine(JsonSerializer.Serialize(new {
    runtime = RuntimeInformation.FrameworkDescription, signatures, methods, loadError, executions,
}, new JsonSerializerOptions { WriteIndented = true }));

// SRM decodes every signature; this projection retains only facts needed to count stack slots.
sealed class ReturnVoid : ISignatureTypeProvider<bool, object?>
{
    public bool GetPrimitiveType(PrimitiveTypeCode code) => code == PrimitiveTypeCode.Void;
    public bool GetModifiedType(bool modifier, bool element, bool required) => element;
    public bool GetArrayType(bool element, ArrayShape shape) => false;
    public bool GetByReferenceType(bool element) => false;
    public bool GetPointerType(bool element) => false;
    public bool GetSZArrayType(bool element) => false;
    public bool GetPinnedType(bool element) => element;
    public bool GetFunctionPointerType(MethodSignature<bool> signature) => false;
    public bool GetGenericInstantiation(bool type, ImmutableArray<bool> arguments) => false;
    public bool GetGenericMethodParameter(object? context, int index) => false;
    public bool GetGenericTypeParameter(object? context, int index) => false;
    public bool GetTypeFromDefinition(MetadataReader metadata, TypeDefinitionHandle handle, byte raw) => false;
    public bool GetTypeFromReference(MetadataReader metadata, TypeReferenceHandle handle, byte raw) => false;
    public bool GetTypeFromSpecification(MetadataReader metadata, object? context, TypeSpecificationHandle handle, byte raw) =>
        metadata.GetTypeSpecification(handle).DecodeSignature(this, context);
}
