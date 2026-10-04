using System.Collections.Immutable;
using System.Reflection.Metadata;
using System.Reflection.Metadata.Ecma335;
using System.Reflection.PortableExecutable;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.Emit;
using Microsoft.CodeAnalysis.Text;

static class Program
{
    private static string Source(int generation) => $$"""
        public static class Fixture
        {
        #line {{(generation >= 2 ? 210 : 10)}} "Generation.cs"
            public static int First() => {{(generation >= 2 ? 1000 : 1)}};
        #line {{(generation >= 1 ? 120 : 20)}} "Generation.cs"
            public static int Updated()
            {
                int local = {{(generation >= 1 ? 100 : 10)}};
                return local;
            }
        #line 30 "Generation.cs"
            public static int Last() => 3;
        }
        """;

    private static CSharpCompilation Compile(int generation) => CSharpCompilation.Create(
        "GenerationFixture",
        [CSharpSyntaxTree.ParseText(SourceText.From(Source(generation), Encoding.UTF8), path: "/src/PdbGenerations/Fixture.cs")],
        [MetadataReference.CreateFromFile(typeof(object).Assembly.Location)],
        new CSharpCompilationOptions(OutputKind.DynamicallyLinkedLibrary,
            optimizationLevel: OptimizationLevel.Debug, deterministic: true, concurrentBuild: false));

    private static void Check(EmitResult result)
    {
        if (!result.Success) throw new InvalidOperationException(string.Join(Environment.NewLine, result.Diagnostics));
    }

    private static Dictionary<int, int> RowCounts(MetadataReader reader)
    {
        var result = new Dictionary<int, int>();
        for (int table = 0; table <= 44; table++)
        {
            if (table is 30 or 31 || !Enum.IsDefined((TableIndex)table)) continue;
            int count = reader.GetTableRowCount((TableIndex)table);
            if (count != 0) result.Add(table, count);
        }
        return result;
    }

    private static object Inspect(string path)
    {
        using var provider = MetadataReaderProvider.FromPortablePdbStream(File.OpenRead(path));
        var reader = provider.GetMetadataReader();
        var mapping = reader.GetEditAndContinueMapEntries().Select(MetadataTokens.GetToken).ToArray();
        var documents = reader.Documents.Select(handle => {
            var document = reader.GetDocument(handle);
            return new { id = MetadataTokens.GetRowNumber(handle), name = reader.GetString(document.Name) };
        }).ToArray();
        var methods = reader.MethodDebugInformation.Select(handle => {
            int localRow = MetadataTokens.GetRowNumber(handle);
            var method = reader.GetMethodDebugInformation(handle);
            int token = 0x06000000 | (mapping.Length == 0 ? localRow : mapping[localRow - 1] & 0xffffff);
            var points = method.GetSequencePoints().Select(point => new {
                offset = point.Offset, document = MetadataTokens.GetRowNumber(point.Document),
                startLine = point.StartLine, startColumn = point.StartColumn,
                endLine = point.EndLine, endColumn = point.EndColumn, hidden = point.IsHidden,
            }).ToArray();
            var scopes = reader.GetLocalScopes(MetadataTokens.MethodDefinitionHandle(localRow)).Select(scopeHandle => {
                var scope = reader.GetLocalScope(scopeHandle);
                return new { start = scope.StartOffset, end = scope.EndOffset,
                    names = scope.GetLocalVariables().Select(local => reader.GetString(reader.GetLocalVariable(local).Name)).ToArray() };
            }).ToArray();
            return new { token, localRow, localSignature = MetadataTokens.GetRowNumber(method.LocalSignature), points, scopes };
        }).ToArray();
        return new { id = Convert.ToHexString(reader.DebugMetadataHeader!.Id.AsSpan()).ToLowerInvariant(),
            mapping, documents, methods };
    }

