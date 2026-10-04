using System.Globalization;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text.Json;

if (args.Length != 1 || Environment.Version.ToString() != "10.0.5")
    throw new InvalidOperationException("Use runtime 10.0.5 and supply the output JSON path.");
CultureInfo.CurrentCulture = CultureInfo.InvariantCulture;
CultureInfo.CurrentUICulture = CultureInfo.InvariantCulture;
(string Id, string? Left, int IndexA, string? Right, int IndexB, int Length)[] cases = [
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
    ("empty-past-end", "", 1, "", 0, 0)
];

int[]? Units(string? value) => value?.Select(unit => (int)unit).ToArray();
var rows = cases.Select(row => {
    int? result = null;
    string? fault = null;
    string? parameter = null;
    try { result = string.CompareOrdinal(row.Left, row.IndexA, row.Right, row.IndexB, row.Length); }
    catch (ArgumentException error) { fault = error.GetType().Name; parameter = error.ParamName; }
    return new { id = row.Id, left = Units(row.Left), indexA = row.IndexA, right = Units(row.Right), indexB = row.IndexB,
        length = row.Length, result, sign = result.HasValue ? Math.Sign(result.Value) : (int?)null, fault, parameter };
}).ToArray();
var capture = new {
    schemaVersion = 1, sdk = "10.0.201", runtime = Environment.Version.ToString(),
    os = RuntimeInformation.OSDescription, architecture = RuntimeInformation.ProcessArchitecture.ToString(),
    sourceSha256 = Convert.ToHexStringLower(SHA256.HashData(File.ReadAllBytes("Program.cs"))), rows
};
File.WriteAllText(args[0], JsonSerializer.Serialize(capture, new JsonSerializerOptions { WriteIndented = true }));
