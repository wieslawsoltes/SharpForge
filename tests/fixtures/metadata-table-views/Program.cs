using System;
using System.Collections.Generic;
using System.Collections.Immutable;
using System.IO;
using System.Linq;
using System.Reflection.Metadata;
using System.Reflection.Metadata.Ecma335;
using System.Reflection.PortableExecutable;
using System.Text;
using System.Text.Json;

// The capture driver substitutes inputs, then uses the repository's pinned Roslyn/CoreCLR harness.
using var inputs = JsonDocument.Parse(Encoding.UTF8.GetString(Convert.FromBase64String("INPUT_JSON_BASE64")));
var images = new List<object>();
foreach (var input in inputs.RootElement.EnumerateArray())
{
    var bytes = Convert.FromBase64String(input.GetProperty("image").GetString()!);
    var isPE = bytes[0] == 0x4d && bytes[1] == 0x5a;
    using var stream = new MemoryStream(bytes);
    using var pe = isPE ? new PEReader(stream) : null;
    using var provider = isPE ? null : MetadataReaderProvider.FromMetadataImage(ImmutableArray.Create(bytes));
    var reader = pe != null ? pe.GetMetadataReader(MetadataReaderOptions.None)
        : provider!.GetMetadataReader(MetadataReaderOptions.None);
    var metadataOffset = pe?.PEHeaders.MetadataStartOffset ?? 0;
    var tables = Enum.GetValues<TableIndex>()
        .Where(table => reader.GetTableRowCount(table) > 0)
        .Select(table => {
            var count = reader.GetTableRowCount(table);
            var size = reader.GetTableRowSize(table);
            var offset = metadataOffset + reader.GetTableMetadataOffset(table);
            return new { table = (int)table, rowCount = count, rowSize = size, fileOffset = offset,
                rows = Enumerable.Range(0, count).Select(index => new {
                    token = ((int)table << 24) + index + 1,
                    fileOffset = offset + index * size,
                    bytes = Convert.ToHexString(bytes.AsSpan(offset + index * size, size))
                }).ToArray() };
        }).ToArray();
    var heapKinds = new Dictionary<string, HeapIndex> {
        ["#Strings"] = HeapIndex.String, ["#Blob"] = HeapIndex.Blob,
        ["#GUID"] = HeapIndex.Guid, ["#US"] = HeapIndex.UserString
    };
    var heaps = input.GetProperty("probes").EnumerateObject().Select(probes => {
        var kind = heapKinds[probes.Name];
        return new { name = probes.Name, byteLength = reader.GetHeapSize(kind),
            fileOffset = metadataOffset + reader.GetHeapMetadataOffset(kind),
            entries = probes.Value.EnumerateArray().Select(probe => {
                int index = probe.GetInt32();
                string value = probes.Name switch {
                    "#Strings" => reader.GetString(MetadataTokens.StringHandle(index)),
                    "#Blob" => Convert.ToHexString(reader.GetBlobBytes(MetadataTokens.BlobHandle(index))),
                    "#GUID" => reader.GetGuid(MetadataTokens.GuidHandle(index)).ToString(),
                    _ => reader.GetUserString(MetadataTokens.UserStringHandle(index))
                };
                return new { index, value };
            }).ToArray() };
    }).ToArray();
    images.Add(new { label = input.GetProperty("label").GetString(), metadataOffset, tables, heaps,
        namedRows = new RowProjection(reader).Read() });
}
Console.WriteLine(JsonSerializer.Serialize(new { images }));

sealed class RowProjection
{
    readonly MetadataReader reader;
    readonly List<object> rows = new();
    public RowProjection(MetadataReader reader) { this.reader = reader; }
    string S(StringHandle handle) => reader.GetString(handle);
    string B(BlobHandle handle) => Convert.ToHexString(reader.GetBlobBytes(handle));
    string G(GuidHandle handle) => reader.GetGuid(handle).ToString();
    int T(EntityHandle handle) => handle.IsNil ? 0 : MetadataTokens.GetToken(handle);
    void Add(int table, int row, params (string Name, object Value)[] values) => rows.Add(new {
        token = (table << 24) + row,
        columns = values.ToDictionary(value => value.Name, value => value.Value)
    });
    public object[] Read()
    {
        foreach (var table in Enum.GetValues<TableIndex>())
        {
            for (int row = 1; row <= reader.GetTableRowCount(table); row++)
            {
                if ((int)table <= 17) ReadDefinitions((int)table, row);
                else if ((int)table <= 32) ReadMembers((int)table, row);
                else if ((int)table <= 44) ReadManifest((int)table, row);
                else ReadDebug((int)table, row);
            }
        }
        return rows.ToArray();
    }

