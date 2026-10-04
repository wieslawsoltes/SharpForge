using System.Globalization;
using System.Numerics;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

if (args.Length != 1 || Environment.Version.ToString() != "10.0.5")
    throw new InvalidOperationException("Use .NET 10.0.5 and provide the output JSON path.");
CultureInfo.CurrentCulture = CultureInfo.InvariantCulture;
int[] Units(string value) => value.Select(unit => (int)unit).ToArray();
string? Text(int[]? units) => units == null ? null : new string(units.Select(unit => (char)unit).ToArray());
StringBuilder? Create(string[]? segments)
{
    if (segments == null) return null;
    var builder = new StringBuilder(1);
    foreach (var segment in segments) builder.Append(segment);
    return builder;
}
object? State(StringBuilder? builder)
{
    if (builder == null) return null;
    int chunks = 0;
    foreach (var chunk in builder.GetChunks()) chunks++;
    return new { text = Units(builder.ToString()), length = builder.Length,
        capacity = builder.Capacity, maxCapacity = builder.MaxCapacity, chunks };
}
decimal DecimalValue(Input input)
{
    var bits = BigInteger.Parse(input.scalar!, CultureInfo.InvariantCulture);
    return new decimal(unchecked((int)(uint)(bits & uint.MaxValue)),
        unchecked((int)(uint)((bits >> 32) & uint.MaxValue)),
        unchecked((int)(uint)((bits >> 64) & uint.MaxValue)), input.negative, (byte)input.scale);
}
object? Value(Input input, StringBuilder? receiver) => input.type switch {
    "null" => null,
    "string" => Text(input.units),
    "char[]" => Text(input.units)?.ToCharArray(),
    "sbyte" => sbyte.Parse(input.scalar!, CultureInfo.InvariantCulture),
    "byte" => byte.Parse(input.scalar!, CultureInfo.InvariantCulture),
    "short" => short.Parse(input.scalar!, CultureInfo.InvariantCulture),
    "ushort" => ushort.Parse(input.scalar!, CultureInfo.InvariantCulture),
    "int" => int.Parse(input.scalar!, CultureInfo.InvariantCulture),
    "uint" => uint.Parse(input.scalar!, CultureInfo.InvariantCulture),
    "long" => long.Parse(input.scalar!, CultureInfo.InvariantCulture),
    "ulong" => ulong.Parse(input.scalar!, CultureInfo.InvariantCulture),
    "float" => BitConverter.UInt32BitsToSingle(uint.Parse(input.scalar!, NumberStyles.HexNumber)),
    "double" => BitConverter.UInt64BitsToDouble(ulong.Parse(input.scalar!, NumberStyles.HexNumber)),
    "decimal" => DecimalValue(input),
    "bool" => input.scalar == "true",
    "char" => (char)int.Parse(input.scalar!, CultureInfo.InvariantCulture),
    "object" => new object(),
    "builder" => new StringBuilder(Text(input.units)),
    "probe" => new Probe(receiver, Text(input.units), input.scalar),
    _ => throw new InvalidOperationException("Unknown input type: " + input.type)
};
StringBuilder Invoke(StringBuilder receiver, string overload, object? value, int index, int start, int count) => overload switch {
    "sbyte" => receiver.Insert(index, (sbyte)value!),
    "byte" => receiver.Insert(index, (byte)value!),
    "short" => receiver.Insert(index, (short)value!),
    "ushort" => receiver.Insert(index, (ushort)value!),
    "int" => receiver.Insert(index, (int)value!),
    "uint" => receiver.Insert(index, (uint)value!),
    "long" => receiver.Insert(index, (long)value!),
    "ulong" => receiver.Insert(index, (ulong)value!),
    "float" => receiver.Insert(index, (float)value!),
    "double" => receiver.Insert(index, (double)value!),
    "decimal" => receiver.Insert(index, (decimal)value!),
    "object" => receiver.Insert(index, value),
    "string" => receiver.Insert(index, (string?)value),
    "char[]" => receiver.Insert(index, (char[]?)value),
    "char[]-range" => receiver.Insert(index, (char[]?)value, start, count),
    _ => throw new InvalidOperationException("Unknown overload: " + overload)
};
var rows = new List<object>();
void Capture(string id, string overload, Input input, int index, string[]? segments, int start = 0, int count = 0)
{
    var receiver = Create(segments);
    var value = Value(input, receiver);
    var before = State(receiver);
    bool? identity = null;
    string? fault = null, parameter = null;
    try { identity = ReferenceEquals(receiver, Invoke(receiver!, overload, value, index, start, count)); }
    catch (Exception error)
    {
        fault = error.GetType().Name;
        parameter = (error as ArgumentException)?.ParamName;
    }
    rows.Add(new { id, overload, input, index, startIndex = start, charCount = count,
        capacity = 1, segments = segments?.Select(Units).ToArray(), before, identity, fault, parameter,
        calls = value is Probe probe ? probe.Calls : 0, after = State(receiver) });
}
var numeric = new List<Input>();
foreach (var (type, values) in new (string, string[])[] {
    ("sbyte", ["-128", "-1", "0", "127"]), ("byte", ["0", "1", "255"]),
    ("short", ["-32768", "-1", "32767"]), ("ushort", ["0", "65535"]),
    ("int", ["-2147483648", "-1", "0", "2147483647"]), ("uint", ["0", "4294967295"]),
    ("long", ["-9223372036854775808", "-9007199254740993", "0", "9223372036854775807"]),
    ("ulong", ["0", "9007199254740993", "18446744073709551615"]),
    ("float", ["00000000", "80000000", "3dcccccd", "4e6e6b29", "00000001", "7f7fffff", "7fc00000", "7f800000", "ff800000"]),
    ("double", ["0000000000000000", "8000000000000000", "3fb999999999999a", "0000000000000001",
        "7fefffffffffffff", "7ff8000000000000", "7ff0000000000000", "fff0000000000000"])
}) foreach (var value in values) numeric.Add(new Input(type, value));
foreach (var (coefficient, scale, negative) in new (string, int, bool)[] {
    ("0", 0, false), ("0", 4, true), ("12300", 4, false), ("1", 28, false),
    ("9007199254740993", 0, false), ("79228162514264337593543950335", 0, false),
    ("79228162514264337593543950335", 0, true)
}) numeric.Add(new Input("decimal", coefficient, scale: scale, negative: negative));
foreach (var input in numeric)
    foreach (var index in new[] { 0, 2, 4 })
        Capture($"{input.type}-{input.scalar}-{input.scale}-{input.negative}-{index}", input.type, input, index, ["ab", "cd"]);
