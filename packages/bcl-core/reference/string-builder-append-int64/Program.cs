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
        StringBuilder returned;
        if (type == "long")
        {
            long value = long.Parse(input, CultureInfo.InvariantCulture);
            returned = builder!.Append(value);
        }
        else
        {
            ulong value = ulong.Parse(input, CultureInfo.InvariantCulture);
            returned = builder!.Append(value);
        }
        same = ReferenceEquals(builder, returned);
    }
    catch (Exception error) { fault = error.GetType().Name; }
    rows.Add(new { type, input, nullReceiver, initial, output = builder?.ToString(), length = builder?.Length, same, fault });
}
foreach (var value in new[] {
    "-9223372036854775808", "-9007199254740993", "-9007199254740992", "-2147483649", "-1", "0", "1",
    "2147483648", "9007199254740991", "9007199254740992", "9007199254740993", "9223372036854775807"
}) Capture("long", value);
foreach (var value in new[] {
    "0", "1", "4294967295", "4294967296", "9007199254740991", "9007199254740992", "9007199254740993",
    "9223372036854775807", "9223372036854775808", "18446744073709551615"
}) Capture("ulong", value);
Capture("long", "-9223372036854775808", nullReceiver: true);
Capture("ulong", "18446744073709551615", nullReceiver: true);
Capture("long", "-9223372036854775808", initial: "");
Capture("ulong", "18446744073709551615", initial: "");

long signed = long.MinValue;
ulong unsigned = ulong.MaxValue;
var fluentBuilder = new StringBuilder();
var fluentResult = fluentBuilder.Append(signed).Append('|').Append(unsigned).Append('|').Append(42).Append(true);
var fluent = new { output = fluentBuilder.ToString(), length = fluentBuilder.Length, same = ReferenceEquals(fluentBuilder, fluentResult) };
var result = new {
    sdk = "10.0.201", runtime = Environment.Version.ToString(),
    sourceSha256 = Convert.ToHexStringLower(SHA256.HashData(File.ReadAllBytes("Program.cs"))), rows, fluent
};
File.WriteAllText(args[0], JsonSerializer.Serialize(result, new JsonSerializerOptions { WriteIndented = true }) + "\n");
