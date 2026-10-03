// Roslyn pinning tool for the SharpForge differential harness (SF-A02-T40).
//
// Usage: pin <input.json> <output.json>
//        pin --run <image.dll> <result.json>     (internal: runs one emitted program, see below)
//   input : [{"id":"feature/name","langVersion":"7.3"|null,"source":"..."}]
//   output: {"roslyn","informationalVersion","runtime","references","results":{id:{...}}}
//
// For every fixture the tool compiles the source as a console application with real Roslyn and records the effective
// language version, every non-hidden diagnostic as [code, startOffset, length, severity] (sorted), and - when the
// compilation has no errors - the standard output produced by actually running the emitted assembly (invariant
// culture, timeout, newlines normalised to \n).
//
// Every program runs in a process of its own (this tool started again with --run). Running them all in one process
// made a pin depend on its neighbours: a finalizer of an earlier fixture ran during a later one and wrote into its
// output, and static state, the culture and the threads a program left behind were shared as well.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Threading;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;

internal static class Program
{
    private const int TimeoutMilliseconds = 10000;
    private const int ChildGraceMilliseconds = TimeoutMilliseconds + 20000;

    private static int Main(string[] args)
    {
        if (args.Length == 3 && args[0] == "--run") return RunIsolated(args[1], args[2]);
        if (args.Length != 2) { Console.Error.WriteLine("usage: pin <input.json> <output.json>"); return 2; }
        CultureInfo.DefaultThreadCurrentCulture = CultureInfo.InvariantCulture;
        CultureInfo.DefaultThreadCurrentUICulture = CultureInfo.InvariantCulture;
        CultureInfo.CurrentCulture = CultureInfo.InvariantCulture;
        CultureInfo.CurrentUICulture = CultureInfo.InvariantCulture;

        var references = LocateReferences(out var referenceSource);
        var roslyn = typeof(CSharpCompilation).Assembly;
        var results = new SortedDictionary<string, object>(StringComparer.Ordinal);
        var scratch = Path.GetDirectoryName(Path.GetFullPath(args[1]));
        var index = 0;
        using var input = JsonDocument.Parse(File.ReadAllText(args[0]));
        foreach (var fixture in input.RootElement.EnumerateArray())
        {
            var id = fixture.GetProperty("id").GetString();
            var source = fixture.GetProperty("source").GetString();
            var requested = fixture.TryGetProperty("langVersion", out var lv) && lv.ValueKind == JsonValueKind.String ? lv.GetString() : null;
            var allowUnsafe = fixture.TryGetProperty("allowUnsafe", out var au) && au.ValueKind == JsonValueKind.True;
            results[id] = Pin(id, source, requested, allowUnsafe, references, index++, scratch);
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

    private static object Pin(string id, string source, string requested, bool allowUnsafe, List<MetadataReference> references, int index, string scratch)
    {
        var version = LanguageVersion.Default;
        if (requested != null && !LanguageVersionFacts.TryParse(requested, out version)) throw new InvalidOperationException(id + ": unknown language version " + requested);
        var parseOptions = new CSharpParseOptions(version);
        var tree = CSharpSyntaxTree.ParseText(source, parseOptions, path: "Program.cs", encoding: Encoding.UTF8);
        var options = new CSharpCompilationOptions(OutputKind.ConsoleApplication, optimizationLevel: OptimizationLevel.Debug, deterministic: true, concurrentBuild: false, allowUnsafe: allowUnsafe);
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
        if (image != null) RunInChild(id, image, result, scratch);
        return result;
    }

    /// Runs the emitted program in a child process and copies what it recorded into the fixture's result.
    private static void RunInChild(string id, byte[] image, SortedDictionary<string, object> result, string scratch)
    {
        var imagePath = Path.Combine(scratch, "fixture.dll");
        var resultPath = Path.Combine(scratch, "fixture.json");
        File.WriteAllBytes(imagePath, image);
        File.Delete(resultPath);
        var start = new ProcessStartInfo(Environment.ProcessPath) { UseShellExecute = false, RedirectStandardInput = true };
        // The tool runs as `dotnet pin.dll`; an apphost build is its own process path and takes no assembly argument.
        var host = Path.GetFileNameWithoutExtension(Environment.ProcessPath);
        if (!string.Equals(host, "pin", StringComparison.OrdinalIgnoreCase)) start.ArgumentList.Add(typeof(Program).Assembly.Location);
        start.ArgumentList.Add("--run");
        start.ArgumentList.Add(imagePath);
        start.ArgumentList.Add(resultPath);
        using var child = Process.Start(start);
        child.StandardInput.Close();
        // The child enforces the fixture's timeout itself; this longer wait only guards against a child that hangs.
        if (!child.WaitForExit(ChildGraceMilliseconds))
        {
            child.Kill(entireProcessTree: true);
            child.WaitForExit();
        }
        if (!File.Exists(resultPath)) throw new InvalidOperationException(id + ": the program's process ended without a result (exit code " + child.ExitCode + ")");
        using var recorded = JsonDocument.Parse(File.ReadAllText(resultPath));
        var root = recorded.RootElement;
        result["output"] = root.GetProperty("output").GetString();
        if (root.TryGetProperty("timedOut", out _)) { result["timedOut"] = true; return; }
        if (root.TryGetProperty("exception", out var exception)) result["exception"] = exception.GetString();
        if (root.TryGetProperty("exitCode", out var exitCode)) result["exitCode"] = exitCode.GetInt32();
    }

    /// The child side of RunInChild: runs one program to its end (or the timeout) and writes what happened.
    private static int RunIsolated(string imagePath, string resultPath)
    {
        CultureInfo.DefaultThreadCurrentCulture = CultureInfo.InvariantCulture;
        CultureInfo.DefaultThreadCurrentUICulture = CultureInfo.InvariantCulture;
        var result = new SortedDictionary<string, object>(StringComparer.Ordinal);
        var writer = new StringWriter(CultureInfo.InvariantCulture);
        var synchronized = TextWriter.Synchronized(writer);
        string exception = null;
        object returned = null;
        var image = File.ReadAllBytes(imagePath);
        var thread = new Thread(() =>
        {
            CultureInfo.CurrentCulture = CultureInfo.InvariantCulture;
            CultureInfo.CurrentUICulture = CultureInfo.InvariantCulture;
            try
            {
                var entry = Assembly.Load(image).EntryPoint;
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
        if (!finished) result["timedOut"] = true;
        else
        {
            if (exception != null) result["exception"] = exception;
            if (returned is int exitCode) result["exitCode"] = exitCode;
        }
        File.WriteAllText(resultPath, JsonSerializer.Serialize(result, new JsonSerializerOptions { Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping }));
        // Threads the program left running must not keep the process alive, and its finalizers must not run on exit.
        Environment.Exit(0);
        return 0;
    }
}
