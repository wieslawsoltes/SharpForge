using System.Globalization;
using System.Security.Cryptography;
using System.Text.Json;

if (args.Length != 1 || Environment.Version.ToString() != "10.0.5")
    throw new InvalidOperationException("Use .NET 10.0.5 and provide the output JSON path.");
CultureInfo.CurrentCulture = CultureInfo.InvariantCulture;
CultureInfo.CurrentUICulture = CultureInfo.InvariantCulture;

var samples = new List<ScalarCase>();
void Add<T>(string type, params T[] values) where T : struct
{
    for (int index = 0; index < values.Length; index++)
        samples.Add(new ScalarCase(type + "/" + index, type, values[index]));
}

Add("bool", false, true);
Add("int", int.MinValue, -1, 0, 1, int.MaxValue);
Add("uint", 0u, 1u, 2147483647u, 2147483648u, uint.MaxValue);
Add("long", long.MinValue, -9007199254740993L, -1L, 0L, 1L,
    4294967296L, 9007199254740991L, 9007199254740992L, 9007199254740993L, long.MaxValue);
Add("ulong", 0UL, 1UL, 4294967296UL, 9007199254740991UL, 9007199254740992UL,
    9007199254740993UL, 9223372036854775808UL, ulong.MaxValue);
Add("float", 0f, BitConverter.Int32BitsToSingle(int.MinValue), 1f, -1f, 0.1f,
    float.Epsilon, -float.Epsilon, BitConverter.Int32BitsToSingle(0x007fffff),
    BitConverter.Int32BitsToSingle(0x00800000), float.MinValue, float.MaxValue,
    float.NaN, float.NegativeInfinity, float.PositiveInfinity, 1e-4f, 1e-5f,
    16777216f, 16777218f, 1.2345678f, 1e9f);
Add("double", 0d, BitConverter.Int64BitsToDouble(long.MinValue), 1d, -1d, 0.1d,
    double.Epsilon, -double.Epsilon, BitConverter.Int64BitsToDouble(0x000fffffffffffff),
    BitConverter.Int64BitsToDouble(0x0010000000000000), double.MinValue, double.MaxValue,
    double.NaN, double.NegativeInfinity, double.PositiveInfinity, 1e-4d, 1e-5d,
    9007199254740991d, 9007199254740992d, 0.84551240822557006d, 1e17d);
Add("decimal", 0m, 1m, -1m, 123.4500m, -123.4500m,
    new decimal(0, 0, 0, false, 2), new decimal(0, 0, 0, true, 28),
    new decimal(1, 0, 0, false, 28), new decimal(1, 0, 0, true, 28),
    9007199254740993m, decimal.MinValue, decimal.MaxValue,
    new decimal(-1, -1, -1, false, 28), new decimal(-1, -1, -1, true, 28));

var representatives = new ScalarCase[] {
    new("bool/representative", "bool", true),
    new("int/representative", "int", int.MinValue),
    new("uint/representative", "uint", uint.MaxValue),
    new("long/representative", "long", long.MinValue),
    new("ulong/representative", "ulong", ulong.MaxValue),
    new("float/representative", "float", BitConverter.Int32BitsToSingle(int.MinValue)),
    new("double/representative", "double", 0.84551240822557006d),
    new("decimal/representative", "decimal", 123.4500m)
};
var newlineCases = new NewlineCase[] {
    new("default", false, null), new("lf", true, "\n"), new("crlf", true, "\r\n"),
    new("empty", true, ""), new("custom", true, "<end>"), new("null-reset", true, null),
    new("utf16", true, "\0\uD800\uDC00\uDFFF\uFFFF")
};
var rows = new List<object>();
foreach (var sample in samples)
    Capture(sample, newlineCases[0], "open");
foreach (var sample in representatives)
{
    foreach (var newline in newlineCases.Skip(1))
        Capture(sample, newline, "open");
    Capture(sample, newlineCases[0], "null");
    Capture(sample, newlineCases[0], "disposed");
    Capture(sample, newlineCases[3], "disposed");
}

void Capture(ScalarCase sample, NewlineCase newline, string receiverState)
{
    foreach (bool line in new[] { false, true })
    {
        using StringWriter? writer = receiverState == "null" ? null : new StringWriter();
        writer?.Write("seed|");
        if (writer != null && newline.Set)
            writer.NewLine = newline.Value;
        if (receiverState == "disposed")
            writer!.Dispose();
        string? fault = null;
        try
        {
            Invoke(writer, sample.Value, line);
        }
        catch (Exception error)
        {
            fault = error.GetType().Name;
        }
        rows.Add(new {
            sample.Id, sample.Type, input = Describe(sample.Value), receiverState,
            operation = line ? "WriteLine" : "Write", newlineCase = newline.Id,
            setNewLine = newline.Set, requestedNewLine = Units(newline.Value),
            actualNewLine = Units(writer?.NewLine), output = Units(writer?.ToString()), fault
        });
    }
}

