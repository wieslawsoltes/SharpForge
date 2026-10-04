using System.Globalization;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text.Json;

if (args.Length != 1 || Environment.Version.ToString() != "10.0.5")
    throw new InvalidOperationException("Use runtime 10.0.5 and supply the output JSON path.");
CultureInfo.CurrentCulture = CultureInfo.InvariantCulture;
CultureInfo.CurrentUICulture = CultureInfo.InvariantCulture;

(string Id, string? Left, string? Right, bool CopyRight)[] pairs = [
    ("nulls", null, null, false),
    ("null-left", null, "", false),
    ("null-right", "", null, false),
    ("empty", "", "", false),
    ("identity", "same", "same", false),
    ("allocated-equal", "same", "same", true),
    ("ascii-case", "AbC", "aBc", false),
    ("ascii-different", "abc", "abd", false),
    ("different-length", "abc", "abcd", false),
    ("nul-case", "a\0B", "A\0b", false),
    ("nul-significant", "a\0b", "ab", false),
    ("normalization", "é", "e\u0301", false),
    ("latin-case", "é", "É", false),
    ("long-s", "\u017F", "S", false),
    ("sigma", "\u03C2", "\u03C3", false),
    ("turkish-dotless", "\u0131", "I", false),
    ("turkish-dotted", "\u0130", "i", false),
    ("sharp-s-expansion", "ß", "SS", false),
    ("sharp-s-capital", "ß", "\u1E9E", false),
    ("kelvin", "\u212A", "k", false),
    ("deseret", "\U00010428", "\U00010400", false),
    ("osage", "\U000104D8", "\U000104B0", false),
    ("garay", "\U00016EBB", "\U00016EA0", false),
    ("supplementary-different", "\U0001F600", "\U0001F601", false),
    ("lone-high-equal", "\uD800", "\uD800", true),
    ("lone-high-different", "\uD800", "\uD801", false),
    ("lone-low-case", "\uDC00a", "\uDC00A", false),
    ("split-surrogates", "\uD800a\uDC00", "\uD800A\uDC00", false),
    ("pair-versus-split", "\uD800\uDC00", "\uD800x\uDC00", false),
    ("vector-prefix", "abcdefghijklmnopQ", "ABCDEFGHIJKLMNOPq", false),
    ("vector-different", "abcdefghijklmnopQ", "ABCDEFGHIJKLMNOPx", false),
    ("ascii-reverse", "abd", "abc", false),
    ("prefix-reverse", "abcd", "abc", false),
    ("bmp-versus-pair", "\uE000", "\U00010000", false),
    ("pair-versus-bmp", "\U00010000", "\uE000", false),
    ("pair-versus-high", "\U00010000", "\uD801", false),
    ("high-versus-pair", "\uD801", "\U00010000", false)
];

(string Id, string? Left, string? Right, bool CopyRight)[] precedence = [
    ("nulls", null, null, false),
    ("null-left", null, "abc", false),
    ("null-right", "abc", null, false),
    ("identity", "same", "same", false),
    ("allocated-equal", "same", "same", true),
    ("different-length", "a", "abc", false)
];
var rows = new List<object>();
int[]? Units(string? value) => value?.Select(unit => (int)unit).ToArray();
void Capture((string Id, string? Left, string? Right, bool CopyRight) pair, int mode, string group)
{
    var right = pair.CopyRight && pair.Right != null ? new string(pair.Right.AsSpan()) : pair.Right;
    int? result = null;
    string? fault = null;
    string? parameter = null;
    try {
        result = string.Compare(pair.Left, right, (StringComparison)mode);
    }
    catch (Exception error) {
        fault = error.GetType().Name;
        parameter = (error as ArgumentException)?.ParamName;
    }
    rows.Add(new {
        id = group + "/" + pair.Id + "/" + mode,
        group, left = Units(pair.Left), right = Units(right), mode,
        copyRight = pair.CopyRight, sameReference = ReferenceEquals(pair.Left, right), result,
        sign = result.HasValue ? (int?)Math.Sign(result.Value) : null, fault, parameter
    });
}

foreach (var pair in pairs)
    foreach (var mode in new[] { 4, 5 })
        Capture(pair, mode, "ordinal");
foreach (var pair in precedence)
    foreach (var mode in new[] { -1, 6, int.MinValue, int.MaxValue })
        Capture(pair, mode, "invalid");
foreach (var pair in precedence)
    foreach (var mode in new[] { 0, 1, 2, 3 })
        Capture(pair, mode, "culture");

var capture = new {
    schemaVersion = 1, sdk = "10.0.201", runtime = Environment.Version.ToString(),
    os = RuntimeInformation.OSDescription, architecture = RuntimeInformation.ProcessArchitecture.ToString(),
    culture = CultureInfo.CurrentCulture.Name,
    sourceSha256 = Convert.ToHexStringLower(SHA256.HashData(File.ReadAllBytes("Program.cs"))), rows
};
File.WriteAllText(args[0], JsonSerializer.Serialize(capture, new JsonSerializerOptions { WriteIndented = true }));
