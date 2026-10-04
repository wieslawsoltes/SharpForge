using System.Collections;
using System.Globalization;
using System.Numerics;
using System.Reflection;
using System.Resources;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text.Json;

var directory = args[0];
var nativePath = Path.Combine(directory, "native.resources");
using (var writer = new ResourceWriter(nativePath))
{
    var values = new (string Name, object? Value)[] {
        ("null", null), ("text", "Zażółć\0😃"), ("bom", "\ufeffcontent"), ("long-string", new string('ż', 129)),
        ("empty-string", ""), ("boolean", true), ("false", false), ("char", 'Ł'), ("surrogate-char", '\ud800'),
        ("byte", byte.MaxValue), ("sbyte", sbyte.MinValue), ("short", short.MinValue), ("ushort", ushort.MaxValue),
        ("int", int.MinValue), ("uint", uint.MaxValue), ("long", long.MinValue), ("ulong", ulong.MaxValue),
        ("single", 0.1f), ("double", Math.PI), ("single-negzero", BitConverter.Int32BitsToSingle(int.MinValue)),
        ("double-negzero", BitConverter.Int64BitsToDouble(long.MinValue)), ("nan", double.NaN),
        ("infinity", float.PositiveInfinity), ("negative-infinity", double.NegativeInfinity),
        ("decimal", new decimal(12300, 0, 0, true, 4)), ("decimal-max", decimal.MaxValue),
        ("decimal-negzero", new decimal(0, 0, 0, true, 28)),
        ("date", new DateTime(638500000000000000L, DateTimeKind.Utc)),
        ("local-date", DateTime.FromBinary(unchecked((long)0x88dc000000000000UL))),
        ("span", TimeSpan.MinValue), ("bytes", new byte[] { 0, 127, 128, 255 }),
        ("stream", new MemoryStream(new byte[] { 9, 8, 7 })), ("empty-bytes", Array.Empty<byte>()),
        (" a", 1), ("!@", 2), ("", "empty key"), ("\ufeffHeading", "BOM key")
    };
    foreach (var (name, value) in values)
    {
        if (value is Stream stream) writer.AddResource(name, stream, closeAfterWrite: true);
        else writer.AddResource(name, value);
    }
    writer.AddResourceData("opaque", "Fixture.Serialized, Fixture, Version=1.0.0.0, Culture=neutral, PublicKeyToken=null",
        new byte[] { 0xde, 0xad, 0xbe, 0xef });
}
var resgenPath = Path.Combine(directory, "resgen.resources");
using (var source = Assembly.GetExecutingAssembly().GetManifestResourceStream("Oracle.Sample.resources")!)
using (var destination = File.Create(resgenPath)) source.CopyTo(destination);
var files = new[] { Dump(nativePath), Dump(resgenPath) };
Console.WriteLine(JsonSerializer.Serialize(new { runtime = RuntimeInformation.FrameworkDescription, files }));

static object Dump(string path)
{
    var bytes = File.ReadAllBytes(path);
    var entries = new List<object>();
    using var reader = new ResourceReader(new MemoryStream(bytes));
    var enumerator = reader.GetEnumerator();
    while (enumerator.MoveNext())
    {
        var name = (string)enumerator.Key;
        reader.GetResourceData(name, out var typeName, out var data);
        var serialized = !typeName.StartsWith("ResourceTypeCode.", StringComparison.Ordinal);
        entries.Add(new { name, typeName, rawData = Convert.ToBase64String(data), serialized,
            value = serialized ? data.Select(item => (int)item).ToArray() : Normalize(enumerator.Value) });
    }
    return new { name = Path.GetFileName(path), sha256 = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant(),
        image = Convert.ToBase64String(bytes), entries };
}

static object? Normalize(object? value)
{
    if (value is long signed) return signed.ToString(CultureInfo.InvariantCulture);
    if (value is ulong unsigned) return unsigned.ToString(CultureInfo.InvariantCulture);
    if (value is char character) return new { codeUnit = (int)character };
    if (value is decimal number)
    {
        var bits = decimal.GetBits(number);
        var coefficient = (BigInteger)(uint)bits[0] | ((BigInteger)(uint)bits[1] << 32) | ((BigInteger)(uint)bits[2] << 64);
        return new { coefficient = coefficient.ToString(CultureInfo.InvariantCulture), scale = (bits[3] >> 16) & 255, negative = bits[3] < 0 };
    }
    if (value is DateTime date)
    {
        var binary = date.ToBinary();
        return new { binary = binary.ToString(CultureInfo.InvariantCulture), kindBits = (int)((ulong)binary >> 62) };
    }
    if (value is TimeSpan span) return new { ticks = span.Ticks.ToString(CultureInfo.InvariantCulture) };
    if (value is byte[] bytes) return bytes.Select(item => (int)item).ToArray();
    if (value is Stream stream)
    {
        using (stream)
        using (var copy = new MemoryStream()) { stream.CopyTo(copy); return copy.ToArray().Select(item => (int)item).ToArray(); }
    }
    if (value is float single) return Floating(single, BitConverter.SingleToInt32Bits(single) == int.MinValue);
    if (value is double doubleValue) return Floating(doubleValue, BitConverter.DoubleToInt64Bits(doubleValue) == long.MinValue);
    return value;
}

static object Floating(double value, bool negativeZero) => negativeZero ? "-0"
    : double.IsNaN(value) ? "NaN" : double.IsPositiveInfinity(value) ? "Infinity"
    : double.IsNegativeInfinity(value) ? "-Infinity" : value;
