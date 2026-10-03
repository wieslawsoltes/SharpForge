using System.Collections;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text.Json;

if (args.Length != 1 || Environment.Version.ToString() != "10.0.5")
    throw new InvalidOperationException("Use runtime 10.0.5 and supply the output JSON path.");
CultureInfo.CurrentCulture = CultureInfo.InvariantCulture;
CultureInfo.CurrentUICulture = CultureInfo.InvariantCulture;
IComparer cmp = StringComparer.Ordinal;
object shared = new object();
var rows = new List<object>();
void Add(string id, string expression, Func<int> operation, bool sign = false, bool nativeOnly = false)
{
    int? value = null;
    string? error = null;
    string? inner = null;
    try { value = operation(); if (sign) value = Math.Sign(value.Value); }
    catch (Exception failure) { error = failure.GetType().Name; inner = failure.InnerException?.GetType().Name; }
    rows.Add(new { id, expression, sign, nativeOnly, value, error, inner });
}

Add("both-null", "cmp.Compare(null, null)", () => cmp.Compare(null, null), true);
Add("null-first", "cmp.Compare(null, \"\")", () => cmp.Compare(null, ""), true);
Add("null-second", "cmp.Compare(\"\", null)", () => cmp.Compare("", null), true);
Add("ordinal", "cmp.Compare(\"a\", \"A\")", () => cmp.Compare("a", "A"), true);
Add("ints", "cmp.Compare(1, 2)", () => cmp.Compare(1, 2), true);
Add("doubles", "cmp.Compare(1.5, 2.5)", () => cmp.Compare(1.5, 2.5), true);
Add("bools", "cmp.Compare(false, true)", () => cmp.Compare(false, true), true);
Add("different-boxes", "cmp.Compare(1, 1.0)", () => cmp.Compare(1, 1.0), true);
Add("number-string", "cmp.Compare(1, \"1\")", () => cmp.Compare(1, "1"), true);
Add("string-number", "cmp.Compare(\"1\", 1)", () => cmp.Compare("1", 1), true);
Add("opaque-same", "cmp.Compare(shared, shared)", () => cmp.Compare(shared, shared), true);
Add("opaque-distinct", "cmp.Compare(new object(), new object())", () => cmp.Compare(new object(), new object()), true);
Add("nan-equal", "cmp.Compare(double.NaN, double.NaN)", () => cmp.Compare(double.NaN, double.NaN), true);
Add("nan-first", "cmp.Compare(double.NaN, 0.0)", () => cmp.Compare(double.NaN, 0.0), true);
Add("signed-zero", "cmp.Compare(-0.0, 0.0)", () => cmp.Compare(-0.0, 0.0), true);

string?[] sorted = { null, "", "A", "a", "b" };
const string sourceArray = "(Array)new string[] {null, \"\", \"A\", \"a\", \"b\"}";
foreach (string? key in new string?[] { null, "", "0", "A", "B", "a", "aa", "b", "z" })
{
    string literal = key is null ? "null" : JsonSerializer.Serialize(key);
    Add("search-" + (key ?? "null"), $"Array.BinarySearch({sourceArray}, {literal}, cmp)",
        () => Array.BinarySearch((Array)sorted, key, cmp));
}
Add("empty", "Array.BinarySearch((Array)new string[] {}, 1, cmp)",
    () => Array.BinarySearch((Array)Array.Empty<string>(), 1, cmp));
Add("null-array", "Array.BinarySearch((Array)null, \"a\", cmp)",
    () => Array.BinarySearch((Array)null!, "a", cmp));
Add("int-array", "Array.BinarySearch((Array)new int[] {1, 2, 3}, 2, cmp)",
    () => Array.BinarySearch((Array)new int[] {1, 2, 3}, 2, cmp));
Add("boxed-array", "Array.BinarySearch((Array)new object[] {1, 2, 3}, 2, cmp)",
    () => Array.BinarySearch((Array)new object[] {1, 2, 3}, 2, cmp));
Add("mixed-search", "Array.BinarySearch((Array)new int[] {1, 2, 3}, 2.0, cmp)",
    () => Array.BinarySearch((Array)new int[] {1, 2, 3}, 2.0, cmp));
Add("string-search-number", "Array.BinarySearch((Array)new string[] {\"a\"}, 2, cmp)",
    () => Array.BinarySearch((Array)new string[] {"a"}, 2, cmp));
Add("opaque-search", "Array.BinarySearch((Array)new object[] {new object()}, new object(), cmp)",
    () => Array.BinarySearch((Array)new object[] {new object()}, new object(), cmp));
Add("null-comparer", "Array.BinarySearch((Array)new int[] {1, 2, 3}, 2, null)",
    () => Array.BinarySearch((Array)new int[] {1, 2, 3}, 2, null));
Add("rank-two", "Array.BinarySearch((Array)new int[,] {{1}}, 1, cmp)",
    () => Array.BinarySearch((Array)new int[,] {{1}}, 1, cmp), nativeOnly: true);

var result = new {
    sdk = "10.0.201", runtime = Environment.Version.ToString(),
    framework = RuntimeInformation.FrameworkDescription, os = RuntimeInformation.OSDescription,
    culture = CultureInfo.CurrentCulture.Name,
    sourceSha256 = Convert.ToHexStringLower(SHA256.HashData(File.ReadAllBytes("Program.cs"))),
    cases = rows
};
File.WriteAllText(args[0], JsonSerializer.Serialize(result, new JsonSerializerOptions { WriteIndented = true }));
