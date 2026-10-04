using System.Globalization;
using System.Security.Cryptography;
using System.Text.Json;

if (args.Length != 1 || Environment.Version.ToString() != "10.0.5")
    throw new InvalidOperationException("Use .NET 10.0.5 and provide the output JSON path.");
CultureInfo.CurrentCulture = CultureInfo.InvariantCulture;
var rows = new List<object>();
void Capture(string id, char value, bool disposed = false, bool nullWriter = false,
    string? newLine = null, bool setNewLine = false)
{
    foreach (var baseView in new[] { false, true })
    {
        StringWriter? writer = nullWriter ? null : new StringWriter();
        writer?.Write("seed|");
        if (writer != null && setNewLine) writer.NewLine = newLine;
        if (disposed) writer!.Dispose();
        string? fault = null;
        try
        {
            if (baseView)
            {
                TextWriter? view = writer;
                view!.WriteLine(value);
            }
            else writer!.WriteLine(value);
        }
        catch (Exception error) { fault = error.GetType().Name; }
        rows.Add(new {
            id = id + (baseView ? "/TextWriter" : "/StringWriter"), baseView, value = (int)value, disposed, nullWriter,
            newLine = newLine?.Select(unit => (int)unit).ToArray(), setNewLine,
            output = writer?.ToString().Select(unit => (int)unit).ToArray(), fault
        });
    }
}

foreach (var unit in new[] { 0, 10, 13, 65, 0xD7FF, 0xD800, 0xDBFF, 0xDC00, 0xDFFF, 0xE000, 0xFFFF })
    Capture("unit-" + unit, (char)unit);
Capture("disposed-nul", '\0', disposed: true);
Capture("disposed-surrogate", '\uD800', disposed: true);
Capture("null-receiver-nul", '\0', nullWriter: true);
Capture("null-receiver-max", '\uFFFF', nullWriter: true);
Capture("empty-newline", 'A', newLine: "", setNewLine: true);
Capture("custom-newline", 'A', newLine: "<\r\n>", setNewLine: true);
Capture("reset-newline", 'A', newLine: null, setNewLine: true);
Capture("unicode-newline", '\uD800', newLine: "\0\uDC00\uFFFF", setNewLine: true);
Capture("disposed-empty-newline", '\0', disposed: true, newLine: "", setNewLine: true);

var transitions = new List<object>();
foreach (var mode in new[] { "newline", "dispose" })
foreach (var baseView in new[] { false, true })
{
    var writer = new TransitionWriter(mode) { NewLine = "|" };
    writer.Write("seed|");
    writer.Armed = true;
    const char value = '\uD800';
    string? fault = null;
    try
    {
        if (baseView)
        {
            TextWriter view = writer;
            view.WriteLine(value);
        }
        else writer.WriteLine(value);
    }
    catch (Exception error) { fault = error.GetType().Name; }
    transitions.Add(new {
        mode, baseView, value = (int)value, fault,
        output = writer.ToString().Select(unit => (int)unit).ToArray(),
        newLine = writer.NewLine.Select(unit => (int)unit).ToArray()
    });
}

var result = new {
    sdk = "10.0.201", runtime = Environment.Version.ToString(),
    sourceSha256 = Convert.ToHexStringLower(SHA256.HashData(File.ReadAllBytes("Program.cs"))), rows, transitions
};
File.WriteAllText(args[0], JsonSerializer.Serialize(result, new JsonSerializerOptions { WriteIndented = true }) + "\n");

// Native-only observation of the inherited Write(char), then WriteLine() sequence.
// Managed tests use host observers, without enabling custom TextWriter subclasses.
sealed class TransitionWriter(string mode) : StringWriter
{
    public bool Armed { get; set; }
    public override void Write(char value)
    {
        base.Write(value);
        if (!Armed) return;
        Armed = false;
        if (mode == "newline") NewLine = "!";
        else Dispose();
    }
}
