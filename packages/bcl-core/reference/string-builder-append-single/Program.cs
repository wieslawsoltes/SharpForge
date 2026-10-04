using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

if (args.Length != 1 || Environment.Version.ToString() != "10.0.5")
    throw new InvalidOperationException("Use .NET 10.0.5 and provide the output JSON path.");
CultureInfo.CurrentCulture = CultureInfo.InvariantCulture;
var rows = new List<object>();
void Capture(uint bits, bool nullReceiver = false)
{
    float value = BitConverter.UInt32BitsToSingle(bits);
    StringBuilder? builder = nullReceiver ? null : new StringBuilder("seed|");
    string? fault = null;
    bool? same = null;
    try { same = ReferenceEquals(builder, builder!.Append(value)); }
    catch (Exception error) { fault = error.GetType().Name; }
    rows.Add(new {
        bits = bits.ToString("x8", CultureInfo.InvariantCulture),
        observedBits = BitConverter.SingleToUInt32Bits(value).ToString("x8", CultureInfo.InvariantCulture),
        nullReceiver, text = value.ToString(null, CultureInfo.InvariantCulture),
        doubleText = ((double)value).ToString(null, CultureInfo.InvariantCulture),
        output = builder?.ToString(), length = builder?.Length, same, fault
    });
}

uint[] patterns = [
    0x00000000, 0x80000000, 0x3f800000, 0xbf800000,
    0x3dcccccd, 0x3eaaaaab, 0x3f9e0651, 0x3f7fffff,
    0x3f800001, 0x4b800000, 0x4b800001, 0x4cbebc1f,
    0x4cbebc20, 0x4cbebc21, 0x4e6e6b27, 0x4e6e6b28,
    0x4e6e6b29, 0xce6e6b28, 0x38d1b716, 0x38d1b717,
    0x38d1b718, 0x3727c5ac, 0xb727c5ac, 0x00000001,
    0x00000002, 0x00000003, 0x007fffff, 0x00800000,
    0x00800001, 0x80000001, 0x807fffff, 0x80800000,
    0x7f7fffff, 0xff7fffff, 0x7f800000, 0xff800000,
    0x7fc00000, 0xffc00000, 0x7fa12345, 0xffa12345
];
foreach (uint bits in patterns) Capture(bits);
foreach (uint bits in new uint[] { 0x00000000, 0x80000000, 0x7f7fffff, 0x7fc00000 }) Capture(bits, true);

float fraction = BitConverter.UInt32BitsToSingle(0x3dcccccd);
float negativeZero = BitConverter.UInt32BitsToSingle(0x80000000);
var fluentBuilder = new StringBuilder();
var returned = fluentBuilder.Append(fraction).Append('|').Append(negativeZero).Append('|').Append(42).Append(true);
var fluent = new { output = fluentBuilder.ToString(), length = fluentBuilder.Length, same = ReferenceEquals(fluentBuilder, returned) };
var result = new {
    sdk = "10.0.201", runtime = Environment.Version.ToString(),
    sourceSha256 = Convert.ToHexStringLower(SHA256.HashData(File.ReadAllBytes("Program.cs"))), rows, fluent
};
File.WriteAllText(args[0], JsonSerializer.Serialize(result, new JsonSerializerOptions { WriteIndented = true }) + "\n");
