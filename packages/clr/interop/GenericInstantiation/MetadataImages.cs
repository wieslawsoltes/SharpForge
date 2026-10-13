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

namespace GenericInstantiationOracle;

internal sealed record NativeImage(string id, string file, string assemblyName,
    Dictionary<string, int> specifications, Dictionary<string, int> definitions);

internal sealed class MetadataImages
{
    private readonly MetadataBuilder metadata = new();
    private readonly Dictionary<string, int> specifications = new(StringComparer.Ordinal);
    private readonly Dictionary<string, int> definitions = new(StringComparer.Ordinal);
    private readonly string name;
    private readonly Guid moduleId;
    private readonly AssemblyReferenceHandle fixture;
    private readonly AssemblyReferenceHandle system;

    private MetadataImages(string name)
    {
        this.name = name;
        moduleId = new Guid(SHA256.HashData(Encoding.UTF8.GetBytes("GenericInstantiation/" + name))[..16]);
        metadata.AddModule(0, metadata.GetOrAddString(name + ".dll"), metadata.GetOrAddGuid(moduleId), default, default);
        metadata.AddAssembly(metadata.GetOrAddString(name), new Version(1, 0, 0, 0), default, default,
            (AssemblyFlags)0, AssemblyHashAlgorithm.Sha256);
        metadata.AddTypeDefinition(TypeAttributes.NotPublic, default, metadata.GetOrAddString("<Module>"), default,
            MetadataTokens.FieldDefinitionHandle(1), MetadataTokens.MethodDefinitionHandle(1));
        fixture = metadata.AddAssemblyReference(metadata.GetOrAddString("Fixture"), new Version(1, 0, 0, 0),
            default, default, (AssemblyFlags)0, default);
        system = metadata.AddAssemblyReference(metadata.GetOrAddString("System.Runtime"), new Version(10, 0, 0, 0),
            default, metadata.GetOrAddBlob(Convert.FromHexString("b03f5f7f11d50a3a")), (AssemblyFlags)0, default);
    }

    private TypeReferenceHandle Reference(Type type) => metadata.AddTypeReference(fixture,
        metadata.GetOrAddString(type.Namespace!), metadata.GetOrAddString(type.Name));

    private int Specification(string id, Action<BlobBuilder> signature)
    {
        var blob = new BlobBuilder();
        signature(blob);
        var handle = metadata.AddTypeSpecification(metadata.GetOrAddBlob(blob));
        return specifications[id] = MetadataTokens.GetToken(handle);
    }

    private static Action<BlobBuilder> Primitive(byte code) => blob => blob.WriteByte(code);

    private static Action<BlobBuilder> Variable(int index = 0, bool method = false) => blob =>
    {
        blob.WriteByte(method ? (byte)0x1e : (byte)0x13);
        blob.WriteCompressedInteger(index);
    };

    private static void Type(BlobBuilder blob, EntityHandle handle, bool valueType)
    {
        blob.WriteByte(valueType ? (byte)0x11 : (byte)0x12);
        var token = MetadataTokens.GetToken(handle);
        var tag = handle.Kind == HandleKind.TypeDefinition ? 0 : handle.Kind == HandleKind.TypeReference ? 1 : 2;
        blob.WriteCompressedInteger(((token & 0xffffff) << 2) | tag);
    }

    private static Action<BlobBuilder> Generic(EntityHandle definition, bool valueType, params Action<BlobBuilder>[] arguments) => blob =>
    {
        blob.WriteByte(0x15);
        Type(blob, definition, valueType);
        blob.WriteCompressedInteger(arguments.Length);
        foreach (var argument in arguments) argument(blob);
    };

    private static Action<BlobBuilder> Element(byte kind, Action<BlobBuilder> element) => blob =>
    {
        blob.WriteByte(kind);
        element(blob);
        if (kind == 0x14)
        {
            blob.WriteCompressedInteger(2);
            blob.WriteCompressedInteger(0);
            blob.WriteCompressedInteger(0);
        }
    };

    private static Action<BlobBuilder> Function(byte convention, Action<BlobBuilder> result, params Action<BlobBuilder>[] arguments) => blob =>
    {
        blob.WriteByte(0x1b);
        blob.WriteByte(convention);
        blob.WriteCompressedInteger(arguments.Length);
        result(blob);
        foreach (var argument in arguments) argument(blob);
    };

    private NativeImage Save(string directory, string id)
    {
        var pe = new ManagedPEBuilder(
            new PEHeaderBuilder(imageCharacteristics: Characteristics.ExecutableImage | Characteristics.Dll),
            new MetadataRootBuilder(metadata), new BlobBuilder(), flags: CorFlags.ILOnly,
            deterministicIdProvider: _ => new BlobContentId(moduleId, 0));
        var image = new BlobBuilder();
        pe.Serialize(image);
        var file = name + ".dll";
        File.WriteAllBytes(Path.Combine(directory, file), image.ToArray());
        return new NativeImage(id, file, name, specifications, definitions);
    }

