using System.Security.Cryptography;
using System.Text.Json;

public class Capture
{
    public static void Main()
    {
        if (Environment.Version.ToString() != "10.0.5")
            throw new InvalidOperationException("Capture requires CoreCLR 10.0.5.");
        var original = Console.Out;
        using var output = new StringWriter();
        Console.SetOut(output);
        JsonInt64Cases.Main();
        Console.SetOut(original);
        Console.WriteLine(JsonSerializer.Serialize(new {
            sdk = "10.0.201",
            runtime = Environment.Version.ToString(),
            sourceSha256 = Convert.ToHexString(SHA256.HashData(File.ReadAllBytes("Cases.cs"))).ToLowerInvariant(),
            lines = output.ToString().TrimEnd('\r', '\n').Split('\n').Select(line => line.TrimEnd('\r')).ToArray()
        }, new JsonSerializerOptions { WriteIndented = true }));
    }
}