    // Typed SRM accessors validate semantic column projections independently of physical bytes.
    void ReadDefinitions(int table, int row)
    {
        switch (table)
        {
                case 0:
                    var module = reader.GetModuleDefinition();
                    Add(0, row, ("Generation", module.Generation), ("Name", S(module.Name)),
                        ("Mvid", G(module.Mvid)), ("EncId", G(module.GenerationId)), ("EncBaseId", G(module.BaseGenerationId)));
                    break;
                case 1:
                    var reference = reader.GetTypeReference(MetadataTokens.TypeReferenceHandle(row));
                    Add(1, row, ("ResolutionScope", T(reference.ResolutionScope)), ("Name", S(reference.Name)),
                        ("Namespace", S(reference.Namespace)));
                    break;
                case 2:
                    var type = reader.GetTypeDefinition(MetadataTokens.TypeDefinitionHandle(row));
                    Add(2, row, ("Flags", (int)type.Attributes), ("Name", S(type.Name)),
                        ("Namespace", S(type.Namespace)), ("Extends", T(type.BaseType)));
                    break;
                case 4:
                    var field = reader.GetFieldDefinition(MetadataTokens.FieldDefinitionHandle(row));
                    Add(4, row, ("Flags", (int)field.Attributes), ("Name", S(field.Name)), ("Signature", B(field.Signature)));
                    break;
                case 6:
                    var method = reader.GetMethodDefinition(MetadataTokens.MethodDefinitionHandle(row));
                    Add(6, row, ("RVA", method.RelativeVirtualAddress), ("ImplFlags", (int)method.ImplAttributes),
                        ("Flags", (int)method.Attributes), ("Name", S(method.Name)), ("Signature", B(method.Signature)));
                    break;
                case 8:
                    var parameter = reader.GetParameter(MetadataTokens.ParameterHandle(row));
                    Add(8, row, ("Flags", (int)parameter.Attributes), ("Sequence", parameter.SequenceNumber), ("Name", S(parameter.Name)));
                    break;
                case 9:
                    var implementation = reader.GetInterfaceImplementation(MetadataTokens.InterfaceImplementationHandle(row));
                    Add(9, row, ("Interface", T(implementation.Interface)));
                    break;
                case 10:
                    var member = reader.GetMemberReference(MetadataTokens.MemberReferenceHandle(row));
                    Add(10, row, ("Class", T(member.Parent)), ("Name", S(member.Name)), ("Signature", B(member.Signature)));
                    break;
                case 11:
                    var constant = reader.GetConstant(MetadataTokens.ConstantHandle(row));
                    Add(11, row, ("Type", (int)constant.TypeCode), ("Parent", T(constant.Parent)), ("Value", B(constant.Value)));
                    break;
                case 12:
                    var attribute = reader.GetCustomAttribute(MetadataTokens.CustomAttributeHandle(row));
                    Add(12, row, ("Parent", T(attribute.Parent)), ("Type", T(attribute.Constructor)), ("Value", B(attribute.Value)));
                    break;
                case 14:
                    var security = reader.GetDeclarativeSecurityAttribute(MetadataTokens.DeclarativeSecurityAttributeHandle(row));
                    Add(14, row, ("Action", (int)security.Action), ("Parent", T(security.Parent)), ("PermissionSet", B(security.PermissionSet)));
                    break;
                case 17:
                    Add(17, row, ("Signature", B(reader.GetStandaloneSignature(MetadataTokens.StandaloneSignatureHandle(row)).Signature)));
                    break;
        }
    }

    void ReadMembers(int table, int row)
    {
        switch (table)
        {
                case 20:
                    var @event = reader.GetEventDefinition(MetadataTokens.EventDefinitionHandle(row));
                    Add(20, row, ("EventFlags", (int)@event.Attributes), ("Name", S(@event.Name)), ("EventType", T(@event.Type)));
                    break;
                case 23:
                    var property = reader.GetPropertyDefinition(MetadataTokens.PropertyDefinitionHandle(row));
                    Add(23, row, ("Flags", (int)property.Attributes), ("Name", S(property.Name)), ("Type", B(property.Signature)));
                    break;
                case 25:
                    var methodImpl = reader.GetMethodImplementation(MetadataTokens.MethodImplementationHandle(row));
                    Add(25, row, ("Class", T(methodImpl.Type)), ("MethodBody", T(methodImpl.MethodBody)),
                        ("MethodDeclaration", T(methodImpl.MethodDeclaration)));
                    break;
                case 26:
                    Add(26, row, ("Name", S(reader.GetModuleReference(MetadataTokens.ModuleReferenceHandle(row)).Name)));
                    break;
                case 27:
                    Add(27, row, ("Signature", B(reader.GetTypeSpecification(MetadataTokens.TypeSpecificationHandle(row)).Signature)));
                    break;
                case 32:
                    var assembly = reader.GetAssemblyDefinition();
                    Add(32, row, ("HashAlgId", (int)assembly.HashAlgorithm), ("MajorVersion", assembly.Version.Major),
                        ("MinorVersion", assembly.Version.Minor), ("BuildNumber", assembly.Version.Build),
                        ("RevisionNumber", assembly.Version.Revision), ("Flags", (int)assembly.Flags),
                        ("PublicKey", B(assembly.PublicKey)), ("Name", S(assembly.Name)), ("Culture", S(assembly.Culture)));
                    break;
        }
    }

