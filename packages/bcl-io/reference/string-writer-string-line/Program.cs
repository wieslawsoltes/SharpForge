using System.Globalization;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text.Json;

if (args.Length != 1 || Environment.Version.ToString() != "10.0.5")
    throw new InvalidOperationException("Use .NET 10.0.5 and provide the output JSON path.");
CultureInfo.CurrentCulture = CultureInfo.InvariantCulture;
CultureInfo.CurrentUICulture = CultureInfo.InvariantCulture;

var values = new ValueCase[] {
    new("null", null), new("empty", ""), new("payload", "payload"),
    new("utf16", "\0\uD800\uDC00\uDFFF\uFFFF")
};
var newlines = new NewlineCase[] {
    new("default", false, null), new("empty", true, ""), new("custom", true, "~"),
    new("null-reset", true, null), new("utf16", true, "\0\uDFFF!")
};
var rows = new List<object>();
foreach (bool baseView in new[] { false, true })
foreach (var value in values)
foreach (string state in new[] { "open", "disposed", "null" })
{
    foreach (var newline in newlines)
        Capture(value, newline, state, baseView, true);
    Capture(value, newlines[0], state, baseView, false);
}

void Capture(ValueCase value, NewlineCase newline, string state, bool baseView, bool line)
{
    using StringWriter? writer = state == "null" ? null : new StringWriter();
    writer?.Write("seed|");
    if (writer != null && newline.Set)
        writer.NewLine = newline.Value;
    if (state == "disposed")
        writer!.Dispose();
    string? fault = null;
    try { Invoke(writer, baseView, line, value.Value); }
    catch (Exception error) { fault = error.GetType().Name; }
    rows.Add(new {
        id = $"{(line ? "WriteLine" : "Write")}/{baseView}/{value.Id}/{newline.Id}/{state}",
        operation = line ? "WriteLine" : "Write", valueCase = value.Id, value = Units(value.Value),
        baseView, receiverState = state, setNewLine = newline.Set,
        requestedNewLine = Units(newline.Value), actualNewLine = Units(writer?.NewLine),
        output = Units(writer?.ToString()), fault
    });
}

static void Invoke(StringWriter? writer, bool baseView, bool line, string? value)
{
    if (baseView)
    {
        TextWriter? view = writer;
        if (line) view!.WriteLine(value);
        else view!.Write(value);
    }
    else if (line) writer!.WriteLine(value);
    else writer!.Write(value);
}

static int[]? Units(string? text) => text?.Select(unit => (int)unit).ToArray();

var transitions = new List<object>();
foreach (bool baseView in new[] { false, true })
foreach (var value in values.Where(value => value.Id != "empty"))
foreach (string state in new[] { "open", "disposed" })
foreach (string mode in new[] { "newline", "dispose", "throw" })
{
    using var writer = new TransitionWriter(mode) { NewLine = "~" };
    writer.Write("seed|");
    if (state == "disposed")
        writer.Dispose();
    writer.Arm();
    string? fault = null;
    try { Invoke(writer, baseView, true, value.Value); }
    catch (Exception error) { fault = error.GetType().Name; }
    transitions.Add(new {
        id = $"{baseView}/{value.Id}/{state}/{mode}", nativeOnly = true, baseView,
        valueCase = value.Id, value = Units(value.Value), receiverState = state, mode,
        requestedNewLine = Units("~"), changedNewLine = Units("!\r\n"),
        events = writer.Events.ToArray(), writer.ParameterlessLineCalls, writer.Armed,
        writer.Disposed, output = Units(writer.ToString()), actualNewLine = Units(writer.NewLine), fault
    });
}

var result = new {
    schemaVersion = 1, sdk = "10.0.201", runtime = Environment.Version.ToString(),
    platform = RuntimeInformation.OSDescription, architecture = RuntimeInformation.ProcessArchitecture.ToString(),
    culture = "InvariantCulture", environmentNewLine = Units(Environment.NewLine),
    sourceSha256 = Convert.ToHexStringLower(SHA256.HashData(File.ReadAllBytes("Program.cs"))),
    runtimeSource = new {
        tag = "v10.0.5", textWriterBlob = "035664cc815f5e70e478413e3efbe4c9407deae9",
        stringWriterBlob = "478d95fd347ac47198fc5341e606aba7d62eb19c"
    },
    rows, transitions
};
var options = new JsonSerializerOptions { WriteIndented = true, PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
File.WriteAllText(args[0], JsonSerializer.Serialize(result, options) + "\n");

sealed record ValueCase(string Id, string? Value);
sealed record NewlineCase(string Id, bool Set, string? Value);
sealed record WriteEvent(string Kind, int Call, int[]? Value = null, string? Fault = null);

// Native subclass observations are separate from ordinary StringWriter results.
// WriteLine(string) inherits two virtual Write(string) calls and no parameterless WriteLine call.
sealed class TransitionWriter(string mode) : StringWriter
{
    public List<WriteEvent> Events { get; } = [];
    public int ParameterlessLineCalls { get; private set; }
    public bool Armed { get; private set; }
    public bool Disposed { get; private set; }
    private int calls;

    public void Arm()
    {
        Events.Clear();
        calls = 0;
        ParameterlessLineCalls = 0;
        Armed = true;
    }

    public override void Write(string? value)
    {
        int call = ++calls;
        Events.Add(new("write-enter", call, value?.Select(unit => (int)unit).ToArray()));
        try { base.Write(value); }
        catch (Exception error)
        {
            Events.Add(new("write-fault", call, Fault: error.GetType().Name));
            throw;
        }
        Events.Add(new("write-complete", call));
        if (!Armed)
            return;
        Armed = false;
        switch (mode)
        {
            case "newline":
                NewLine = "!\r\n";
                Events.Add(new("newline-changed", call));
                break;
            case "dispose":
                Dispose();
                Events.Add(new("disposed", call));
                break;
            case "throw":
                Events.Add(new("callback-threw", call));
                throw new InvalidOperationException("Native string-line transition callback.");
            default:
                throw new InvalidOperationException("Unknown transition mode.");
        }
    }

    public override void WriteLine()
    {
        ParameterlessLineCalls++;
        base.WriteLine();
    }

    protected override void Dispose(bool disposing)
    {
        base.Dispose(disposing);
        Disposed = true;
    }
}
