using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

if (args.Length != 1 || Environment.Version.ToString() != "10.0.5")
    throw new InvalidOperationException("Use .NET 10.0.5 and provide the output JSON path.");
CultureInfo.CurrentCulture = CultureInfo.InvariantCulture;
var rows = new List<object>();
void Capture(string id, (int Source, int? Length, int Destination, int Count) range, bool nullReceiver = false, bool empty = false)
{
    var segments = empty ? Array.Empty<string>() : new[] { "ab", "\0", "\uD800", "cd\uDC00" };
    StringBuilder? builder = nullReceiver ? null : new StringBuilder();
    if (builder is not null) foreach (var segment in segments) builder.Append(segment);
    char[]? destination = range.Length.HasValue ? Enumerable.Repeat('.', range.Length.Value).ToArray() : null;
    string? fault = null, parameter = null;
    try { builder!.CopyTo(range.Source, destination!, range.Destination, range.Count); }
    catch (Exception error)
    {
        fault = error.GetType().Name;
        parameter = (error as ArgumentException)?.ParamName;
    }
    rows.Add(new {
        id, sourceIndex = range.Source, destinationLength = range.Length,
        destinationIndex = range.Destination, count = range.Count, nullReceiver,
        segments = segments.Select(segment => segment.Select(unit => (int)unit).ToArray()).ToArray(),
        output = destination?.Select(unit => (int)unit).ToArray(),
        builder = builder?.ToString().Select(unit => (int)unit).ToArray(),
        length = builder?.Length, capacity = builder?.Capacity, fault, parameter
    });
}

var cases = new (int Source, int? Length, int Destination, int Count)[] {
    (0, 9, 1, 7), (2, 9, 3, 4), (3, 9, 1, 1), (6, 9, 0, 1),
    (7, 9, 9, 0), (7, 9, 0, 0), (0, 9, 9, 0), (0, 0, 0, 0),
    (-1, 9, 0, 0), (0, 9, -1, 0), (0, 9, 0, -1),
    (int.MinValue, 9, 0, 0), (0, 9, int.MinValue, 0), (0, 9, 0, int.MinValue),
    (int.MaxValue, 9, 0, 0), (0, 9, int.MaxValue, 0), (0, 9, 0, int.MaxValue),
    (8, 9, 0, 0), (6, 9, 0, 2), (0, 9, 8, 2), (0, 0, 0, 1),
    (-1, 9, -1, -1), (-1, 9, 0, -1), (0, 9, -1, -1),
    (8, 9, -1, 1), (-1, 9, 10, 1), (6, 9, 8, 2),
    (-1, 0, 0, 1), (8, 9, 10, 0), (8, 9, 0, int.MaxValue),
    (0, null, 0, 0), (-1, null, -1, -1), (int.MaxValue, null, int.MaxValue, int.MaxValue)
};
for (var index = 0; index < cases.Length; index++) Capture("range-" + index, cases[index]);
foreach (var source in new[] { -1, 0, 1 })
    foreach (var count in new[] { -1, 0, 1 }) Capture("empty-" + source + "-" + count, (source, 0, 0, count), empty: true);
Capture("empty-destination-space", (0, 9, 9, 0), empty: true);
Capture("null-receiver-valid-range", (0, 9, 0, 1), nullReceiver: true);
Capture("null-receiver-null-destination", (0, null, 0, 0), nullReceiver: true);
Capture("null-receiver-negative-ranges", (-1, null, -1, -1), nullReceiver: true);
Capture("null-receiver-large-ranges", (int.MaxValue, 0, int.MaxValue, int.MaxValue), nullReceiver: true);

var result = new {
    sdk = "10.0.201", runtime = Environment.Version.ToString(),
    sourceSha256 = Convert.ToHexStringLower(SHA256.HashData(File.ReadAllBytes("Program.cs"))), rows
};
File.WriteAllText(args[0], JsonSerializer.Serialize(result, new JsonSerializerOptions { WriteIndented = true }) + "\n");
