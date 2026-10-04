using System.Globalization;
using System.Security.Cryptography;
using System.Text.Json;

if (args.Length != 1 || Environment.Version.ToString() != "10.0.5")
    throw new InvalidOperationException("Use .NET 10.0.5 and provide the output JSON path.");
CultureInfo.CurrentCulture = CultureInfo.InvariantCulture;
var rows = new List<object>();
void Capture(string id, string? input, int index = 0, int count = 0,
    bool full = false, bool disposed = false, bool nullWriter = false,
    string? newLine = "\n", bool setNewLine = true)
{
    foreach (var baseView in new[] { false, true })
    {
        StringWriter? writer = nullWriter ? null : new StringWriter();
        writer?.Write("seed|");
        if (writer != null && setNewLine) writer.NewLine = newLine;
        if (disposed) writer!.Dispose();
        var buffer = input?.ToCharArray();
        string? fault = null, parameter = null;
        try
        {
            if (baseView)
            {
                TextWriter? view = writer;
                if (full) view!.WriteLine(buffer);
                else view!.WriteLine(buffer!, index, count);
            }
            else if (full) writer!.WriteLine(buffer);
            else writer!.WriteLine(buffer!, index, count);
        }
        catch (Exception error)
        {
            fault = error.GetType().Name;
            parameter = (error as ArgumentException)?.ParamName;
        }
        rows.Add(new {
            id = id + (baseView ? "/TextWriter" : "/StringWriter"), baseView, full, index, count, disposed, nullWriter,
            input = input?.Select(unit => (int)unit).ToArray(), buffer = buffer?.Select(unit => (int)unit).ToArray(),
            newLine = newLine?.Select(unit => (int)unit).ToArray(), setNewLine,
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
Capture("default-newline", "ABC", full: true, setNewLine: false);
Capture("empty-newline", "ABC", full: true, newLine: "");
Capture("null-empty-newline", null, full: true, newLine: "");
Capture("disposed-null-empty-newline", null, full: true, disposed: true, newLine: "");
Capture("disposed-zero-empty-newline", "ABC", 3, 0, disposed: true, newLine: "");
Capture("custom-newline", "ABC", 1, 2, newLine: "<\r\n>");
Capture("unicode-newline", "ABC", full: true, newLine: "\0\uD800\uDC00\uFFFF");
Capture("reset-newline", "ABC", full: true, newLine: null);

var transitions = new List<object>();
foreach (var mode in new[] { "newline", "dispose" })
foreach (var full in new[] { false, true })
foreach (var baseView in new[] { false, true })
{
    var writer = new TransitionWriter(mode) { NewLine = "|" };
    writer.Write("seed|");
    writer.Armed = true;
    char[] buffer = ['A', 'B', 'C', 'D'];
    string? fault = null;
    try
    {
        if (baseView)
        {
            TextWriter view = writer;
            if (full) view.WriteLine(buffer);
            else view.WriteLine(buffer, 1, 2);
        }
        else if (full) writer.WriteLine(buffer);
        else writer.WriteLine(buffer, 1, 2);
    }
    catch (Exception error) { fault = error.GetType().Name; }
    transitions.Add(new {
        mode, full, baseView, fault,
        output = writer.ToString().Select(unit => (int)unit).ToArray(),
        newLine = writer.NewLine.Select(unit => (int)unit).ToArray()
    });
}

var result = new {
    sdk = "10.0.201", runtime = Environment.Version.ToString(),
    sourceSha256 = Convert.ToHexStringLower(SHA256.HashData(File.ReadAllBytes("Program.cs"))), rows, transitions
};
File.WriteAllText(args[0], JsonSerializer.Serialize(result, new JsonSerializerOptions { WriteIndented = true }) + "\n");

// This native-only subclass records the boundary between value and newline writes.
// Managed tests use host observers at that boundary; custom subclasses remain outside the profile.
sealed class TransitionWriter(string mode) : StringWriter
{
    public bool Armed { get; set; }
    public override void Write(char[] buffer, int index, int count)
    {
        base.Write(buffer, index, count);
        if (!Armed) return;
        Armed = false;
        if (mode == "newline") NewLine = "!";
        else Dispose();
    }
}
