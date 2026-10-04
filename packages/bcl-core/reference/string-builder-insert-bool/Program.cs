using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

if (args.Length != 1 || Environment.Version.ToString() != "10.0.5")
    throw new InvalidOperationException("Use .NET 10.0.5 and provide the output JSON path.");
CultureInfo.CurrentCulture = CultureInfo.InvariantCulture;
int[] Units(string value) => value.Select(unit => (int)unit).ToArray();
StringBuilder? Create(string[]? segments, int capacity)
{
    if (segments == null) return null;
    var builder = new StringBuilder(capacity);
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
void Capture(string id, string[]? segments, int index, bool value, int capacity = 16, int? sourceIndex = null)
{
    var receiver = Create(segments, capacity);
    var before = State(receiver);
    bool? identity = null;
    string? fault = null, parameter = null;
    try
    {
        var alias = receiver;
        var result = sourceIndex.HasValue
            ? receiver!.Insert(index, alias![sourceIndex.Value] != '\0')
            : receiver!.Insert(index, value);
        identity = ReferenceEquals(receiver, result);
    }
    catch (Exception error)
    {
        fault = error.GetType().Name;
        parameter = (error as ArgumentException)?.ParamName;
    }
    rows.Add(new { id, culture = CultureInfo.CurrentCulture.Name, segments = segments?.Select(Units).ToArray(),
        capacity, index, value, sourceIndex, before, identity, fault, parameter, after = State(receiver) });
}
var inputs = new (string Name, string[]? Segments)[] {
    ("null", null), ("empty", []), ("flat", ["aba"]), ("chunks", ["ab", "\0\ud801", "\udc28z"])
};
foreach (var (name, segments) in inputs)
{
    int length = segments?.Sum(segment => segment.Length) ?? 0;
    foreach (var (label, index) in new (string, int)[] {
        ("minimum", int.MinValue), ("negative", -1), ("zero", 0), ("middle", Math.Min(1, length)),
        ("end", length), ("past", length + 1), ("maximum", int.MaxValue)
    })
    foreach (bool value in new[] { false, true }) Capture($"{name}-{label}-{value}", segments, index, value);
}
foreach (bool value in new[] { false, true })
{
    Capture($"capacity-middle-{value}", [new string('a', 16)], 8, value);
    Capture($"capacity-end-{value}", [new string('a', 16)], 16, value);
    Capture($"many-segments-{value}", Enumerable.Repeat("ab", 32).ToArray(), 31, value, 64);
}
Capture("alias-own-true", ["ab", "\0d"], 0, false, sourceIndex: 1);
Capture("alias-own-false", ["ab", "\0d"], 1, true, sourceIndex: 2);
Capture("alias-invalid-getter-first", ["ab"], -1, false, sourceIndex: 2);
foreach (string culture in new[] { "", "fr-FR", "tr-TR" })
{
    CultureInfo.CurrentCulture = CultureInfo.GetCultureInfo(culture);
    foreach (bool value in new[] { false, true }) Capture($"culture-{culture}-{value}", ["a", "b"], 1, value);
}
CultureInfo.CurrentCulture = CultureInfo.InvariantCulture;
int calls = 0;
StringBuilder Receiver(StringBuilder value) { calls = calls * 10 + 1; return value; }
int Index() { calls = calls * 10 + 2; return 1; }
bool Value() { calls = calls * 10 + 3; return true; }
var fluentBuilder = new StringBuilder("ab");
var returned = Receiver(fluentBuilder).Insert(Index(), Value()).Insert(0, false).Insert(0, '!').Insert(0, "|");
var fluent = new { calls, text = Units(fluentBuilder.ToString()), length = fluentBuilder.Length,
    identity = ReferenceEquals(fluentBuilder, returned) };
var source = Path.Combine(AppContext.BaseDirectory, "Program.cs");
var output = new { sdk = "10.0.201", runtime = Environment.Version.ToString(),
    sourceSha256 = Convert.ToHexStringLower(SHA256.HashData(File.ReadAllBytes(source))), rows, fluent };
File.WriteAllText(args[0], JsonSerializer.Serialize(output, new JsonSerializerOptions { WriteIndented = true }) + "\n");
