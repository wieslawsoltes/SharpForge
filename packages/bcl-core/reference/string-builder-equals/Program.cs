using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

if (args.Length != 1 || Environment.Version.ToString() != "10.0.5")
    throw new InvalidOperationException("Use .NET 10.0.5 and provide the output JSON path.");
CultureInfo.CurrentCulture = CultureInfo.InvariantCulture;
int[]? Units(string? value) => value?.Select(unit => (int)unit).ToArray();
StringBuilder? Create(Plan? plan)
{
    if (plan == null) return null;
    var builder = plan.MaxCapacity.HasValue ? new StringBuilder(plan.Capacity, plan.MaxCapacity.Value)
        : new StringBuilder(plan.Capacity);
    if (plan.ClearFirst) builder.Append("discarded history\ud800\udc00").Clear();
    foreach (var segment in plan.Segments) builder.Append(segment);
    if (plan.Length.HasValue) builder.Length = plan.Length.Value;
    return builder;
}
object? Input(Plan? plan) => plan == null ? null : new {
    segments = plan.Segments.Select(Units).ToArray(), capacity = plan.Capacity,
    maxCapacity = plan.MaxCapacity, clearFirst = plan.ClearFirst, length = plan.Length
};
object? State(StringBuilder? builder)
{
    if (builder == null) return null;
    int chunks = 0;
    foreach (var chunk in builder.GetChunks()) chunks++;
    return new { text = Units(builder.ToString()), length = builder.Length, capacity = builder.Capacity,
        maxCapacity = builder.MaxCapacity, chunks };
}
var rows = new List<object>();
void Capture(string id, Plan? first, Plan? second, bool self = false)
{
    var receiver = Create(first);
    var other = self ? receiver : Create(second);
    var beforeFirst = State(receiver);
    var beforeSecond = State(other);
    bool? result = null, objectResult = null;
    string? fault = null;
    try { result = receiver!.Equals(other); }
    catch (Exception error) { fault = error.GetType().Name; }
    if (receiver != null) objectResult = ((object)receiver).Equals(other);
    rows.Add(new { id, first = Input(first), second = Input(second), self,
        nativeOnly = first?.MaxCapacity != null || second?.MaxCapacity != null,
        identity = ReferenceEquals(receiver, other), beforeFirst, beforeSecond,
        result, objectResult, fault, afterFirst = State(receiver), afterSecond = State(other) });
}
Capture("null-both", null, null);
Capture("null-empty", null, new Plan([]));
Capture("null-text", null, new Plan(["abc"]));
Capture("null-self", null, null, self: true);
Capture("empty-null", new Plan([]), null);
Capture("text-null", new Plan(["abc"]), null);
Capture("empty", new Plan([]), new Plan([]));
Capture("empty-capacities", new Plan([], 1), new Plan([], 4096));
Capture("self-empty", new Plan([]), null, self: true);
Capture("self-segments", new Plan(["a", "\ud800", "\udc00", "z"], 1), null, self: true);
Capture("same-single", new Plan(["abc"]), new Plan(["abc"]));
Capture("same-segments", new Plan(["a", "b", "c"], 1), new Plan(["abc"], 64));
Capture("same-different-segments", new Plan(["ab", "cd", "ef"], 1), new Plan(["a", "bcde", "f"], 2));
Capture("empty-segments", new Plan(["", "a", "", "b", ""]), new Plan(["ab"]));
Capture("different-case", new Plan(["a"]), new Plan(["A"]));
Capture("different-length", new Plan(["ab"]), new Plan(["abc"]));
Capture("different-first", new Plan(["xbc"]), new Plan(["abc"]));
Capture("different-middle", new Plan(["a", "x", "c"], 1), new Plan(["abc"]));
Capture("different-last", new Plan(["abx"]), new Plan(["abc"]));
Capture("embedded-null", new Plan(["a", "\0", "b"]), new Plan(["a\0b"]));
Capture("surrogate-split", new Plan(["a\ud801", "\udc28z"], 1), new Plan(["a\ud801\udc28z"]));
Capture("surrogate-case", new Plan(["\ud801", "\udc28"], 1), new Plan(["\ud801\udc00"]));
Capture("isolated-high", new Plan(["\ud801", "a"], 1), new Plan(["\ud801a"]));
Capture("isolated-low", new Plan(["a", "\udc28"], 1), new Plan(["a\udc28"]));
Capture("reversed-pair", new Plan(["\udc28", "\ud801"], 1), new Plan(["\udc28\ud801"]));
Capture("normalization", new Plan(["\u00e9"]), new Plan(["e", "\u0301"]));
Capture("clear-history", new Plan(["ab", "c"], 1, ClearFirst: true), new Plan(["abc"], 128));
Capture("truncate-history", new Plan(["abc", "discarded"], 1, Length: 3), new Plan(["abc"]));
Capture("length-growth", new Plan(["a"], 1, Length: 3), new Plan(["a\0\0"], 32));
Capture("same-capacity-different", new Plan(["abc"], 3), new Plan(["abc"], 4096));
Capture("many-segments", new Plan(Enumerable.Repeat("ab", 80).ToArray(), 1), new Plan([string.Concat(Enumerable.Repeat("ab", 80))], 512));
Capture("different-max-capacity", new Plan(["abc"], 8, 16), new Plan(["abc"], 8, 32));
Capture("different-all-capacities", new Plan(["a", "bc"], 4, 16), new Plan(["abc"], 12, 128));
Capture("empty-max-capacity", new Plan([], 1, 1), new Plan([], 8, 32));
Capture("max-capacity-different-text", new Plan(["abc"], 4, 16), new Plan(["abd"], 4, 32));

var result = new {
    sdk = "10.0.201", runtime = Environment.Version.ToString(),
    sourceSha256 = Convert.ToHexStringLower(SHA256.HashData(File.ReadAllBytes("Program.cs"))), rows
};
File.WriteAllText(args[0], JsonSerializer.Serialize(result, new JsonSerializerOptions { WriteIndented = true }) + "\n");

record Plan(string[] Segments, int Capacity = 16, int? MaxCapacity = null, bool ClearFirst = false, int? Length = null);
