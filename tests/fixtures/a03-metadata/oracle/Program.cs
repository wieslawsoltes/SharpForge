using System.Collections.Immutable;
using System.Reflection.Metadata;
using System.Reflection.Metadata.Ecma335;
using System.Text.Json;

// Read the metadata root directly so no runtime profile or assembly loading is involved.
using var provider = MetadataReaderProvider.FromMetadataImage(ImmutableArray.Create(File.ReadAllBytes(args[0])));
var reader = provider.GetMetadataReader();
var types = reader.TypeDefinitions.Select(handle => {
    var type = reader.GetTypeDefinition(handle);
    var layout = type.GetLayout();
    return new {
        token = MetadataTokens.GetToken(handle), name = reader.GetString(type.Name),
        @namespace = reader.GetString(type.Namespace), attributes = (int)type.Attributes,
        enclosing = MetadataTokens.GetToken(type.GetDeclaringType()),
        packing = layout.PackingSize, size = layout.Size,
        interfaces = type.GetInterfaceImplementations().Select(item => new {
            token = MetadataTokens.GetToken(item),
            type = MetadataTokens.GetToken(reader.GetInterfaceImplementation(item).Interface)
        }).ToArray(),
        methods = type.GetMethodImplementations().Select(item => new {
            body = MetadataTokens.GetToken(reader.GetMethodImplementation(item).MethodBody),
            declaration = MetadataTokens.GetToken(reader.GetMethodImplementation(item).MethodDeclaration)
        }).ToArray()
    };
}).ToArray();
var fields = reader.FieldDefinitions.Select(handle => {
    var field = reader.GetFieldDefinition(handle);
    var constant = field.GetDefaultValue();
    return new {
        token = MetadataTokens.GetToken(handle), name = reader.GetString(field.Name),
        attributes = (int)field.Attributes, offset = field.GetOffset(), rva = field.GetRelativeVirtualAddress(),
        constant = constant.IsNil ? null : new {
            type = (int)reader.GetConstant(constant).TypeCode,
            value = Convert.ToHexString(reader.GetBlobBytes(reader.GetConstant(constant).Value))
        }
    };
}).ToArray();
var imports = reader.MethodDefinitions.Select(handle => {
    var method = reader.GetMethodDefinition(handle);
    var import = method.GetImport();
    return new { token = MetadataTokens.GetToken(handle), name = reader.GetString(method.Name),
        importName = reader.GetString(import.Name), importModule = MetadataTokens.GetToken(import.Module),
        importFlags = (int)import.Attributes };
}).ToArray();
var resources = reader.ManifestResources.Select(handle => {
    var item = reader.GetManifestResource(handle);
    return new { name = reader.GetString(item.Name), offset = item.Offset, attributes = (int)item.Attributes,
        implementation = MetadataTokens.GetToken(item.Implementation) };
}).ToArray();
var exported = reader.ExportedTypes.Select(handle => {
    var item = reader.GetExportedType(handle);
    return new { name = reader.GetString(item.Name), @namespace = reader.GetString(item.Namespace),
        attributes = (int)item.Attributes, implementation = MetadataTokens.GetToken(item.Implementation) };
}).ToArray();
var files = reader.AssemblyFiles.Select(handle => {
    var item = reader.GetAssemblyFile(handle);
    return new { name = reader.GetString(item.Name), containsMetadata = item.ContainsMetadata,
        hash = Convert.ToHexString(reader.GetBlobBytes(item.HashValue)) };
}).ToArray();
var events = reader.EventDefinitions.Select(handle => {
    var item = reader.GetEventDefinition(handle);
    return new { name = reader.GetString(item.Name), type = MetadataTokens.GetToken(item.Type), attributes = (int)item.Attributes };
}).ToArray();
var security = reader.DeclarativeSecurityAttributes.Select(handle => {
    var item = reader.GetDeclarativeSecurityAttribute(handle);
    return new { action = (int)item.Action, parent = MetadataTokens.GetToken(item.Parent),
        value = Convert.ToHexString(reader.GetBlobBytes(item.PermissionSet)) };
}).ToArray();
var parameters = Enumerable.Range(1, reader.GetTableRowCount(TableIndex.Param)).Select(index => {
    var item = reader.GetParameter(MetadataTokens.ParameterHandle(index));
    return new { name = reader.GetString(item.Name), sequence = item.SequenceNumber,
        marshal = Convert.ToHexString(reader.GetBlobBytes(item.GetMarshallingDescriptor())) };
}).ToArray();
var counts = Enum.GetValues<TableIndex>().Where(table => reader.GetTableRowCount(table) != 0)
    .ToDictionary(table => ((int)table).ToString(), table => reader.GetTableRowCount(table));
Console.WriteLine(JsonSerializer.Serialize(new { counts, types, fields, imports, resources, exported, files, events, security, parameters },
    new JsonSerializerOptions { WriteIndented = true }));
