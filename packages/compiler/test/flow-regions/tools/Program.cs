// Roslyn region-analysis pinning tool (SF-A02-T35).
//
// Usage: regions <input.json> <output.json>
//   input : [{"id":"name","source":"..."}]   the region of a program lies between the comments /*<*/ and /*>*/
//   output: {"roslyn","informationalVersion","references","results":{id:{...}}}
//
// The region is the run of statements between the markers (the statements of one statement list whose spans lie
// inside them). For it the tool records what SemanticModel.AnalyzeDataFlow and AnalyzeControlFlow answer:
//   data flow    : variablesDeclared, readInside, writtenInside, readOutside, writtenOutside, dataFlowsIn, dataFlowsOut,
//                  alwaysAssigned, captured, capturedInside, capturedOutside - variable names, sorted
//   control flow : startPointIsReachable, endPointIsReachable, returnStatements, exitPoints, entryPoints (counts)
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
    private const string Open = "/*<*/", Close = "/*>*/";

    private static int Main(string[] args)
    {
        if (args.Length != 2) { Console.Error.WriteLine("usage: regions <input.json> <output.json>"); return 2; }
        CultureInfo.DefaultThreadCurrentCulture = CultureInfo.InvariantCulture;
        CultureInfo.CurrentCulture = CultureInfo.InvariantCulture;
        var references = LocateReferences(out var referenceSource);
        var roslyn = typeof(CSharpCompilation).Assembly;
        var results = new SortedDictionary<string, object>(StringComparer.Ordinal);
        using var input = JsonDocument.Parse(File.ReadAllText(args[0]));
        foreach (var fixture in input.RootElement.EnumerateArray())
        {
            var id = fixture.GetProperty("id").GetString();
            results[id] = Analyze(id, fixture.GetProperty("source").GetString(), references);
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

    private static object Analyze(string id, string source, List<MetadataReference> references)
    {
        var result = new SortedDictionary<string, object>(StringComparer.Ordinal);
        var tree = CSharpSyntaxTree.ParseText(source, new CSharpParseOptions(LanguageVersion.Default), path: "Program.cs", encoding: Encoding.UTF8);
        var options = new CSharpCompilationOptions(OutputKind.ConsoleApplication, concurrentBuild: false);
        var compilation = CSharpCompilation.Create("regions", new[] { tree }, references, options);
        result["errors"] = compilation.GetDiagnostics().Where(d => d.Severity == DiagnosticSeverity.Error).Select(d => d.Id + "@" + d.Location.SourceSpan.Start).ToList();
        int start = source.IndexOf(Open, StringComparison.Ordinal), end = source.IndexOf(Close, StringComparison.Ordinal);
        if (start < 0 || end < start) throw new InvalidOperationException(id + ": the region markers are missing");
        start += Open.Length;
        // The outermost statements inside the markers; they must be siblings.
        var inside = tree.GetRoot().DescendantNodes().OfType<StatementSyntax>()
            .Where(s => s.SpanStart >= start && s.Span.End <= end).ToList();
        var outer = inside.Where(s => !inside.Any(o => o != s && o.Span.Contains(s.Span) && o.Span != s.Span)).OrderBy(s => s.SpanStart).ToList();
        if (outer.Count == 0) throw new InvalidOperationException(id + ": no statement between the markers");
        var model = compilation.GetSemanticModel(tree);
        var data = model.AnalyzeDataFlow(outer[0], outer[outer.Count - 1]);
        var control = model.AnalyzeControlFlow(outer[0], outer[outer.Count - 1]);
        if (!data.Succeeded || !control.Succeeded) throw new InvalidOperationException(id + ": Roslyn could not analyze the region");
        result["region"] = new[] { outer[0].SpanStart, outer[outer.Count - 1].Span.End };
        result["variablesDeclared"] = Names(data.VariablesDeclared);
        result["readInside"] = Names(data.ReadInside);
        result["writtenInside"] = Names(data.WrittenInside);
        result["readOutside"] = Names(data.ReadOutside);
        result["writtenOutside"] = Names(data.WrittenOutside);
        result["dataFlowsIn"] = Names(data.DataFlowsIn);
        result["dataFlowsOut"] = Names(data.DataFlowsOut);
        result["alwaysAssigned"] = Names(data.AlwaysAssigned);
        result["captured"] = Names(data.Captured);
        result["capturedInside"] = Names(data.CapturedInside);
        result["capturedOutside"] = Names(data.CapturedOutside);
        result["startPointIsReachable"] = control.StartPointIsReachable;
        result["endPointIsReachable"] = control.EndPointIsReachable;
        result["returnStatements"] = control.ReturnStatements.Length;
        result["exitPoints"] = control.ExitPoints.Length;
        result["entryPoints"] = control.EntryPoints.Length;
        return result;
    }

    private static List<string> Names(IEnumerable<ISymbol> symbols) => symbols.Select(s => s.Name).OrderBy(n => n, StringComparer.Ordinal).ToList();
}
