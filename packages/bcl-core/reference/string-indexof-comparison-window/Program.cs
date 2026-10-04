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
    ("first", "abcdef", "abc", false),
    ("middle", "abcdef", "bcd", false),
    ("last", "abcdef", "def", false),
    ("absent", "abcdef", "abd", false),
    ("longer-value", "abc", "abcd", false),
    ("overlap", "abababc", "ababc", false),
    ("overlap-miss", "ababab", "abac", false),
    ("case-first", "AbCdef", "aBc", false),
    ("case-middle", "abcDeFghi", "CdEf", false),
    ("case-last", "abcDeF", "dEf", false),
    ("latin-middle", "xcaféz", "FÉ", false),
    ("non-ascii-first", "xéaBz", "ÉAb", false),
    ("sigma", "x\u03C2\u03C3z", "\u03A3\u03A3", false),
    ("long-s", "x\u017Fz", "S", false),
    ("long-s-reverse", "xSz", "\u017F", false),
    ("turkish-dotless", "x\u0131z", "I", false),
    ("turkish-dotted", "x\u0130z", "i", false),
    ("kelvin", "x\u212Az", "k", false),
    ("sharp-s-expansion", "xßz", "SS", false),
    ("garay", "x\U00016EBBz", "\U00016EA0", false),
    ("deseret-middle", "x\U00010428z", "\U00010400", false),
    ("osage-middle", "x\U000104D8z", "\U000104B0", false),
    ("embedded-null", "xa\0Bz", "A\0b", false),
    ("nul-significant", "xa\0bz", "ab", false),
    ("nul-only", "a\0b", "\0", false),
    ("normalization", "xéz", "e\u0301", false),
    ("lone-high-equal", "\uD800", "\uD800", true),
    ("lone-high-different", "\uD800", "\uD801", false),
    ("lone-low-case", "x\uDC00az", "\uDC00A", false),
    ("malformed-middle", "x\uD800a\uDC00z", "\uD800A\uDC00", false),
    ("pair-high-cut", "x\uD801\uDC28z", "\uD801", false),
    ("pair-low-cut", "x\uD801\uDC28z", "\uDC28", false),
    ("both-cuts", "x\uD801\uDC28a\uD801\uDC28z", "\uDC28A\uD801", false),
    ("high-cut-before-case", "x\uD801\uDC28az", "\uD801A", false),
    ("malformed-needle", "x\uD801\uDC28z", "\uD801x", false),
    ("malformed-body", "x\uD801a\uDC28z", "\uD801\uDC28", false),
    ("retry-after-pair", "\uD801\uDC28\uDC28a", "\uDC28A", false),
    ("case-pair-followed-by-ascii", "x\U00010428az", "\U00010400A", false),
    ("ascii-followed-by-case-pair", "xa\U00010428z", "A\U00010400", false)
};
foreach (var length in new[] { 7, 15, 31 }) {
    var lower = new string('a', length);
    var upper = new string('A', length);
    pairs.Add(("end-split-" + length, "x" + lower + "\uD801\uDC28z", upper + "\uD801", false));
    pairs.Add(("start-split-" + length, "x\uD801\uDC28" + lower + "z", "\uDC28" + upper, false));
    pairs.Add(("both-split-" + length, "x\uD801\uDC28" + lower + "\uD801\uDC28z", "\uDC28" + upper + "\uD801", false));
}
pairs.Add(("repeated-ascii-miss", new string('a', 128), new string('A', 31) + "B", false));
pairs.Add(("repeated-ascii-late", new string('a', 128) + "b", new string('A', 31) + "B", false));
pairs.Add(("repeated-unicode-miss", new string('é', 128), new string('É', 31) + "B", false));
pairs.Add(("repeated-unicode-late", new string('é', 128) + "b", new string('É', 31) + "B", false));

pairs.Add(("first-of-many", "abcABCabc", "abc", false));
pairs.Add(("first-folded-before-exact", "AbCabCabc", "abc", false));
pairs.Add(("overlapping-first", "aaaaa", "aaa", false));
pairs.Add(("overlapping-folded-first", "aAaAa", "AaA", false));
pairs.Add(("supplementary-prefix-offset", "\U0001F600\U0001F601abcABC", "abc", false));
pairs.Add(("supplementary-prefix-folded", "\U0001F600\U0001F601AbCabc", "abc", false));
pairs.Add(("supplementary-needle-first", "xx\U00010428\U00010400", "\U00010400", false));
pairs.Add(("low-half-first", "\U00010428\uDC28", "\uDC28", false));
pairs.Add(("high-half-first", "x\U00010428\uD801", "\uD801", false));
pairs.Add(("retry-low-half-offset", "x\U00010428\uDC28a", "\uDC28A", false));
pairs.Add(("nul-first-offset", "x\0y\0z", "\0", false));
pairs.Add(("miss-after-pair-prefix", "\U0001F600abc", "abcd", false));

