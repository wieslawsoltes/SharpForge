using System.Reflection.Metadata;
using System.Reflection.Metadata.Ecma335;
using System.Reflection.PortableExecutable;
using System.Runtime.InteropServices;
using System.Runtime.Loader;
using System.Security.Cryptography;
using System.Text.Json;

var cases = new List<object>();
foreach (var path in Directory.GetFiles(args[0], "*.dll").Order())
{
    var bytes = File.ReadAllBytes(path);
    using var stream = new MemoryStream(bytes);
    using var pe = new PEReader(stream);
    var metadata = pe.GetMetadataReader();
    var method = metadata.GetMethodDefinition(metadata.MethodDefinitions.Single());
    var body = pe.GetMethodBody(method.RelativeVirtualAddress);
    var regions = body.ExceptionRegions.Select(region => new {
        kind = region.Kind.ToString(), tryOffset = region.TryOffset, tryLength = region.TryLength,
        handlerOffset = region.HandlerOffset, handlerLength = region.HandlerLength,
        catchType = region.Kind == ExceptionRegionKind.Catch ? MetadataTokens.GetToken(region.CatchType) : 0,
        filterOffset = region.Kind == ExceptionRegionKind.Filter ? region.FilterOffset : -1,
    }).ToArray();
    var context = new AssemblyLoadContext(Path.GetFileNameWithoutExtension(path), isCollectible: true);
    var assembly = context.LoadFromAssemblyPath(Path.GetFullPath(path));
    int? result = null;
    string? error = null;
    try { result = (int)assembly.GetType("Cases")!.GetMethod("Run")!.Invoke(null, null)!; }
    catch (System.Reflection.TargetInvocationException exception) { error = exception.InnerException?.GetType().FullName; }
    context.Unload();
    cases.Add(new { id = Path.GetFileNameWithoutExtension(path), sha256 = Convert.ToHexStringLower(SHA256.HashData(bytes)), result, error, regions });
}
Console.WriteLine(JsonSerializer.Serialize(new { runtime = RuntimeInformation.FrameworkDescription, cases },
    new JsonSerializerOptions { WriteIndented = true }));
