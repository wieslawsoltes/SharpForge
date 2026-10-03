// Roslyn oracle for the SharpForge differential corpora (SF-A02-T32 constants, SF-A02-T37 suppression).
// Usage: oracle constants <input.json> <output.json> | oracle suppression <input.json> <output.json>
// Driven by ../generate.js and ../../suppression/generate.js; never needed by the test suite itself.
using System;
using System.Collections.Generic;
using System.Collections.Immutable;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;
using Microsoft.CodeAnalysis.Diagnostics;

static class Program
{
    static readonly MetadataReference[] References = { MetadataReference.CreateFromFile(typeof(object).Assembly.Location) };
    static readonly CultureInfo Inv = CultureInfo.InvariantCulture;

    static int Main(string[] args)
    {
        var input = JsonNode.Parse(File.ReadAllText(args[1]));
        var result = args[0] == "constants" ? Constants(input) : Suppression(input);
        result["roslyn"] = typeof(CSharpCompilation).Assembly.GetName().Version.ToString();
        File.WriteAllText(args[2], result.ToJsonString(new JsonSerializerOptions { Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping }));
        return 0;
    }

    // ---------------------------------------------------------------- constants
    static JsonObject Constants(JsonNode input)
    {
        string prelude = (string)input["prelude"];
        var rows = new JsonArray();
        JsonObject enums = null;
        foreach (var c in input["cases"].AsArray())
        {
            string expression = (string)c["expression"]; bool isChecked = (bool)c["checked"];
            // Constant expressions are always folded in a checked context unless written inside unchecked(...).
            string wrapped = isChecked ? "(" + expression + ")" : "unchecked(" + expression + ")";
            string src = prelude + "\nclass __C { void __M() { object __v = " + wrapped + ";\n} }";
            var tree = CSharpSyntaxTree.ParseText(src, new CSharpParseOptions(LanguageVersion.Preview));
            var comp = CSharpCompilation.Create("c", new[] { tree }, References, new CSharpCompilationOptions(OutputKind.DynamicallyLinkedLibrary));
            var model = comp.GetSemanticModel(tree);
            if (enums == null) enums = Enums(comp);
            var row = new JsonObject { ["expression"] = expression, ["checked"] = isChecked };
            var errors = comp.GetDiagnostics().Where(d => d.Severity == DiagnosticSeverity.Error).OrderBy(d => d.Location.SourceSpan.Start).ToList();
            if (errors.Count > 0)
            {
                row["diagnostics"] = new JsonArray(errors.Select(d => (JsonNode)d.Id).ToArray());
                row["messages"] = new JsonArray(errors.Select(d => (JsonNode)d.GetMessage(Inv)).ToArray());
                rows.Add(row); continue;
            }
            var outer = tree.GetRoot().DescendantNodes().OfType<VariableDeclaratorSyntax>().Last().Initializer.Value;
            ExpressionSyntax e = outer is ParenthesizedExpressionSyntax p ? p.Expression : ((CheckedExpressionSyntax)outer).Expression;
            var type = model.GetTypeInfo(e).Type;
            row["type"] = type == null ? "null" : type.ToDisplayString();
            var cv = model.GetConstantValue(e);
            if (!cv.HasValue) row["constant"] = false;
            else Value(row, cv.Value);
            rows.Add(row);
        }
        return new JsonObject { ["prelude"] = prelude, ["enums"] = enums ?? new JsonObject(), ["rows"] = rows };
    }

    static JsonObject Enums(CSharpCompilation comp)
    {
        var result = new JsonObject();
        foreach (var t in comp.Assembly.GlobalNamespace.GetTypeMembers().Where(t => t.TypeKind == TypeKind.Enum))
        {
            var members = new JsonObject();
            foreach (var f in t.GetMembers().OfType<IFieldSymbol>().Where(f => f.HasConstantValue)) members[f.Name] = Convert.ToString(f.ConstantValue, Inv);
            result[t.Name] = new JsonObject { ["underlying"] = t.EnumUnderlyingType.ToDisplayString(), ["members"] = members };
        }
        return result;
    }

