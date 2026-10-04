using System.Collections.Immutable;
using System.Reflection.Metadata;
using System.Reflection.Metadata.Ecma335;
using System.Reflection.PortableExecutable;
using System.Security.Cryptography;
using System.Text;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.Emit;
using Microsoft.CodeAnalysis.Text;

internal static class FixtureWriter
{
    private static string Source(int generation)
    {
        string oldValue = generation == 0 ? "baseline" : "first update λ";
        string additions = generation == 0 ? "" : $$"""
                public static int AddedField;
                public static string Added() => "{{(generation == 1 ? "first insert" : "second update 😀")}}";
            """;
        string secondAddition = generation < 2 ? "" : "public static string AddedAgain() => \"second insert\";";
        return $$"""
            public static class MixedFixture
            {
                public static string Old() => "{{oldValue}}";
                public static int Stable(int value) => value;
                {{additions}}
                {{secondAddition}}
            }
            """;
    }

    private static CSharpCompilation Compile(int generation) => CSharpCompilation.Create(
        "MetadataMixedFixture",
        [CSharpSyntaxTree.ParseText(SourceText.From(Source(generation), Encoding.UTF8), path: "/src/MetadataGenerations/Fixture.cs")],
        [MetadataReference.CreateFromFile(typeof(object).Assembly.Location)],
        new CSharpCompilationOptions(OutputKind.DynamicallyLinkedLibrary, optimizationLevel: OptimizationLevel.Debug,
            deterministic: true, concurrentBuild: false));

    private static void Check(EmitResult result)
    {
        if (!result.Success) throw new InvalidOperationException(string.Join(Environment.NewLine, result.Diagnostics));
    }

    private static ISymbol Member(CSharpCompilation compilation, string name) =>
        compilation.GetTypeByMetadataName("MixedFixture")!.GetMembers(name).Single();

    private static ImmutableArray<SemanticEdit> Edits(CSharpCompilation previous, CSharpCompilation current, int generation)
    {
        string update = generation == 1 ? "Old" : "Added";
        string insert = generation == 1 ? "Added" : "AddedAgain";
        var result = ImmutableArray.CreateBuilder<SemanticEdit>();
        result.Add(new SemanticEdit(SemanticEditKind.Update, Member(previous, update), Member(current, update)));
        result.Add(new SemanticEdit(SemanticEditKind.Insert, null, Member(current, insert)));
        if (generation == 1) result.Add(new SemanticEdit(SemanticEditKind.Insert, null, Member(current, "AddedField")));
        return result.ToImmutable();
    }

    public static object Create(string directory)
    {
        if (Directory.Exists(directory) && Directory.EnumerateFileSystemEntries(directory).Any())
            throw new ArgumentException("Fixture output must be a new or empty directory");
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
        using var pdb = MetadataReaderProvider.FromPortablePdbImage(ImmutableArray.CreateRange(pdbBytes));
        var pdbReader = pdb.GetMetadataReader();
        var baseline = EmitBaseline.CreateInitialBaseline(initial, module, _ => default,
            handle => pdbReader.GetMethodDebugInformation(handle).LocalSignature, hasPortableDebugInformation: true);
        var previous = initial;
        for (int generation = 1; generation <= 2; generation++)
        {
            var current = Compile(generation);
            using var metadataDelta = new MemoryStream();
            using var ilDelta = new MemoryStream();
            using var pdbDelta = new MemoryStream();
            var result = current.EmitDifference(baseline, Edits(previous, current, generation),
                _ => false, metadataDelta, ilDelta, pdbDelta);
            Check(result);
            baseline = result.Baseline ?? throw new InvalidOperationException("Missing Roslyn delta baseline");
            string prefix = Path.Combine(directory, $"delta{generation}");
            File.WriteAllBytes(prefix + ".dmeta", metadataDelta.ToArray());
            File.WriteAllBytes(prefix + ".dil", ilDelta.ToArray());
            File.WriteAllBytes(prefix + ".pdb", pdbDelta.ToArray());
            File.WriteAllText(prefix + ".cs", Source(generation), new UTF8Encoding(false));
            previous = current;
        }
        var artifacts = Directory.EnumerateFiles(directory).Order().ToDictionary(file => Path.GetFileName(file)!,
            file => Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(file))).ToLowerInvariant());
        return new { runtime = Environment.Version.ToString(), compiler = typeof(CSharpCompilation).Assembly.GetName().Version!.ToString(),
            compilerSha256 = Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(typeof(CSharpCompilation).Assembly.Location))).ToLowerInvariant(),
            referenceAssembly = new { name = Path.GetFileName(typeof(object).Assembly.Location),
                sha256 = Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(typeof(object).Assembly.Location))).ToLowerInvariant() },
            artifacts, operations = new[] { "update Old + insert Added + insert field", "update Added + insert AddedAgain" } };
    }
}
