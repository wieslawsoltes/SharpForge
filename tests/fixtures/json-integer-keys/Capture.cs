using System.Security.Cryptography;
using System.Text.Json;

public class Capture
{
    public static void Main()
    {
        var savedOutput = Console.Out;
        using var captured = new StringWriter();
        Console.SetOut(captured);
        JsonIntegerKeys.Main();
        Console.SetOut(savedOutput);
        var source = File.ReadAllBytes("Cases.cs");
        var report = new
        {
            sdk = "10.0.201",
            runtime = Environment.Version.ToString(),
            sourceSha256 = Convert.ToHexString(SHA256.HashData(source)).ToLowerInvariant(),
            lines = captured.ToString().TrimEnd('\r', '\n').Split('\n').Select(line => line.TrimEnd('\r')).ToArray()
        };
        Console.WriteLine(JsonSerializer.Serialize(report, new JsonSerializerOptions { WriteIndented = true }));
    }
}
