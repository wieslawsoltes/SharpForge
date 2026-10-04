using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

if (args.Length != 1 || Environment.Version.ToString() != "10.0.5")
    throw new InvalidOperationException("Use .NET 10.0.5 and provide the output JSON path.");
CultureInfo.CurrentCulture = CultureInfo.InvariantCulture;
var rows = new List<object>();
const string initial = "seed|";
void Capture(string id, string? value, int startIndex, int count, bool nullReceiver = false)
{
    StringBuilder? builder = nullReceiver ? null : new StringBuilder(initial);
    string? fault = null, parameter = null;
    bool? same = null;
    try
    {
        var returned = builder!.Append(value, startIndex, count);
        same = ReferenceEquals(builder, returned);
    }
    catch (Exception error)
    {
        fault = error.GetType().Name;
        parameter = (error as ArgumentException)?.ParamName;
    }
    rows.Add(new {
        id, value = value?.Select(unit => (int)unit).ToArray(), startIndex, count, nullReceiver,
        output = builder?.ToString().Select(unit => (int)unit).ToArray(), length = builder?.Length,
        same, fault, parameter
    });
}

var ranges = new (int Start, int Count)[] {
    (-1, -1), (int.MinValue, 0), (0, int.MinValue), (0, -1),
    (0, 0), (1, 0), (int.MaxValue, 0), (0, 1), (1, 1),
    (6, 2), (8, 0), (8, 1), (0, int.MaxValue), (int.MaxValue, int.MaxValue)
};
string?[] values = [null, "", "A\0\uD800\uDC00\uD800x\uDC00Z"];
for (int valueIndex = 0; valueIndex < values.Length; valueIndex++)
    for (int rangeIndex = 0; rangeIndex < ranges.Length; rangeIndex++)
        Capture($"value-{valueIndex}-range-{rangeIndex}", values[valueIndex], ranges[rangeIndex].Start, ranges[rangeIndex].Count);
Capture("complete-units", values[2], 0, 8);
Capture("nul-and-pair", values[2], 1, 3);
Capture("isolated-high", values[2], 4, 1);
Capture("isolated-low", values[2], 6, 1);
Capture("past-end-zero", values[2], 9, 0);
Capture("moderate-chunk", new string('x', 129), 31, 65);
Capture("null-receiver-null-zero", null, 0, 0, true);
Capture("null-receiver-negative", null, -1, -1, true);
Capture("null-receiver-valid", "abc", 1, 1, true);
Capture("null-receiver-invalid", "abc", int.MaxValue, int.MaxValue, true);

var result = new {
    sdk = "10.0.201", runtime = Environment.Version.ToString(), initial,
    sourceSha256 = Convert.ToHexStringLower(SHA256.HashData(File.ReadAllBytes("Program.cs"))), rows
};
File.WriteAllText(args[0], JsonSerializer.Serialize(result, new JsonSerializerOptions { WriteIndented = true }) + "\n");
