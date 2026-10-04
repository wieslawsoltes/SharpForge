// Roslyn semantic-model pinning tool (SF-A02-T38).
//
// Usage: query <input.json> <output.json>
//   input : [{"id":"feature/name","langVersion":"7.3"|null,"source":"..."}]
//   output: {"roslyn","informationalVersion","references","results":{id:{"expressions":[...],"declarations":[...]}}}
//
// For every program the tool asks Roslyn's SemanticModel what a language service asks:
//   expressions  : one row per expression or type syntax node -
//                  [start, length, syntaxKind, symbolKind, methodKind, symbolName, symbolDisplay, type, convertedType, constant]
//   declarations : one row per declaration node - [start, length, syntaxKind, symbolKind, symbolName, symbolDisplay]
// Symbols and types are shown with Roslyn's default display (the one diagnostics use) without nullable reference
// annotations; a constant is [value] with
// numbers as invariant text, or null when the expression has none.
using System;
using System.Collections.Generic;
using System.Globalization;
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
    private static int Main(string[] args)
    {
        if (args.Length != 2) { Console.Error.WriteLine("usage: query <input.json> <output.json>"); return 2; }
        CultureInfo.DefaultThreadCurrentCulture = CultureInfo.InvariantCulture;
        CultureInfo.CurrentCulture = CultureInfo.InvariantCulture;
        var references = LocateReferences(out var referenceSource);
        var roslyn = typeof(CSharpCompilation).Assembly;
        var results = new SortedDictionary<string, object>(StringComparer.Ordinal);
        using var input = JsonDocument.Parse(File.ReadAllText(args[0]));
        foreach (var fixture in input.RootElement.EnumerateArray())
        {
            var id = fixture.GetProperty("id").GetString();
            var source = fixture.GetProperty("source").GetString();
            var requested = fixture.TryGetProperty("langVersion", out var lv) && lv.ValueKind == JsonValueKind.String ? lv.GetString() : null;
            results[id] = Query(id, source, requested, references);
        }
        var document = new SortedDictionary<string, object>(StringComparer.Ordinal)
        {
            ["roslyn"] = roslyn.GetName().Version.ToString(),
            ["informationalVersion"] = roslyn.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion,
            ["references"] = referenceSource,
            ["results"] = results,
        };
        File.WriteAllText(args[1], JsonSerializer.Serialize(document, new JsonSerializerOptions { Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping }));
        return 0;
    }

    /// Prefer the reference pack matching the running runtime; fall back to the runtime's own assemblies.
    private static List<MetadataReference> LocateReferences(out string description)
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
                description = "Microsoft.NETCore.App.Ref/" + Path.GetFileName(version) + "/ref/" + moniker;
                return Directory.GetFiles(directory, "*.dll").OrderBy(f => f, StringComparer.Ordinal).Select(f => (MetadataReference)MetadataReference.CreateFromFile(f)).ToList();
            }
        }
        description = "Microsoft.NETCore.App/" + Environment.Version + " (implementation assemblies)";
        var trusted = ((string)AppContext.GetData("TRUSTED_PLATFORM_ASSEMBLIES") ?? "").Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries);
        return trusted.Where(f => f.StartsWith(runtimeDirectory, StringComparison.Ordinal)).Select(f => (MetadataReference)MetadataReference.CreateFromFile(f)).ToList();
    }

    private static object Query(string id, string source, string requested, List<MetadataReference> references)
    {
        var version = LanguageVersion.Default;
        if (requested != null && !LanguageVersionFacts.TryParse(requested, out version)) throw new InvalidOperationException(id + ": unknown language version " + requested);
        var tree = CSharpSyntaxTree.ParseText(source, new CSharpParseOptions(version), path: "Program.cs", encoding: Encoding.UTF8);
        var options = new CSharpCompilationOptions(OutputKind.ConsoleApplication, concurrentBuild: false, allowUnsafe: true);
        var compilation = CSharpCompilation.Create("query", new[] { tree }, references, options);
        var model = compilation.GetSemanticModel(tree);
        var expressions = new List<object[]>();
        var declarations = new List<object[]>();
        foreach (var node in tree.GetRoot().DescendantNodes())
        {
            if (node is ExpressionSyntax expression) expressions.Add(ExpressionRow(model, expression));
            var declared = DeclaredSymbol(model, node);
            if (declared != null)
                declarations.Add(new object[] { node.SpanStart, node.Span.Length, node.Kind().ToString(), declared.Kind.ToString(), declared.Name, declared.ToDisplayString(Format) });
        }
        var errors = compilation.GetDiagnostics().Where(d => d.Severity == DiagnosticSeverity.Error).Select(d => d.Id + "@" + d.Location.SourceSpan.Start).ToList();
        return new SortedDictionary<string, object>(StringComparer.Ordinal) { ["expressions"] = expressions, ["declarations"] = declarations, ["errors"] = errors };
    }

    /// Roslyn's default display without the `?` of nullable reference types: the framework registry carries no annotations.
    private static readonly SymbolDisplayFormat Format =
        SymbolDisplayFormat.CSharpErrorMessageFormat.RemoveMiscellaneousOptions(SymbolDisplayMiscellaneousOptions.IncludeNullableReferenceTypeModifier);

    private static object[] ExpressionRow(SemanticModel model, ExpressionSyntax node)
    {
        var symbol = model.GetSymbolInfo(node).Symbol;
        var type = model.GetTypeInfo(node);
        var constant = model.GetConstantValue(node);
        return new object[]
        {
            node.SpanStart, node.Span.Length, node.Kind().ToString(),
            symbol?.Kind.ToString(), (symbol as IMethodSymbol)?.MethodKind.ToString(), symbol?.Name, symbol?.ToDisplayString(Format),
            type.Type?.ToDisplayString(Format), type.ConvertedType?.ToDisplayString(Format),
            constant.HasValue ? new object[] { ConstantText(constant.Value) } : null,
        };
    }

    private static object ConstantText(object value)
    {
        if (value == null) return null;
        if (value is bool || value is string) return value;
        if (value is char c) return c.ToString();
        return Convert.ToString(value, CultureInfo.InvariantCulture);
    }

    private static ISymbol DeclaredSymbol(SemanticModel model, SyntaxNode node)
    {
        switch (node)
        {
            case BaseTypeDeclarationSyntax or DelegateDeclarationSyntax or BaseMethodDeclarationSyntax or BasePropertyDeclarationSyntax:
            case VariableDeclaratorSyntax or ParameterSyntax or TypeParameterSyntax or EnumMemberDeclarationSyntax:
            case AccessorDeclarationSyntax or LocalFunctionStatementSyntax or SingleVariableDesignationSyntax or ForEachStatementSyntax:
            case BaseNamespaceDeclarationSyntax or CatchDeclarationSyntax:
                return model.GetDeclaredSymbol(node);
            default:
                return null;
        }
    }
}
