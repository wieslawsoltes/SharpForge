using System.Collections.Immutable;
using System.Reflection.Metadata;
using System.Reflection.Metadata.Ecma335;
using System.Reflection.PortableExecutable;
using System.Security.Cryptography;
using System.Text.Json;

internal static class Program
{
    private static byte[] ReadInput(string path)
    {
        if (new FileInfo(path).Length > 64 * 1024 * 1024) throw new ArgumentException("Observer input budget exceeded");
        return File.ReadAllBytes(path);
    }

    private static object Observe(string[] files)
    {
        var bytes = files.Select(ReadInput).ToArray();
        using var pe = new PEReader(new MemoryStream(bytes[0]));
        using var first = MetadataReaderProvider.FromMetadataImage(ImmutableArray.CreateRange(bytes[1]));
        using var second = MetadataReaderProvider.FromMetadataImage(ImmutableArray.CreateRange(bytes[2]));
        var readers = new[] { pe.GetMetadataReader(MetadataReaderOptions.None),
            first.GetMetadataReader(MetadataReaderOptions.None), second.GetMetadataReader(MetadataReaderOptions.None) };
        var roots = new[] { pe.GetMetadata().GetContent().ToArray(), bytes[1], bytes[2] };
        var counts = new Dictionary<int, int>();
        var latest = new Dictionary<int, NativeRow>();
        var generations = new List<object>();
        var probes = new HashSet<HeapProbe>();
        var heapTotals = new Dictionary<string, int>();
        for (int generation = 0; generation < readers.Length; generation++)
        {
            var reader = readers[generation];
            var physical = NativeRows.Physical(reader, roots[generation], generation);
            var mapping = reader.GetEditAndContinueMapEntries().Select(MetadataTokens.GetToken).ToArray();
            if (generation == 0)
            {
                foreach (var row in physical.Where(row => row.Token >>> 24 is not (30 or 31)))
                {
                    latest[row.Token] = row;
                    counts[row.Token >>> 24] = row.Token & 0xffffff;
                }
            }
            else
            {
                latest[1] = NativeRows.Read(reader, roots[generation], generation, 1, 1);
                var localRows = new Dictionary<int, int>();
                foreach (int value in mapping)
                {
                    int table = value >>> 24, localRow = localRows.GetValueOrDefault(table) + 1;
                    localRows[table] = localRow;
                    counts[table] = Math.Max(counts.GetValueOrDefault(table), value & 0xffffff);
                    latest[value] = NativeRows.Read(reader, roots[generation], generation, table << 24 | localRow, value);
                }
            }
            var heapSizes = NativeHeaps.AddProbes(reader, heapTotals, probes);
            var module = reader.GetModuleDefinition();
            var identity = new { generation = module.Generation,
                mvid = Convert.ToHexString(reader.GetGuid(module.Mvid).ToByteArray()).ToLowerInvariant(),
                generationId = Convert.ToHexString(reader.GetGuid(module.GenerationId).ToByteArray()).ToLowerInvariant(),
                previousGenerationId = Convert.ToHexString(reader.GetGuid(module.BaseGenerationId).ToByteArray()).ToLowerInvariant() };
            var log = reader.GetEditAndContinueLogEntries().Select(value =>
                new { token = MetadataTokens.GetToken(value.Handle), operation = (int)value.Operation }).ToArray();
            var aggregate = generation == 0 ? null : new MetadataAggregator(readers[0], readers.Skip(1).Take(generation).ToArray());
            generations.Add(new { generation, identity, heapSizes, heapTotals = new Dictionary<string, int>(heapTotals),
                counts = new Dictionary<int, int>(counts), physical, mapping, log,
                // Latest-row selection is derived separately from native EncMap and native physical rows.
                mergedRows = latest.OrderBy(item => item.Key).Select(item => item.Value).ToArray(),
                entityMappings = aggregate is null ? Array.Empty<object>() : EntityMappings(aggregate, counts),
                heapMappings = aggregate is null ? Array.Empty<object>() : NativeHeaps.MapProbes(aggregate, readers, roots, probes) });
        }
        return new { schemaVersion = 1, runtime = Environment.Version.ToString(),
            artifacts = files.Select((file, index) => new { name = Path.GetFileName(file),
                sha256 = Convert.ToHexString(SHA256.HashData(bytes[index])).ToLowerInvariant(), bytes = bytes[index].Length }).ToArray(),
            generations, qualification = "SRM physical reads and MetadataAggregator handle mapping; no runtime ApplyUpdate" };
    }

    private static object[] EntityMappings(MetadataAggregator aggregate, Dictionary<int, int> counts)
    {
        var results = new List<object>();
        foreach (var (table, count) in counts.OrderBy(item => item.Key))
        {
            for (int row = 0; row <= count + 1; row++)
            {
                int value = table << 24 | row;
                try
                {
                    var local = aggregate.GetGenerationHandle(MetadataTokens.Handle(value), out int generation);
                    results.Add(new { value, generation, localValue = MetadataTokens.GetToken(local), success = true });
                }
                catch (Exception error)
                {
                    results.Add(new { value, success = false, error = error.GetType().Name });
                }
            }
        }
        return results.ToArray();
    }

    public static void Main(string[] args)
    {
        object result = args.Length == 2 && args[0] == "create" ? FixtureWriter.Create(args[1]) :
            args.Length == 4 && args[0] == "observe" ? Observe(args.Skip(1).ToArray()) :
            throw new ArgumentException("create <fresh-directory> | observe <baseline.dll> <delta1.dmeta> <delta2.dmeta>");
        Console.WriteLine(JsonSerializer.Serialize(result, new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase }));
    }
}
