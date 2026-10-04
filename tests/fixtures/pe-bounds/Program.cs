#nullable enable
using System;
using System.IO;
using System.Linq;
using System.Reflection.Metadata;
using System.Reflection.PortableExecutable;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text.Json;

// Header inspection only. No input assembly is loaded or executed.
internal static class Program
{
    private static object Failure(Exception error) => new { name = error.GetType().FullName, message = error.Message };

    private static object Observe(string path)
    {
        if (new FileInfo(path).Length > 1024 * 1024) throw new InvalidDataException("Authored image limit exceeded.");
        byte[] bytes = File.ReadAllBytes(path);
        if (bytes.Length > 1024 * 1024) throw new InvalidDataException("Authored image limit exceeded.");
        object? headers = null;
        object? headerError = null;
        object? metadata = null;
        object? metadataError = null;
        try
        {
            using var stream = new MemoryStream(bytes, writable: false);
            using var reader = new PEReader(stream);
            PEHeaders parsed = reader.PEHeaders;
            PEHeader optional = parsed.PEHeader ?? throw new BadImageFormatException("Missing PE optional header.");
            headers = new
            {
                machine = (ushort)parsed.CoffHeader.Machine,
                sectionCount = (ushort)parsed.CoffHeader.NumberOfSections,
                sizeOfHeaders = unchecked((uint)optional.SizeOfHeaders),
                sections = parsed.SectionHeaders.Select(section => new
                {
                    name = section.Name,
                    rva = unchecked((uint)section.VirtualAddress),
                    virtualSize = unchecked((uint)section.VirtualSize),
                    size = unchecked((uint)section.SizeOfRawData),
                    offset = unchecked((uint)section.PointerToRawData)
                }).ToArray()
            };
            try
            {
                MetadataReader tables = reader.GetMetadataReader(MetadataReaderOptions.None);
                metadata = new { moduleName = tables.GetString(tables.GetModuleDefinition().Name) };
            }
            catch (Exception error) { metadataError = Failure(error); }
        }
        catch (Exception error) { headerError = Failure(error); }
        return new
        {
            imageBytes = bytes.Length,
            imageSha256 = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant(),
            headers, headerError, metadata, metadataError
        };
    }

    public static int Main(string[] args)
    {
        if (args.Length != 1) return 2;
        using JsonDocument manifest = JsonDocument.Parse(File.ReadAllText(args[0]));
        var results = manifest.RootElement.EnumerateArray().Select(row => new
        {
            id = row.GetProperty("id").GetString(),
            observation = Observe(row.GetProperty("path").GetString()!)
        }).ToArray();
        Console.WriteLine(JsonSerializer.Serialize(new
        {
            runtime = RuntimeInformation.FrameworkDescription,
            metadataAssemblyVersion = typeof(PEReader).Assembly.GetName().Version?.ToString(),
            results
        }));
        return 0;
    }
}
