using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Reflection.Metadata;
using System.Reflection.Metadata.Ecma335;
using System.Reflection.PortableExecutable;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace GenericClosureOracle;

internal sealed record ClosureImage(string id, string file, string assemblyName,
    Dictionary<string, int> definitions, Dictionary<string, int> specifications);

internal sealed class MetadataImage
{
    private readonly MetadataBuilder metadata = new();
    private readonly JsonElement specification;
    private readonly IReadOnlyDictionary<string, JsonElement> universe;
    private readonly Dictionary<string, TypeDefinitionHandle> definitions = new(StringComparer.Ordinal);
    private readonly Dictionary<string, EntityHandle> references = new(StringComparer.Ordinal);
    private readonly Dictionary<string, int> specifications = new(StringComparer.Ordinal);
    private readonly string id;
    private readonly string name;
    private readonly Guid moduleId;
    private readonly AssemblyReferenceHandle system;

    private MetadataImage(JsonElement specification, IReadOnlyDictionary<string, JsonElement> universe)
    {
        this.specification = specification;
        this.universe = universe;
        id = specification.GetProperty("id").GetString()!;
        name = specification.GetProperty("assemblyName").GetString()!;
        moduleId = new Guid(SHA256.HashData(Encoding.UTF8.GetBytes("GenericClosure/" + name))[..16]);
        metadata.AddModule(0, metadata.GetOrAddString(name + ".dll"), metadata.GetOrAddGuid(moduleId), default, default);
        metadata.AddAssembly(metadata.GetOrAddString(name), new Version(1, 0, 0, 0), default, default,
            (AssemblyFlags)0, AssemblyHashAlgorithm.Sha256);
        metadata.AddTypeDefinition(TypeAttributes.NotPublic, default, metadata.GetOrAddString("<Module>"), default,
            MetadataTokens.FieldDefinitionHandle(1), MetadataTokens.MethodDefinitionHandle(1));
        system = metadata.AddAssemblyReference(metadata.GetOrAddString("System.Runtime"), new Version(10, 0, 0, 0), default,
            metadata.GetOrAddBlob(Convert.FromHexString("B03F5F7F11D50A3A")), (AssemblyFlags)0, default);
        var row = 2;
        foreach (var definition in specification.GetProperty("definitions").EnumerateArray())
            definitions.Add(definition.GetProperty("id").GetString()!, MetadataTokens.TypeDefinitionHandle(row++));
    }

    private static string TypeName(JsonElement definition)
    {
        var name = definition.GetProperty("name").GetString()!;
        var arity = definition.GetProperty("arity").GetInt32();
        return arity == 0 ? name : name + "`" + arity;
    }

    private EntityHandle Target(JsonElement target)
    {
        var image = target.ValueKind == JsonValueKind.String ? id : target.GetProperty("image").GetString()!;
        var definition = target.ValueKind == JsonValueKind.String ? target.GetString()! : target.GetProperty("definition").GetString()!;
        if (image == id) return definitions[definition];
        var key = image + "/" + definition;
        if (references.TryGetValue(key, out var existing)) return existing;
        var owner = universe[image];
        var assemblyName = owner.GetProperty("assemblyName").GetString()!;
        var assemblyKey = "assembly/" + image;
        if (!references.TryGetValue(assemblyKey, out var scope))
        {
            scope = metadata.AddAssemblyReference(metadata.GetOrAddString(assemblyName), new Version(1, 0, 0, 0),
                default, default, (AssemblyFlags)0, default);
            references.Add(assemblyKey, scope);
        }
        var type = owner.GetProperty("definitions").EnumerateArray().Single(item => item.GetProperty("id").GetString() == definition);
        var handle = metadata.AddTypeReference(scope, metadata.GetOrAddString(owner.GetProperty("namespace").GetString()!),
            metadata.GetOrAddString(TypeName(type)));
        references.Add(key, handle);
        return handle;
    }

    private TypeReferenceHandle ObjectType()
    {
        const string key = "intrinsic/System.Object";
        if (references.TryGetValue(key, out var existing)) return (TypeReferenceHandle)existing;
        var result = metadata.AddTypeReference(system, metadata.GetOrAddString("System"), metadata.GetOrAddString("Object"));
        references.Add(key, result);
        return result;
    }

    private static int Coded(EntityHandle handle)
    {
        var tag = handle.Kind == HandleKind.TypeDefinition ? 0 : handle.Kind == HandleKind.TypeReference ? 1 : 2;
        return ((MetadataTokens.GetToken(handle) & 0xffffff) << 2) | tag;
    }

