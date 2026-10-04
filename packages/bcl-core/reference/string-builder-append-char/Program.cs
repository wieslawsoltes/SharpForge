using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

if (args.Length != 1 || Environment.Version.ToString() != "10.0.5")
    throw new InvalidOperationException("Use .NET 10.0.5 and provide the output JSON path.");
CultureInfo.CurrentCulture = CultureInfo.InvariantCulture;
var rows = new List<object>();
void Capture(string id, char value, int? repeatCount = null, string initial = "seed|", bool nullReceiver = false)
{
    StringBuilder? builder = nullReceiver ? null : new StringBuilder(initial);
    int? capacityBefore = builder?.Capacity;
    string? fault = null, parameter = null;
    bool? same = null;
    try
    {
        var returned = repeatCount.HasValue ? builder!.Append(value, repeatCount.Value) : builder!.Append(value);
        same = ReferenceEquals(builder, returned);
    }
    catch (Exception error)
    {
        fault = error.GetType().Name;
        parameter = (error as ArgumentException)?.ParamName;
    }
    rows.Add(new {
        id, value = (int)value, repeatCount, initial = initial.Select(unit => (int)unit).ToArray(), nullReceiver,
        output = builder?.ToString().Select(unit => (int)unit).ToArray(), length = builder?.Length,
        capacityBefore, capacity = builder?.Capacity, maxCapacity = builder?.MaxCapacity, same, fault, parameter
    });
}

foreach (var unit in new[] { 0, 10, 13, 65, 0xD7FF, 0xD800, 0xDBFF, 0xDC00, 0xDFFF, 0xE000, 0xFFFF })
    Capture("unit-" + unit, (char)unit);
foreach (var count in new[] { 0, 1, 2, 11, 12, 16, 17, 31, 32, 33, 64, 129 })
    Capture("repeat-" + count, 'A', count);
Capture("repeat-nul", '\0', 3);
Capture("repeat-high-surrogate", '\uD800', 3);
Capture("repeat-low-surrogate", '\uDC00', 3);
Capture("repeat-max-unit", '\uFFFF', 3);
Capture("negative-repeat", 'A', -1);
Capture("minimum-repeat", 'A', int.MinValue);
Capture("max-capacity-overflow", 'A', int.MaxValue);
Capture("null-single", 'A', nullReceiver: true);
Capture("null-zero", 'A', 0, nullReceiver: true);
Capture("null-negative", 'A', -1, nullReceiver: true);
Capture("empty-single", '\0', initial: "");
Capture("empty-zero", '\uD800', 0, initial: "");
Capture("empty-repeat", 'A', 17, initial: "");
Capture("split-surrogate", '\uDC00', initial: "\0\uD800");

var result = new {
    sdk = "10.0.201", runtime = Environment.Version.ToString(),
    sourceSha256 = Convert.ToHexStringLower(SHA256.HashData(File.ReadAllBytes("Program.cs"))), rows
};
File.WriteAllText(args[0], JsonSerializer.Serialize(result, new JsonSerializerOptions { WriteIndented = true }) + "\n");
