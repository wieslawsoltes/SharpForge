using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

if (args.Length != 1 || Environment.Version.ToString() != "10.0.5")
    throw new InvalidOperationException("Use .NET 10.0.5 and provide the output JSON path.");
CultureInfo.CurrentCulture = CultureInfo.InvariantCulture;
var rows = new List<object>();
StringBuilder Create(string[] segments)
{
    var builder = new StringBuilder();
    foreach (var segment in segments) builder.Append(segment);
    return builder;
}
int[]? Units(string? value) => value?.Select(unit => (int)unit).ToArray();
void Capture(string id, string[] destination, string[]? source, bool self = false, bool nullReceiver = false)
{
    StringBuilder? builder = nullReceiver ? null : Create(destination);
    StringBuilder? input = self ? builder : source == null ? null : Create(source);
    var sourceBefore = Units(input?.ToString());
    string? fault = null;
    bool? same = null;
    try
    {
        var returned = builder!.Append(input);
        same = ReferenceEquals(builder, returned);
    }
    catch (Exception error) { fault = error.GetType().Name; }
    rows.Add(new {
        id, destination = destination.Select(Units).ToArray(), source = source?.Select(Units).ToArray(), self, nullReceiver,
        sourceBefore, sourceOutput = Units(input?.ToString()), output = Units(builder?.ToString()),
        length = builder?.Length, same, fault
    });
}

Capture("null-source", ["seed|"], null);
Capture("null-source-empty-destination", [], null);
Capture("fresh-empty-source", ["seed|"], []);
Capture("empty-segments-source", ["seed|"], ["", ""]);
Capture("empty-destination", [], ["abc"]);
Capture("single-segments", ["seed|"], ["abc"]);
Capture("multiple-segments", ["s", "e", "ed|"], ["a", "b", "c"]);
Capture("unicode-segments", ["seed|"], ["A", "\0", "\uD800", "\uDC00", "\uD800x\uDC00Z"]);
Capture("surrogate-across-append", ["\uD800"], ["\uDC00"]);
Capture("newlines", ["a\r"], ["\n", "b\r\nc"]);
Capture("moderate-segments", ["seed|"], [new string('x', 17), new string('y', 33), new string('z', 15)]);
Capture("self-empty", [], null, true);
Capture("self-empty-segments", ["", ""], null, true);
Capture("self-single", ["seed|"], null, true);
Capture("self-multiple", ["a", "b", "c"], null, true);
Capture("self-unicode", ["\0", "\uD800", "\uDC00", "\uD800x\uDC00"], null, true);
Capture("self-moderate", [new string('x', 17), new string('y', 33), new string('z', 15)], null, true);
Capture("null-receiver-null-source", [], null, false, true);
Capture("null-receiver-empty-source", [], [], false, true);
Capture("null-receiver-nonempty-source", [], ["abc"], false, true);
Capture("null-receiver-self", [], null, true, true);

var result = new {
    sdk = "10.0.201", runtime = Environment.Version.ToString(),
    sourceSha256 = Convert.ToHexStringLower(SHA256.HashData(File.ReadAllBytes("Program.cs"))), rows
};
File.WriteAllText(args[0], JsonSerializer.Serialize(result, new JsonSerializerOptions { WriteIndented = true }) + "\n");