    void ReadManifest(int table, int row)
    {
        switch (table)
        {
                case 35:
                    var assemblyRef = reader.GetAssemblyReference(MetadataTokens.AssemblyReferenceHandle(row));
                    Add(35, row, ("MajorVersion", assemblyRef.Version.Major), ("MinorVersion", assemblyRef.Version.Minor),
                        ("BuildNumber", assemblyRef.Version.Build), ("RevisionNumber", assemblyRef.Version.Revision),
                        ("Flags", (int)assemblyRef.Flags), ("PublicKeyOrToken", B(assemblyRef.PublicKeyOrToken)),
                        ("Name", S(assemblyRef.Name)), ("Culture", S(assemblyRef.Culture)), ("HashValue", B(assemblyRef.HashValue)));
                    break;
                case 38:
                    var file = reader.GetAssemblyFile(MetadataTokens.AssemblyFileHandle(row));
                    Add(38, row, ("Flags", file.ContainsMetadata ? 0 : 1), ("Name", S(file.Name)), ("HashValue", B(file.HashValue)));
                    break;
                case 39:
                    var exported = reader.GetExportedType(MetadataTokens.ExportedTypeHandle(row));
                    Add(39, row, ("Flags", (int)exported.Attributes), ("TypeName", S(exported.Name)),
                        ("TypeNamespace", S(exported.Namespace)), ("Implementation", T(exported.Implementation)));
                    break;
                case 40:
                    var resource = reader.GetManifestResource(MetadataTokens.ManifestResourceHandle(row));
                    Add(40, row, ("Offset", resource.Offset), ("Flags", (int)resource.Attributes),
                        ("Name", S(resource.Name)), ("Implementation", T(resource.Implementation)));
                    break;
                case 42:
                    var generic = reader.GetGenericParameter(MetadataTokens.GenericParameterHandle(row));
                    Add(42, row, ("Number", generic.Index), ("Flags", (int)generic.Attributes),
                        ("Owner", T(generic.Parent)), ("Name", S(generic.Name)));
                    break;
                case 43:
                    var specification = reader.GetMethodSpecification(MetadataTokens.MethodSpecificationHandle(row));
                    Add(43, row, ("Method", T(specification.Method)), ("Instantiation", B(specification.Signature)));
                    break;
                case 44:
                    var constraint = reader.GetGenericParameterConstraint(MetadataTokens.GenericParameterConstraintHandle(row));
                    Add(44, row, ("Owner", T(constraint.Parameter)), ("Constraint", T(constraint.Type)));
                    break;
        }
    }

    void ReadDebug(int table, int row)
    {
        switch (table)
        {
                case 48:
                    var document = reader.GetDocument(MetadataTokens.DocumentHandle(row));
                    Add(48, row, ("Name", B((BlobHandle)document.Name)), ("HashAlgorithm", G(document.HashAlgorithm)),
                        ("Hash", B(document.Hash)), ("Language", G(document.Language)));
                    break;
                case 49:
                    var debug = reader.GetMethodDebugInformation(MetadataTokens.MethodDebugInformationHandle(row));
                    Add(49, row, ("Document", T(debug.Document)), ("SequencePoints", B(debug.SequencePointsBlob)));
                    break;
                case 50:
                    var scope = reader.GetLocalScope(MetadataTokens.LocalScopeHandle(row));
                    Add(50, row, ("Method", T(scope.Method)), ("ImportScope", T(scope.ImportScope)),
                        ("StartOffset", scope.StartOffset), ("Length", scope.Length));
                    break;
                case 51:
                    var local = reader.GetLocalVariable(MetadataTokens.LocalVariableHandle(row));
                    Add(51, row, ("Attributes", (int)local.Attributes), ("Index", local.Index), ("Name", S(local.Name)));
                    break;
                case 52:
                    var localConstant = reader.GetLocalConstant(MetadataTokens.LocalConstantHandle(row));
                    Add(52, row, ("Name", S(localConstant.Name)), ("Signature", B(localConstant.Signature)));
                    break;
                case 53:
                    var import = reader.GetImportScope(MetadataTokens.ImportScopeHandle(row));
                    Add(53, row, ("Parent", T(import.Parent)), ("Imports", B(import.ImportsBlob)));
                    break;
                case 55:
                    var custom = reader.GetCustomDebugInformation(MetadataTokens.CustomDebugInformationHandle(row));
                    Add(55, row, ("Parent", T(custom.Parent)), ("Kind", G(custom.Kind)), ("Value", B(custom.Value)));
                    break;
        }
    }
}
