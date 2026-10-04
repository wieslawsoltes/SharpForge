using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

if (args.Length != 1 || Environment.Version.ToString() != "10.0.5")
    throw new InvalidOperationException("Use .NET 10.0.5 and provide the output JSON path.");
CultureInfo.CurrentCulture = CultureInfo.InvariantCulture;
var rows = new List<object>();
void Capture(string type, string input, bool nullReceiver = false, string initial = "seed|")
{
    StringBuilder? builder = nullReceiver ? null : new StringBuilder(initial);
    string? fault = null;
    bool? same = null;
    try
    {
        var returned = type switch {
            "sbyte" => builder!.Append(sbyte.Parse(input, CultureInfo.InvariantCulture)),
            "byte" => builder!.Append(byte.Parse(input, CultureInfo.InvariantCulture)),
            "short" => builder!.Append(short.Parse(input, CultureInfo.InvariantCulture)),
            "ushort" => builder!.Append(ushort.Parse(input, CultureInfo.InvariantCulture)),
            "uint" => builder!.Append(uint.Parse(input, CultureInfo.InvariantCulture)),
            _ => throw new InvalidOperationException("Unknown fixture type")
        };
        same = ReferenceEquals(builder, returned);
    }
    catch (Exception error) { fault = error.GetType().Name; }
    rows.Add(new { type, input, nullReceiver, initial, output = builder?.ToString(), length = builder?.Length, same, fault });
}

var cases = new (string Type, string[] Values)[] {
    ("sbyte", ["-128", "-127", "-42", "-1", "0", "1", "42", "126", "127"]),
    ("byte", ["0", "1", "42", "127", "128", "254", "255"]),
    ("short", ["-32768", "-32767", "-129", "-128", "-1", "0", "1", "127", "128", "32766", "32767"]),
    ("ushort", ["0", "1", "255", "256", "32767", "32768", "65534", "65535"]),
    ("uint", ["0", "1", "65535", "65536", "2147483647", "2147483648", "4294967294", "4294967295"])
};
foreach (var item in cases)
{
    foreach (var value in item.Values) Capture(item.Type, value);
    Capture(item.Type, item.Values[^1], nullReceiver: true);
    Capture(item.Type, item.Values[0], initial: "");
}

sbyte signedByte = -128;
byte unsignedByte = 255;
short signedShort = -32768;
ushort unsignedShort = 65535;
uint unsignedInt = uint.MaxValue;
var fluentBuilder = new StringBuilder();
var fluentResult = fluentBuilder.Append(signedByte).Append('|').Append(unsignedByte).Append('|')
    .Append(signedShort).Append('|').Append(unsignedShort).Append('|').Append(unsignedInt).Append('|').Append(42).Append('A');
var fluent = new { output = fluentBuilder.ToString(), length = fluentBuilder.Length, same = ReferenceEquals(fluentBuilder, fluentResult) };
var result = new {
    sdk = "10.0.201", runtime = Environment.Version.ToString(),
    sourceSha256 = Convert.ToHexStringLower(SHA256.HashData(File.ReadAllBytes("Program.cs"))), rows, fluent
};
File.WriteAllText(args[0], JsonSerializer.Serialize(result, new JsonSerializerOptions { WriteIndented = true }) + "\n");