    private static object Capture(string directory)
    {
        Directory.CreateDirectory(directory);
        var initial = Compile(0);
        using var assembly = new MemoryStream();
        using var symbols = new MemoryStream();
        Check(initial.Emit(assembly, symbols, options: new EmitOptions(debugInformationFormat: DebugInformationFormat.PortablePdb)));
        var assemblyBytes = assembly.ToArray();
        var pdbBytes = symbols.ToArray();
        File.WriteAllBytes(Path.Combine(directory, "baseline.dll"), assemblyBytes);
        File.WriteAllBytes(Path.Combine(directory, "baseline.pdb"), pdbBytes);
        File.WriteAllText(Path.Combine(directory, "baseline.cs"), Source(0), new UTF8Encoding(false));
        using var module = ModuleMetadata.CreateFromImage(assemblyBytes);
        using var pe = new PEReader(new MemoryStream(assemblyBytes));
        using var pdbProvider = MetadataReaderProvider.FromPortablePdbImage(ImmutableArray.Create(pdbBytes));
        var initialPdb = pdbProvider.GetMetadataReader();
        var baseline = EmitBaseline.CreateInitialBaseline(initial, module, _ => default,
            handle => initialPdb.GetMethodDebugInformation(handle).LocalSignature, hasPortableDebugInformation: true);
        var counts = RowCounts(pe.GetMetadataReader());
        var generations = new List<object> {
            new { generation = 0, typeSystemRowCounts = new Dictionary<int, int>(counts),
                symbols = Inspect(Path.Combine(directory, "baseline.pdb")) }
        };
        var previous = initial;
        for (int generation = 1; generation <= 2; generation++)
        {
            var current = Compile(generation);
            string methodName = generation == 1 ? "Updated" : "First";
            var oldMethod = previous.GetTypeByMetadataName("Fixture")!.GetMembers(methodName).Single();
            var newMethod = current.GetTypeByMetadataName("Fixture")!.GetMembers(methodName).Single();
            using var metadataDelta = new MemoryStream();
            using var ilDelta = new MemoryStream();
            using var pdbDelta = new MemoryStream();
            var result = current.EmitDifference(baseline,
                [new SemanticEdit(SemanticEditKind.Update, oldMethod, newMethod)],
                _ => false, metadataDelta, ilDelta, pdbDelta);
            Check(result);
            baseline = result.Baseline ?? throw new InvalidOperationException("Missing delta baseline");
            using var deltaProvider = MetadataReaderProvider.FromMetadataImage(ImmutableArray.Create(metadataDelta.ToArray()));
            foreach (var handle in deltaProvider.GetMetadataReader().GetEditAndContinueMapEntries())
            {
                int handleToken = MetadataTokens.GetToken(handle);
                int table = handleToken >>> 24;
                if (table >= 48 || table is 30 or 31) continue;
                counts[table] = Math.Max(counts.GetValueOrDefault(table), handleToken & 0xffffff);
            }
            string prefix = Path.Combine(directory, $"delta{generation}");
            File.WriteAllBytes(prefix + ".pdb", pdbDelta.ToArray());
            File.WriteAllBytes(prefix + ".dmeta", metadataDelta.ToArray());
            File.WriteAllBytes(prefix + ".dil", ilDelta.ToArray());
            File.WriteAllText(prefix + ".cs", Source(generation), new UTF8Encoding(false));
            generations.Add(new { generation, typeSystemRowCounts = new Dictionary<int, int>(counts), symbols = Inspect(prefix + ".pdb") });
            previous = current;
        }
        return new { schemaVersion = 1, runtime = Environment.Version.ToString(),
            compiler = typeof(CSharpCompilation).Assembly.GetName().Version!.ToString(),
            compilerSha256 = Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(typeof(CSharpCompilation).Assembly.Location))).ToLowerInvariant(),
            generations };
    }

    public static void Main(string[] args)
    {
        object result = args.Length == 2 && args[0] == "inspect" ? Inspect(args[1]) :
            args.Length == 2 && args[0] == "capture" ? Capture(args[1]) : throw new ArgumentException("capture <directory> | inspect <pdb>");
        Console.WriteLine(JsonSerializer.Serialize(result));
    }
}
