using System.Globalization;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text.Json;

if (args.Length != 1 || Environment.Version.ToString() != "10.0.5")
    throw new InvalidOperationException("Use runtime 10.0.5 and supply the output JSON path.");
CultureInfo.CurrentCulture = CultureInfo.InvariantCulture;
CultureInfo.CurrentUICulture = CultureInfo.InvariantCulture;

var cases = new List<(string Id, string? Left, int IndexA, string? Right, int IndexB, int Length)> {
    ("equal", "abc", 0, "abc", 0, 3),
    ("case", "abc", 0, "Abc", 0, 3),
    ("inside", "__abc_", 2, "_abd__", 1, 3),
    ("same-range", "abcdef", 2, "abcdef", 2, 3),
    ("same-string-different-offset", "abcabc", 0, "abcabc", 3, 3),
    ("zero", "abc", 1, "xyz", 2, 0),
    ("both-endpoints", "abc", 3, "abcdef", 6, 3),
    ("left-endpoint", "abc", 3, "abc", 1, 3),
    ("right-endpoint", "abc", 1, "abc", 3, 3),
    ("empty", "", 0, "", 0, 20),
    ("empty-left", "", 0, "abc", 0, 3),
    ("empty-right", "abc", 0, "", 0, 3),
    ("truncate-left", "ab", 0, "abcde", 0, 5),
    ("truncate-right", "abcde", 0, "ab", 0, 5),
    ("truncate-both", "abc", 1, "bc", 0, int.MaxValue),
    ("maximum-length", "abcdef", 2, "abcdeg", 2, int.MaxValue),
    ("ignore-before-after", "xabcq", 1, "yabcz", 1, 3),
    ("embedded-null", "a\0b", 0, "a\0c", 0, 3),
    ("null-unit-prefix", "a\0", 1, "", 0, 2),
    ("high-unit-difference", "\0", 0, "\uFFFF", 0, 1),
    ("decomposed", "é", 0, "e\u0301", 0, 2),
    ("surrogate-pair", "\uD83D\uDE00", 0, "\uD83D\uDE01", 0, 2),
    ("split-high", "\uD83D\uDE00", 0, "\uD83D\uDE01", 0, 1),
    ("split-low", "\uD83D\uDE00", 1, "\uD83D\uDE01", 1, 1),
    ("isolated-high-low", "x\uD800z", 1, "y\uDC00z", 1, 1),
    ("supplementary-vs-bmp", "\uD800\uDC00", 0, "\uE000", 0, 2),
    ("vector-prefix", "abcdefghijklmnopX", 0, "abcdefghijklmnopY", 0, 17),
    ("vector-offset", "xabcdefghijklmnopX", 1, "yyabcdefghijklmnopY", 2, 17),
    ("long-prefix-length", "abcdefghijklmnop", 0, "abcdefghijklmnopXYZ", 0, int.MaxValue),
    ("nulls-valid", null, 0, null, 0, 0),
    ("nulls-negative", null, -1, null, -1, -1),
    ("nulls-overflow", null, int.MaxValue, null, int.MaxValue, int.MinValue),
    ("null-left-negative", null, -1, "abc", -1, -1),
    ("null-right-negative", "abc", -1, null, -1, -1),
    ("null-left-overflow", null, int.MaxValue, "abc", int.MaxValue, int.MaxValue),
    ("null-right-overflow", "abc", int.MaxValue, null, int.MaxValue, int.MaxValue),
    ("null-left-empty", null, 0, "", 0, 0),
    ("null-right-empty", "", 0, null, 0, 0),
    ("negative-length", "abc", 0, "abc", 0, -1),
    ("minimum-length", "abc", 0, "abc", 0, int.MinValue),
    ("negative-first-index", "abc", -1, "abc", 0, 1),
    ("negative-second-index", "abc", 0, "abc", -1, 1),
    ("minimum-first-index", "abc", int.MinValue, "abc", 0, 1),
    ("minimum-second-index", "abc", 0, "abc", int.MinValue, 1),
    ("first-past-end", "abc", 4, "abc", 0, 1),
    ("second-past-end", "abc", 0, "abc", 4, 1),
    ("first-maximum-index", "abc", int.MaxValue, "abc", 0, int.MaxValue),
    ("second-maximum-index", "abc", 0, "abc", int.MaxValue, int.MaxValue),
    ("zero-first-past-end", "abc", 4, "abc", 0, 0),
    ("zero-second-past-end", "abc", 0, "abc", 4, 0),
    ("zero-negative-first", "abc", -1, "abc", 0, 0),
    ("zero-negative-second", "abc", 0, "abc", -1, 0),
    ("equal-invalid", "abc", 4, "abc", 4, 1),
    ("equal-negative", "abc", -1, "abc", -1, 1),
    ("length-before-indices", "abc", -1, "abc", -1, -1),
    ("negative-second-before-first-bounds", "abc", 4, "abc", -1, 1),
    ("first-negative-before-second-bounds", "abc", -1, "abc", 4, 1),
    ("empty-past-end", "", 1, "", 0, 0),
    ("latin-case-offset", "xéclair", 1, "yyÉCLAIR", 2, 6),
    ("sigma-offset", "x\u03C2\u03C3", 1, "y\u03A3\u03A3", 1, 2),
    ("long-s", "x\u017F", 1, "yS", 1, 1),
    ("dotless-i", "x\u0131", 1, "yI", 1, 1),
    ("dotted-i", "x\u0130", 1, "yi", 1, 1),
    ("sharp-s-expansion", "xß", 1, "ySS", 1, 2),
    ("sharp-s-capital", "xß", 1, "y\u1E9E", 1, 1),
    ("kelvin", "x\u212A", 1, "yk", 1, 1),
    ("deseret", "x\U00010428z", 1, "yy\U00010400Z", 2, 3),
    ("osage", "x\U000104D8", 1, "y\U000104B0", 1, 2),
    ("garay", "x\U00016EBB", 1, "y\U00016EA0", 1, 2),
    ("folded-clipped-left", "xabc", 1, "yABCDEF", 1, int.MaxValue),
    ("folded-clipped-right", "xabcdef", 1, "yABC", 1, int.MaxValue),
    ("folded-clipped-both", "xabc", 1, "yyABC", 2, int.MaxValue),
    ("allocated-equal", "abc", 0, new string("abc".AsSpan()), 0, 3),
    ("allocated-equal-invalid", "abc", 4, new string("abc".AsSpan()), 4, 1),
    ("surrogate-cut-left", "x\uD801\uDC28", 1, "y\uD801", 1, 1),
    ("surrogate-cut-right", "x\uD801", 1, "y\uD801\uDC00", 1, 1),
    ("surrogate-cut-both", "x\uD801\uDC28", 1, "y\uD801\uDC00", 1, 1),
    ("surrogate-start-low-left", "x\uD801\uDC28a", 2, "y\uDC28A", 1, 2),
    ("surrogate-start-low-right", "x\uDC28a", 1, "y\uD801\uDC28A", 2, 2),
    ("unequal-extent-pair-left", "x\U00010000", 1, "y\uD800", 1, 2),
    ("unequal-extent-pair-right", "x\uD800", 1, "y\U00010000", 1, 2),
    ("scalar-vs-bmp", "x\U00010000", 1, "y\uE000", 1, 2),
    ("bmp-vs-scalar", "x\uE000", 1, "y\U00010000", 1, 2),
    ("bounded-nul-case", "xa\0Bz", 1, "yA\0bq", 1, 3)
};
foreach (var length in new[] { 7, 15, 31 }) {
    var lower = new string('a', length);
    var upper = new string('A', length);
    cases.Add(("prefix-cut-" + length, "x" + lower + "\uD801\uDC28", 1,
        "yy" + upper + "\uD801\uDC00", 2, length + 1));
    cases.Add(("suffix-cut-" + length, "x\uD801\uDC28" + lower, 2,
        "yy\uD801\uDC28" + upper, 3, length + 1));
}

