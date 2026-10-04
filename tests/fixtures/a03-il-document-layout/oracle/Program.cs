using System.Reflection;
using System.Runtime.InteropServices;
using System.Text.Json;

var assembly = Assembly.Load(File.ReadAllBytes(args[0]));
var type = assembly.GetType("Fixture.Program")!;
var results = new Dictionary<string, object?>();
foreach (var method in type.GetMethods(BindingFlags.Public | BindingFlags.Static | BindingFlags.DeclaredOnly)) {
    results[method.Name] = method.Invoke(null, null);
}
Console.WriteLine(JsonSerializer.Serialize(new { runtime = RuntimeInformation.FrameworkDescription, results },
    new JsonSerializerOptions { WriteIndented = true }));
