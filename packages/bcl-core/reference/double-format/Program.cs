using System.Globalization;
using System.Text.Json;

if (Environment.Version.ToString() != "10.0.5")
    throw new InvalidOperationException("Reference capture requires CoreCLR 10.0.5.");

(string Name, double Value)[] values = [
    ("zero", 0d),
    ("negative-zero", BitConverter.Int64BitsToDouble(long.MinValue)),
    ("epsilon", double.Epsilon),
    ("negative-epsilon", -double.Epsilon),
    ("minimum-normal", BitConverter.Int64BitsToDouble(0x0010000000000000)),
    ("maximum-subnormal", BitConverter.Int64BitsToDouble(0x000fffffffffffff)),
    ("maximum", double.MaxValue),
    ("negative-maximum", -double.MaxValue),
    ("nan", double.NaN),
    ("positive-infinity", double.PositiveInfinity),
    ("negative-infinity", double.NegativeInfinity),
    ("one", 1d),
    ("negative-one", -1d),
    ("tenth", 0.1d),
    ("negative-tenth", -0.1d),
    ("one-and-half", 1.5d),
    ("one-and-quarter", 1.25d),
    ("even-midpoint", 1.125d),
    ("odd-midpoint", 1.375d),
    ("decimal-midpoint-below", 9.995d),
    ("decimal-round-carry", 9.9995d),
    ("integer-round-carry", 999.5d),
    ("above-integer-midpoint", Math.BitIncrement(999.5d)),
    ("below-integer-midpoint", Math.BitDecrement(999.5d)),
    ("seven-digits", 1234567d),
    ("negative-seven-digits", -1234567d),
    ("small-fixed-threshold", 1e-4d),
    ("below-small-fixed-threshold", Math.BitDecrement(1e-4d)),
    ("above-small-fixed-threshold", Math.BitIncrement(1e-4d)),
    ("small-scientific", 1e-5d),
    ("millionth", 1e-6d),
    ("ten-millionth", 1e-7d),
    ("large-fixed", 1e16d),
    ("below-large-fixed", Math.BitDecrement(1e16d)),
    ("above-large-fixed", Math.BitIncrement(1e16d)),
    ("large-scientific-threshold", 1e17d),
    ("below-large-scientific-threshold", Math.BitDecrement(1e17d)),
    ("above-large-scientific-threshold", Math.BitIncrement(1e17d)),
    ("twenty-digit-power", 1e20d),
    ("javascript-scientific-threshold", 1e21d),
    ("twenty-three-digit-power", 1e23d),
    ("seventeen-significant-digits", 1.2345678901234567d),
    ("roundtrip-sensitive", 0.84551240822557006d),
    ("pi", Math.PI),
    ("e", Math.E),
    ("above-one", Math.BitIncrement(1d)),
    ("below-one", Math.BitDecrement(1d)),
    ("below-maximum", Math.BitDecrement(double.MaxValue)),
    ("maximum-exact-integer", 9007199254740991d),
    ("next-exact-integer", 9007199254740992d)
];
string[] formats = ["", "G", "G3", "G17", "R", "g", "g3", "g17", "r", "G0"];
var rows = values.Select(item => new {
    name = item.Name,
    bits = unchecked((ulong)BitConverter.DoubleToInt64Bits(item.Value)).ToString("x16", CultureInfo.InvariantCulture),
    output = formats.ToDictionary(format => format, format => item.Value.ToString(format, CultureInfo.InvariantCulture))
});
var result = new {
    schemaVersion = 1,
    sdk = "10.0.201",
    runtime = Environment.Version.ToString(),
    culture = "InvariantCulture",
    formats,
    rows
};
Console.WriteLine(JsonSerializer.Serialize(result, new JsonSerializerOptions { WriteIndented = true }));
