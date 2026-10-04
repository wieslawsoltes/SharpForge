using System.Reflection.Metadata;
using System.Reflection.Metadata.Ecma335;

internal sealed record HeapProbe(string Kind, int Value);

internal static class NativeHeaps
{
    private static readonly (string Kind, HeapIndex Heap)[] Kinds =
    [ ("string", HeapIndex.String), ("blob", HeapIndex.Blob), ("guid", HeapIndex.Guid), ("userString", HeapIndex.UserString) ];

    private static Handle Handle(HeapProbe probe) => probe.Kind switch
    {
        "string" => MetadataTokens.StringHandle(probe.Value),
        "blob" => MetadataTokens.BlobHandle(probe.Value),
        "guid" => MetadataTokens.GuidHandle(probe.Value),
        "userString" => MetadataTokens.UserStringHandle(probe.Value),
        _ => throw new ArgumentException("Unknown heap probe"),
    };

    private static Handle Next(MetadataReader reader, string kind, Handle handle) => kind switch
    {
        "string" => reader.GetNextHandle((StringHandle)handle),
        "blob" => reader.GetNextHandle((BlobHandle)handle),
        "userString" => reader.GetNextHandle((UserStringHandle)handle),
        _ => throw new ArgumentException("Heap does not support offset enumeration"),
    };

    private static string Read(MetadataReader reader, string kind, Handle handle) => kind switch
    {
        "string" => reader.GetString((StringHandle)handle),
        "blob" => Convert.ToHexString(reader.GetBlobBytes((BlobHandle)handle)).ToLowerInvariant(),
        "guid" => Convert.ToHexString(reader.GetGuid((GuidHandle)handle).ToByteArray()).ToLowerInvariant(),
        "userString" => reader.GetUserString((UserStringHandle)handle),
        _ => throw new ArgumentException("Unknown heap probe"),
    };

    public static Dictionary<string, int> AddProbes(MetadataReader reader, Dictionary<string, int> totals, HashSet<HeapProbe> probes)
    {
        var sizes = new Dictionary<string, int>();
        foreach (var (kind, heap) in Kinds)
        {
            int size = reader.GetHeapSize(heap), prior = totals.GetValueOrDefault(kind);
            int aggregateSize = prior + (kind == "guid" ? size / 16 : size);
            sizes[kind] = size;
            totals[kind] = aggregateSize;
            foreach (int offset in new[] { 0, prior, Math.Max(0, aggregateSize - 1), aggregateSize, aggregateSize + 1 })
                probes.Add(new HeapProbe(kind, offset));
            if (kind == "guid")
            {
                if (size / 16 > 20_000) throw new ArgumentException("Observer GUID budget exceeded");
                for (int index = 1; index <= aggregateSize; index++) probes.Add(new HeapProbe(kind, index));
                continue;
            }
            if (size == 0) continue;
            var handle = Handle(new HeapProbe(kind, 0));
            for (int count = 0; ; count++)
            {
                if (count > 20_000) throw new ArgumentException("Observer heap record budget exceeded");
                probes.Add(new HeapProbe(kind, prior + MetadataTokens.GetHeapOffset(handle)));
                var next = Next(reader, kind, handle);
                if (next.IsNil) break;
                if (MetadataTokens.GetHeapOffset(next) <= MetadataTokens.GetHeapOffset(handle))
                    throw new BadImageFormatException("Nonadvancing native heap enumerator");
                handle = next;
            }
        }
        AddReferencedHeaps(reader, probes);
        return sizes;
    }

    private static void AddReferencedHeaps(MetadataReader reader, HashSet<HeapProbe> probes)
    {
        void String(StringHandle handle) => probes.Add(new HeapProbe("string", MetadataTokens.GetHeapOffset(handle)));
        void Blob(BlobHandle handle) => probes.Add(new HeapProbe("blob", MetadataTokens.GetHeapOffset(handle)));
        var module = reader.GetModuleDefinition();
        String(module.Name);
        foreach (var handle in new[] { module.Mvid, module.GenerationId, module.BaseGenerationId })
            probes.Add(new HeapProbe("guid", MetadataTokens.GetHeapOffset(handle)));
        foreach (var handle in reader.TypeDefinitions) { var value = reader.GetTypeDefinition(handle); String(value.Name); String(value.Namespace); }
        foreach (var handle in reader.TypeReferences) { var value = reader.GetTypeReference(handle); String(value.Name); String(value.Namespace); }
        foreach (var handle in reader.MethodDefinitions) { var value = reader.GetMethodDefinition(handle); String(value.Name); Blob(value.Signature); }
        foreach (var handle in reader.FieldDefinitions) { var value = reader.GetFieldDefinition(handle); String(value.Name); Blob(value.Signature); }
        foreach (var handle in reader.MemberReferences) { var value = reader.GetMemberReference(handle); String(value.Name); Blob(value.Signature); }
        foreach (var handle in reader.CustomAttributes) Blob(reader.GetCustomAttribute(handle).Value);
        for (int row = 1; row <= reader.GetTableRowCount(TableIndex.StandAloneSig); row++)
            Blob(reader.GetStandaloneSignature(MetadataTokens.StandaloneSignatureHandle(row)).Signature);
        foreach (var handle in reader.AssemblyReferences)
        {
            var value = reader.GetAssemblyReference(handle);
            String(value.Name); String(value.Culture); Blob(value.PublicKeyOrToken); Blob(value.HashValue);
        }
        if (reader.IsAssembly)
        {
            var value = reader.GetAssemblyDefinition();
            String(value.Name); String(value.Culture); Blob(value.PublicKey);
        }
    }

    private static unsafe string UserStringStatus(MetadataReader reader, byte[] root, int offset)
    {
        int size = reader.GetHeapSize(HeapIndex.UserString);
        if (offset < 0 || offset >= size) return "outside-heap";
        int start = reader.GetHeapMetadataOffset(HeapIndex.UserString);
        fixed (byte* pointer = root)
        {
            var blob = new BlobReader(pointer + start + offset, size - offset);
            try
            {
                int length = blob.ReadCompressedInteger();
                if (length == 0) return "nil-or-padding";
                if (length > blob.RemainingBytes) return "truncated";
                return (length & 1) == 1 ? "valid" : "invalid-length";
            }
            catch (BadImageFormatException) { return "invalid-prefix"; }
        }
    }

    public static object[] MapProbes(MetadataAggregator aggregate, MetadataReader[] readers, byte[][] roots, HashSet<HeapProbe> probes)
    {
        var results = new List<object>();
        foreach (var probe in probes.OrderBy(value => value.Kind, StringComparer.Ordinal).ThenBy(value => value.Value))
        {
            Handle local;
            int generation;
            try { local = aggregate.GetGenerationHandle(Handle(probe), out generation); }
            catch (Exception error)
            {
                results.Add(new { kind = probe.Kind, value = probe.Value, success = false, error = error.GetType().Name });
                continue;
            }
            int localValue = MetadataTokens.GetHeapOffset(local);
            try
            {
                string value = Read(readers[generation], probe.Kind, local);
                results.Add(new { kind = probe.Kind, value = probe.Value, success = true, generation, localValue,
                    readSuccess = true, heapValue = value,
                    userStringStatus = probe.Kind == "userString" ? UserStringStatus(readers[generation], roots[generation], localValue) : null });
            }
            catch (Exception error)
            {
                results.Add(new { kind = probe.Kind, value = probe.Value, success = true, generation, localValue,
                    readSuccess = false, readError = error.GetType().Name });
            }
        }
        return results.ToArray();
    }
}