// Typed pattern variables preserve overload selection after values leave the case table.
static void Invoke(TextWriter? writer, object scalar, bool line)
{
    switch (scalar)
    {
        case bool boolean:
            if (line) writer!.WriteLine(boolean);
            else writer!.Write(boolean);
            break;
        case int signedInt:
            if (line) writer!.WriteLine(signedInt);
            else writer!.Write(signedInt);
            break;
        case uint unsignedInt:
            if (line) writer!.WriteLine(unsignedInt);
            else writer!.Write(unsignedInt);
            break;
        case long signedLong:
            if (line) writer!.WriteLine(signedLong);
            else writer!.Write(signedLong);
            break;
        case ulong unsignedLong:
            if (line) writer!.WriteLine(unsignedLong);
            else writer!.Write(unsignedLong);
            break;
        case float single:
            if (line) writer!.WriteLine(single);
            else writer!.Write(single);
            break;
        case double number:
            if (line) writer!.WriteLine(number);
            else writer!.Write(number);
            break;
        case decimal exact:
            if (line) writer!.WriteLine(exact);
            else writer!.Write(exact);
            break;
        default:
            throw new InvalidOperationException("Unknown fixture scalar type.");
    }
}

static int[]? Units(string? text) => text?.Select(unit => (int)unit).ToArray();

static object Describe(object value)
{
    string text = Convert.ToString(value, CultureInfo.InvariantCulture)!;
    return value switch {
        float single => new { text, bits = BitConverter.SingleToUInt32Bits(single).ToString("x8") },
        double number => new { text, bits = BitConverter.DoubleToUInt64Bits(number).ToString("x16") },
        decimal number => (object)new { text, bits = decimal.GetBits(number) },
        _ => new { text }
    };
}

var transitions = new List<object>();
foreach (var sample in representatives)
foreach (string mode in new[] { "newline", "dispose", "throw" })
{
    using var writer = new TransitionWriter(mode) { NewLine = "|" };
    writer.Write("seed|");
    writer.Armed = true;
    string? fault = null;
    try
    {
        Invoke(writer, sample.Value, true);
    }
    catch (Exception error)
    {
        fault = error.GetType().Name;
    }
    transitions.Add(new {
        sample.Id, sample.Type, input = Describe(sample.Value), mode, nativeOnly = true,
        events = writer.Events.ToArray(), output = Units(writer.ToString()),
        newLine = Units(writer.NewLine), fault
    });
}

var result = new {
    schemaVersion = 1, sdk = "10.0.201", runtime = Environment.Version.ToString(),
    culture = "InvariantCulture", declaredReceiver = "System.IO.TextWriter",
    concreteReceiver = "System.IO.StringWriter", environmentNewLine = Units(Environment.NewLine),
    sourceSha256 = Convert.ToHexStringLower(SHA256.HashData(File.ReadAllBytes("Program.cs"))),
    runtimeSource = new {
        tag = "v10.0.5", textWriterBlob = "035664cc815f5e70e478413e3efbe4c9407deae9",
        stringWriterBlob = "478d95fd347ac47198fc5341e606aba7d62eb19c"
    },
    rows, transitions
};
var options = new JsonSerializerOptions { WriteIndented = true, PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
File.WriteAllText(args[0], JsonSerializer.Serialize(result, options) + "\n");

sealed record ScalarCase(string Id, string Type, object Value);
sealed record NewlineCase(string Id, bool Set, string? Value);

// Native-only observation of inherited scalar Write(value), then virtual WriteLine().
// SharpForge host observers model this boundary without executing writer subclasses.
sealed class TransitionWriter(string mode) : StringWriter
{
    public bool Armed { get; set; }
    public List<string> Events { get; } = [];

    public override void Write(string? value)
    {
        base.Write(value);
        if (!Armed)
            return;
        Armed = false;
        Events.Add("value-written");
        switch (mode)
        {
            case "newline":
                NewLine = "!\r\n";
                Events.Add("newline-changed");
                break;
            case "dispose":
                Dispose();
                Events.Add("disposed");
                break;
            case "throw":
                Events.Add("callback-threw");
                throw new InvalidOperationException("Native transition callback.");
            default:
                throw new InvalidOperationException("Unknown transition mode.");
        }
    }

    public override void WriteLine()
    {
        Events.Add("line-entered");
        base.WriteLine();
        Events.Add("line-written");
    }
}
