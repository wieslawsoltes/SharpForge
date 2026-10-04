using System.Globalization;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text.Json;

if (args.Length != 1 || Environment.Version.ToString() != "10.0.5")
    throw new InvalidOperationException("Use runtime 10.0.5 and supply the output JSON path.");
CultureInfo.CurrentCulture = CultureInfo.InvariantCulture;
CultureInfo.CurrentUICulture = CultureInfo.InvariantCulture;
var rows = new List<object>();

void Capture(string id, string source, int length, int index, int count, int start = 0,
    bool disposed = false, bool nullBuffer = false, bool nullReader = false)
{
    foreach (string method in new[] { "Read", "ReadBlock" })
    {
        TextReader? reader = nullReader ? null : new StringReader(source);
        for (int offset = 0; offset < start; offset++) reader!.Read();
        if (disposed) reader!.Dispose();
        char[]? buffer = nullBuffer ? null : Enumerable.Repeat('.', length).ToArray();
        int? countRead = null;
        string? fault = null;
        try
        {
            countRead = method == "Read" ? reader!.Read(buffer!, index, count) : reader!.ReadBlock(buffer!, index, count);
        }
        catch (Exception error) { fault = error.GetType().Name; }
        int? next = null;
        string? nextFault = null;
        try { next = reader!.Peek(); }
        catch (Exception error) { nextFault = error.GetType().Name; }
        rows.Add(new {
            id = id + "/" + method, method, sourceUnits = source.Select(unit => (int)unit).ToArray(),
            bufferLength = length, index, count, start, disposed, nullBuffer, nullReader,
            countRead, fault, buffer = buffer?.Select(unit => (int)unit).ToArray(), next, nextFault
        });
    }
}

Capture("full-slice", "ABCDE", 7, 1, 5);
Capture("partial-eof", "AB", 7, 2, 4);
Capture("zero-count", "ABCDE", 7, 2, 0);
Capture("zero-at-end", "ABCDE", 7, 7, 0);
Capture("empty-source", "", 3, 1, 2);
Capture("empty-buffer", "ABCDE", 0, 0, 0);
Capture("at-eof", "ABCDE", 3, 1, 2, start: 5);
Capture("existing-cursor", "ABCDE", 5, 1, 3, start: 2);
Capture("utf16-units", "\0\uD83D\uDE00\uD800X\uDC00\r\n", 10, 1, 8);
Capture("split-surrogate", "\uD83D\uDE00", 3, 1, 1);
Capture("null-buffer", "ABCDE", 0, 0, 0, nullBuffer: true);
Capture("negative-index", "ABCDE", 3, -1, 1);
Capture("negative-count", "ABCDE", 3, 0, -1);
Capture("index-past-end", "ABCDE", 3, 4, 0);
Capture("cross-end", "ABCDE", 3, 2, 2);
Capture("maximum-index", "ABCDE", 3, int.MaxValue, 0);
Capture("maximum-count", "ABCDE", 3, 0, int.MaxValue);
Capture("null-before-range", "ABCDE", 0, -1, -1, nullBuffer: true);
Capture("both-negative", "ABCDE", 3, -1, -1);
Capture("disposed-valid", "ABCDE", 3, 0, 1, disposed: true);
Capture("disposed-zero", "ABCDE", 3, 3, 0, disposed: true);
Capture("disposed-empty", "", 0, 0, 0, disposed: true);
Capture("disposed-null", "ABCDE", 0, -1, -1, disposed: true, nullBuffer: true);
Capture("disposed-index", "ABCDE", 3, -1, 1, disposed: true);
Capture("disposed-count", "ABCDE", 3, 0, -1, disposed: true);
Capture("disposed-slice", "ABCDE", 3, 3, 1, disposed: true);
Capture("null-reader", "ABCDE", 3, 0, 1, nullReader: true);
Capture("null-reader-and-buffer", "ABCDE", 0, -1, -1, nullReader: true, nullBuffer: true);

var result = new {
    schemaVersion = 1, sdk = "10.0.201", runtime = Environment.Version.ToString(),
    framework = RuntimeInformation.FrameworkDescription, os = RuntimeInformation.OSDescription,
    architecture = RuntimeInformation.ProcessArchitecture.ToString(),
    sourceSha256 = Convert.ToHexStringLower(SHA256.HashData(File.ReadAllBytes("Program.cs"))), rows
};
File.WriteAllText(args[0], JsonSerializer.Serialize(result, new JsonSerializerOptions { WriteIndented = true }));
