// Roslyn conversion classification oracle for the SharpForge conversion corpus (SF-A02-T06.1).
//
// Usage: classify <input.json> <output.json>
//   input : [{"langVersion":"13"|null,"source":"...","typePairs":[[fromIndex,toIndex],...],"expressionTargets":[typeIndex,...]}]
//   output: {"roslyn","informationalVersion","compilations":[{"langVersion","types":[display,...],"typePairs":[row,...],"expressions":[row,...]}]}
//
// Every compilation is the corpus source (test/conversions/corpus.js): the parameters of ConversionTypes<...>.Types
// are the corpus types by index, the field initializers of ConversionExpressions are the corpus expressions in order.
// A type pair is classified with Compilation.ClassifyConversion(source, destination); an expression with the
// speculative SemanticModel.ClassifyConversion(position, expression, destination). A row is [kind, exists, isImplicit, isExplicit], where
// kind is Roslyn's ConversionKind name (Conversion.ToString()).
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;

internal static class Program
{
    private const string TypesClass = "ConversionTypes";
    private const string ExpressionsClass = "ConversionExpressions";

    private static int Main(string[] args)
    {
        if (args.Length != 2) { Console.Error.WriteLine("usage: classify <input.json> <output.json>"); return 2; }
        var references = LocateReferences();
        var roslyn = typeof(CSharpCompilation).Assembly;
        var compilations = new List<object>();
        using var input = JsonDocument.Parse(File.ReadAllText(args[0]));
        foreach (var item in input.RootElement.EnumerateArray()) compilations.Add(Classify(item, references));
        var document = new SortedDictionary<string, object>(StringComparer.Ordinal)
        {
            ["roslyn"] = roslyn.GetName().Version.ToString(),
            ["informationalVersion"] = roslyn.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion,
            ["compilations"] = compilations,
        };
        File.WriteAllText(args[1], JsonSerializer.Serialize(document, new JsonSerializerOptions { Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping }));
        return 0;
    }

    /// The reference pack matching the running runtime, or the runtime's own assemblies.
    private static List<MetadataReference> LocateReferences()
    {
        var runtimeDirectory = Path.GetDirectoryName(typeof(object).Assembly.Location);
        var root = Path.GetFullPath(Path.Combine(runtimeDirectory, "..", "..", ".."));
        var packs = Path.Combine(root, "packs", "Microsoft.NETCore.App.Ref");
        var moniker = "net" + Environment.Version.Major + "." + Environment.Version.Minor;
        if (Directory.Exists(packs))
        {
            foreach (var version in Directory.GetDirectories(packs).OrderByDescending(d => d, StringComparer.Ordinal))
            {
                var directory = Path.Combine(version, "ref", moniker);
                if (!Directory.Exists(directory)) continue;
                return Directory.GetFiles(directory, "*.dll").OrderBy(f => f, StringComparer.Ordinal)
                    .Select(f => (MetadataReference)MetadataReference.CreateFromFile(f)).ToList();
            }
        }
        var trusted = ((string)AppContext.GetData("TRUSTED_PLATFORM_ASSEMBLIES") ?? "").Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries);
        return trusted.Where(f => f.StartsWith(runtimeDirectory, StringComparison.Ordinal))
            .Select(f => (MetadataReference)MetadataReference.CreateFromFile(f)).ToList();
    }

    private static object Classify(JsonElement item, List<MetadataReference> references)
    {
        var requested = item.GetProperty("langVersion").ValueKind == JsonValueKind.String ? item.GetProperty("langVersion").GetString() : null;
        var version = LanguageVersion.Default;
        if (requested != null && !LanguageVersionFacts.TryParse(requested, out version)) throw new InvalidOperationException("unknown language version " + requested);
        var parseOptions = new CSharpParseOptions(version);
        var tree = CSharpSyntaxTree.ParseText(item.GetProperty("source").GetString(), parseOptions, path: "Corpus.cs", encoding: Encoding.UTF8);
        var options = new CSharpCompilationOptions(OutputKind.DynamicallyLinkedLibrary, deterministic: true, concurrentBuild: false);
        var compilation = CSharpCompilation.Create("ConversionCorpus", new[] { tree }, references, options);
        var syntaxErrors = tree.GetDiagnostics().Where(d => d.Severity == DiagnosticSeverity.Error).ToList();
        if (syntaxErrors.Count > 0) throw new InvalidOperationException("the corpus source does not parse: " + syntaxErrors[0]);

        var types = TypesOf(compilation);
        var model = compilation.GetSemanticModel(tree);
        var typePairs = new List<object>();
        foreach (var pair in item.GetProperty("typePairs").EnumerateArray())
        {
            var conversion = compilation.ClassifyConversion(types[pair[0].GetInt32()], types[pair[1].GetInt32()]);
            typePairs.Add(Row(conversion));
        }
        var expressions = ExpressionsOf(tree);
        var targets = item.GetProperty("expressionTargets").EnumerateArray().Select(t => t.GetInt32()).ToList();
        if (expressions.Count != targets.Count) throw new InvalidOperationException($"{expressions.Count} expressions but {targets.Count} targets");
        var expressionRows = new List<object>();
        for (var i = 0; i < expressions.Count; i++)
        {
            // The initializer is bound again on its own (speculatively, at its own position): the field's declared type
            // must not target-type `default`, `new()`, tuple literals or lambdas before the corpus target is applied.
            var standalone = SyntaxFactory.ParseExpression(expressions[i].ToString(), options: parseOptions);
            expressionRows.Add(Row(model.ClassifyConversion(expressions[i].SpanStart, standalone, types[targets[i]])));
        }

        return new SortedDictionary<string, object>(StringComparer.Ordinal)
        {
            ["langVersion"] = parseOptions.LanguageVersion.ToDisplayString(),
            ["types"] = types.Select(t => t.ToDisplayString()).ToList(),
            ["typePairs"] = typePairs,
            ["expressions"] = expressionRows,
        };
    }

    private static object[] Row(Conversion conversion) =>
        new object[] { conversion.ToString(), conversion.Exists, conversion.IsImplicit, conversion.IsExplicit };

    /// The corpus types: the parameter types of ConversionTypes<...>.Types, none of which may be an error type.
    private static List<ITypeSymbol> TypesOf(CSharpCompilation compilation)
    {
        var carrier = compilation.GlobalNamespace.GetTypeMembers(TypesClass).Single();
        var method = carrier.GetMembers("Types").OfType<IMethodSymbol>().Single();
        var types = method.Parameters.Select(p => p.Type).ToList();
        var broken = method.Parameters.Where(p => p.Type.TypeKind == TypeKind.Error).Select(p => p.ToDisplayString()).ToList();
        if (broken.Count > 0) throw new InvalidOperationException("corpus types Roslyn cannot bind: " + string.Join(", ", broken));
        return types;
    }

    /// The corpus expressions: the field initializers of ConversionExpressions, in declaration order.
    private static List<ExpressionSyntax> ExpressionsOf(SyntaxTree tree)
    {
        var carrier = tree.GetRoot().DescendantNodes().OfType<ClassDeclarationSyntax>().Single(c => c.Identifier.ValueText == ExpressionsClass);
        return carrier.Members.OfType<FieldDeclarationSyntax>().Select(f => f.Declaration.Variables[0].Initializer.Value).ToList();
    }
}
