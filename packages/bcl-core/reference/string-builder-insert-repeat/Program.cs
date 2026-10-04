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
void Capture(string id, string[]? segments, int index, string? value, int count)
{
    var receiver = Create(segments);
    var before = State(receiver);
    bool? identity = null;
    string? fault = null, parameter = null;
    try { identity = ReferenceEquals(receiver, receiver!.Insert(index, value, count)); }
    catch (Exception error)
    {
        fault = error.GetType().Name;
        parameter = (error as ArgumentException)?.ParamName;
    }
    rows.Add(new { id, capacity = 1, segments = segments?.Select(Units).ToArray(), index,
        value = value == null ? null : Units(value), count, before, identity, fault, parameter, after = State(receiver) });
}
var inputs = new (string Name, string[]? Segments)[] {
    ("null", null), ("empty", []), ("flat", ["ab"]), ("chunks", ["ab", "cd", "ef"]),
    ("raw", ["a\0", "\ud800", "\udc00z"])
};
foreach (var (name, segments) in inputs)
{
    int size = segments?.Sum(segment => segment.Length) ?? 0;
    foreach (var (label, value) in new (string, string?)[] { ("null-value", null), ("empty-value", ""), ("text-value", "x\0\ud800") })
    foreach (int count in new[] { 0, 1, 3 })
    foreach (var (position, index) in new (string, int)[] { ("zero", 0), ("middle", size / 2), ("end", size) })
        Capture($"{name}-{label}-{position}-{count}", segments, index, value, count);
}
foreach (var (name, segments) in new (string, string[]?)[] { ("null", null), ("empty", []), ("flat", ["ab"]) })
{
    int size = segments?.Sum(segment => segment.Length) ?? 0;
    foreach (var (label, value) in new (string, string?)[] { ("null-value", null), ("empty-value", ""), ("text-value", "x") })
    foreach (var (range, index, count) in new (string, int, int)[] {
        ("both-negative", -1, -1), ("negative-zero", -1, 0), ("past-one", size + 1, 1),
        ("negative-count", 0, -1), ("both-minimum", int.MinValue, int.MinValue), ("maximum-zero", int.MaxValue, 0)
    }) Capture(name + "-" + label + "-" + range, segments, index, value, count);
}
// Huge positive counts are used only with empty inputs or an index rejected before any repetition.
foreach (var (name, segments) in new (string, string[])[] { ("empty", []), ("flat", ["ab"]) })
{
    int size = segments.Sum(segment => segment.Length);
    foreach (var (label, value) in new (string, string?)[] { ("null-value", null), ("empty-value", "") })
    {
        Capture(name + "-" + label + "-maximum-count", segments, 0, value, int.MaxValue);
        Capture(name + "-" + label + "-past-maximum-count", segments, size + 1, value, int.MaxValue);
    }
    Capture(name + "-text-negative-maximum-count", segments, -1, "x", int.MaxValue);
    Capture(name + "-text-maximum-maximum-count", segments, int.MaxValue, "x", int.MaxValue);
}
Capture("repeat-seven", ["ab", "cd"], 2, "xy", 7);
Capture("repeat-seventeen", ["ab"], 1, "\0\ud800\udc00", 17);
Capture("split-pair-insertion", ["\ud801", "\udc28"], 1, "\udc00\ud800", 2);
Capture("literal-dollar", ["ab"], 1, "$&$1", 2);
Capture("many-segments", Enumerable.Repeat("ab", 32).ToArray(), 31, "z", 3);
int calls = 0;
StringBuilder Receiver(StringBuilder value) { calls = calls * 10 + 1; return value; }
int Index() { calls = calls * 10 + 2; return 1; }
string Value() { calls = calls * 10 + 3; return "xy"; }
int Count() { calls = calls * 10 + 4; return 2; }
var fluentBuilder = new StringBuilder("ab");
var fluentResult = Receiver(fluentBuilder).Insert(Index(), Value(), Count());
var fluent = new { calls, text = Units(fluentBuilder.ToString()), length = fluentBuilder.Length,
    identity = ReferenceEquals(fluentBuilder, fluentResult) };
var source = Path.Combine(AppContext.BaseDirectory, "Program.cs");
var output = new { sdk = "10.0.201", runtime = Environment.Version.ToString(),
    sourceSha256 = Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(source))).ToLowerInvariant(), rows, fluent };
File.WriteAllText(args[0], JsonSerializer.Serialize(output, new JsonSerializerOptions { WriteIndented = true }) + "\n");
