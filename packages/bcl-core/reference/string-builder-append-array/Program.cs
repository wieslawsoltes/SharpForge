using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

if (args.Length != 1 || Environment.Version.ToString() != "10.0.5")
    throw new InvalidOperationException("Use .NET 10.0.5 and provide the output JSON path.");
CultureInfo.CurrentCulture = CultureInfo.InvariantCulture;
var rows = new List<object>();
void Capture(string id, char[]? value, int? startIndex = null, int? count = null,
    bool nullReceiver = false, string initial = "seed|")
{
    StringBuilder? builder = nullReceiver ? null : new StringBuilder(initial);
    string? fault = null, parameter = null;
    bool? same = null;
    try
    {
        var returned = startIndex.HasValue ? builder!.Append(value, startIndex.Value, count!.Value) : builder!.Append(value);
        same = ReferenceEquals(builder, returned);
    }
    catch (Exception error)
    {
        fault = error.GetType().Name;
        parameter = (error as ArgumentException)?.ParamName;
    }
    rows.Add(new {
        id, value = value?.Select(unit => (int)unit).ToArray(), startIndex, count, nullReceiver,
        initial = initial.Select(unit => (int)unit).ToArray(),
        output = builder?.ToString().Select(unit => (int)unit).ToArray(), length = builder?.Length,
        same, fault, parameter
    });
}

var ranges = new (int Start, int Count)[] {
    (-1, -1), (int.MinValue, 0), (0, int.MinValue), (0, -1),
    (0, 0), (1, 0), (int.MaxValue, 0), (0, 1), (1, 1),
    (8, 0), (8, 1), (9, 0), (0, int.MaxValue), (int.MaxValue, int.MaxValue)
};
char[]?[] values = [null, [], "A\0\uD800\uDC00\uD800x\uDC00Z".ToCharArray()];
for (int valueIndex = 0; valueIndex < values.Length; valueIndex++)
    for (int rangeIndex = 0; rangeIndex < ranges.Length; rangeIndex++)
        Capture($"value-{valueIndex}-range-{rangeIndex}", values[valueIndex], ranges[rangeIndex].Start, ranges[rangeIndex].Count);
Capture("complete-units", values[2], 0, 8);
Capture("nul-and-pair", values[2], 1, 3);
Capture("paired-high-only", values[2], 2, 1);
Capture("paired-low-only", values[2], 3, 1);
Capture("isolated-high", values[2], 4, 1);
Capture("isolated-low", values[2], 6, 1);
Capture("final-unit", values[2], 7, 1);
Capture("moderate-slice", new string('x', 129).ToCharArray(), 31, 65);
Capture("full-null", null);
Capture("full-empty", []);
Capture("full-units", values[2]);
Capture("full-moderate", new string('x', 129).ToCharArray());
Capture("full-empty-builder", values[2], initial: "");
Capture("null-receiver-full-null", null, nullReceiver: true);
Capture("null-receiver-full-units", values[2], nullReceiver: true);
Capture("null-receiver-null-zero", null, 0, 0, true);
Capture("null-receiver-negative", null, -1, -1, true);
Capture("null-receiver-valid", values[2], 1, 1, true);
Capture("null-receiver-invalid", values[2], int.MaxValue, int.MaxValue, true);

var result = new {
    sdk = "10.0.201", runtime = Environment.Version.ToString(),
    sourceSha256 = Convert.ToHexStringLower(SHA256.HashData(File.ReadAllBytes("Program.cs"))), rows
};
File.WriteAllText(args[0], JsonSerializer.Serialize(result, new JsonSerializerOptions { WriteIndented = true }) + "\n");