foreach (var group in numeric.GroupBy(input => input.type))
{
    var input = group.First();
    foreach (var index in new[] { -1, 5, int.MinValue, int.MaxValue })
        Capture($"{input.type}-invalid-{index}", input.type, input, index, ["ab", "cd"]);
    Capture(input.type + "-null-receiver", input.type, input, -1, null);
}
foreach (var input in new[] { new Input("string"), new Input("string", units: []),
    new Input("string", units: Units("x\0\ud800")), new Input("string", units: Units("$&$1")),
    new Input("string", units: Units("\udc00\ud800")) })
{
    string name = input.units == null ? "null" : input.units.Length == 0 ? "empty" : string.Join("-", input.units);
    foreach (var index in new[] { -1, 0, 2, 4, 5, int.MinValue, int.MaxValue })
        Capture($"string-{name}-{index}", "string", input, index, ["ab", "cd"]);
    Capture("string-" + name + "-null-receiver", "string", input, 0, null);
    Capture("string-" + name + "-empty-receiver", "string", input, 0, []);
}
var arrays = new[] { new Input("char[]"), new Input("char[]", units: []), new Input("char[]", units: Units("x\0\ud800\udc00z")) };
foreach (var input in arrays)
{
    string name = input.units == null ? "null" : input.units.Length == 0 ? "empty" : "raw";
    foreach (var index in new[] { -1, 0, 2, 4, 5, int.MinValue, int.MaxValue })
        Capture($"array-{name}-{index}", "char[]", input, index, ["ab", "cd"]);
    Capture("array-" + name + "-null-receiver", "char[]", input, 0, null);
    foreach (var (start, count) in new (int, int)[] { (0, 0), (0, 1), (0, 5), (1, 3), (5, 0), (6, 0),
        (-1, 0), (0, -1), (-1, -1), (4, 2), (int.MinValue, 0), (0, int.MaxValue) })
        foreach (var index in new[] { -1, 2, 5 })
            Capture($"array-range-{name}-{index}-{start}-{count}", "char[]-range", input, index, ["ab", "cd"], start, count);
}
Capture("array-range-null-receiver", "char[]-range", arrays[0], -1, null, -1, -1);
Capture("array-cross-block", "char[]-range", new Input("char[]", units: Units(new string('x', 4097))), 1, ["ab"], 1, 4096);
var objects = new List<Input> { new("null"), new("string", units: []), new("string", units: Units("x\0\ud800")),
    new("bool", "true"), new("char", "55304"), new("object"), new("builder", units: Units("inner")),
    new("probe", units: Units("probe")), new("probe", units: []), new("probe"),
    new("probe", "throw", Units("unseen")), new("probe", "append", Units("x")), new("probe", "clear", Units("x")) };
objects.AddRange(numeric.Where(input => input.type is "uint" or "long" or "ulong" or "float" or "decimal").Take(20));
foreach (var (input, ordinal) in objects.Select((input, index) => (input, index)))
{
    foreach (var index in new[] { -1, 2, 4, 5 })
        Capture($"object-{ordinal}-{index}", "object", input, index, ["ab", "cd"]);
    Capture($"object-{ordinal}-null-receiver", "object", input, 0, null);
}
int calls = 0;
StringBuilder Receiver(StringBuilder builder) { calls = calls * 10 + 1; return builder; }
int Index() { calls = calls * 10 + 2; return 1; }
int Number() { calls = calls * 10 + 3; return -42; }
var fluentBuilder = new StringBuilder("ab");
var returned = Receiver(fluentBuilder).Insert(Index(), Number());
var fluent = new { calls, text = Units(fluentBuilder.ToString()), length = fluentBuilder.Length,
    identity = ReferenceEquals(fluentBuilder, returned) };
var source = Path.Combine(AppContext.BaseDirectory, "Program.cs");
var output = new { sdk = "10.0.201", runtime = Environment.Version.ToString(),
    sourceSha256 = Convert.ToHexStringLower(SHA256.HashData(File.ReadAllBytes(source))), rows, fluent };
File.WriteAllText(args[0], JsonSerializer.Serialize(output, new JsonSerializerOptions { WriteIndented = true }) + "\n");

sealed record Input(string type, string? scalar = null, int[]? units = null, int scale = 0, bool negative = false);
sealed class Probe(StringBuilder? builder, string? text, string? action)
{
    public int Calls { get; private set; }
    public override string? ToString()
    {
        Calls++;
        if (action == "throw") throw new InvalidOperationException("probe failure");
        if (action == "append") builder?.Append("!");
        if (action == "clear") builder?.Clear();
        return text;
    }
}
