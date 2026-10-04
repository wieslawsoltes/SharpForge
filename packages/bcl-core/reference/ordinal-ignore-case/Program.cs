using System.Collections;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text.Json;

if (args.Length != 1 || Environment.Version.ToString() != "10.0.5")
    throw new InvalidOperationException("Use runtime 10.0.5 and supply the output JSON path.");
CultureInfo.CurrentCulture = CultureInfo.InvariantCulture;
CultureInfo.CurrentUICulture = CultureInfo.InvariantCulture;
var comparer = StringComparer.OrdinalIgnoreCase;

// This measures every scalar/simple-upper relation instead of assuming invariant casing is ordinal casing.
var upperRelations = new List<object>();
for (int point = 0; point <= 0x10FFFF; point++)
{
    string input = point <= char.MaxValue ? ((char)point).ToString() : char.ConvertFromUtf32(point);
    string upper = input.ToUpperInvariant();
    if (input == upper) continue;
    upperRelations.Add(new {
        point, upper = upper.Length == 1 ? upper[0] : char.ConvertToUtf32(upper, 0),
        sign = Math.Sign(comparer.Compare(input, upper)),
        prefixedSign = Math.Sign(comparer.Compare("a" + input, "A" + upper)),
        suffixedSign = Math.Sign(comparer.Compare(input + "a", upper + "A"))
    });
}

string?[] values = [
    null, "", "a", "A", "b", "B", "aa", "aA", "aB", "ab", "a\0b", "A\0B", "a\0", "A",
    "I", "i", "\u0130", "\u0131", "s", "S", "\u017F", "k", "K", "\u212A",
    "ß", "SS", "ss", "\u1E9E", "\uFB03", "ffi", "é", "É", "e\u0301", "E\u0301",
    "µ", "Μ", "μ", "Σ", "σ", "ς", "\u0345", "Ι", "\u1F80", "\u1F88", "\u1F00Ι",
    "\U00010428", "\U00010400", "\U00010429", "\U0001E922", "\U0001E900", "\U0001F600",
    "\uD800", "\uD801", "\uDFFF", "\uDC00", "\uE000", "\U00010000", "\U0010FFFF",
    "a\uD800b", "A\uD800B", "\uD801\uDC28x", "\uD801\uDC00X", "\uD801x", "\uD801X",
    "\uD801\uDC28\uDC00", "\uD801\uDC00\uDC00", "\uD801\uDC28", "\uD801",
    "\uD801\uD800", "\uD801\uDFFF", "\uD801\uDC00\0", "\uD801\uDC28\0",
    "\U00016EA0", "\U00016EBB", "\U00016EB8", "\U00016ED3", "\U00016EB9", "\U00016EBA",
    "\U00016ED4", "a\U00016EBB", "A\U00016EA0", "\U00016EBBa", "\U00016EA0A"
];
var signs = values.Select(left => values.Select(right => Math.Sign(comparer.Compare(left, right))).ToArray()).ToArray();
string?[] inputValues = ["z", "b", "A", "é", "\u017F", "\u0131", "ß", "\U00010428", "\uD800", "\uDFFF", null];
var list = new List<string?>(inputValues);
list.Sort(comparer);
var sorted = list.ToArray();
string?[] keys = [null, "", "a", "B", "C", "Z", "É", "S", "\u017F", "I", "\u0131", "SS", "ß", "\U00010400", "\uD800", "\uE000"];
IComparer objectComparer = comparer;
object shared = new object();
object?[] first = [null, "a", 1, 1, "a", shared, shared];
object?[] second = ["A", "A", 2, 1.0, 1, shared, new object()];
var objectRows = first.Select((value, index) => Outcome(() => objectComparer.Compare(value, second[index]))).ToArray();
var searchFault = Outcome(() => Array.BinarySearch((Array)new string[] { "a" }, 1, comparer));
var result = new {
    schemaVersion = 1, sdk = "10.0.201", runtime = Environment.Version.ToString(),
    os = RuntimeInformation.OSDescription, architecture = RuntimeInformation.ProcessArchitecture.ToString(),
    sourceSha256 = Convert.ToHexStringLower(SHA256.HashData(File.ReadAllBytes("Program.cs"))),
    scalarCount = 0x110000, upperRelations, values = values.Select(Units), signs,
    input = inputValues.Select(Units), sorted = sorted.Select(Units),
    searches = keys.Select(key => new { key = Units(key), index = Array.BinarySearch((Array)sorted, key, comparer) }),
    objectRows, searchFault,
    sameSingleton = ReferenceEquals(comparer, StringComparer.OrdinalIgnoreCase),
    distinctOrdinal = !ReferenceEquals(comparer, StringComparer.Ordinal)
};
File.WriteAllText(args[0], JsonSerializer.Serialize(result));

static int[]? Units(string? value) => value?.Select(unit => (int)unit).ToArray();

static object Outcome(Func<int> action)
{
    try { return new { sign = (int?)Math.Sign(action()), error = (string?)null, inner = (string?)null }; }
    catch (Exception error) { return new { sign = (int?)null, error = error.GetType().Name, inner = error.InnerException?.GetType().Name }; }
}