    static void Value(JsonObject row, object v)
    {
        switch (v)
        {
            case null: row["value"] = null; break;
            case bool b: row["value"] = b; break;
            case string s: row["value"] = s; break;
            case char ch: row["value"] = ((int)ch).ToString(Inv); break;
            case float f: row["value"] = f.ToString("R", Inv); row["bits"] = BitConverter.SingleToInt32Bits(f).ToString("x8"); break;
            case double d: row["value"] = d.ToString("R", Inv); row["bits"] = BitConverter.DoubleToInt64Bits(d).ToString("x16"); break;
            case decimal m: row["value"] = m.ToString(Inv); row["bits"] = new JsonArray(decimal.GetBits(m).Select(x => (JsonNode)x).ToArray()); break;
            default: row["value"] = Convert.ToString(v, Inv); break;
        }
    }

    // ---------------------------------------------------------------- suppression
    static JsonObject Suppression(JsonNode input)
    {
        var fixtures = new JsonArray();
        foreach (var f in input["fixtures"].AsArray())
        {
            var o = f["options"] ?? new JsonObject();
            var symbols = (f["defines"]?.AsArray().Select(x => (string)x) ?? Array.Empty<string>()).ToArray();
            var parse = new CSharpParseOptions(LanguageVersion.Preview, preprocessorSymbols: symbols);
            var sources = f["sources"].AsArray().Select(s => ((string)s["uri"], (string)s["text"])).ToList();

            // Raw list: what the compiler reports before any filtering. #pragma lines are blanked (same length), every warning level is on.
            var rawTrees = sources.Select(s => CSharpSyntaxTree.ParseText(Regex.Replace(s.Item2, @"^[ \t]*#pragma[^\r\n]*", m => new string(' ', m.Length), RegexOptions.Multiline), parse, s.Item1)).ToArray();
            var rawComp = CSharpCompilation.Create("f", rawTrees, References, new CSharpCompilationOptions(OutputKind.DynamicallyLinkedLibrary, warningLevel: 9999));
            bool analyzers = f["analyzers"] != null && (bool)f["analyzers"];
            var raw = All(rawComp, analyzers, true).Where(d => d.Severity != DiagnosticSeverity.Hidden);

            var specific = new Dictionary<string, ReportDiagnostic>();
            foreach (var id in Ids(o["warnAsError"])) specific[id] = ReportDiagnostic.Error;
            foreach (var id in Ids(o["warnNotAsError"])) specific[id] = ReportDiagnostic.Default;
            foreach (var id in Ids(o["noWarn"])) specific[id] = ReportDiagnostic.Suppress;
            bool all = o["treatWarningsAsErrors"] != null && (bool)o["treatWarningsAsErrors"];
            int level = o["warningLevel"] != null ? (int)o["warningLevel"] : 4;
            var options = new CSharpCompilationOptions(OutputKind.DynamicallyLinkedLibrary, warningLevel: level,
                generalDiagnosticOption: all ? ReportDiagnostic.Error : ReportDiagnostic.Default, specificDiagnosticOptions: specific);
            var trees = sources.Select(s => CSharpSyntaxTree.ParseText(s.Item2, parse, s.Item1)).ToArray();
            var comp = CSharpCompilation.Create("f", trees, References, options);
            // SuppressMessage is applied by the analyzer driver (as csc does), never by Compilation.GetDiagnostics.
            IEnumerable<Diagnostic> final = All(comp, analyzers, false).Where(d => d.Severity != DiagnosticSeverity.Hidden);
            var suppressions = Suppressions(comp);

            var row = new JsonObject { ["name"] = (string)f["name"], ["sources"] = f["sources"].DeepClone(), ["options"] = o.DeepClone() };
            if (symbols.Length > 0) row["defines"] = f["defines"].DeepClone();
            if (analyzers) row["analyzers"] = true;
            row["raw"] = List(raw, true);
            if (suppressions.Count > 0) row["suppressions"] = suppressions;
            row["expected"] = List(final, false);
            fixtures.Add(row);
        }
        return new JsonObject { ["fixtures"] = fixtures };
    }

