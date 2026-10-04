using System.Reflection;
using System.Runtime.InteropServices;
using System.Text.Json;

var cases = new Dictionary<string, Dictionary<string, object?>>();
foreach (var name in new[] { "wide", "compact" }) {
    var assembly = Assembly.Load(File.ReadAllBytes(Path.Combine(args[0], name + ".dll")));
    var type = assembly.GetType("Fixture.Program")!;
    var results = new Dictionary<string, object?>();
    foreach (var method in type.GetMethods(BindingFlags.Public | BindingFlags.Static | BindingFlags.DeclaredOnly)) {
        results[method.Name] = method.Invoke(null, method.Name == "Echo" ? new object[] { 1, 2, 3, 4, 5 } : null);
    }
    cases[name] = results;
}
Console.WriteLine(JsonSerializer.Serialize(new { runtime = RuntimeInformation.FrameworkDescription, cases },
    new JsonSerializerOptions { WriteIndented = true }));