    private void Signature(BlobBuilder blob, JsonElement expression, int depth = 0)
    {
        if (depth > 32) throw new InvalidOperationException("Authored signature exceeds 32 levels");
        var kind = expression.GetProperty("kind").GetString();
        if (kind == "primitive") blob.WriteByte(expression.GetProperty("code").GetByte());
        else if (kind == "parameter")
        {
            blob.WriteByte(0x13);
            blob.WriteCompressedInteger(expression.GetProperty("index").GetInt32());
        }
        else if (kind == "szarray")
        {
            blob.WriteByte(0x1d);
            Signature(blob, expression.GetProperty("element"), depth + 1);
        }
        else if (kind is "generic" or "definition")
        {
            if (kind == "generic") blob.WriteByte(0x15);
            blob.WriteByte(0x12);
            var target = expression.TryGetProperty("image", out _) ? expression : expression.GetProperty("definition");
            blob.WriteCompressedInteger(Coded(Target(target)));
            if (kind == "definition") return;
            var arguments = expression.GetProperty("arguments");
            blob.WriteCompressedInteger(arguments.GetArrayLength());
            foreach (var argument in arguments.EnumerateArray()) Signature(blob, argument, depth + 1);
        }
        else throw new InvalidOperationException("Unknown authored signature kind: " + kind);
    }

    private TypeSpecificationHandle TypeSpecification(JsonElement expression)
    {
        var blob = new BlobBuilder();
        Signature(blob, expression);
        return metadata.AddTypeSpecification(metadata.GetOrAddBlob(blob));
    }

    private void AddDefinitions()
    {
        foreach (var definition in specification.GetProperty("definitions").EnumerateArray())
        {
            var kind = definition.GetProperty("kind").GetString();
            EntityHandle baseType = kind == "interface" ? default : ObjectType();
            if (definition.TryGetProperty("base", out var parent)) baseType = TypeSpecification(parent);
            var attributes = TypeAttributes.Public | (kind == "interface" ? TypeAttributes.Interface | TypeAttributes.Abstract : 0);
            var handle = metadata.AddTypeDefinition(attributes, metadata.GetOrAddString(specification.GetProperty("namespace").GetString()!),
                metadata.GetOrAddString(TypeName(definition)), baseType,
                MetadataTokens.FieldDefinitionHandle(1), MetadataTokens.MethodDefinitionHandle(1));
            if (handle != definitions[definition.GetProperty("id").GetString()!]) throw new InvalidOperationException("TypeDef row drift");
            if (definition.TryGetProperty("interfaces", out var interfaces))
                foreach (var item in interfaces.EnumerateArray()) metadata.AddInterfaceImplementation(handle, TypeSpecification(item));
        }
        foreach (var definition in specification.GetProperty("definitions").EnumerateArray())
        {
            var handle = definitions[definition.GetProperty("id").GetString()!];
            for (var index = 0; index < definition.GetProperty("arity").GetInt32(); index++)
                metadata.AddGenericParameter(handle, GenericParameterAttributes.None,
                    metadata.GetOrAddString(index == 0 ? "T" : "U"), index);
        }
        foreach (var item in specification.GetProperty("specifications").EnumerateArray())
            specifications.Add(item.GetProperty("id").GetString()!, MetadataTokens.GetToken(TypeSpecification(item.GetProperty("type"))));
    }

    private ClosureImage Save(string directory)
    {
        AddDefinitions();
        var bytes = new BlobBuilder();
        new ManagedPEBuilder(new PEHeaderBuilder(imageCharacteristics: Characteristics.ExecutableImage | Characteristics.Dll),
            new MetadataRootBuilder(metadata), new BlobBuilder(), flags: CorFlags.ILOnly,
            deterministicIdProvider: _ => new BlobContentId(moduleId, 0)).Serialize(bytes);
        var file = name + ".dll";
        using var stream = new FileStream(Path.Combine(directory, file), FileMode.CreateNew, FileAccess.Write);
        stream.Write(bytes.ToArray());
        return new ClosureImage(id, file, name, definitions.ToDictionary(item => item.Key, item => MetadataTokens.GetToken(item.Value)), specifications);
    }

    public static ClosureImage[] Create(string directory, JsonElement source)
    {
        var images = source.GetProperty("images").EnumerateArray().ToArray();
        var universe = images.ToDictionary(item => item.GetProperty("id").GetString()!, StringComparer.Ordinal);
        return images.Select(item => new MetadataImage(item, universe).Save(directory)).ToArray();
    }
}
