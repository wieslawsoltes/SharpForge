using System.Globalization;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text.Json;

if (args.Length != 1 || Environment.Version.ToString() != "10.0.5")
    throw new InvalidOperationException("Use runtime 10.0.5 and supply the output JSON path.");
CultureInfo.CurrentCulture = CultureInfo.InvariantCulture;
CultureInfo.CurrentUICulture = CultureInfo.InvariantCulture;
var compare = CultureInfo.InvariantCulture.CompareInfo;
if (compare.Compare("a", "A", CompareOptions.None) >= 0)
    throw new InvalidOperationException("Linguistic invariant culture is required.");

(string Id, string Left, string Right)[] pairs = [
    ("decomposed-accent", "é", "e\u0301"),
    ("reordered-acute-cedilla", "a\u0301\u0327", "a\u0327\u0301"),
    ("reordered-comma-grave", "a\u0315\u0300", "a\u0300\u0315"),
    ("composed-acute-cedilla", "\u00E1\u0327", "a\u0327\u0301"),
    ("composed-dot-below", "\u1E0B\u0323", "\u1E0D\u0307"),
    ("reordered-hebrew", "\u05E9\u05C1\u05B8", "\u05E9\u05B8\u05C1"),
    ("same-class-marks", "a\u0301\u0300", "a\u0300\u0301"),
    ("embedded-null", "ab", "a\0b"),
    ("ignorable-only", "", "\u00AD\u200B\uFEFF"),
    ("isolated-surrogates", "\uD800", "\uDC00"),
    ("width-distinction", "a", "ａ"),
    ("kana-distinction", "か", "カ"),
];

int[] Units(string value) => value.Select(unit => (int)unit).ToArray();
var version = compare.Version;
var result = new {
    schemaVersion = 1, sdk = "10.0.201", runtime = Environment.Version.ToString(),
    framework = RuntimeInformation.FrameworkDescription, os = RuntimeInformation.OSDescription,
    architecture = RuntimeInformation.ProcessArchitecture.ToString(),
    culture = CultureInfo.CurrentCulture.Name, compareInfo = compare.Name, options = "None",
    sortVersion = new { fullVersion = version.FullVersion, sortId = version.SortId.ToString() },
    globalizationInvariant = Environment.GetEnvironmentVariable("DOTNET_SYSTEM_GLOBALIZATION_INVARIANT"),
    useNls = Environment.GetEnvironmentVariable("DOTNET_SYSTEM_GLOBALIZATION_USENLS"),
    appLocalIcu = Environment.GetEnvironmentVariable("DOTNET_SYSTEM_GLOBALIZATION_APPLOCALICU"),
    sourceSha256 = Convert.ToHexStringLower(SHA256.HashData(File.ReadAllBytes("Program.cs"))),
    pairs = pairs.Select(pair => new {
        id = pair.Id, left = Units(pair.Left), right = Units(pair.Right),
        sign = Math.Sign(compare.Compare(pair.Left, pair.Right, CompareOptions.None)),
        reverseSign = Math.Sign(compare.Compare(pair.Right, pair.Left, CompareOptions.None))
    }).ToArray()
};
File.WriteAllText(args[0], JsonSerializer.Serialize(result, new JsonSerializerOptions { WriteIndented = true }));
