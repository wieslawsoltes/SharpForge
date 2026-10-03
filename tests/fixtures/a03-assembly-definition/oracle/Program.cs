using System.Reflection;
using System.Runtime.InteropServices;
using System.Text.Json;

var cases = args.Select(path => AssemblyName.GetAssemblyName(path)).Select(identity => new {
    name = identity.Name, version = identity.Version!.ToString(), culture = identity.CultureName ?? "",
}).ToArray();
Console.WriteLine(JsonSerializer.Serialize(new { runtime = RuntimeInformation.FrameworkDescription, cases },
    new JsonSerializerOptions { WriteIndented = true }));
