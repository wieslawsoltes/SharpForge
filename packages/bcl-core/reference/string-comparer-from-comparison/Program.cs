using System.Globalization;
using System.Security.Cryptography;
using System.Text.Json;

if (args.Length != 1 || Environment.Version.ToString() != "10.0.5")
    throw new InvalidOperationException("Use .NET 10.0.5 and provide the output JSON path.");

StringComparer Getter(int mode) => mode switch {
    0 => StringComparer.CurrentCulture,
    1 => StringComparer.CurrentCultureIgnoreCase,
    2 => StringComparer.InvariantCulture,
    3 => StringComparer.InvariantCultureIgnoreCase,
    4 => StringComparer.Ordinal,
    5 => StringComparer.OrdinalIgnoreCase,
    _ => throw new InvalidOperationException("No getter for invalid modes.")
};
int[]? Units(string? value) => value?.Select(unit => (int)unit).ToArray();
var pairs = new (string? First, string? Second)[] {
    (null, null), (null, ""), ("", null), ("", ""), ("a", "A"), ("a", "B"),
    ("I", "i"), ("I", "\u0131"), ("i", "\u0130"), ("\u00df", "SS"),
    ("\u00e9", "\u00c9"), ("\u00e9", "e\u0301"), ("\u03c2", "\u03a3"),
    ("\u017f", "S"), ("\ud801\udc28", "\ud801\udc00"), ("\ud801", "\ud801"),
    ("\udc28", "\udc00"), ("\0a", "\0A"), ("a\u0301", "\u00e1")
};
var rows = new List<object>();
foreach (var culture in new[] { "", "tr-TR" })
{
    CultureInfo.CurrentCulture = culture == "" ? CultureInfo.InvariantCulture : CultureInfo.GetCultureInfo(culture);
    foreach (var mode in new[] { int.MinValue, -1, 0, 1, 2, 3, 4, 5, 6, int.MaxValue })
    {
        string? fault = null, parameter = null;
        bool? sameGetter = null, sameFactory = null, sameGetterRepeat = null, distinctOpposite = null;
        int[]? signs = null;
        string?[]? sorted = null;
        int[]? searches = null;
        try
        {
            var comparer = StringComparer.FromComparison((StringComparison)mode);
            var getter = Getter(mode);
            sameGetter = ReferenceEquals(comparer, getter);
            sameFactory = ReferenceEquals(comparer, StringComparer.FromComparison((StringComparison)mode));
            sameGetterRepeat = ReferenceEquals(getter, Getter(mode));
            distinctOpposite = !ReferenceEquals(comparer, Getter(mode ^ 1));
            signs = pairs.Select(pair => Math.Sign(comparer.Compare(pair.First, pair.Second))).ToArray();
            var values = new List<string?> { "z", "A", null, "m", "B" };
            values.Sort(comparer);
            sorted = values.ToArray();
            searches = new string?[] { null, "A", "m", "!", "zz" }
                .Select(value => Array.BinarySearch((Array)sorted, value, comparer)).ToArray();
        }
        catch (Exception error)
        {
            fault = error.GetType().Name;
            parameter = (error as ArgumentException)?.ParamName;
        }
        rows.Add(new { culture, mode, fault, parameter, sameGetter, sameFactory, sameGetterRepeat, distinctOpposite,
            signs, sorted = sorted?.Select(Units).ToArray(), searches });
    }
}
var result = new {
    sdk = "10.0.201", runtime = Environment.Version.ToString(),
    sourceSha256 = Convert.ToHexStringLower(SHA256.HashData(File.ReadAllBytes("Program.cs"))),
    pairs = pairs.Select(pair => new { first = Units(pair.First), second = Units(pair.Second) }).ToArray(), rows
};
File.WriteAllText(args[0], JsonSerializer.Serialize(result, new JsonSerializerOptions { WriteIndented = true }) + "\n");
