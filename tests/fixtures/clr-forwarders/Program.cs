using System.Reflection;
using System.Runtime.InteropServices;
using System.Runtime.Loader;
using System.Text.Json;

var directory = args[0];
var cases = JsonSerializer.Deserialize<Request[]>(File.ReadAllText(Path.Combine(directory, "cases.json")))!;
var results = new List<object>();
foreach (var request in cases)
{
    var context = new AssemblyLoadContext("ForwarderOracle", isCollectible: true);
    context.Resolving += (_, name) =>
    {
        var path = Path.Combine(directory, name.Name + ".dll");
        return File.Exists(path) ? context.LoadFromAssemblyPath(path) : null;
    };
    try
    {
        var assembly = context.LoadFromAssemblyPath(Path.Combine(directory, request.assembly + ".dll"));
        var type = request.token.HasValue ? assembly.ManifestModule.ResolveType(request.token.Value)
            : assembly.GetType(request.name!, throwOnError: true)!;
        var target = context.Assemblies.Single(item => item.GetName().Name == "ForwardTarget");
        results.Add(new { request, name = type.FullName, assembly = type.Assembly.GetName().Name,
            token = type.MetadataToken, canonical = ReferenceEquals(type, target.GetType(type.FullName!)) });
    }
    catch (Exception error)
    {
        results.Add(new { request, error = error.GetType().FullName });
    }
    finally { context.Unload(); }
}
Console.WriteLine(JsonSerializer.Serialize(new { runtime = RuntimeInformation.FrameworkDescription, results }));

record Request(string assembly, string? name, int? token);
