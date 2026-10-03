using System.Reflection;
using System.Runtime.InteropServices;
using System.Text.Json;
using NuGet.Frameworks;

object result = args[0] switch
{
    "names" => ReadNames(args[1]),
    "keys" => ReadKeys(),
    "frameworks" => ReadFrameworks(args[1]),
    "trusted" => ReadTrustedAssemblies(),
    _ => throw new ArgumentException("Unknown oracle mode")
};
Console.WriteLine(JsonSerializer.Serialize(result, new JsonSerializerOptions { WriteIndented = true }));

static object ReadNames(string path)
{
    var inputs = JsonSerializer.Deserialize<string[]>(File.ReadAllText(path))!;
    var cases = inputs.Select(input => {
        try
        {
            var name = new AssemblyName(input);
            return (object)new {
                input, name = name.Name, version = name.Version?.ToString(), culture = name.CultureName,
                token = name.GetPublicKeyToken() is {} token ? Convert.ToHexString(token).ToLowerInvariant() : null,
                flags = (int)name.Flags, contentType = name.ContentType.ToString(), fullName = name.FullName
            };
        }
        catch (Exception exception) { return new { input, error = exception.GetType().Name }; }
    });
    return new { runtime = RuntimeInformation.FrameworkDescription, cases };
}

static object ReadKeys()
{
    var assemblies = new[] { typeof(object).Assembly, typeof(Console).Assembly, typeof(NuGetFramework).Assembly };
    return assemblies.Select(assembly => {
        var name = assembly.GetName();
        return new { name = name.Name, key = Convert.ToHexString(name.GetPublicKey()!).ToLowerInvariant(),
            token = Convert.ToHexString(name.GetPublicKeyToken()!).ToLowerInvariant() };
    });
}

static object ReadFrameworks(string path)
{
    var reducer = new FrameworkReducer();
    using var document = JsonDocument.Parse(File.ReadAllText(path));
    return document.RootElement.EnumerateArray().Select(row => {
        var target = row.GetProperty("target").GetString()!;
        var candidates = row.GetProperty("candidates").EnumerateArray().Select(value => value.GetString()!).ToArray();
        var nearest = reducer.GetNearest(NuGetFramework.ParseFolder(target), candidates.Select(NuGetFramework.ParseFolder));
        return new { package = row.GetProperty("package").GetString(), target, candidates, nearest = nearest?.GetShortFolderName() };
    }).ToArray();
}

static object ReadTrustedAssemblies()
{
    var paths = ((string)AppContext.GetData("TRUSTED_PLATFORM_ASSEMBLIES")!).Split(Path.PathSeparator);
    return new { runtime = RuntimeInformation.FrameworkDescription, paths };
}
