// Dumps Roslyn syntax trees as deterministic JSON reference data.
// Usage: dotnet run --project packages/syntax/tools/roslyn-tree-export -- <input-root> <output-root>
// Every *.cs file under <input-root> produces <output-root>/<relative path>.json. A first-line comment of the form
//   // roslyn: langversion=11 define=DEBUG;TRACE kind=script
// selects parse options. Node entries are [kind, spanStart, spanEnd, children]; token entries are
// [kind, spanStart, spanEnd, text, valueType, value, leadingTrivia, trailingTrivia, isMissing] with trivia as [kind, fullStart, fullEnd].
using System.Globalization;
using System.Reflection;
using System.Text;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.Text;

if (args.Length == 2 && args[0] == "--features")
{
    // Dumps Roslyn's MessageID feature table (id and required language version) so the SharpForge catalog can be checked against it.
    var assembly = typeof(CSharpSyntaxTree).Assembly;
    var messageId = assembly.GetType("Microsoft.CodeAnalysis.CSharp.MessageID")!;
    var requiredVersion = assembly.GetType("Microsoft.CodeAnalysis.CSharp.MessageIDExtensions")!.GetMethod("RequiredVersion", BindingFlags.Static | BindingFlags.NonPublic | BindingFlags.Public)!;
    var rows = new List<string>();
    foreach (var value in Enum.GetValues(messageId))
    {
        var name = value!.ToString()!;
        if (!name.StartsWith("IDS_Feature", StringComparison.Ordinal)) continue;
        string version;
        try { version = ((LanguageVersion)requiredVersion.Invoke(null, new[] { value })!).ToDisplayString(); } catch (TargetInvocationException) { version = "unknown"; }
        rows.Add("[" + Quote(name) + "," + Quote(version) + "]");
    }
    File.WriteAllText(args[1], "{\"roslyn\":" + Quote(typeof(CSharpSyntaxTree).Assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion ?? "unknown") + ",\"features\":[\n" + string.Join(",\n", rows) + "\n]}\n", new UTF8Encoding(false));
    Console.WriteLine($"Exported {rows.Count} feature ids");
    return 0;
}
if (args.Length < 2) { Console.Error.WriteLine("usage: roslyn-tree-export <input-root> <output-root> | --features <output.json>"); return 2; }
var inputRoot = Path.GetFullPath(args[0]);
var outputRoot = Path.GetFullPath(args[1]);
var roslyn = typeof(CSharpSyntaxTree).Assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion ?? "unknown";
var files = Directory.EnumerateFiles(inputRoot, "*.cs", SearchOption.AllDirectories).OrderBy(p => p, StringComparer.Ordinal).ToList();
foreach (var file in files)
{
    var text = File.ReadAllText(file);
    var options = new CSharpParseOptions(LanguageVersion.Preview, DocumentationMode.Parse, SourceCodeKind.Regular);
    var first = text.Split('\n')[0];
    if (first.StartsWith("// roslyn:", StringComparison.Ordinal))
    {
        foreach (var setting in first["// roslyn:".Length..].Trim().Split(' ', StringSplitOptions.RemoveEmptyEntries))
        {
            var pair = setting.Split('=', 2);
            if (pair[0] == "langversion" && LanguageVersionFacts.TryParse(pair[1], out var version)) options = options.WithLanguageVersion(version);
            else if (pair[0] == "define") options = options.WithPreprocessorSymbols(pair[1].Split(';'));
            else if (pair[0] == "kind" && pair[1] == "script") options = options.WithKind(SourceCodeKind.Script);
        }
    }
    var tree = CSharpSyntaxTree.ParseText(SourceText.From(text), options);
    var json = new StringBuilder();
    json.Append("{\"roslyn\":").Append(Quote(roslyn)).Append(",\"length\":").Append(text.Length).Append(",\"tree\":");
    WriteNode(json, tree.GetRoot());
    json.Append(",\"diagnostics\":[");
    var firstDiagnostic = true;
    foreach (var diagnostic in tree.GetDiagnostics().OrderBy(d => d.Location.SourceSpan.Start).ThenBy(d => d.Id, StringComparer.Ordinal))
    {
        if (!firstDiagnostic) json.Append(',');
        firstDiagnostic = false;
        json.Append('[').Append(Quote(diagnostic.Id)).Append(',').Append(diagnostic.Location.SourceSpan.Start).Append(',').Append(diagnostic.Location.SourceSpan.End).Append(',').Append(Quote(diagnostic.Severity.ToString().ToLowerInvariant())).Append(']');
    }
    json.Append("]}\n");
    var output = Path.Combine(outputRoot, Path.GetRelativePath(inputRoot, file) + ".json");
    Directory.CreateDirectory(Path.GetDirectoryName(output)!);
    File.WriteAllText(output, json.ToString(), new UTF8Encoding(false));
}
Console.WriteLine($"Exported {files.Count} trees with Roslyn {roslyn}");
return 0;

static void WriteNode(StringBuilder json, SyntaxNode node)
{
    json.Append('[').Append(Quote(node.Kind().ToString())).Append(',').Append(node.SpanStart).Append(',').Append(node.Span.End).Append(",[");
    var first = true;
    foreach (var child in node.ChildNodesAndTokens())
    {
        if (!first) json.Append(',');
        first = false;
        if (child.IsNode) WriteNode(json, child.AsNode()!); else WriteToken(json, child.AsToken());
    }
    json.Append("]]");
}

static void WriteToken(StringBuilder json, SyntaxToken token)
{
    json.Append('[').Append(Quote(token.Kind().ToString())).Append(',').Append(token.SpanStart).Append(',').Append(token.Span.End).Append(',').Append(Quote(token.Text)).Append(',');
    var value = token.Value;
    json.Append(Quote(value?.GetType().Name ?? "null")).Append(',').Append(Quote(value switch
    {
        null => "",
        string s => s,
        char c => c.ToString(),
        float f => f.ToString("R", CultureInfo.InvariantCulture),
        double d => d.ToString("R", CultureInfo.InvariantCulture),
        IFormattable formattable => formattable.ToString(null, CultureInfo.InvariantCulture),
        _ => value.ToString() ?? ""
    })).Append(',');
    WriteTrivia(json, token.LeadingTrivia);
    json.Append(',');
    WriteTrivia(json, token.TrailingTrivia);
    json.Append(',').Append(token.IsMissing ? "true" : "false").Append(']');
}

static void WriteTrivia(StringBuilder json, SyntaxTriviaList list)
{
    json.Append('[');
    var first = true;
    foreach (var trivia in list)
    {
        if (!first) json.Append(',');
        first = false;
        json.Append('[').Append(Quote(trivia.Kind().ToString())).Append(',').Append(trivia.FullSpan.Start).Append(',').Append(trivia.FullSpan.End).Append(']');
    }
    json.Append(']');
}

static string Quote(string value)
{
    var builder = new StringBuilder("\"");
    foreach (var ch in value)
    {
        switch (ch)
        {
            case '"': builder.Append("\\\""); break;
            case '\\': builder.Append("\\\\"); break;
            case '\n': builder.Append("\\n"); break;
            case '\r': builder.Append("\\r"); break;
            case '\t': builder.Append("\\t"); break;
            default:
                if (ch < 0x20 || ch > 0x7E) builder.Append("\\u").Append(((int)ch).ToString("x4", CultureInfo.InvariantCulture)); else builder.Append(ch);
                break;
        }
    }
    return builder.Append('"').ToString();
}
