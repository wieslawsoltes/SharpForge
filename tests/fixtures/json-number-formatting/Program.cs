using System.Security.Cryptography;
using System.Text.Json;

if (Environment.Version.ToString() != "10.0.5")
    throw new InvalidOperationException("Expected runtime 10.0.5");
using var input = JsonDocument.Parse(File.ReadAllText(args[0]));
var cases = new List<object>();
foreach (var row in input.RootElement.GetProperty("rows").EnumerateArray())
{
    var name = row.GetProperty("name").GetString()!;
    var bits = row.GetProperty("bits").GetString()!;
    var value = BitConverter.Int64BitsToDouble(unchecked((long)Convert.ToUInt64(bits, 16)));
    if (!double.IsFinite(value))
    {
        try { JsonSerializer.Serialize(value); }
        catch (Exception error) { cases.Add(new { name, bits, exception = error.GetType().Name }); }
        continue;
    }
    cases.Add(new
    {
        name,
        bits,
        scalar = JsonSerializer.Serialize(value),
        array = JsonSerializer.Serialize(new object[] { value, -0.0, 42, "1e+21 <é>" }),
        dictionary = JsonSerializer.Serialize(new Dictionary<string, double>
        {
            ["n<é+>"] = value,
            ["zero"] = -0.0
        })
    });
}
var controls = new Dictionary<string, string>
{
    ["int-min"] = JsonSerializer.Serialize(int.MinValue),
    ["int-max"] = JsonSerializer.Serialize(int.MaxValue),
    ["null"] = JsonSerializer.Serialize<object?>(null),
    ["string"] = JsonSerializer.Serialize("1e+21 -0 1e-7 <é>")
};
var report = new
{
    schemaVersion = 1,
    sdk = "10.0.201",
    runtime = Environment.Version.ToString(),
    sourceSha256 = Convert.ToHexString(SHA256.HashData(File.ReadAllBytes("Program.cs"))).ToLowerInvariant(),
    cases,
    controls
};
Console.WriteLine(JsonSerializer.Serialize(report, new JsonSerializerOptions { WriteIndented = true }));
