using System.Reflection.Emit;
using System.Security.Cryptography;
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
var rows = new List<object>();
foreach (var name in new[] { "empty", "written", "disposed", "mutated-after-disposal", "null" })
{
    var writer = name == "null" ? null : new StringWriter();
    if (name is "written" or "disposed" or "mutated-after-disposal") writer!.Write("value");
    if (name is "disposed" or "mutated-after-disposal") writer!.Dispose();
    if (name == "mutated-after-disposal") writer!.GetStringBuilder().Append("!");
    foreach (var (kind, invoke) in new[] { ("call", direct), ("callvirt", virtualCall) })
    {
        try { rows.Add(new { name, kind, value = invoke(writer), fault = (string?)null }); }
        catch (Exception error) { rows.Add(new { name, kind, value = (string?)null, fault = error.GetType().Name }); }
    }
}
var result = new {
    runtime = Environment.Version.ToString(),
    sourceSha256 = Convert.ToHexString(SHA256.HashData(File.ReadAllBytes("Program.cs"))).ToLowerInvariant(), rows
};
File.WriteAllText(args[0], JsonSerializer.Serialize(result, new JsonSerializerOptions { WriteIndented = true }) + "\n");