    // Compiler diagnostics, plus the probe analyzer's when asked (suppressed ones included for the raw list).
    static IEnumerable<Diagnostic> All(CSharpCompilation comp, bool analyzers, bool includeSuppressed)
    {
        if (!analyzers) return comp.GetDiagnostics();
        var options = new CompilationWithAnalyzersOptions(new AnalyzerOptions(ImmutableArray<AdditionalText>.Empty), null, false, false, includeSuppressed);
        return comp.WithAnalyzers(ImmutableArray.Create<DiagnosticAnalyzer>(new ProbeAnalyzer()), options).GetAllDiagnosticsAsync().Result;
    }

    static IEnumerable<string> Ids(JsonNode n) => n == null ? Array.Empty<string>() : n.AsArray().Select(x => Normalize((string)x));
    // As csc's command-line parser: a number, optionally prefixed CS in any case, names a compiler warning
    // (168, cs0168 -> CS0168); anything else is taken verbatim as a custom diagnostic id.
    static string Normalize(string id) =>
        ushort.TryParse(id, NumberStyles.Integer, Inv, out var n) ? "CS" + n.ToString("D4")
        : id.StartsWith("CS", StringComparison.OrdinalIgnoreCase) && ushort.TryParse(id.Substring(2), NumberStyles.Integer, Inv, out n) ? "CS" + n.ToString("D4")
        : id;

    static JsonArray List(IEnumerable<Diagnostic> diagnostics, bool raw)
    {
        var a = new JsonArray();
        foreach (var d in diagnostics.OrderBy(d => d.Location.SourceTree?.FilePath, StringComparer.Ordinal).ThenBy(d => d.Location.SourceSpan.Start).ThenBy(d => d.Id, StringComparer.Ordinal))
        {
            var r = new JsonObject { ["uri"] = d.Location.SourceTree?.FilePath, ["start"] = d.Location.SourceSpan.Start, ["length"] = d.Location.SourceSpan.Length, ["code"] = d.Id, ["severity"] = Severity(d.Severity) };
            if (raw) { r["warningLevel"] = d.WarningLevel; r["message"] = d.GetMessage(Inv); }
            a.Add(r);
        }
        return a;
    }
    static string Severity(DiagnosticSeverity s) => s == DiagnosticSeverity.Error ? "error" : s == DiagnosticSeverity.Warning ? "warning" : s == DiagnosticSeverity.Info ? "information" : "hint";

    static JsonArray Suppressions(CSharpCompilation comp)
    {
        var result = new JsonArray();
        foreach (var tree in comp.SyntaxTrees)
        {
            var model = comp.GetSemanticModel(tree);
            foreach (var attribute in tree.GetRoot().DescendantNodes().OfType<AttributeSyntax>())
            {
                if (model.GetSymbolInfo(attribute).Symbol?.ContainingType?.ToDisplayString() != "System.Diagnostics.CodeAnalysis.SuppressMessageAttribute") continue;
                var list = (AttributeListSyntax)attribute.Parent;
                var arguments = attribute.ArgumentList.Arguments;
                string checkId = (string)model.GetConstantValue(arguments[1].Expression).Value;
                var row = new JsonObject { ["id"] = checkId.Split(':')[0].Trim() };
                string scope = null, target = null;
                foreach (var a in arguments.Where(a => a.NameEquals != null))
                {
                    var value = model.GetConstantValue(a.Expression).Value as string;
                    if (a.NameEquals.Name.Identifier.ValueText == "Scope") scope = value;
                    if (a.NameEquals.Name.Identifier.ValueText == "Target") target = value;
                }
                if (list.Target != null && (list.Target.Identifier.ValueText == "assembly" || list.Target.Identifier.ValueText == "module"))
                {
                    if (scope != null) row["scope"] = scope;
                    if (target != null)
                    {
                        row["target"] = target;
                        // The lead's binder resolves Target to declaration spans; the oracle records what Roslyn resolves it to.
                        var spans = new JsonArray();
                        foreach (var symbol in DocumentationCommentId.GetSymbolsForDeclarationId(target.TrimStart('~'), comp))
                            foreach (var reference in symbol.DeclaringSyntaxReferences)
                                spans.Add(new JsonObject { ["uri"] = reference.SyntaxTree.FilePath, ["start"] = reference.Span.Start, ["end"] = reference.Span.End });
                        row["spans"] = spans;
                        // Scope "namespace" covers the namespace itself but not the declarations nested in it.
                        if (string.Equals(scope, "namespace", StringComparison.OrdinalIgnoreCase))
                        {
                            var nested = new JsonArray();
                            foreach (var symbol in DocumentationCommentId.GetSymbolsForDeclarationId(target.TrimStart('~'), comp).OfType<INamespaceSymbol>())
                                foreach (var member in symbol.GetMembers())
                                    foreach (var reference in member.DeclaringSyntaxReferences)
                                        nested.Add(new JsonObject { ["uri"] = reference.SyntaxTree.FilePath, ["start"] = reference.Span.Start, ["end"] = reference.Span.End });
                            row["excludeSpans"] = nested;
                        }
                    }
                }
                else
                {
                    row["uri"] = tree.FilePath;
                    row["span"] = new JsonObject { ["start"] = list.Parent.Span.Start, ["end"] = list.Parent.Span.End };
                }
                result.Add(row);
            }
        }
        return result;
    }
}

