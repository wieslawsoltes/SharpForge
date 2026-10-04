using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using System.Reflection.Metadata;

// Display names deliberately omit contract versions; decoding retains the native identity separately.
sealed record AttributeType(string Name, MetadataReader? Reader = null, EntityHandle Handle = default,
    string? SerializedName = null, AssemblyName? SerializedAssembly = null);

sealed class AttributeTypes : ICustomAttributeTypeProvider<AttributeType>
{
    readonly MetadataReader metadata;
    readonly SignatureNames names;
    readonly Dictionary<string, TypeDefinitionHandle> definitions;

    public AttributeTypes(MetadataReader metadata, SignatureNames names)
    {
        this.metadata = metadata;
        this.names = names;
        definitions = metadata.TypeDefinitions.ToDictionary(handle => names.Name(metadata, handle), StringComparer.Ordinal);
    }

    public AttributeType GetPrimitiveType(PrimitiveTypeCode code) => new(code.ToString());
    public AttributeType GetSystemType() => new("class System.Type");
    public bool IsSystemType(AttributeType type) => type.Name == GetSystemType().Name;
    public AttributeType GetSZArrayType(AttributeType element) => new(element.Name + "[]");
    public AttributeType GetTypeFromDefinition(MetadataReader reader, TypeDefinitionHandle handle, byte raw) =>
        new(names.GetTypeFromDefinition(reader, handle, raw), reader, handle);
    public AttributeType GetTypeFromReference(MetadataReader reader, TypeReferenceHandle handle, byte raw) =>
        new(names.GetTypeFromReference(reader, handle, raw), reader, handle);

    public AttributeType GetTypeFromSerializedName(string name)
    {
        // Only an outer assembly qualification is removed; commas inside constructed type names remain intact.
        var depth = 0;
        var separator = -1;
        for (var index = 0; index < name.Length; index++)
        {
            if (name[index] == '\\') { index++; continue; }
            if (name[index] == '[') depth++;
            if (name[index] == ']') depth--;
            if (name[index] == ',' && depth == 0) { separator = index; break; }
        }
        var fullName = separator < 0 ? name : name[..separator].Trim();
        var assemblyName = separator < 0 ? null : new AssemblyName(name[(separator + 1)..].Trim());
        var local = assemblyName == null || assemblyName.FullName == metadata.GetAssemblyDefinition().GetAssemblyName().FullName;
        return local && definitions.TryGetValue(fullName, out var handle)
            ? new(fullName, metadata, handle, name, assemblyName)
            : new(fullName, SerializedName: name, SerializedAssembly: assemblyName);
    }

    public object SerializedTypeValue(AttributeType type)
    {
        var local = type.Reader != null && type.Handle.Kind == HandleKind.TypeDefinition;
        var assemblyQualified = type.SerializedAssembly != null;
        var declared = local ? metadata.GetAssemblyDefinition().GetAssemblyName() : null;
        var identityMatchesReference = assemblyQualified && (local
            ? type.SerializedAssembly!.FullName == declared!.FullName
            : metadata.AssemblyReferences.Select(handle => metadata.GetAssemblyReference(handle).GetAssemblyName())
                .Any(identity => identity.FullName == type.SerializedAssembly!.FullName));
        // Compare the resolved runtime identity, but also preserve qualification and its agreement with AssemblyRef.
        // Unqualified System.Int32 resolves in CoreCLR yet fails importing a FixedBuffer attribute through facade references.
        var resolvedIdentity = local ? type.Name + ", " + declared!.FullName
            : Type.GetType(type.SerializedName ?? type.Name, throwOnError: true)!.AssemblyQualifiedName;
        return new { name = type.Name, assemblyQualified, identityMatchesReference, resolvedIdentity };
    }

