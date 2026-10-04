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
void Capture(string id, string[]? segments, char oldChar, char newChar, bool ranged = false, int start = 0, int count = 0)
{
    var receiver = Create(segments);
    var before = State(receiver);
    bool? identity = null;
    string? fault = null, parameter = null;
    try
    {
        var result = ranged ? receiver!.Replace(oldChar, newChar, start, count) : receiver!.Replace(oldChar, newChar);
        identity = ReferenceEquals(receiver, result);
    }
    catch (Exception error)
    {
        fault = error.GetType().Name;
        parameter = (error as ArgumentException)?.ParamName;
    }
    rows.Add(new { id, segments = segments?.Select(Units).ToArray(), oldChar = (int)oldChar,
        newChar = (int)newChar, ranged, start, count, before, identity, fault, parameter, after = State(receiver) });
}
var inputs = new (string Name, string[]? Segments)[] {
    ("null", null), ("empty", []), ("single", ["a"]), ("flat", ["ababa"]),
    ("chunks", ["aa", "b", "aba", "aa"]), ("raw", ["a\0\ud800", "\udc00a", "\uffffa"]),
    ("pair-cuts", ["\ud801", "\udc28", "a\ud801", "\udc28z"])
};
foreach (var (name, segments) in inputs)
{
    int length = segments?.Sum(segment => segment.Length) ?? 0;
    foreach (var (label, oldChar, newChar) in new (string, char, char)[] {
        ("replace", 'a', 'x'), ("identity", 'a', 'a'), ("absent", 'q', 'x'),
        ("zero", '\0', '\uffff'), ("high", '\ud801', '\ud800'), ("low", '\udc28', '\0')
    }) Capture(name + "-whole-" + label, segments, oldChar, newChar);
    foreach (var (label, start, count) in new (string, int, int)[] {
        ("full", 0, length), ("zero", 0, 0), ("end-zero", length, 0),
        ("middle", Math.Min(1, length), Math.Max(0, length - 2)),
        ("end-one", length, 1), ("past-zero", length + 1, 0),
        ("negative-start", -1, 0), ("negative-count", 0, -1), ("both-negative", -1, -1),
        ("past-negative", length + 1, -1), ("too-long", 0, length + 1),
        ("minimum-start", int.MinValue, int.MaxValue), ("maximum-start", int.MaxValue, int.MinValue),
        ("maximum-count", 0, int.MaxValue), ("minimum-count", 0, int.MinValue)
    })
    {
        Capture(name + "-range-" + label, segments, 'a', 'x', true, start, count);
        Capture(name + "-same-range-" + label, segments, 'a', 'a', true, start, count);
    }
}
foreach (var (start, count) in new (int, int)[] { (0, 1), (1, 1), (2, 2), (3, 1), (4, 1), (1, 4) })
{
    Capture($"cut-high-{start}-{count}", ["\ud801", "\udc28a\ud801", "\udc28z"], '\ud801', 'x', true, start, count);
    Capture($"cut-low-{start}-{count}", ["\ud801", "\udc28a\ud801", "\udc28z"], '\udc28', '\0', true, start, count);
}
Capture("many-chunks", Enumerable.Repeat("aba", 80).ToArray(), 'a', '\0', true, 2, 236);
Capture("cross-chunk-partial", ["baaa", "aab", "aaab"], 'a', 'b', true, 2, 7);
var source = Path.Combine(AppContext.BaseDirectory, "Program.cs");
var output = new { sdk = "10.0.201", runtime = Environment.Version.ToString(),
    sourceSha256 = Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(source))).ToLowerInvariant(), rows };
File.WriteAllText(args[0], JsonSerializer.Serialize(output, new JsonSerializerOptions { WriteIndented = true }) + "\n");
