using System.Collections.Immutable;
using System.Reflection.Metadata;
using System.Reflection.Metadata.Ecma335;
using System.Reflection.PortableExecutable;
using System.Text.Json;
using System.Security.Cryptography;

var inputs = new List<(string Id, string Kind, byte[] Bytes)>();
void Add(string id, string kind, Action<BlobEncoder> encode)
{
    var blob = new BlobBuilder();
    encode(new BlobEncoder(blob));
    inputs.Add((id, kind, blob.ToArray()));
}
var primitives = new[] {
    PrimitiveTypeCode.Boolean, PrimitiveTypeCode.Char, PrimitiveTypeCode.SByte, PrimitiveTypeCode.Byte,
    PrimitiveTypeCode.Int16, PrimitiveTypeCode.UInt16, PrimitiveTypeCode.Int32, PrimitiveTypeCode.UInt32,
    PrimitiveTypeCode.Int64, PrimitiveTypeCode.UInt64, PrimitiveTypeCode.Single, PrimitiveTypeCode.Double,
    PrimitiveTypeCode.String, PrimitiveTypeCode.Object, PrimitiveTypeCode.IntPtr, PrimitiveTypeCode.UIntPtr
};
foreach (var primitive in primitives)
{
    Add($"field-{primitive}", "field", e => e.FieldSignature().PrimitiveType(primitive));
    Add($"array-{primitive}", "type", e => e.TypeSpecificationSignature().SZArray().PrimitiveType(primitive));
    Add($"pointer-{primitive}", "type", e => e.TypeSpecificationSignature().Pointer().PrimitiveType(primitive));
    Add($"local-{primitive}", "locals", e => e.LocalVariableSignature(1).AddVariable().Type().PrimitiveType(primitive));
    Add($"pinned-{primitive}", "locals", e => e.LocalVariableSignature(1).AddVariable().Type(true, true).PrimitiveType(primitive));
    Add($"byref-{primitive}", "method", e => e.MethodSignature().Parameters(1,
        r => r.Type(true).PrimitiveType(primitive), p => p.AddParameter().Type(true).PrimitiveType(primitive)));
    Add($"property-{primitive}", "property", e => e.PropertySignature(true).Parameters(1,
        r => r.Type().PrimitiveType(primitive), p => p.AddParameter().Type().Int32()));
    foreach (var bound in new[] { -268435456, -8193, -8192, -65, -64, -1, 0, 63, 64, 8191, 8192, 268435455 })
        Add($"shape-{primitive}-{bound}", "type", e => e.TypeSpecificationSignature().Array(
            t => t.PrimitiveType(primitive), s => s.Shape(2, ImmutableArray.Create(5), ImmutableArray.Create(bound, 0))));
}
foreach (bool value in new[] { false, true })
{
    Add($"named-{value}", "type", e => e.TypeSpecificationSignature().Type(MetadataTokens.TypeReferenceHandle(1), value));
    Add($"generic-{value}", "type", e => {
        var args = e.TypeSpecificationSignature().GenericInstantiation(MetadataTokens.TypeReferenceHandle(1), 2, value);
        args.AddArgument().String();
        args.AddArgument().GenericInstantiation(MetadataTokens.TypeReferenceHandle(2), 1, false).AddArgument().Int32();
    });
}
foreach (var convention in new[] { SignatureCallingConvention.Default, SignatureCallingConvention.CDecl,
    SignatureCallingConvention.StdCall, SignatureCallingConvention.ThisCall, SignatureCallingConvention.FastCall,
    SignatureCallingConvention.VarArgs, SignatureCallingConvention.Unmanaged })
{
    Add($"fnptr-{convention}", "type", e => e.TypeSpecificationSignature().FunctionPointer(convention).Parameters(1,
        r => r.Void(), p => p.AddParameter().Type().Int32()));
}
Add("explicit-this", "type", e => e.TypeSpecificationSignature().FunctionPointer(SignatureCallingConvention.Default,
    FunctionPointerAttributes.HasThis | FunctionPointerAttributes.HasExplicitThis).Parameters(0, r => r.Void(), p => {}));
Add("vararg-sentinel", "method", e => e.MethodSignature(SignatureCallingConvention.VarArgs).Parameters(2,
    r => r.Void(), p => { p.AddParameter().Type().Int32(); p.StartVarArgs().AddParameter().Type().String(); }));
Add("generic-method", "method", e => e.MethodSignature(genericParameterCount: 2).Parameters(1,
    r => r.Type().GenericMethodTypeParameter(1), p => p.AddParameter().Type().GenericTypeParameter(0)));
