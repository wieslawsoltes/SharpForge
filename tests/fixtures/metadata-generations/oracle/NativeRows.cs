using System.Reflection.Metadata;
using System.Reflection.Metadata.Ecma335;

internal sealed record NativeRow(int Token, int Generation, int LocalToken, int MetadataOffset,
    int ByteLength, string Bytes, Dictionary<string, int>? Fields, Dictionary<string, int>? References);

internal static class NativeRows
{
    public static NativeRow Read(MetadataReader reader, byte[] root, int generation, int localToken, int aggregateToken)
    {
        var table = (TableIndex)(localToken >>> 24);
        int row = localToken & 0xffffff;
        int width = reader.GetTableRowSize(table);
        int offset = reader.GetTableMetadataOffset(table) + (row - 1) * width;
        var bytes = root.AsSpan(offset, width);
        return new NativeRow(aggregateToken, generation, localToken, offset, width,
            Convert.ToHexString(bytes).ToLowerInvariant(), DefinitionFields(reader, table, row) ?? ReferenceFields(reader, table, row),
            References(reader, table, row));
    }

    private static Dictionary<string, int>? DefinitionFields(MetadataReader reader, TableIndex table, int row)
    {
        if (table == TableIndex.Module)
        {
            var value = reader.GetModuleDefinition();
            return new() { ["Generation"] = value.Generation, ["Name"] = MetadataTokens.GetHeapOffset(value.Name),
                ["Mvid"] = MetadataTokens.GetHeapOffset(value.Mvid), ["EncId"] = MetadataTokens.GetHeapOffset(value.GenerationId),
                ["EncBaseId"] = MetadataTokens.GetHeapOffset(value.BaseGenerationId) };
        }
        if (table == TableIndex.MethodDef)
        {
            var value = reader.GetMethodDefinition(MetadataTokens.MethodDefinitionHandle(row));
            return new() { ["RVA"] = value.RelativeVirtualAddress, ["ImplFlags"] = (int)value.ImplAttributes,
                ["Flags"] = (int)value.Attributes, ["Name"] = MetadataTokens.GetHeapOffset(value.Name),
                ["Signature"] = MetadataTokens.GetHeapOffset(value.Signature) };
        }
        if (table == TableIndex.Field)
        {
            var value = reader.GetFieldDefinition(MetadataTokens.FieldDefinitionHandle(row));
            return new() { ["Flags"] = (int)value.Attributes, ["Name"] = MetadataTokens.GetHeapOffset(value.Name),
                ["Signature"] = MetadataTokens.GetHeapOffset(value.Signature) };
        }
        if (table == TableIndex.Param)
        {
            var value = reader.GetParameter(MetadataTokens.ParameterHandle(row));
            return new() { ["Flags"] = (int)value.Attributes, ["Sequence"] = value.SequenceNumber,
                ["Name"] = MetadataTokens.GetHeapOffset(value.Name) };
        }
        if (table == TableIndex.StandAloneSig)
        {
            var value = reader.GetStandaloneSignature(MetadataTokens.StandaloneSignatureHandle(row));
            return new() { ["Signature"] = MetadataTokens.GetHeapOffset(value.Signature) };
        }
        if (table == TableIndex.TypeDef)
        {
            var value = reader.GetTypeDefinition(MetadataTokens.TypeDefinitionHandle(row));
            return new() { ["Flags"] = (int)value.Attributes, ["Name"] = MetadataTokens.GetHeapOffset(value.Name),
                ["Namespace"] = MetadataTokens.GetHeapOffset(value.Namespace) };
        }
        return null;
    }

    private static Dictionary<string, int>? ReferenceFields(MetadataReader reader, TableIndex table, int row)
    {
        if (table == TableIndex.TypeRef)
        {
            var value = reader.GetTypeReference(MetadataTokens.TypeReferenceHandle(row));
            return new() { ["Name"] = MetadataTokens.GetHeapOffset(value.Name), ["Namespace"] = MetadataTokens.GetHeapOffset(value.Namespace) };
        }
        if (table == TableIndex.MemberRef)
        {
            var value = reader.GetMemberReference(MetadataTokens.MemberReferenceHandle(row));
            return new() { ["Name"] = MetadataTokens.GetHeapOffset(value.Name), ["Signature"] = MetadataTokens.GetHeapOffset(value.Signature) };
        }
        if (table == TableIndex.CustomAttribute)
            return new() { ["Value"] = MetadataTokens.GetHeapOffset(reader.GetCustomAttribute(MetadataTokens.CustomAttributeHandle(row)).Value) };
        if (table == TableIndex.Assembly)
        {
            var value = reader.GetAssemblyDefinition();
            return new() { ["HashAlgId"] = (int)value.HashAlgorithm, ["Flags"] = (int)value.Flags,
                ["MajorVersion"] = value.Version.Major, ["MinorVersion"] = value.Version.Minor,
                ["BuildNumber"] = value.Version.Build, ["RevisionNumber"] = value.Version.Revision,
                ["Name"] = MetadataTokens.GetHeapOffset(value.Name), ["Culture"] = MetadataTokens.GetHeapOffset(value.Culture),
                ["PublicKey"] = MetadataTokens.GetHeapOffset(value.PublicKey) };
        }
        if (table == TableIndex.AssemblyRef)
        {
            var value = reader.GetAssemblyReference(MetadataTokens.AssemblyReferenceHandle(row));
            return new() { ["Flags"] = (int)value.Flags, ["MajorVersion"] = value.Version.Major, ["MinorVersion"] = value.Version.Minor,
                ["BuildNumber"] = value.Version.Build, ["RevisionNumber"] = value.Version.Revision,
                ["Name"] = MetadataTokens.GetHeapOffset(value.Name), ["Culture"] = MetadataTokens.GetHeapOffset(value.Culture),
                ["PublicKeyOrToken"] = MetadataTokens.GetHeapOffset(value.PublicKeyOrToken), ["HashValue"] = MetadataTokens.GetHeapOffset(value.HashValue) };
        }
        return null;
    }

    private static int Token(EntityHandle handle) => handle.IsNil ? 0 : MetadataTokens.GetToken(handle);

    private static Dictionary<string, int>? References(MetadataReader reader, TableIndex table, int row)
    {
        if (table == TableIndex.TypeRef)
            return new() { ["ResolutionScope"] = Token(reader.GetTypeReference(MetadataTokens.TypeReferenceHandle(row)).ResolutionScope) };
        if (table == TableIndex.TypeDef)
            return new() { ["Extends"] = Token(reader.GetTypeDefinition(MetadataTokens.TypeDefinitionHandle(row)).BaseType) };
        if (table == TableIndex.MemberRef)
            return new() { ["Class"] = Token(reader.GetMemberReference(MetadataTokens.MemberReferenceHandle(row)).Parent) };
        if (table == TableIndex.CustomAttribute)
        {
            var value = reader.GetCustomAttribute(MetadataTokens.CustomAttributeHandle(row));
            return new() { ["Parent"] = Token(value.Parent), ["Type"] = Token(value.Constructor) };
        }
        return null;
    }

    public static List<NativeRow> Physical(MetadataReader reader, byte[] root, int generation)
    {
        var rows = new List<NativeRow>();
        for (int table = 0; table <= 44; table++)
        {
            int count = reader.GetTableRowCount((TableIndex)table);
            if (count + rows.Count > 100_000) throw new ArgumentException("Observer row budget exceeded");
            for (int row = 1; row <= count; row++)
            {
                int token = table << 24 | row;
                rows.Add(Read(reader, root, generation, token, token));
            }
        }
        return rows;
    }
}
