// Roslyn pinning tool for the reference-manager fixtures (SF-A02-T22).
//
// Usage: references <input.json> <output.json>
//   input : {"core":"<path>","keyFile":"<path>","assemblyDirectory":"<dir>",
//            "assemblies":[{"file","name","strong","build","source","references":["file"]}],
//            "scenarios":[{"id","source","references":[{"file","aliases":["A"]}]}]}
//   output: {"roslyn","informationalVersion","assemblies":{file:{"identity","bytes"}},"results":{id:[[code,start,length,severity,message]]}}
//
// The tool first builds every fixture assembly with Roslyn (deterministic, public-signed when strong) and writes the
// ones with "build" != false to the assembly directory. It then compiles every scenario as a console application
// against the core library plus its references (each with its extern aliases) and records every non-hidden
// diagnostic, sorted. References are created from the images with the file name as display path.
using System;
using System.Collections.Generic;
using System.Collections.Immutable;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;

internal static class Program
{
    private static int Main(string[] args)
    {
        if (args.Length != 2) { Console.Error.WriteLine("usage: references <input.json> <output.json>"); return 2; }
        CultureInfo.DefaultThreadCurrentCulture = CultureInfo.InvariantCulture;
        CultureInfo.DefaultThreadCurrentUICulture = CultureInfo.InvariantCulture;
        CultureInfo.CurrentCulture = CultureInfo.InvariantCulture;
        CultureInfo.CurrentUICulture = CultureInfo.InvariantCulture;

        using var input = JsonDocument.Parse(File.ReadAllText(args[0]));
        var root = input.RootElement;
        var core = File.ReadAllBytes(root.GetProperty("core").GetString());
        var keyFile = root.GetProperty("keyFile").GetString();
        var directory = root.GetProperty("assemblyDirectory").GetString();
        Directory.CreateDirectory(directory);

        var images = new Dictionary<string, byte[]>(StringComparer.Ordinal);
        var described = new SortedDictionary<string, object>(StringComparer.Ordinal);
        foreach (var assembly in root.GetProperty("assemblies").EnumerateArray())
        {
            var file = assembly.GetProperty("file").GetString();
            var image = Build(assembly, core, keyFile, images, out var identity);
            images[file] = image;
            if (assembly.TryGetProperty("build", out var build) && build.ValueKind == JsonValueKind.False) continue;
            File.WriteAllBytes(Path.Combine(directory, file), image);
            described[file] = new SortedDictionary<string, object>(StringComparer.Ordinal) { ["identity"] = identity, ["bytes"] = image.Length };
        }

        var results = new SortedDictionary<string, object>(StringComparer.Ordinal);
        foreach (var scenario in root.GetProperty("scenarios").EnumerateArray())
            results[scenario.GetProperty("id").GetString()] = Pin(scenario, core, images);

        var roslyn = typeof(CSharpCompilation).Assembly;
        var document = new SortedDictionary<string, object>(StringComparer.Ordinal)
        {
            ["roslyn"] = roslyn.GetName().Version.ToString(),
            ["informationalVersion"] = roslyn.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion,
            ["assemblies"] = described,
            ["results"] = results,
        };
        File.WriteAllText(args[1], JsonSerializer.Serialize(document, new JsonSerializerOptions { Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping }));
        return 0;
    }

    private static MetadataReference Reference(byte[] image, string display, IEnumerable<string> aliases = null)
    {
        var properties = aliases == null ? MetadataReferenceProperties.Assembly : new MetadataReferenceProperties(MetadataImageKind.Assembly, aliases.ToImmutableArray());
        return MetadataReference.CreateFromImage(image, properties, filePath: display);
    }

    private static byte[] Build(JsonElement assembly, byte[] core, string keyFile, Dictionary<string, byte[]> images, out string identity)
    {
        var file = assembly.GetProperty("file").GetString();
        var strong = assembly.GetProperty("strong").GetBoolean();
        var references = new List<MetadataReference> { Reference(core, "MiniStandard.dll") };
        if (assembly.TryGetProperty("references", out var list))
            foreach (var reference in list.EnumerateArray()) references.Add(Reference(images[reference.GetString()], reference.GetString()));
        var tree = CSharpSyntaxTree.ParseText(assembly.GetProperty("source").GetString(), new CSharpParseOptions(LanguageVersion.Latest), path: file + ".cs", encoding: Encoding.UTF8);
        var options = new CSharpCompilationOptions(OutputKind.DynamicallyLinkedLibrary, optimizationLevel: OptimizationLevel.Release, deterministic: true, concurrentBuild: false);
        if (strong) options = options.WithPublicSign(true).WithCryptoKeyFile(keyFile).WithStrongNameProvider(new DesktopStrongNameProvider());
        var compilation = CSharpCompilation.Create(assembly.GetProperty("name").GetString(), new[] { tree }, references, options);
        using var stream = new MemoryStream();
        var emitted = compilation.Emit(stream);
        if (!emitted.Success)
            throw new InvalidOperationException(file + ": " + string.Join("; ", emitted.Diagnostics.Where(d => d.Severity == DiagnosticSeverity.Error)));
        identity = compilation.Assembly.Identity.GetDisplayName();
        return stream.ToArray();
    }

    private static object Pin(JsonElement scenario, byte[] core, Dictionary<string, byte[]> images)
    {
        var references = new List<MetadataReference> { Reference(core, "MiniStandard.dll") };
        foreach (var reference in scenario.GetProperty("references").EnumerateArray())
        {
            var file = reference.GetProperty("file").GetString();
            var aliases = reference.TryGetProperty("aliases", out var list) ? list.EnumerateArray().Select(a => a.GetString()).ToList() : null;
            references.Add(Reference(images[file], file, aliases));
        }
        var tree = CSharpSyntaxTree.ParseText(scenario.GetProperty("source").GetString(), new CSharpParseOptions(LanguageVersion.Latest), path: "Program.cs", encoding: Encoding.UTF8);
        var options = new CSharpCompilationOptions(OutputKind.ConsoleApplication, optimizationLevel: OptimizationLevel.Debug, deterministic: true, concurrentBuild: false);
        var compilation = CSharpCompilation.Create("Scenario", new[] { tree }, references, options);
        return compilation.GetDiagnostics().Where(d => d.Severity != DiagnosticSeverity.Hidden).Select(d =>
        {
            var inSource = d.Location.IsInSource;
            return new
            {
                code = d.Id,
                start = inSource ? d.Location.SourceSpan.Start : -1,
                length = inSource ? d.Location.SourceSpan.Length : 0,
                severity = d.Severity.ToString().ToLowerInvariant(),
                message = d.GetMessage(CultureInfo.InvariantCulture),
            };
        }).Distinct().OrderBy(d => d.start).ThenBy(d => d.length).ThenBy(d => d.code, StringComparer.Ordinal).ThenBy(d => d.message, StringComparer.Ordinal)
          .Select(d => new object[] { d.code, d.start, d.length, d.severity, d.message }).ToList();
    }
}