    public static NativeImage Consumer(string directory, string id, string name)
    {
        var image = new MetadataImages(name);
        var box = image.Reference(typeof(Fixture.Box<>));
        var pair = image.Reference(typeof(Fixture.Pair<,>));
        var integer = Primitive(0x08);
        var text = Primitive(0x0e);
        image.Specification("boxInteger", Generic(box, false, integer));
        image.Specification("scopePair", Generic(pair, false, Variable(), Variable(method: true)));
        image.Specification("scopeType", Variable());
        image.Specification("scopeMethod", Variable(method: true));
        image.Specification("scopeArray", Element(0x1d, Variable()));
        image.Specification("scopeMatrix", Element(0x14, Variable()));
        image.Specification("scopePointer", Element(0x0f, Variable()));
        image.Specification("scopeByRef", Element(0x10, Variable()));
        image.Specification("scopeNested", Generic(box, false, Element(0x1d, Generic(pair, false, Variable(), integer))));
        image.Specification("secondVariable", Generic(box, false, Variable(1)));
        image.Specification("managedFunction", Function(0, Variable(method: true), Variable()));
        image.Specification("nativeFunction", Function(1, integer, integer));
        image.Specification("nestedFunction", Function(0, integer, Function(0, integer, integer), Element(0x10, integer)));
        var collections = image.metadata.AddAssemblyReference(image.metadata.GetOrAddString("System.Collections"),
            new Version(10, 0, 0, 0), default, image.metadata.GetOrAddBlob(Convert.FromHexString("b03f5f7f11d50a3a")),
            (AssemblyFlags)0, default);
        var list = image.metadata.AddTypeReference(collections,
            image.metadata.GetOrAddString(typeof(List<>).Namespace!), image.metadata.GetOrAddString(typeof(List<>).Name));
        image.Specification("listInteger", Generic(list, false, integer));
        image.Specification("pairSwapped", Generic(pair, false, text, integer));
        return image.Save(directory, id);
    }

    public static NativeImage Malformed(string directory)
    {
        var image = new MetadataImages("MalformedGenerics");
        var box = image.Reference(typeof(Fixture.Box<>));
        var cell = image.Reference(typeof(Fixture.Cell<>));
        image.Specification("wrongArity", Generic(box, false, Primitive(0x08), Primitive(0x0e)));
        image.Specification("wrongClassKind", Generic(cell, false, Primitive(0x08)));
        image.Specification("wrongValueKind", Generic(box, true, Primitive(0x08)));
        image.Specification("invalidElement", Primitive(0xff));
        return image.Save(directory, "malformed");
    }

    private TypeDefinitionHandle Definition(string id, string name, TypeAttributes attributes, EntityHandle baseType)
    {
        var handle = metadata.AddTypeDefinition(attributes, default, metadata.GetOrAddString(name), baseType,
            MetadataTokens.FieldDefinitionHandle(1), MetadataTokens.MethodDefinitionHandle(1));
        definitions[id] = MetadataTokens.GetToken(handle);
        return handle;
    }

    private void Parameters(TypeDefinitionHandle owner, int count)
    {
        for (var index = 0; index < count; index++)
            metadata.AddGenericParameter(owner, GenericParameterAttributes.None, metadata.GetOrAddString("T" + index), index);
    }

    public static NativeImage Nested(string directory)
    {
        var image = new MetadataImages("NestedGenericMetadata");
        var objectType = image.metadata.AddTypeReference(image.system,
            image.metadata.GetOrAddString("System"), image.metadata.GetOrAddString("Object"));
        var outer = image.Definition("outer", "Outer" + (char)96 + "1", TypeAttributes.Public, objectType);
        var inner = image.Definition("detachedInner", "DetachedInner", TypeAttributes.NestedPublic, objectType);
        var unmarked = image.Definition("unmarkedArity", "UnmarkedArity", TypeAttributes.Public, objectType);
        image.metadata.AddNestedType(inner, outer);
        image.Parameters(outer, 1);
        image.Parameters(unmarked, 2);
        return image.Save(directory, "nested");
    }

    public static NativeImage Circular(string directory)
    {
        var image = new MetadataImages("CircularGenericMetadata");
        var leftHandle = MetadataTokens.TypeDefinitionHandle(2);
        var rightHandle = MetadataTokens.TypeDefinitionHandle(3);
        var leftBase = image.Specification("leftBase", Generic(rightHandle, false, Variable()));
        var rightBase = image.Specification("rightBase", Generic(leftHandle, false, Variable()));
        var left = image.Definition("left", "Left" + (char)96 + "1", TypeAttributes.Public, MetadataTokens.EntityHandle(leftBase));
        var right = image.Definition("right", "Right" + (char)96 + "1", TypeAttributes.Public, MetadataTokens.EntityHandle(rightBase));
        image.Parameters(left, 1);
        image.Parameters(right, 1);
        return image.Save(directory, "circular");
    }
}

