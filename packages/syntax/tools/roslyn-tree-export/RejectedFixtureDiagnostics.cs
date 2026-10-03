using System.Reflection;
using System.Text;
using System.Text.RegularExpressions;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.Text;

/// <summary>
/// Compiles every <c>rejected.cs</c> and <c>*.rejected.cs</c> at the language version named in its first line and records the
/// errors and warnings Roslyn reports, so the SharpForge feature gate is checked against the reference compiler rather than
/// against itself. Language-version errors come from the parser or the binder depending on the feature, which is
/// why this needs a compilation and not only a syntax tree.
/// Output: <c>rejected.cs.roslyn.json</c> beside each fixture, as
/// <c>{"roslyn": version, "langversion": text, "errors": [[id, start, end], ...]}</c> ordered by position and id;
/// a warning has "warning" as a fourth element.
/// </summary>
internal static class RejectedFixtureDiagnostics
{
    private static readonly Regex Header = new(@"^// langversion (\S+): expect ", RegexOptions.Compiled);

    public static int Export(string root)
    {
        var roslyn = typeof(CSharpSyntaxTree).Assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion ?? "unknown";
        var references = PlatformReferences();
        var files = Directory.EnumerateFiles(Path.GetFullPath(root), "*.cs", SearchOption.AllDirectories)
            .Where(path => Path.GetFileName(path) == "rejected.cs" || path.EndsWith(".rejected.cs", StringComparison.Ordinal))
            .OrderBy(path => path, StringComparer.Ordinal)
            .ToList();
        var exported = 0;
        foreach (var file in files)
        {
            var text = File.ReadAllText(file);
            var header = Header.Match(text);
            if (!header.Success || !LanguageVersionFacts.TryParse(header.Groups[1].Value, out var version))
            {
                Console.Error.WriteLine($"{file}: first line does not name a language version");
                return 1;
            }
            File.WriteAllText(file + ".roslyn.json", Describe(roslyn, header.Groups[1].Value, Errors(text, version, references)), new UTF8Encoding(false));
            exported++;
        }
        Console.WriteLine($"Exported compile errors of {exported} rejected fixtures with Roslyn {roslyn}");
        return 0;
    }

    private static List<Diagnostic> Errors(string text, LanguageVersion version, IReadOnlyList<MetadataReference> references)
    {
        var parseOptions = new CSharpParseOptions(version, DocumentationMode.Parse, SourceCodeKind.Regular);
        var tree = CSharpSyntaxTree.ParseText(SourceText.From(text), parseOptions);
        var options = new CSharpCompilationOptions(OutputKind.DynamicallyLinkedLibrary, allowUnsafe: true);
        var compilation = CSharpCompilation.Create("RejectedFixture", new[] { tree }, references, options);
        return compilation.GetDiagnostics()
            .Where(diagnostic => diagnostic.Severity >= DiagnosticSeverity.Warning && diagnostic.Location.IsInSource)
            .OrderBy(diagnostic => diagnostic.Location.SourceSpan.Start)
            .ThenBy(diagnostic => diagnostic.Id, StringComparer.Ordinal)
            .ToList();
    }

    private static string Describe(string roslyn, string version, List<Diagnostic> errors)
    {
        var json = new StringBuilder();
        json.Append("{\"roslyn\":\"").Append(roslyn).Append("\",\"langversion\":\"").Append(version).Append("\",\"errors\":[");
        for (var index = 0; index < errors.Count; index++)
        {
            var span = errors[index].Location.SourceSpan;
            if (index > 0) json.Append(',');
            json.Append("[\"").Append(errors[index].Id).Append("\",").Append(span.Start).Append(',').Append(span.End);
            if (errors[index].Severity == DiagnosticSeverity.Warning) json.Append(",\"warning\"");
            json.Append(']');
        }
        return json.Append("]}\n").ToString();
    }

    /// <summary>The framework assemblies of the runtime this tool runs on, as compilation references.</summary>
    private static List<MetadataReference> PlatformReferences()
    {
        var trusted = (string?)AppContext.GetData("TRUSTED_PLATFORM_ASSEMBLIES") ?? "";
        return trusted.Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries)
            .Where(path => Path.GetFileName(path).StartsWith("System.", StringComparison.Ordinal) || Path.GetFileName(path) == "mscorlib.dll")
            .OrderBy(path => path, StringComparer.Ordinal)
            .Select(path => (MetadataReference)MetadataReference.CreateFromFile(path))
            .ToList();
    }
}