Add("method-spec", "methodSpec", e => {
    var arguments = e.MethodSpecificationSignature(2);
    arguments.AddArgument().Int32();
    arguments.AddArgument().GenericTypeParameter(0);
});
Add("modifiers", "field", e => {
    var field = e.Field();
    field.CustomModifiers().AddModifier(MetadataTokens.TypeReferenceHandle(1), false)
        .AddModifier(MetadataTokens.TypeReferenceHandle(2), true);
    field.Type().Int32();
});
Add("typedref-local", "locals", e => e.LocalVariableSignature(1).AddVariable().TypedReference());
Add("void-pointer", "type", e => e.TypeSpecificationSignature().VoidPointer());

var metadata = new MetadataBuilder();
var module = metadata.AddModule(0, metadata.GetOrAddString("Signatures"), metadata.GetOrAddGuid(Guid.Empty), default, default);
metadata.AddTypeReference(module, metadata.GetOrAddString("Oracle"), metadata.GetOrAddString("First"));
metadata.AddTypeReference(module, metadata.GetOrAddString("Oracle"), metadata.GetOrAddString("Second"));
var blobs = inputs.Select(input => metadata.GetOrAddBlob(input.Bytes)).ToArray();
var image = new BlobBuilder();
new MetadataRootBuilder(metadata).Serialize(image, 0, 0);
using var provider = MetadataReaderProvider.FromMetadataImage(image.ToImmutableArray());
var reader = provider.GetMetadataReader();
var cases = new List<object>();
for (var i = 0; i < inputs.Count; i++)
    cases.Add(Decode(inputs[i].Id, inputs[i].Kind, inputs[i].Bytes, reader, blobs[i]));

// Roslyn-produced signatures qualify the encoder corpus against actual compiler output too.
using var peStream = File.OpenRead(typeof(RoslynFixture<>).Assembly.Location);
using var pe = new PEReader(peStream);
var compiled = pe.GetMetadataReader();
foreach (var handle in compiled.TypeDefinitions)
{
    var definition = compiled.GetTypeDefinition(handle);
    if (!compiled.GetString(definition.Name).StartsWith("RoslynFixture")) continue;
    foreach (var fieldHandle in definition.GetFields())
    {
        var field = compiled.GetFieldDefinition(fieldHandle);
        cases.Add(Decode("roslyn-field-" + compiled.GetString(field.Name), "field",
            compiled.GetBlobBytes(field.Signature), compiled, field.Signature));
    }
    foreach (var methodHandle in definition.GetMethods())
    {
        var method = compiled.GetMethodDefinition(methodHandle);
        cases.Add(Decode("roslyn-method-" + compiled.GetString(method.Name), "method",
            compiled.GetBlobBytes(method.Signature), compiled, method.Signature));
    }
    foreach (var propertyHandle in definition.GetProperties())
    {
        var property = compiled.GetPropertyDefinition(propertyHandle);
        cases.Add(Decode("roslyn-property-" + compiled.GetString(property.Name), "property",
            compiled.GetBlobBytes(property.Signature), compiled, property.Signature));
    }
}
var sources = new[] { "Program.cs", "Provider.cs", "RoslynFixture.cs", "SignatureOracle.csproj" };
var hashes = sources.ToDictionary(path => path, path => Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(Path.Combine(args[0], path)))));
Console.WriteLine(JsonSerializer.Serialize(new {
    specification = "ECMA-335 6th edition II.23.2",
    runtime = System.Runtime.InteropServices.RuntimeInformation.FrameworkDescription,
    srmVersion = typeof(MetadataReader).Assembly.GetName().Version!.ToString(),
    sourceSha256 = hashes, cases
}, new JsonSerializerOptions { WriteIndented = true }));

static object Decode(string id, string kind, byte[] bytes, MetadataReader reader, BlobHandle handle)
{
    var decoder = new SignatureDecoder<object, object?>(new Provider(), reader, null);
    var blob = reader.GetBlobReader(handle);
    object shape = kind switch {
        "type" => decoder.DecodeType(ref blob),
        "field" => Provider.Node("field", ("type", decoder.DecodeFieldSignature(ref blob))),
        "locals" => Provider.Node("locals", ("types", decoder.DecodeLocalSignature(ref blob))),
        "methodSpec" => Provider.Node("methodSpec", ("arguments", decoder.DecodeMethodSpecificationSignature(ref blob))),
        _ => Provider.Method(decoder.DecodeMethodSignature(ref blob))
    };
    if (blob.RemainingBytes != 0) throw new BadImageFormatException("Trailing oracle bytes");
    return new { id, kind, bytes = Convert.ToHexString(bytes), shape };
}
