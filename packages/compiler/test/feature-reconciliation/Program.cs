using System;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Text.Json;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;

// The existing differential pin.csproj builds this program against the SDK's own Roslyn assemblies.
internal static class Program
{
    private static void Main(string[] args)
    {
        using var input = JsonDocument.Parse(File.ReadAllText(args[0]));
        var reference = MetadataReference.CreateFromFile(typeof(object).Assembly.Location);
        var rows = input.RootElement.EnumerateArray().Select(row =>
        {
            var source = row.GetProperty("source").GetString();
            var requested = row.GetProperty("langVersion").GetString();
            if (!LanguageVersionFacts.TryParse(requested, out var version)) throw new ArgumentException(requested);
            var tree = CSharpSyntaxTree.ParseText(source, new CSharpParseOptions(version), path: "Program.cs");
            var library = row.GetProperty("outputKind").GetString() == "library";
            var options = new CSharpCompilationOptions(library ? OutputKind.DynamicallyLinkedLibrary : OutputKind.ConsoleApplication);
            var compilation = CSharpCompilation.Create("FeatureGate", new[] { tree }, new[] { reference }, options);
            return new
            {
                source, langVersion = requested, outputKind = library ? "library" : "exe",
                diagnostics = compilation.GetDiagnostics().Where(d => d.Severity != DiagnosticSeverity.Hidden).Select(d => new
                {
                    code = d.Id, start = d.Location.SourceSpan.Start, length = d.Location.SourceSpan.Length,
                    message = d.GetMessage(CultureInfo.InvariantCulture), severity = d.Severity.ToString().ToLowerInvariant(),
                }).ToArray(),
            };
        }).ToArray();
        var assembly = typeof(CSharpCompilation).Assembly;
        var result = new
        {
            roslyn = assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion,
            runtime = Environment.Version.ToString(), rows,
        };
        File.WriteAllText(args[1], JsonSerializer.Serialize(result, new JsonSerializerOptions { WriteIndented = true }) + "\n");
    }
}
