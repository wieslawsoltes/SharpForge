using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

if (args.Length != 1 || Environment.Version.ToString() != "10.0.5")
    throw new InvalidOperationException("Use .NET 10.0.5 and provide the output JSON path.");
CultureInfo.CurrentCulture = CultureInfo.InvariantCulture;
int[] Units(string value) => value.Select(unit => (int)unit).ToArray();
StringBuilder? Create(string[]? segments)
{
    if (segments == null) return null;
    var builder = new StringBuilder(1);
    foreach (var segment in segments) builder.Append(segment);
    return builder;
}
object? State(StringBuilder? builder)
{
    if (builder == null) return null;
    int chunks = 0;
    foreach (var chunk in builder.GetChunks()) chunks++;
    return new { text = Units(builder.ToString()), length = builder.Length,
        capacity = builder.Capacity, maxCapacity = builder.MaxCapacity, chunks };
}
var rows = new List<object>();
void Capture(string id, string[]? segments, int start, int length)
{
    var receiver = Create(segments);
    var before = State(receiver);
    bool? identity = null;
    string? fault = null, parameter = null;
    try
    {
        var result = receiver!.Remove(start, length);
        identity = ReferenceEquals(receiver, result);
    }
    catch (Exception error)
    {
        fault = error.GetType().Name;
        parameter = (error as ArgumentException)?.ParamName;
    }
    rows.Add(new { id, segments = segments?.Select(Units).ToArray(), start, length,
        before, identity, fault, parameter, after = State(receiver) });
}
var inputs = new (string Name, string[]? Segments)[] {
    ("null", null), ("empty", []), ("single", ["a"]), ("flat", ["abcde"]),
    ("chunks", ["aa", "b", "cde", "fg"]), ("raw", ["a\0\ud800", "\udc00b", "\uffffc"]),
    ("pair-cuts", ["\ud801", "\udc28", "a\ud801", "\udc28z"])
};
foreach (var (name, segments) in inputs)
{
    int size = segments?.Sum(segment => segment.Length) ?? 0;
    foreach (var (label, start, length) in new (string, int, int)[] {
        ("full", 0, size), ("zero", 0, 0), ("end-zero", size, 0),
        ("prefix", 0, Math.Min(1, size)), ("suffix", Math.Max(0, size - 1), Math.Min(1, size)),
        ("middle", Math.Min(1, size), Math.Max(0, size - 2)), ("end-one", size, 1),
        ("past-zero", size + 1, 0), ("negative-start", -1, 0), ("negative-length", 0, -1),
        ("both-negative", -1, -1), ("past-negative", size + 1, -1), ("too-long", 0, size + 1),
        ("minimum-start", int.MinValue, int.MaxValue), ("maximum-start", int.MaxValue, int.MinValue),
        ("maximum-start-zero", int.MaxValue, 0), ("maximum-length", 0, int.MaxValue),
        ("minimum-length", 0, int.MinValue), ("both-maximum", int.MaxValue, int.MaxValue),
        ("both-minimum", int.MinValue, int.MinValue)
    }) Capture(name + "-" + label, segments, start, length);
}
foreach (var (start, length) in new (int, int)[] { (0, 1), (1, 1), (2, 2), (3, 1), (4, 1), (1, 4), (0, 2), (3, 2) })
    Capture($"surrogate-cut-{start}-{length}", ["\ud801", "\udc28a\ud801", "\udc28z"], start, length);
Capture("many-chunks", Enumerable.Repeat("abc", 80).ToArray(), 2, 236);
Capture("cross-chunk-partial", ["abcd", "efg", "hijk"], 2, 7);
var source = Path.Combine(AppContext.BaseDirectory, "Program.cs");
var output = new { sdk = "10.0.201", runtime = Environment.Version.ToString(),
    sourceSha256 = Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(source))).ToLowerInvariant(), rows };
File.WriteAllText(args[0], JsonSerializer.Serialize(output, new JsonSerializerOptions { WriteIndented = true }) + "\n");
