using System.Globalization;
using System.Security.Cryptography;
using System.Text.Json;

if (args.Length != 1 || Environment.Version.ToString() != "10.0.5")
    throw new InvalidOperationException("Use .NET 10.0.5 and provide the output JSON path.");
CultureInfo.CurrentCulture = CultureInfo.InvariantCulture;
var rows = new List<object>();
void Capture(string id, string? input, int index = 0, int count = 0,
    bool full = false, bool disposed = false, bool nullWriter = false)
{
    foreach (var baseView in new[] { false, true })
    {
        StringWriter? writer = nullWriter ? null : new StringWriter();
        writer?.Write("seed|");
        if (disposed) writer!.Dispose();
        var buffer = input?.ToCharArray();
        string? fault = null, parameter = null;
        try
        {
            if (baseView)
            {
                TextWriter? view = writer;
                if (full) view!.Write(buffer);
                else view!.Write(buffer!, index, count);
            }
            else if (full) writer!.Write(buffer);
            else writer!.Write(buffer!, index, count);
        }
        catch (Exception error)
        {
            fault = error.GetType().Name;
            parameter = (error as ArgumentException)?.ParamName;
        }
        rows.Add(new {
            id = id + (baseView ? "/TextWriter" : "/StringWriter"), baseView, full, index, count, disposed, nullWriter,
            input = input?.Select(unit => (int)unit).ToArray(), buffer = buffer?.Select(unit => (int)unit).ToArray(),
            output = writer?.ToString().Select(unit => (int)unit).ToArray(), fault, parameter
        });
    }
}

Capture("full", "ABCDE", full: true);
Capture("full-empty", "", full: true);
Capture("full-null", null, full: true);
Capture("full-unicode", "\0\uD83D\uDE00\uD800X\uDC00\uFFFF", full: true);
Capture("full-disposed", "ABCDE", full: true, disposed: true);
Capture("full-disposed-empty", "", full: true, disposed: true);
Capture("full-disposed-null", null, full: true, disposed: true);
Capture("full-null-writer", "ABCDE", full: true, nullWriter: true);
Capture("full-null-writer-buffer", null, full: true, nullWriter: true);
Capture("slice", "ABCDE", 1, 3);
Capture("prefix", "ABCDE", 0, 2);
Capture("suffix", "ABCDE", 3, 2);
Capture("zero", "ABCDE", 2, 0);
Capture("zero-at-end", "ABCDE", 5, 0);
Capture("empty", "", 0, 0);
Capture("unicode", "\0\uD83D\uDE00\uD800X\uDC00\uFFFF", 1, 5);
Capture("split-pair", "\uD83D\uDE00", 1, 1);
Capture("null", null);
Capture("null-before-range", null, -1, -1);
Capture("negative-index", "ABC", -1, 1);
Capture("negative-count", "ABC", 0, -1);
Capture("both-negative", "ABC", -1, -1);
Capture("past-end", "ABC", 4, 0);
Capture("cross-end", "ABC", 2, 2);
Capture("max-index", "ABC", int.MaxValue, 0);
Capture("max-count", "ABC", 0, int.MaxValue);
Capture("disposed", "ABC", 0, 1, disposed: true);
Capture("disposed-zero", "ABC", 3, 0, disposed: true);
Capture("disposed-empty", "", 0, 0, disposed: true);
Capture("disposed-null", null, -1, -1, disposed: true);
Capture("disposed-index", "ABC", -1, 1, disposed: true);
Capture("disposed-count", "ABC", 0, -1, disposed: true);
Capture("disposed-slice", "ABC", 3, 1, disposed: true);
Capture("null-writer", "ABC", 0, 1, nullWriter: true);
Capture("null-writer-buffer", null, -1, -1, nullWriter: true);

var result = new {
    sdk = "10.0.201", runtime = Environment.Version.ToString(),
    sourceSha256 = Convert.ToHexStringLower(SHA256.HashData(File.ReadAllBytes("Program.cs"))), rows
};
File.WriteAllText(args[0], JsonSerializer.Serialize(result, new JsonSerializerOptions { WriteIndented = true }) + "\n");
