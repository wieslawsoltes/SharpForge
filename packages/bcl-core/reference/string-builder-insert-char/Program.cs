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
void Capture(string id, string[]? segments, int index, char value, int capacity = 16, int? sourceIndex = null)
{
    var receiver = Create(segments, capacity);
    var before = State(receiver);
    bool? identity = null;
    string? fault = null, parameter = null;
    try
    {
        // The aliased char argument is evaluated once before Insert mutates the same builder.
        var alias = receiver;
        var result = sourceIndex.HasValue ? receiver!.Insert(index, alias![sourceIndex.Value]) : receiver!.Insert(index, value);
        identity = ReferenceEquals(receiver, result);
    }
    catch (Exception error)
    {
        fault = error.GetType().Name;
        parameter = (error as ArgumentException)?.ParamName;
    }
    rows.Add(new { id, segments = segments?.Select(Units).ToArray(), capacity, index,
        value = (int)value, sourceIndex, before, identity, fault, parameter, after = State(receiver) });
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
    foreach (var value in new char[] { '\0', 'A', '\ud800' })
        Capture($"{name}-{label}-{(int)value}", segments, index, value);
}
foreach (int index in new int[] { 0, 1, 2, 3 })
foreach (char value in new char[] { '\udc00', '\uffff', '$' })
    Capture($"pair-{index}-{(int)value}", ["\ud801", "\udc28z"], index, value);
Capture("alias-own-char", ["ab", "cd"], 0, '\0', sourceIndex: 2);
Capture("alias-invalid-getter-first", ["ab"], -1, '\0', sourceIndex: 2);
Capture("capacity-growth-middle", [new string('a', 16)], 8, 'x');
Capture("capacity-growth-end", [new string('a', 16)], 16, '\0');
Capture("many-chunks", Enumerable.Repeat("ab", 32).ToArray(), 31, '\ud800', 64);
var source = Path.Combine(AppContext.BaseDirectory, "Program.cs");
var output = new { sdk = "10.0.201", runtime = Environment.Version.ToString(),
    sourceSha256 = Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(source))).ToLowerInvariant(), rows };
File.WriteAllText(args[0], JsonSerializer.Serialize(output, new JsonSerializerOptions { WriteIndented = true }) + "\n");
