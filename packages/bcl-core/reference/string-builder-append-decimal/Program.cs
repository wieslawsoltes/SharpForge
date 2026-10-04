using System.Globalization;
using System.Numerics;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

if (args.Length != 1 || Environment.Version.ToString() != "10.0.5")
    throw new InvalidOperationException("Use .NET 10.0.5 and provide the output JSON path.");
CultureInfo.CurrentCulture = CultureInfo.InvariantCulture;
const string maximum = "79228162514264337593543950335";
var rows = new List<object>();
decimal Value(string coefficient, int scale, bool negative)
{
    var bits = BigInteger.Parse(coefficient, CultureInfo.InvariantCulture);
    return new decimal(unchecked((int)(uint)(bits & uint.MaxValue)),
        unchecked((int)(uint)((bits >> 32) & uint.MaxValue)),
        unchecked((int)(uint)((bits >> 64) & uint.MaxValue)), negative, (byte)scale);
}
void Capture(string coefficient, int scale, bool negative, bool nullReceiver = false, string initial = "seed|")
{
    decimal value = Value(coefficient, scale, negative);
    StringBuilder? builder = nullReceiver ? null : new StringBuilder(initial);
    string? fault = null;
    bool? same = null;
    try { same = ReferenceEquals(builder, builder!.Append(value)); }
    catch (Exception error) { fault = error.GetType().Name; }
    rows.Add(new {
        coefficient, scale, negative, bits = decimal.GetBits(value), nullReceiver, initial,
        text = value.ToString(CultureInfo.InvariantCulture), output = builder?.ToString(), length = builder?.Length, same, fault
    });
}

foreach (int scale in new[] { 0, 2, 28 })
    foreach (bool negative in new[] { false, true }) Capture("0", scale, negative);
foreach (int scale in new[] { 0, 1, 4, 28 })
    foreach (bool negative in new[] { false, true }) Capture("1", scale, negative);
foreach (var item in new (string Coefficient, int Scale)[] {
    ("1234500", 4), ("9007199254740993", 0), (maximum, 0), (maximum, 28),
    ("10000000000000000000000000000", 0), ("1234567890123456789012345678", 28)
}) foreach (bool negative in new[] { false, true }) Capture(item.Coefficient, item.Scale, negative);
Capture("4294967296", 3, false);
Capture("0", 28, true, nullReceiver: true);
Capture(maximum, 0, true, nullReceiver: true);
Capture("1", 28, false, nullReceiver: true);
Capture("12300", 4, false, initial: "");
Capture("0", 2, true, initial: "");
Capture(maximum, 0, true, initial: "");

decimal fraction = Value("12300", 4, false);
decimal negativeZero = Value("0", 3, true);
var fluentBuilder = new StringBuilder();
var returned = fluentBuilder.Append(fraction).Append('|').Append(negativeZero).Append('|').Append(42).Append('A');
var fluent = new { output = fluentBuilder.ToString(), length = fluentBuilder.Length, same = ReferenceEquals(fluentBuilder, returned) };
var result = new {
    sdk = "10.0.201", runtime = Environment.Version.ToString(),
    sourceSha256 = Convert.ToHexStringLower(SHA256.HashData(File.ReadAllBytes("Program.cs"))), rows, fluent
};
File.WriteAllText(args[0], JsonSerializer.Serialize(result, new JsonSerializerOptions { WriteIndented = true }) + "\n");