(string Id, string? Left, int IndexA, string? Right, int IndexB, int Length)[] precedence = [
    ("nulls-valid", null, 0, null, 0, 0),
    ("nulls-invalid-range", null, -1, null, int.MaxValue, -1),
    ("null-left-invalid-range", null, -1, "abc", int.MaxValue, -1),
    ("null-right-invalid-range", "abc", int.MaxValue, null, -1, -1),
    ("identity", "abc", 0, "abc", 0, 3),
    ("allocated-equal", "abc", 0, new string("abc".AsSpan()), 0, 3),
    ("identity-invalid-range", "abc", -1, "abc", -1, -1),
    ("zero-valid", "abc", 1, "xyz", 2, 0),
    ("zero-invalid-range", "abc", 4, "xyz", 0, 0),
    ("length-before-indices", "abc", -1, "abc", -1, -1),
    ("negative-indexB-before-indexA-bounds", "abc", 4, "abc", -1, 1),
    ("indexA-bounds-before-indexB-bounds", "abc", 4, "abc", 4, 1),
    ("normal-difference", "abc", 0, "abd", 0, 3),
    ("unequal-clipped", "abc", 1, "BCDE", 0, int.MaxValue)
];
var rows = new List<object>();
int[]? Units(string? value) => value?.Select(unit => (int)unit).ToArray();
void Capture((string Id, string? Left, int IndexA, string? Right, int IndexB, int Length) pair, int mode, string group)
{
    int? result = null;
    string? fault = null;
    string? parameter = null;
    try { result = string.Compare(pair.Left, pair.IndexA, pair.Right, pair.IndexB, pair.Length, (StringComparison)mode); }
    catch (Exception error) {
        fault = error.GetType().Name;
        parameter = (error as ArgumentException)?.ParamName;
    }
    rows.Add(new {
        id = group + "/" + pair.Id + "/" + mode, group,
        left = Units(pair.Left), indexA = pair.IndexA, right = Units(pair.Right), indexB = pair.IndexB,
        length = pair.Length, mode, sameReference = ReferenceEquals(pair.Left, pair.Right),
        copyRight = pair.Left != null && pair.Left == pair.Right && !ReferenceEquals(pair.Left, pair.Right),
        result, sign = result.HasValue ? (int?)Math.Sign(result.Value) : null, fault, parameter
    });
}
foreach (var pair in cases)
    foreach (var mode in new[] { 4, 5 }) Capture(pair, mode, "ordinal");
foreach (var pair in precedence)
    foreach (var mode in new[] { -1, 6, int.MinValue, int.MaxValue }) Capture(pair, mode, "invalid");
foreach (var pair in precedence)
    foreach (var mode in new[] { 0, 1, 2, 3 }) Capture(pair, mode, "culture");

var capture = new {
    schemaVersion = 1, sdk = "10.0.201", runtime = Environment.Version.ToString(),
    os = RuntimeInformation.OSDescription, architecture = RuntimeInformation.ProcessArchitecture.ToString(),
    culture = CultureInfo.CurrentCulture.Name,
    sourceSha256 = Convert.ToHexStringLower(SHA256.HashData(File.ReadAllBytes("Program.cs"))), rows
};
File.WriteAllText(args[0], JsonSerializer.Serialize(capture, new JsonSerializerOptions { WriteIndented = true }));
