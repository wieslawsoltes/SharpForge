using System.Reflection;
using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;
using System.Runtime.Loader;
using System.Text.Json;

var first = new AssemblyLoadContext("First", isCollectible: true);
var second = new AssemblyLoadContext("Second", isCollectible: true);
using var firstStream = File.OpenRead(args[0]);
using var secondStream = File.OpenRead(args[1]);
var one = first.LoadFromStream(firstStream);
var two = second.LoadFromStream(secondStream);
var loaded = new[] { one, two }.Select(assembly => new {
    fullName = assembly.FullName,
    moduleName = assembly.ManifestModule.Name,
    mvid = assembly.ManifestModule.ModuleVersionId.ToString(),
    references = assembly.GetReferencedAssemblies().Select(name => name.FullName).ToArray(),
    typeToken = assembly.GetType("Widget")!.MetadataToken,
}).ToArray();
var distinctTypes = one.GetType("Widget") != two.GetType("Widget");
var domainSeesAssemblies = AppDomain.CurrentDomain.GetAssemblies().Contains(one) && AppDomain.CurrentDomain.GetAssemblies().Contains(two);
var lifetime = CreateLifetime(args[0]);
Collect();
var liveInstanceRetainsContext = lifetime.Context.IsAlive;
lifetime.Instance = null;
for (var attempt = 0; attempt < 20 && lifetime.Context.IsAlive; attempt++) Collect();
Console.WriteLine(JsonSerializer.Serialize(new {
    runtime = RuntimeInformation.FrameworkDescription, loaded, distinctTypes, domainSeesAssemblies,
    liveInstanceRetainsContext, collectedAfterRelease = !lifetime.Context.IsAlive,
}, new JsonSerializerOptions { WriteIndented = true }));

[MethodImpl(MethodImplOptions.NoInlining)]
static Lifetime CreateLifetime(string path)
{
    var context = new AssemblyLoadContext("Collectible", isCollectible: true);
    using var stream = File.OpenRead(path);
    var assembly = context.LoadFromStream(stream);
    var result = new Lifetime { Context = new WeakReference(context), Instance = Activator.CreateInstance(assembly.GetType("Widget")!) };
    context.Unload();
    return result;
}

[MethodImpl(MethodImplOptions.NoInlining)]
static void Collect()
{
    GC.Collect();
    GC.WaitForPendingFinalizers();
    GC.Collect();
}

class Lifetime
{
    public required WeakReference Context { get; init; }
    public object? Instance { get; set; }
}
