using System.Globalization;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text.Json;

if (args.Length != 1 || Environment.Version.ToString() != "10.0.5")
    throw new InvalidOperationException("Use runtime 10.0.5 and supply the output JSON path.");
CultureInfo.CurrentCulture = CultureInfo.InvariantCulture;
CultureInfo.CurrentUICulture = CultureInfo.InvariantCulture;

var pairs = new List<(string Id, string? Receiver, string? Value, bool CopyValue)> {
    ("empty", "", "", false),
    ("empty-value", "abc", "", false),
    ("empty-receiver", "", "a", false),
    ("identity", "same", "same", false),
    ("allocated-equal", "same", "same", true),
    ("ascii-prefix", "abcdef", "abc", false),
    ("ascii-suffix", "abcdef", "def", false),
    ("ascii-different", "abcdef", "abd", false),
    ("longer-value", "abc", "abcd", false),
    ("case-prefix", "AbCdef", "aBc", false),
    ("case-suffix", "abcDeF", "dEf", false),
    ("latin-prefix", "éclair", "É", false),
    ("latin-suffix", "café", "É", false),
    ("sigma", "\u03C2\u03C3", "\u03A3", false),
    ("long-s", "\u017F", "S", false),
    ("turkish-dotless", "\u0131", "I", false),
    ("turkish-dotted", "\u0130", "i", false),
    ("sharp-s-expansion", "ß", "SS", false),
    ("garay", "\U00016EBB", "\U00016EA0", false),
    ("deseret-prefix", "\U00010428x", "\U00010400", false),
    ("osage-suffix", "x\U000104D8", "\U000104B0", false),
    ("embedded-null", "a\0B", "A\0b", false),
    ("nul-significant", "a\0b", "ab", false),
    ("normalization", "é", "e\u0301", false),
    ("lone-high-equal", "\uD800", "\uD800", true),
    ("lone-high-different", "\uD800", "\uD801", false),
    ("lone-low-case", "\uDC00a", "\uDC00A", false),
    ("malformed-prefix", "\uD800a\uDC00x", "\uD800A\uDC00", false),
    ("malformed-suffix", "x\uD800a\uDC00", "\uD800A\uDC00", false),
    ("pair-versus-split", "\uD800\uDC00", "\uD800x\uDC00", false)
};
foreach (var length in new[] { 7, 15, 31 }) {
    var lower = new string('a', length);
    var upper = new string('A', length);
    pairs.Add(("prefix-split-" + length, lower + "\uD801\uDC28", upper + "\uD801", false));
    pairs.Add(("suffix-split-" + length, "\uD801\uDC28" + lower, "\uDC28" + upper, false));
}

(string Id, string? Receiver, string? Value, bool CopyValue)[] precedence = [
    ("nulls", null, null, false),
    ("null-receiver", null, "a", false),
    ("null-value", "a", null, false),
    ("identity", "same", "same", false),
    ("empty-value", "a", "", false),
    ("longer-value", "a", "abc", false)
];
var rows = new List<object>();
int[]? Units(string? value) => value?.Select(unit => (int)unit).ToArray();
void Capture((string Id, string? Receiver, string? Value, bool CopyValue) pair, int mode, string method, string group)
{
    var value = pair.CopyValue && pair.Value != null ? new string(pair.Value.AsSpan()) : pair.Value;
    bool? result = null;
    string? fault = null;
    string? parameter = null;
    try {
        result = method == "StartsWith" ? pair.Receiver!.StartsWith(value!, (StringComparison)mode)
            : pair.Receiver!.EndsWith(value!, (StringComparison)mode);
    }
    catch (Exception error) {
        fault = error.GetType().Name;
        parameter = (error as ArgumentException)?.ParamName;
    }
    rows.Add(new {
        id = group + "/" + pair.Id + "/" + mode + "/" + method,
        group, method, receiver = Units(pair.Receiver), value = Units(value), mode,
        copyValue = pair.CopyValue, sameReference = ReferenceEquals(pair.Receiver, value), result, fault, parameter
    });
}

foreach (var pair in pairs)
    foreach (var mode in new[] { 4, 5 })
        foreach (var method in new[] { "StartsWith", "EndsWith" }) Capture(pair, mode, method, "ordinal");
foreach (var pair in precedence)
    foreach (var mode in new[] { -1, 6, int.MinValue, int.MaxValue, 0, 1, 2, 3, 4, 5 })
        foreach (var method in new[] { "StartsWith", "EndsWith" }) Capture(pair, mode, method, "precedence");

var capture = new {
    schemaVersion = 1, sdk = "10.0.201", runtime = Environment.Version.ToString(),
    os = RuntimeInformation.OSDescription, architecture = RuntimeInformation.ProcessArchitecture.ToString(),
    culture = CultureInfo.CurrentCulture.Name,
    sourceSha256 = Convert.ToHexStringLower(SHA256.HashData(File.ReadAllBytes("Program.cs"))), rows
};
File.WriteAllText(args[0], JsonSerializer.Serialize(capture, new JsonSerializerOptions { WriteIndented = true }));
