using System.Reflection.Emit;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

static Func<object?, string> Dispatch(OpCode instruction)
{
    var method = new DynamicMethod("ObjectString", typeof(string), [typeof(object)]);
    var il = method.GetILGenerator();
    il.Emit(OpCodes.Ldarg_0);
    il.Emit(instruction, typeof(object).GetMethod(nameof(object.ToString), Type.EmptyTypes)!);
    il.Emit(OpCodes.Ret);
    return method.CreateDelegate<Func<object?, string>>();
}

var direct = Dispatch(OpCodes.Call);
var virtualCall = Dispatch(OpCodes.Callvirt);
var builder = new StringBuilder("value");
builder.Append("!");
var inputs = new (string Name, object? Value)[] {
    ("empty-builder", new StringBuilder()), ("builder", new StringBuilder("value")),
    ("mutated-builder", builder), ("uri", new Uri("https://example.com/path?q=1")),
    ("relative-uri", new Uri("relative/path", UriKind.Relative)), ("null", null),
    ("object", new object()), ("hidden", new HiddenString()), ("int", 42),
    ("bool", true), ("string", "text")
};
var rows = new List<object>();
foreach (var (name, value) in inputs)
{
    foreach (var (kind, invoke) in new[] { ("call", direct), ("callvirt", virtualCall) })
    {
        try { rows.Add(new { name, kind, value = invoke(value), fault = (string?)null }); }
        catch (Exception error) { rows.Add(new { name, kind, value = (string?)null, fault = error.GetType().Name }); }
    }
}
var result = new {
    runtime = Environment.Version.ToString(),
    sourceSha256 = Convert.ToHexString(SHA256.HashData(File.ReadAllBytes("Program.cs"))).ToLowerInvariant(), rows
};
File.WriteAllText(args[0], JsonSerializer.Serialize(result, new JsonSerializerOptions { WriteIndented = true }) + "\n");

sealed class HiddenString { public new string ToString() => "hidden"; }