(string Id, string? Receiver, string? Value, bool CopyValue)[] precedence = [
    ("nulls", null, null, false),
    ("null-receiver", null, "a", false),
    ("null-value", "a", null, false),
    ("empty-receiver-null-value", "", null, false),
    ("identity", "same", "same", false),
    ("empty-value", "a", "", false),
    ("empty-both", "", "", false),
    ("longer-value", "a", "abc", false)
];
var rows = new List<object>();
int[]? Units(string? value) => value?.Select(unit => (int)unit).ToArray();
void Capture((string Id, string? Receiver, string? Value, bool CopyValue) pair, int mode, string group, int startIndex = 0, int? requestedCount = null)
{
    var value = pair.CopyValue && pair.Value != null ? new string(pair.Value.AsSpan()) : pair.Value;
    var count = requestedCount ?? ((pair.Receiver?.Length ?? 0) - startIndex);
    int? result = null;
    bool? contains = null;
    string? fault = null;
    string? parameter = null;
    try {
        result = pair.Receiver!.IndexOf(value!, startIndex, count, (StringComparison)mode);
        contains = pair.Receiver.Contains(value!, (StringComparison)mode);
    }
    catch (Exception error) {
        fault = error.GetType().Name;
        parameter = (error as ArgumentException)?.ParamName;
    }
    rows.Add(new {
        id = group + "/" + pair.Id + "/" + startIndex + "/" + count + "/" + mode, group, startIndex, count,
        receiver = Units(pair.Receiver), value = Units(value), mode,
        copyValue = pair.CopyValue, sameReference = ReferenceEquals(pair.Receiver, value), result, contains, fault, parameter
    });
}

foreach (var pair in pairs)
    foreach (var mode in new[] { 4, 5 }) Capture(pair, mode, "ordinal");
foreach (var pair in precedence)
    foreach (var mode in new[] { -1, 6, int.MinValue, int.MaxValue, 0, 1, 2, 3, 4, 5 }) Capture(pair, mode, "precedence");

(string Id, string? Receiver, string? Value, int Start, int Count)[] ranges = [
    ("nulls", null, null, -1, -1),
    ("null-receiver", null, "x", int.MinValue, int.MaxValue),
    ("null-value", "abc", null, -1, -1),
    ("null-value-end", "abc", null, 3, 0),
    ("start-negative", "abc", "", -1, -1),
    ("start-minimum", "abc", "", int.MinValue, 0),
    ("start-beyond", "abc", "", 4, -1),
    ("start-maximum", "abc", "", int.MaxValue, int.MaxValue),
    ("count-negative", "abc", "", 0, -1),
    ("count-minimum", "abc", "", 0, int.MinValue),
    ("count-beyond", "abc", "", 1, 3),
    ("count-maximum", "abc", "", 0, int.MaxValue),
    ("end-count-beyond", "abc", "", 3, 1),
    ("empty-end", "abc", "", 3, 0),
    ("empty-middle", "abc", "", 1, 0),
    ("empty-both", "", "", 0, 0),
    ("empty-body-invalid-start", "", "", -1, 0),
    ("empty-body-invalid-count", "", "", 0, 1),
    ("identity-zero-count", "same", "same", 0, 0),
    ("identity-short-count", "same", "same", 0, 3),
    ("identity-invalid-count", "same", "same", 0, -1),
    ("longer-value", "abc", "abc", 1, 1)
];
foreach (var row in ranges)
    foreach (var mode in new[] { -1, 6, int.MinValue, int.MaxValue, 0, 1, 2, 3, 4, 5 })
        Capture((row.Id, row.Receiver, row.Value, false), mode, "range-precedence", row.Start, row.Count);

(string Id, string Receiver, string Value)[] windows = [
    ("repeated", "abcABCabc", "abc"),
    ("overlap", "aAaAa", "AaA"),
    ("empty", "abc", ""),
    ("empty-body", "", "a"),
    ("nul", "x\0y\0z", "\0"),
    ("pair-fold", "x\U00010428z", "\U00010400"),
    ("pair-high", "x\U00010428z", "\uD801"),
    ("pair-low", "x\U00010428z", "\uDC28"),
    ("both-cuts", "x\U00010428a\U00010428z", "\uDC28A\uD801"),
    ("malformed", "\uD800a\uDC00", "\uD800A\uDC00")
];
foreach (var row in windows)
    for (var start = 0; start <= row.Receiver.Length; start++)
        for (var count = 0; count <= row.Receiver.Length - start; count++)
            foreach (var mode in new[] { 4, 5 })
                Capture((row.Id, row.Receiver, row.Value, false), mode, "window", start, count);
foreach (var length in new[] { 6, 7, 31 }) {
    var receiver = "x\U00010428" + new string('é', length) + "\U00010428z";
    var value = "\uDC28" + new string('É', length) + "\uD801";
    foreach (var start in new[] { 0, 1, 2, 3 })
        foreach (var end in new[] { receiver.Length - 3, receiver.Length - 2, receiver.Length - 1, receiver.Length })
            foreach (var mode in new[] { 4, 5 })
                Capture(("long-both-cuts-" + length, receiver, value, false), mode, "window", start, end - start);
}
foreach (var letter in new[] { 'a', 'é' }) {
    var receiver = new string(letter, 128) + "b" + new string(letter, 64) + "b";
    var value = new string(char.ToUpperInvariant(letter), 31) + "B";
    foreach (var start in new[] { 0, 64, 97, 98, 129 })
        foreach (var end in new[] { 128, 129, receiver.Length })
            if (start <= end)
                foreach (var mode in new[] { 4, 5 })
                    Capture(("periodic-" + (int)letter, receiver, value, false), mode, "window", start, end - start);
}

var capture = new {
    schemaVersion = 1, sdk = "10.0.201", runtime = Environment.Version.ToString(),
    os = RuntimeInformation.OSDescription, architecture = RuntimeInformation.ProcessArchitecture.ToString(),
    culture = CultureInfo.CurrentCulture.Name,
    sourceSha256 = Convert.ToHexStringLower(SHA256.HashData(File.ReadAllBytes("Program.cs"))), rows
};
File.WriteAllText(args[0], JsonSerializer.Serialize(capture, new JsonSerializerOptions { WriteIndented = true }));