    public PrimitiveTypeCode GetUnderlyingEnumType(AttributeType type)
    {
        if (type.Handle.Kind == HandleKind.TypeDefinition && type.Reader != null)
            return LocalEnumStorage(type.Reader, (TypeDefinitionHandle)type.Handle);
        var runtimeType = type.Handle.Kind == HandleKind.TypeReference && type.Reader != null
            ? ResolveReference(type.Reader, (TypeReferenceHandle)type.Handle)
            : type.SerializedName != null ? Type.GetType(type.SerializedName, throwOnError: true)!
            : throw new BadImageFormatException("Attribute enum has no native type identity: " + type.Name);
        return Type.GetTypeCode(Enum.GetUnderlyingType(runtimeType)) switch
        {
            TypeCode.SByte => PrimitiveTypeCode.SByte, TypeCode.Byte => PrimitiveTypeCode.Byte,
            TypeCode.Int16 => PrimitiveTypeCode.Int16, TypeCode.UInt16 => PrimitiveTypeCode.UInt16,
            TypeCode.Int32 => PrimitiveTypeCode.Int32, TypeCode.UInt32 => PrimitiveTypeCode.UInt32,
            TypeCode.Int64 => PrimitiveTypeCode.Int64, TypeCode.UInt64 => PrimitiveTypeCode.UInt64,
            _ => throw new BadImageFormatException("Invalid native enum storage: " + type.Name),
        };
    }

    PrimitiveTypeCode LocalEnumStorage(MetadataReader reader, TypeDefinitionHandle handle)
    {
        // A reference image cannot be loaded to discover its own enums, so read the ECMA storage field directly.
        var definition = reader.GetTypeDefinition(handle);
        if (definition.BaseType.Kind != HandleKind.TypeReference
            || ResolveReference(reader, (TypeReferenceHandle)definition.BaseType) != typeof(Enum))
            throw new BadImageFormatException("Attribute enum does not derive from native System.Enum");
        var fields = definition.GetFields().Select(reader.GetFieldDefinition)
            .Where(field => (field.Attributes & FieldAttributes.Static) == 0).ToArray();
        if (fields.Length != 1 || reader.GetString(fields[0].Name) != "value__")
            throw new BadImageFormatException("Attribute enum must have exactly one value__ instance field");
        var signature = fields[0].DecodeSignature(names, null);
        if (!Enum.TryParse<PrimitiveTypeCode>(signature, out var code)
            || code is not (PrimitiveTypeCode.SByte or PrimitiveTypeCode.Byte or PrimitiveTypeCode.Int16 or PrimitiveTypeCode.UInt16
                or PrimitiveTypeCode.Int32 or PrimitiveTypeCode.UInt32 or PrimitiveTypeCode.Int64 or PrimitiveTypeCode.UInt64))
            throw new BadImageFormatException("Invalid metadata enum storage: " + signature);
        return code;
    }

    Type ResolveReference(MetadataReader reader, TypeReferenceHandle handle, int depth = 0)
    {
        if (depth >= 256) throw new BadImageFormatException("Attribute enum type nesting exceeds the observer limit");
        var reference = reader.GetTypeReference(handle);
        var scope = reference.ResolutionScope;
        if (scope.Kind == HandleKind.TypeReference)
            return ResolveReference(reader, (TypeReferenceHandle)scope, depth + 1)
                .GetNestedType(reader.GetString(reference.Name), BindingFlags.Public | BindingFlags.NonPublic)
                ?? throw new TypeLoadException("Missing nested attribute enum: " + names.Name(reader, handle));
        if (scope.Kind != HandleKind.AssemblyReference)
            throw new BadImageFormatException("Attribute enum TypeRef requires an assembly resolution scope");
        var identity = reader.GetAssemblyReference((AssemblyReferenceHandle)scope).GetAssemblyName();
        // CLR resolution follows framework type forwarders while respecting the metadata AssemblyRef identity.
        return Assembly.Load(identity).GetType(names.Name(reader, handle), throwOnError: true)!;
    }
}
