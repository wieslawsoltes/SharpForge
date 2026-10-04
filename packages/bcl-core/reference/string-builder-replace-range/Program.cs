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
void Capture(string id, string[]? segments, string? oldValue, string? newValue, int start, int count)
{
    var receiver = Create(segments);
    var before = State(receiver);
    bool? identity = null;
    string? fault = null, parameter = null;
    try
    {
        var result = receiver!.Replace(oldValue!, newValue, start, count);
        identity = ReferenceEquals(receiver, result);
    }
    catch (Exception error)
    {
        fault = error.GetType().Name;
        parameter = (error as ArgumentException)?.ParamName;
    }
    rows.Add(new { id, segments = segments?.Select(Units).ToArray(),
        oldValue = oldValue == null ? null : Units(oldValue), newValue = newValue == null ? null : Units(newValue),
        start, count, before, identity, fault, parameter, after = State(receiver) });
}
var inputs = new (string Name, string[] Segments)[] {
    ("empty", []), ("flat", ["abaaba"]), ("chunks", ["ab", "a", "ab", "a"]),
    ("raw", ["a\0", "b\ud800", "\udc00a", "\uffff"]), ("pair-cuts", ["\ud801", "\udc28", "x\ud801", "\udc28y"])
};
foreach (var (name, segments) in inputs)
{
    int size = segments.Sum(segment => segment.Length);
    foreach (var (label, oldValue, newValue) in new (string, string, string?)[] {
        ("replace", "a", "x"), ("delete", "a", null), ("grow", "a", "aa"), ("shrink", "aba", "Q"),
        ("same", "a", "a"), ("absent", "absent", "x"), ("nul", "\0", "$&"), ("low", "\udc28", "\ud800")
    })
    {
        Capture(name + "-full-" + label, segments, oldValue, newValue, 0, size);
        Capture(name + "-middle-" + label, segments, oldValue, newValue, Math.Min(1, size), Math.Max(0, size - 2));
        Capture(name + "-end-zero-" + label, segments, oldValue, newValue, size, 0);
    }
}
foreach (var (name, segments) in new (string, string[]?)[] { ("null", null), ("empty", []), ("flat", ["abcde"]) })
{
    int size = segments?.Sum(segment => segment.Length) ?? 0;
    foreach (var (oldLabel, oldValue) in new (string, string?)[] { ("null-old", null), ("empty-old", ""), ("text-old", "a") })
    foreach (var (label, start, count) in new (string, int, int)[] {
        ("both-negative", -1, -1), ("negative-start", -1, 0), ("negative-count", 0, -1),
        ("past-zero", size + 1, 0), ("past-negative", size + 1, -1), ("too-long", 0, size + 1),
        ("minimum-start", int.MinValue, int.MaxValue), ("maximum-start", int.MaxValue, int.MinValue),
        ("end-zero", size, 0), ("both-maximum", int.MaxValue, int.MaxValue)
    }) Capture(name + "-" + oldLabel + "-" + label, segments, oldValue, null, start, count);
}
Capture("overlap-full", ["aaaaa"], "aa", "X", 0, 5);
Capture("overlap-window", ["aaaaa"], "aa", "X", 1, 3);
Capture("inserted-text-not-searched", ["aa", "bb"], "a", "aaa", 0, 2);
Capture("literal-dollar-patterns", ["ab", "ab"], "ab", "$$$&$`$'", 0, 4);
Capture("literal-dollar-needle", ["$&", "$&x"], "$&", "$1", 0, 5);
Capture("match-start-before-window", ["abc", "abc"], "bc", "X", 2, 4);
Capture("match-end-after-window", ["abc", "abc"], "bc", "X", 0, 5);
Capture("cross-many-chunks", ["ab", "cd", "ef"], "bcde", "$&", 1, 4);
Capture("needle-longer-than-window", ["abc"], "bc", "x", 1, 1);
Capture("empty-replacement", ["aab", "aab"], "aa", "", 0, 6);
Capture("many-chunks", Enumerable.Repeat("aba", 80).ToArray(), "aba", "Q", 2, 236);
Capture("delete-full-split", ["ab", "cd", "ef"], "abcdef", null, 0, 6);
foreach (var (start, count) in new (int, int)[] { (0, 1), (1, 1), (2, 2), (3, 1), (4, 1), (1, 4), (0, 2), (3, 2) })
    Capture($"surrogate-cut-{start}-{count}", ["\ud801", "\udc28x\ud801", "\udc28y"], "\ud801\udc28", "\ud800", start, count);
var source = Path.Combine(AppContext.BaseDirectory, "Program.cs");
var output = new { sdk = "10.0.201", runtime = Environment.Version.ToString(),
    sourceSha256 = Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(source))).ToLowerInvariant(), rows };
File.WriteAllText(args[0], JsonSerializer.Serialize(output, new JsonSerializerOptions { WriteIndented = true }) + "\n");
