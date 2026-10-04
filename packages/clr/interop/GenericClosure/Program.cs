using System;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text.Json;

namespace GenericClosureOracle;

internal static class Program
{
    private static object Header(object observations) => new
    {
        schemaVersion = 1, runtime = Environment.Version.ToString(), framework = RuntimeInformation.FrameworkDescription,
        architecture = RuntimeInformation.ProcessArchitecture.ToString().ToLowerInvariant(), observations
    };

    private static object Prepare(string directory, string source)
    {
        using var document = JsonDocument.Parse(File.ReadAllText(Path.Combine(source, "images.json")));
        var images = MetadataImage.Create(directory, document.RootElement);
        var metadata = images.Select(image => new { image = image.id, records = MetadataInventory.Read(Path.Combine(directory, image.file)) }).ToArray();
        var result = new { images, metadata };
        using var output = new FileStream(Path.Combine(directory, "images.json"), FileMode.CreateNew, FileAccess.Write);
        JsonSerializer.Serialize(output, result);
        return result;
    }

    private static object Observe(string directory, string source, string id, string journalPath)
    {
        using var imageDocument = JsonDocument.Parse(File.ReadAllText(Path.Combine(directory, "images.json")));
        var images = imageDocument.RootElement.GetProperty("images").Deserialize<ClosureImage[]>()!
            .ToDictionary(image => image.id, StringComparer.Ordinal);
        using var matrixDocument = JsonDocument.Parse(File.ReadAllText(Path.Combine(source, "matrix.json")));
        var item = matrixDocument.RootElement.GetProperty("cases").EnumerateArray().Single(item => item.GetProperty("id").GetString() == id);
        var bindings = new RequestBindings(images);
        using var observations = new CaseObservations(id, directory, images, journalPath);
        return observations.Run(item, bindings);
    }

    public static void Main(string[] arguments)
    {
        if (arguments.Length != 3 && arguments.Length != 5)
            throw new ArgumentException("Usage: GenericClosureOracle.dll prepare images source | observe images source case-id progress-file");
        object result;
        if (arguments[0] == "prepare" && arguments.Length == 3) result = Prepare(arguments[1], arguments[2]);
        else if (arguments[0] == "observe" && arguments.Length == 5)
            result = Observe(arguments[1], arguments[2], arguments[3], arguments[4]);
        else throw new ArgumentException("Invalid GenericClosureOracle mode or argument count");
        Console.WriteLine(JsonSerializer.Serialize(Header(result)));
    }
}
