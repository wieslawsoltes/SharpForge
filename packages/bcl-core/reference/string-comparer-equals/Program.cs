using System.Globalization;
using System.Security.Cryptography;
using System.Text.Json;

if (args.Length != 1 || Environment.Version.ToString() != "10.0.5")
    throw new InvalidOperationException("Use .NET 10.0.5 and provide the output JSON path.");
CultureInfo.CurrentCulture = CultureInfo.InvariantCulture;
int[]? Units(string? value) => value?.Select(unit => (int)unit).ToArray();
var rows = new List<object>();
void Capture(string id, string? first, string? second, int mode, bool factory,
    bool sameReference = false, bool copyValue = false, bool nullReceiver = false)
{
    if (sameReference) second = first;
    if (copyValue) second = new string(first!.ToCharArray());
    StringComparer? comparer = nullReceiver ? null : factory ? StringComparer.FromComparison((StringComparison)mode)
        : mode == 4 ? StringComparer.Ordinal : StringComparer.OrdinalIgnoreCase;
    bool? result = null;
    int? compareSign = null;
    string? fault = null, parameter = null;
    try
    {
        result = comparer!.Equals(first, second);
        compareSign = Math.Sign(comparer.Compare(first, second));
    }
    catch (Exception error)
    {
        fault = error.GetType().Name;
        parameter = (error as ArgumentException)?.ParamName;
    }
    rows.Add(new { id = id + "/" + mode + "/" + (factory ? "factory" : "getter"), mode, factory,
        first = Units(first), second = Units(second), sameReference, copyValue, nullReceiver,
        identity = ReferenceEquals(first, second), result, compareSign, fault, parameter });
}
var pairs = new (string Id, string? First, string? Second)[] {
    ("nulls", null, null), ("null-empty", null, ""), ("empty-null", "", null), ("empty", "", ""),
    ("same-text", "same", "same"), ("ascii-case", "a", "A"), ("ascii-different", "a", "b"),
    ("prefix", "abc", "ab"), ("suffix", "ab", "abc"), ("turkish-i", "I", "i"),
    ("turkish-dotless", "I", "\u0131"), ("turkish-dotted", "i", "\u0130"),
    ("sharp-s-expansion", "\u00df", "SS"), ("sharp-s-capital", "\u1e9e", "\u00df"),
    ("accent-case", "\u00e9", "\u00c9"), ("normalization", "\u00e9", "e\u0301"),
    ("greek-final", "\u03c2", "\u03a3"), ("greek-small", "\u03c3", "\u03a3"),
    ("greek-simple", "\u1f80", "\u1f88"), ("long-s", "\u017f", "S"),
    ("kelvin", "\u212a", "K"), ("ligature", "\ufb03", "FFI"),
    ("deseret", "\ud801\udc28", "\ud801\udc00"),
    ("garay", char.ConvertFromUtf32(0x16ebb), char.ConvertFromUtf32(0x16ea0)),
    ("high-same", "\ud801", "\ud801"), ("high-different", "\ud801", "\ud802"),
    ("low-same", "\udc28", "\udc28"), ("low-different", "\udc28", "\udc00"),
    ("pair-vs-bmp", "\ud801\udc28", "a"), ("reversed-pair", "\udc28\ud801", "\udc00\ud801"),
    ("high-boundary", "a\ud801", "A\ud801"), ("low-boundary", "\udc28a", "\udc28A"),
    ("pair-boundaries", "a\ud801\udc28z", "A\ud801\udc00Z"),
    ("different-pair-width", "\ud801\udc28", "\ud801"), ("embedded-null", "\0a", "\0A"),
    ("long-equal", new string('a', 128), new string('A', 128)),
    ("long-last-different", new string('a', 127) + "b", new string('A', 127) + "C"),
    ("long-length-different", new string('a', 128), new string('A', 127))
};
foreach (var mode in new[] { 4, 5 })
{
    foreach (var factory in new[] { false, true })
    {
        foreach (var pair in pairs) Capture(pair.Id, pair.First, pair.Second, mode, factory);
        Capture("shared-reference", new string('x', 5), null, mode, factory, sameReference: true);
        Capture("distinct-reference", new string('x', 5), null, mode, factory, copyValue: true);
        Capture("null-receiver-null-values", null, null, mode, factory, nullReceiver: true);
        Capture("null-receiver-equal-values", "a", "a", mode, factory, nullReceiver: true);
        Capture("null-receiver-different-length", "a", "", mode, factory, nullReceiver: true);
    }
}
var result = new {
    sdk = "10.0.201", runtime = Environment.Version.ToString(),
    sourceSha256 = Convert.ToHexStringLower(SHA256.HashData(File.ReadAllBytes("Program.cs"))), rows
};
File.WriteAllText(args[0], JsonSerializer.Serialize(result, new JsonSerializerOptions { WriteIndented = true }) + "\n");