// A stand-in for non-compiler diagnostics: Roslyn applies SuppressMessage to analyzer diagnostics only.
[DiagnosticAnalyzer(LanguageNames.CSharp)]
sealed class ProbeAnalyzer : DiagnosticAnalyzer
{
    static readonly DiagnosticDescriptor Local = new DiagnosticDescriptor("SFA001", "Local", "Local '{0}'", "Probe", DiagnosticSeverity.Warning, true);
    static readonly DiagnosticDescriptor Method = new DiagnosticDescriptor("SFA002", "Method", "Method '{0}'", "Probe", DiagnosticSeverity.Info, true);
    static readonly DiagnosticDescriptor Type = new DiagnosticDescriptor("SFA003", "Type", "Type '{0}'", "Probe", DiagnosticSeverity.Warning, true);
    static readonly DiagnosticDescriptor Namespace = new DiagnosticDescriptor("SFA004", "Namespace", "Namespace '{0}'", "Probe", DiagnosticSeverity.Info, true);
    public override ImmutableArray<DiagnosticDescriptor> SupportedDiagnostics => ImmutableArray.Create(Local, Method, Type, Namespace);
    public override void Initialize(AnalysisContext context)
    {
        context.ConfigureGeneratedCodeAnalysis(GeneratedCodeAnalysisFlags.None);
        context.RegisterSyntaxNodeAction(c => { var d = (VariableDeclaratorSyntax)c.Node; if (d.Parent?.Parent is LocalDeclarationStatementSyntax) c.ReportDiagnostic(Diagnostic.Create(Local, d.Identifier.GetLocation(), d.Identifier.ValueText)); }, SyntaxKind.VariableDeclarator);
        context.RegisterSyntaxNodeAction(c => { var d = (MethodDeclarationSyntax)c.Node; c.ReportDiagnostic(Diagnostic.Create(Method, d.Identifier.GetLocation(), d.Identifier.ValueText)); }, SyntaxKind.MethodDeclaration);
        context.RegisterSyntaxNodeAction(c => { var d = (NamespaceDeclarationSyntax)c.Node; c.ReportDiagnostic(Diagnostic.Create(Namespace, d.Name.GetLocation(), d.Name.ToString())); }, SyntaxKind.NamespaceDeclaration);
        context.RegisterSyntaxNodeAction(c => { var d = (ClassDeclarationSyntax)c.Node; c.ReportDiagnostic(Diagnostic.Create(Type, d.Identifier.GetLocation(), d.Identifier.ValueText)); }, SyntaxKind.ClassDeclaration);
    }
}
