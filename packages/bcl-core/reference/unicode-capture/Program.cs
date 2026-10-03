using System.Globalization;
using System.Runtime.InteropServices;
using System.Text.Json;

if (Environment.Version.ToString() != "10.0.5")
    throw new InvalidOperationException("Unicode capture requires CoreCLR 10.0.5.");
if (args.Length != 1) throw new ArgumentException("Pass the output JSON path.");

CultureInfo.CurrentCulture = CultureInfo.InvariantCulture;
CultureInfo.CurrentUICulture = CultureInfo.InvariantCulture;
var whitespace = new List<int>();
for (var unit = 0; unit <= char.MaxValue; unit++)
{
    var character = (char)unit;
    var text = character.ToString();
    var expected = char.IsWhiteSpace(character);
    if (string.IsNullOrWhiteSpace(text) != expected || (text.Trim().Length == 0) != expected)
        throw new InvalidOperationException($"Whitespace APIs disagree at U+{unit:X4}.");
    if (expected) whitespace.Add(unit);
}

var upper = new List<int[]>();
var lower = new List<int[]>();
for (var point = 0; point <= 0x10FFFF; point++)
{
    // Include every isolated UTF-16 surrogate as well as every valid Unicode scalar.
    var text = point <= char.MaxValue ? ((char)point).ToString() : char.ConvertFromUtf32(point);
    RecordCase(point, text, text.ToUpperInvariant(), upper);
    RecordCase(point, text, text.ToLowerInvariant(), lower);
}

var splitInputs = new[] { "", "a", "\u0085a\u00A0b\uFEFFc\t", " a  b ", "\r\n", "\uFEFF", "\u0085" };
var splits = new List<object>();
foreach (var input in splitInputs)
    foreach (var count in new[] { 0, 1, 2, 3, int.MaxValue })
        splits.Add(new {
            input, count,
            output = input.Split((string?)null, count, StringSplitOptions.None),
            whitespaceOutput = input.Split((char[]?)null, count, StringSplitOptions.None)
        });

var examples = new[] {
    "Straße", "\u0149", "\u0130", "\u0131", "\u1F80", "\u1F88", "\u039F\u03A3",
    "\U00010428\U00010400", "\U0001E922\U0001E900", "a\uD800b\uDC00c", "\uFB03"
}.Select(input => new {
    input = input.Select(character => (int)character).ToArray(),
    upper = input.ToUpperInvariant().Select(character => (int)character).ToArray(),
    lower = input.ToLowerInvariant().Select(character => (int)character).ToArray()
});

var result = new {
    schemaVersion = 1,
    runtime = Environment.Version.ToString(),
    framework = RuntimeInformation.FrameworkDescription,
    os = RuntimeInformation.OSDescription,
    architecture = RuntimeInformation.ProcessArchitecture.ToString(),
    culture = CultureInfo.CurrentCulture.Name,
    invariantSortVersion = CultureInfo.InvariantCulture.CompareInfo.Version.FullVersion,
    codeUnitCount = 65536,
    codePointCount = 0x110000,
    whitespace,
    upper,
    lower,
    splits,
    examples
};
File.WriteAllText(args[0], JsonSerializer.Serialize(result));

static void RecordCase(int point, string source, string mapped, List<int[]> target)
{
    if (mapped.Length != source.Length)
        throw new InvalidOperationException($"Casing changed UTF-16 length at U+{point:X}.");
    if (mapped == source) return;
    var value = mapped.Length == 1 ? mapped[0] : char.ConvertToUtf32(mapped, 0);
    target.Add(new[] { point, value });
}
