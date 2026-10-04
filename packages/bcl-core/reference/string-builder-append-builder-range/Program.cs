using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

if (args.Length != 1 || Environment.Version.ToString() != "10.0.5")
    throw new InvalidOperationException("Use .NET 10.0.5 and provide the output JSON path.");
CultureInfo.CurrentCulture = CultureInfo.InvariantCulture;
var rows = new List<object>();
StringBuilder Create(string[] segments)
{
    var builder = new StringBuilder();
    foreach (var segment in segments) builder.Append(segment);
    return builder;
}
int[]? Units(string? value) => value?.Select(unit => (int)unit).ToArray();
void Capture(string id, string[] destination, string[]? source, int startIndex, int count,
    bool self = false, bool nullReceiver = false)
{
    StringBuilder? builder = nullReceiver ? null : Create(destination);
    StringBuilder? input = self ? builder : source == null ? null : Create(source);
    var sourceBefore = Units(input?.ToString());
    string? fault = null, parameter = null;
    bool? same = null;
    try { same = ReferenceEquals(builder, builder!.Append(input, startIndex, count)); }
    catch (Exception error)
    {
        fault = error.GetType().Name;
        parameter = (error as ArgumentException)?.ParamName;
    }
    rows.Add(new {
        id, destination = destination.Select(Units).ToArray(), source = source?.Select(Units).ToArray(),
        startIndex, count, self, nullReceiver, sourceBefore, sourceOutput = Units(input?.ToString()),
        output = Units(builder?.ToString()), length = builder?.Length, same, fault, parameter
    });
}

var ranges = new (int Start, int Count)[] {
    (-1, -1), (int.MinValue, 0), (0, int.MinValue), (0, -1), (1, -1),
    (0, 0), (1, 0), (8, 0), (9, 0), (int.MaxValue, 0),
    (0, 1), (1, 1), (6, 2), (8, 1), (0, int.MaxValue), (int.MaxValue, int.MaxValue)
};
string[]?[] values = [null, [], ["A", "\0", "\uD800", "\uDC00", "\uD800x", "\uDC00Z"]];
for (int valueIndex = 0; valueIndex < values.Length; valueIndex++)
    for (int rangeIndex = 0; rangeIndex < ranges.Length; rangeIndex++)
        Capture($"value-{valueIndex}-range-{rangeIndex}", ["seed|"], values[valueIndex],
            ranges[rangeIndex].Start, ranges[rangeIndex].Count);
Capture("complete-units", ["s", "e", "ed|"], values[2], 0, 8);
Capture("nul-and-pair", [], values[2], 1, 3);
Capture("isolated-high", ["\uDC00"], values[2], 4, 1);
Capture("isolated-low", ["\uD800"], values[2], 6, 1);
Capture("moderate-chunk-boundaries", ["seed|"], [new string('x', 17), new string('y', 33), new string('z', 15)], 16, 35);
Capture("many-segments", ["seed|"], Enumerable.Range(0, 128).Select(i => ((char)(65 + i % 26)).ToString()).ToArray(), 31, 65);
Capture("empty-segments", [], ["", "", "abc", ""], 1, 2);
Capture("self-empty", [], null, 0, 0, true);
Capture("self-empty-past-end", [], null, 1, 0, true);
Capture("self-full", ["a", "b", "c"], null, 0, 3, true);
Capture("self-middle", ["ab", "cd", "ef"], null, 1, 4, true);
Capture("self-tail", ["ab", "cd", "ef"], null, 5, 1, true);
Capture("self-units", values[2]!, null, 1, 6, true);
Capture("self-end-zero", ["abc"], null, 3, 0, true);
Capture("self-past-end-zero", ["abc"], null, 4, 0, true);
Capture("self-invalid", ["abc"], null, -1, -1, true);
Capture("null-receiver-null-zero", [], null, 0, 0, nullReceiver: true);
Capture("null-receiver-invalid", [], null, -1, -1, nullReceiver: true);
Capture("null-receiver-valid", [], ["abc"], 1, 1, nullReceiver: true);
Capture("null-receiver-self", [], null, 0, 0, self: true, nullReceiver: true);

var result = new {
    sdk = "10.0.201", runtime = Environment.Version.ToString(),
    sourceSha256 = Convert.ToHexStringLower(SHA256.HashData(File.ReadAllBytes("Program.cs"))), rows
};
File.WriteAllText(args[0], JsonSerializer.Serialize(result, new JsonSerializerOptions { WriteIndented = true }) + "\n");
