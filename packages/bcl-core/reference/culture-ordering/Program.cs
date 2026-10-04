using System.Globalization;
using System.Runtime.InteropServices;
using System.Text.Json;

if (Environment.Version.ToString() != "10.0.5")
    throw new InvalidOperationException("Culture capture requires CoreCLR 10.0.5.");
if (args.Length != 1) throw new ArgumentException("Pass the output JSON path.");

CultureInfo.CurrentCulture = CultureInfo.InvariantCulture;
CultureInfo.CurrentUICulture = CultureInfo.InvariantCulture;
var compareInfo = CultureInfo.InvariantCulture.CompareInfo;
if (compareInfo.Compare("a", "A", CompareOptions.None) >= 0)
    throw new InvalidOperationException("Capture requires linguistic invariant culture, not invariant globalization mode.");

// UTF-16 units preserve isolated surrogates without JSON encoder replacement.
string?[] values = [
    null, "", "a", "A", "b", "B", "aa", "aA", "Aa", "AA", "ab", "aB", "Ab", "AB",
    "0", "00", "01", "1", "10", "2", "9", "a1", "a10", "a2",
    " ", "!", "'", "-", ".", "_", "a-b", "ab", "a'b", "a b", "a.b", "a_b",
    "\0", "\t", "\n", "a\0b", "a\u00ADb", "\u00AD", "\u200B", "\uFEFF",
    "e", "E", "é", "É", "e\u0301", "E\u0301", "è", "ê", "ë", "résumé", "resume",
    "ß", "ss", "SS", "æ", "ae", "œ", "oe", "\uFB03", "ffi", "Å", "A\u030A",
    "I", "i", "İ", "ı", "Σ", "σ", "ς", "а", "А", "א", "أ", "中", "文",
    "a", "ａ", "A", "Ａ", "か", "カ", "ｶ", "が", "カ\u3099", "ch", "ll",
    "\U00010428", "\U00010400", "\U0001F600", "\U0001F601", "\uD800", "\uDC00", "a\uD800b",
];

var version = compareInfo.Version;
var result = new {
    schemaVersion = 1,
    sdk = "10.0.201",
    runtime = Environment.Version.ToString(),
    framework = RuntimeInformation.FrameworkDescription,
    os = RuntimeInformation.OSDescription,
    architecture = RuntimeInformation.ProcessArchitecture.ToString(),
    culture = CultureInfo.CurrentCulture.Name,
    compareInfo = compareInfo.Name,
    options = "None",
    sortVersion = new { fullVersion = version.FullVersion, sortId = version.SortId.ToString() },
    globalizationInvariant = Environment.GetEnvironmentVariable("DOTNET_SYSTEM_GLOBALIZATION_INVARIANT"),
    useNls = Environment.GetEnvironmentVariable("DOTNET_SYSTEM_GLOBALIZATION_USENLS"),
    appLocalIcu = Environment.GetEnvironmentVariable("DOTNET_SYSTEM_GLOBALIZATION_APPLOCALICU"),
    values = values.Select(Units).ToArray(),
    invariant = Capture(values, Comparer<string?>.Default),
    ordinal = Capture(values, StringComparer.Ordinal),
    defaultSort = Sort(["b", "A", "a"], null),
    ordinalSort = Sort(["b", "A", "a"], StringComparer.Ordinal),
};
File.WriteAllText(args[0], JsonSerializer.Serialize(result));

static int[]? Units(string? value) => value?.Select(unit => (int)unit).ToArray();

static object Capture(string?[] values, IComparer<string?> comparer)
{
    var signs = values.Select(left => values.Select(right => Math.Sign(comparer.Compare(left, right))).ToArray()).ToArray();
    var sorted = new List<string?>(values);
    sorted.Sort(comparer);
    var array = sorted.ToArray();
    return new {
        signs,
        sorted = array.Select(Units).ToArray(),
        searches = values.Select(value => Array.BinarySearch(array, value, comparer)).ToArray(),
        absent = new[] { "aaa", "zzz", "\U0001F602" }.Select(value => new {
            value = Units(value), index = Array.BinarySearch(array, value, comparer)
        }).ToArray(),
    };
}

static int[]?[] Sort(string[] values, IComparer<string>? comparer)
{
    var list = new List<string>(values);
    if (comparer is null) list.Sort();
    else list.Sort(comparer);
    return list.Select(Units).ToArray();
}
