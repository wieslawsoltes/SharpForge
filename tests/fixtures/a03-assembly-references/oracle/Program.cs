using System.Reflection;
using System.Runtime.InteropServices;
using System.Text.Json;

var cases = args.Select(path => new {
    framework = Path.GetFileNameWithoutExtension(path),
    references = Assembly.LoadFile(Path.GetFullPath(path)).GetReferencedAssemblies().Select(identity => new {
        name = identity.Name, version = identity.Version!.ToString(), culture = identity.CultureName ?? "",
        publicKeyToken = Convert.ToHexString(identity.GetPublicKeyToken()!).ToLowerInvariant(),
    }).OrderBy(identity => identity.name).ToArray(),
}).ToArray();
Console.WriteLine(JsonSerializer.Serialize(new { runtime = RuntimeInformation.FrameworkDescription, cases },
    new JsonSerializerOptions { WriteIndented = true }));
