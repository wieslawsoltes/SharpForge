using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Runtime.Loader;
using System.Security.Cryptography;
using System.Text.Json;

if (args.Length != 1) throw new ArgumentException("Provide one fixture output directory");
var directory = Path.GetFullPath(args[0]);
Directory.CreateDirectory(directory);
var corpus = Images.Create();
if (corpus.Files.Count > 64 || corpus.Cases.Count > 64 || corpus.Files.Any(file => file.Bytes.Length > 65536))
    throw new InvalidOperationException("Native manifest fixture corpus exceeded its authored size limit");
foreach (var file in corpus.Files) File.WriteAllBytes(Path.Combine(directory, file.Name), file.Bytes);
var assemblyPaths = corpus.Files.Where(file => file.AssemblyName is not null)
    .ToDictionary(file => file.AssemblyName!, file => Path.Combine(directory, file.Name), StringComparer.OrdinalIgnoreCase);
var trustedPaths = ((string?)AppContext.GetData("TRUSTED_PLATFORM_ASSEMBLIES") ?? string.Empty)
    .Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries);
var resolverPaths = trustedPaths.Append(typeof(object).Assembly.Location).Concat(assemblyPaths.Values)
    .Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
var files = corpus.Files.Select(file => new {
    name = file.Name,
    assemblyName = file.AssemblyName,
    bytesBase64 = Convert.ToBase64String(file.Bytes),
    sha256 = Convert.ToHexString(SHA256.HashData(file.Bytes)).ToLowerInvariant(),
}).ToArray();
var cases = corpus.Cases.Select(fixture => new {
    id = fixture.Id,
    assemblyName = fixture.AssemblyName,
    resource = fixture.Resource,
    classification = fixture.Classification,
    expectedBase64 = fixture.ExpectedBytes is null ? null : Convert.ToBase64String(fixture.ExpectedBytes),
    expectedInfo = fixture.ExpectedInfo,
    coreClr = CaptureCoreClr(fixture, assemblyPaths),
    metadataLoadContext = CaptureMetadata(fixture, assemblyPaths, resolverPaths),
}).ToArray();
Console.WriteLine(JsonSerializer.Serialize(new {
    format = 1,
    framework = RuntimeInformation.FrameworkDescription,
    metadataLoadContextVersion = typeof(MetadataLoadContext).Assembly.GetName().Version?.ToString(),
    files,
    cases,
}, new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase }));

static object CaptureCoreClr(FixtureCase fixture, IReadOnlyDictionary<string, string> assemblyPaths)
{
    var context = new FixtureLoadContext(fixture.Id, assemblyPaths);
    try
    {
        var assembly = context.LoadFromAssemblyPath(assemblyPaths[fixture.AssemblyName]);
        return Observe(assembly, fixture.Resource);
    }
    catch (Exception error) { return FailedObservations(error); }
    finally { context.Unload(); }
}

static object CaptureMetadata(FixtureCase fixture, IReadOnlyDictionary<string, string> assemblyPaths, string[] resolverPaths)
{
    try
    {
        using var context = new MetadataLoadContext(new PathAssemblyResolver(resolverPaths), "System.Private.CoreLib");
        var assembly = context.LoadFromAssemblyPath(assemblyPaths[fixture.AssemblyName]);
        return Observe(assembly, fixture.Resource);
    }
    catch (Exception error) { return FailedObservations(error); }
}

static object Observe(Assembly assembly, string name) => new {
    names = Operation(() => assembly.GetManifestResourceNames()),
    stream = Operation(() => ResourceBytes(assembly, name)),
    info = Operation(() => ResourceInfo(assembly, name)),
};

static string? ResourceBytes(Assembly assembly, string name)
{
    using var stream = assembly.GetManifestResourceStream(name);
    if (stream is null) return null;
    const int maximumBytes = 65536;
    if (stream.CanSeek && stream.Length > maximumBytes)
        throw new InvalidDataException("Native resource stream exceeds the fixture read limit");
    using var output = new MemoryStream();
    var buffer = new byte[1024];
    for (;;)
    {
        var length = stream.Read(buffer, 0, buffer.Length);
        if (length == 0) break;
        if (output.Length + length > maximumBytes)
            throw new InvalidDataException("Native resource stream exceeds the fixture read limit");
        output.Write(buffer, 0, length);
    }
    return Convert.ToBase64String(output.ToArray());
}

static object? ResourceInfo(Assembly assembly, string name)
{
    var info = assembly.GetManifestResourceInfo(name);
    return info is null ? null : new {
        fileName = info.FileName,
        referencedAssembly = info.ReferencedAssembly?.GetName().Name,
        resourceLocation = (int)info.ResourceLocation,
    };
}

static object Operation(Func<object?> operation)
{
    try { return new { value = operation() }; }
    catch (Exception error) { return Failure(error); }
}

static object Failure(Exception error) => new {
    error = new { type = error.GetType().FullName, message = error.Message, hresult = error.HResult },
};

static object FailedObservations(Exception error)
{
    var failure = Failure(error);
    return new { names = failure, stream = failure, info = failure };
}

internal sealed class FixtureLoadContext : AssemblyLoadContext
{
    private readonly Dictionary<string, string> _paths;

    public FixtureLoadContext(string id, IReadOnlyDictionary<string, string> paths) : base("ManifestFixture:" + id, isCollectible: true)
    {
        _paths = paths.ToDictionary(pair => pair.Key, pair => pair.Value, StringComparer.OrdinalIgnoreCase);
    }

    protected override Assembly? Load(AssemblyName name)
    {
        return name.Name is not null && _paths.TryGetValue(name.Name, out var path) ? LoadFromAssemblyPath(path) : null;
    }
}
