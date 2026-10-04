using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

if (args.Length != 1 || Environment.Version.ToString() != "10.0.5")
    throw new InvalidOperationException("Use .NET 10.0.5 and provide the output JSON path.");
CultureInfo.CurrentCulture = CultureInfo.InvariantCulture;
var rows = new List<object>();
void Capture(string id, bool write, int index, char value, string[]? segments)
{
    StringBuilder? builder = segments is null ? null : new StringBuilder();
    if (segments is not null) foreach (var segment in segments) builder!.Append(segment);
    string? fault = null, parameter = null;
    int? result = null;
    int? capacityBefore = builder?.Capacity;
    try
    {
        if (write) builder![index] = value;
        else result = builder![index];
    }
    catch (Exception error)
    {
        fault = error.GetType().Name;
        parameter = (error as ArgumentException)?.ParamName;
    }
    rows.Add(new {
        id, write, index, value = (int)value,
        segments = segments?.Select(segment => segment.Select(unit => (int)unit).ToArray()).ToArray(),
        result, output = builder?.ToString().Select(unit => (int)unit).ToArray(),
        length = builder?.Length, capacityBefore, capacity = builder?.Capacity,
        maxCapacity = builder?.MaxCapacity, fault, parameter
    });
}

var segments = new[] { "ab", "\0", "\uD800", "cd\uDC00" };
foreach (var write in new[] { false, true })
{
    var operation = write ? "set" : "get";
    foreach (var index in new[] { int.MinValue, -1, 0, 1, 2, 3, 4, 5, 6, 7, int.MaxValue })
        Capture(operation + "-index-" + index, write, index, 'Z', segments);
    foreach (var index in new[] { -1, 0, 1 })
        Capture(operation + "-empty-" + index, write, index, 'A', Array.Empty<string>());
    foreach (var index in new[] { -1, 0, int.MaxValue })
        Capture(operation + "-null-" + index, write, index, 'A', null);
}
foreach (var value in new[] { 0, 10, 13, 0xD7FF, 0xD800, 0xDBFF, 0xDC00, 0xDFFF, 0xFFFF })
    Capture("set-unit-" + value, true, 2, (char)value, segments);
Capture("set-same-unit", true, 0, 'a', segments);

var result = new {
    sdk = "10.0.201", runtime = Environment.Version.ToString(),
    sourceSha256 = Convert.ToHexStringLower(SHA256.HashData(File.ReadAllBytes("Program.cs"))), rows
};
File.WriteAllText(args[0], JsonSerializer.Serialize(result, new JsonSerializerOptions { WriteIndented = true }) + "\n");
