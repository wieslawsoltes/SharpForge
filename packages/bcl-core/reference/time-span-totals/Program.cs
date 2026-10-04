using System.Globalization;
using System.Security.Cryptography;
using System.Text.Json;

if (args.Length != 1 || Environment.Version.ToString() != "10.0.5")
    throw new InvalidOperationException("Use .NET 10.0.5 and provide the output JSON path.");
CultureInfo.CurrentCulture = CultureInfo.InvariantCulture;
long[] ticks = [
    long.MinValue, long.MinValue + 1, -9223372036854770001, -9223372036854770000,
    -9223372036854769999, -123456789012345678, -9007199254740993, -123456789, -1,
    0, 1, 123456789, 9007199254740993, 123456789012345678,
    9223372036854769999, 9223372036854770000, 9223372036854770001, long.MaxValue - 1, long.MaxValue
];
var rows = ticks.Select(tick => {
    var value = new TimeSpan(tick);
    return new {
        ticks = value.Ticks.ToString(CultureInfo.InvariantCulture),
        totalMilliseconds = value.TotalMilliseconds.ToString("R", CultureInfo.InvariantCulture),
        totalSeconds = value.TotalSeconds.ToString("R", CultureInfo.InvariantCulture)
    };
}).ToArray();
var result = new {
    sdk = "10.0.201", runtime = Environment.Version.ToString(),
    sourceSha256 = Convert.ToHexStringLower(SHA256.HashData(File.ReadAllBytes("Program.cs"))),
    source = "Public TimeSpan(long) constructor and TotalMilliseconds/TotalSeconds getters; no simulator or private state mutation.",
    rows
};
File.WriteAllText(args[0], JsonSerializer.Serialize(result, new JsonSerializerOptions { WriteIndented = true }) + "\n");
