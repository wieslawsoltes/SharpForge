// Roslyn pinning tool for the SharpForge differential harness (SF-A02-T40).
//
// Usage: pin <input.json> <output.json>
//   input : [{"id":"feature/name","langVersion":"7.3"|null,"source":"..."}]
//   output: {"roslyn","informationalVersion","runtime","references","results":{id:{...}}}
//
// For every fixture the tool compiles the source as a console application with real Roslyn and records the effective
// language version, every non-hidden diagnostic as [code, startOffset, length, severity] (sorted), and - when the
// compilation has no errors - the standard output produced by actually running the emitted assembly (in-memory emit,
// collectible AssemblyLoadContext, invariant culture, timeout, newlines normalised to \n).
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Runtime.Loader;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Threading;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;

internal static class Program
{
    private const int TimeoutMilliseconds = 10000;

    private static int Main(string[] args)
    {
        if (args.Length != 2) { Console.Error.WriteLine("usage: pin <input.json> <output.json>"); return 2; }
        CultureInfo.DefaultThreadCurrentCulture = CultureInfo.InvariantCulture;
        CultureInfo.DefaultThreadCurrentUICulture = CultureInfo.InvariantCulture;
        CultureInfo.CurrentCulture = CultureInfo.InvariantCulture;
        CultureInfo.CurrentUICulture = CultureInfo.InvariantCulture;

        var references = LocateReferences(out var referenceSource);
        var roslyn = typeof(CSharpCompilation).Assembly;
        var results = new SortedDictionary<string, object>(StringComparer.Ordinal);
        var realOut = Console.Out;
        var index = 0;
        using var input = JsonDocument.Parse(File.ReadAllText(args[0]));
        foreach (var fixture in input.RootElement.EnumerateArray())
        {
            var id = fixture.GetProperty("id").GetString();
            var source = fixture.GetProperty("source").GetString();
            var requested = fixture.TryGetProperty("langVersion", out var lv) && lv.ValueKind == JsonValueKind.String ? lv.GetString() : null;
            results[id] = Pin(id, source, requested, references, index++);
            Console.SetOut(realOut);
        }
        var document = new SortedDictionary<string, object>(StringComparer.Ordinal)
        {
            ["roslyn"] = roslyn.GetName().Version.ToString(),
            ["informationalVersion"] = roslyn.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion,
            ["runtime"] = Environment.Version.ToString(),
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

    private static object Pin(string id, string source, string requested, List<MetadataReference> references, int index)
    {
        var version = LanguageVersion.Default;
        if (requested != null && !LanguageVersionFacts.TryParse(requested, out version)) throw new InvalidOperationException(id + ": unknown language version " + requested);
        var parseOptions = new CSharpParseOptions(version);
        var tree = CSharpSyntaxTree.ParseText(source, parseOptions, path: "Program.cs", encoding: Encoding.UTF8);
        var options = new CSharpCompilationOptions(OutputKind.ConsoleApplication, optimizationLevel: OptimizationLevel.Debug, deterministic: true, concurrentBuild: false);
        var compilation = CSharpCompilation.Create("Fixture" + index, new[] { tree }, references, options);

        var diagnostics = new List<Diagnostic>(compilation.GetDiagnostics());
        byte[] image = null;
        if (!diagnostics.Any(d => d.Severity == DiagnosticSeverity.Error))
        {
            using var stream = new MemoryStream();
            var emitted = compilation.Emit(stream);
            diagnostics = new List<Diagnostic>(emitted.Diagnostics);
            if (emitted.Success) image = stream.ToArray();
        }

        var rows = diagnostics.Where(d => d.Severity != DiagnosticSeverity.Hidden).Select(d =>
        {
            var inSource = d.Location.IsInSource;
            return new { code = d.Id, start = inSource ? d.Location.SourceSpan.Start : -1, length = inSource ? d.Location.SourceSpan.Length : 0, severity = d.Severity.ToString().ToLowerInvariant() };
        }).Distinct().OrderBy(d => d.start).ThenBy(d => d.length).ThenBy(d => d.code, StringComparer.Ordinal).ThenBy(d => d.severity, StringComparer.Ordinal)
          .Select(d => new object[] { d.code, d.start, d.length, d.severity }).ToList();

        var result = new SortedDictionary<string, object>(StringComparer.Ordinal)
        {
            ["langVersion"] = parseOptions.LanguageVersion.ToDisplayString(),
            ["diagnostics"] = rows,
        };
        if (image != null) Run(image, result);
        return result;
    }

    private static void Run(byte[] image, SortedDictionary<string, object> result)
    {
        var context = new AssemblyLoadContext("fixture", isCollectible: true);
        var writer = new StringWriter(CultureInfo.InvariantCulture);
        var synchronized = TextWriter.Synchronized(writer);
        string exception = null;
        object returned = null;
        var thread = new Thread(() =>
        {
            CultureInfo.CurrentCulture = CultureInfo.InvariantCulture;
            CultureInfo.CurrentUICulture = CultureInfo.InvariantCulture;
            try
            {
                var entry = context.LoadFromStream(new MemoryStream(image)).EntryPoint;
                returned = entry.Invoke(null, entry.GetParameters().Length == 0 ? null : new object[] { Array.Empty<string>() });
            }
            catch (TargetInvocationException e) { exception = (e.InnerException ?? e).GetType().FullName; }
            catch (Exception e) { exception = e.GetType().FullName; }
        }, 16 * 1024 * 1024) { IsBackground = true };
        Console.SetOut(synchronized);
        Console.SetError(TextWriter.Null);
        Console.SetIn(new StringReader(""));
        thread.Start();
        var finished = thread.Join(TimeoutMilliseconds);
        string output;
        lock (synchronized) output = writer.ToString();
        result["output"] = output.Replace("\r\n", "\n").Replace("\r", "\n");
        if (!finished) { result["timedOut"] = true; return; }
        if (exception != null) result["exception"] = exception;
        if (returned is int exitCode) result["exitCode"] = exitCode;
        context.Unload();
    }
}
