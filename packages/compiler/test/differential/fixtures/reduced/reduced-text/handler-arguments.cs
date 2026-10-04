using System;
using System.Diagnostics;
using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text;

// Reduced from stress-text/interpolation-formats: a handler parameter marked [InterpolatedStringHandlerArgument]
// receives the receiver or other arguments of its call, and the handler types of the class library are handlers too.

[InterpolatedStringHandler]
public ref struct LogHandler
{
    private readonly StringBuilder _text;
    public bool Enabled { get; }

    public LogHandler(int literalLength, int formattedCount, Logger logger, int level, out bool enabled)
    {
        enabled = level >= logger.Minimum;
        Enabled = enabled;
        _text = enabled ? new StringBuilder(logger.Prefix + "[" + literalLength + "," + formattedCount + "] ") : null;
    }

    public void AppendLiteral(string text) => _text.Append(text);
    public void AppendFormatted<T>(T value) => _text.Append('<').Append(value).Append('>');
    public void AppendFormatted<T>(T value, string format) where T : IFormattable =>
        _text.Append(value.ToString(format, CultureInfo.InvariantCulture));
    public string Text => _text?.ToString() ?? "(disabled)";
}

public class Logger
{
    public int Minimum;
    public string Prefix = "log";
    public int Evaluations;

    public void Write(int level, [InterpolatedStringHandlerArgument("", "level")] ref LogHandler handler) =>
        Console.WriteLine(level + ": " + handler.Text);

    public int Count()
    {
        Evaluations++;
        return Evaluations;
    }
}

public static class Program
{
    private static int _calls;

    private static int Next()
    {
        _calls++;
        return _calls * 10;
    }

    private static Logger Make(string prefix)
    {
        Console.WriteLine("make " + prefix);
        return new Logger { Prefix = prefix, Minimum = 2 };
    }

    public static void Main()
    {
        var builder = new StringBuilder();
        int count = 42;
        double ratio = 0.125;
        string name = "widget";
        object nothing = null;

        builder.Append($"{count}|{ratio}|{name}|{'c'}|{nothing}|{count,6}|{count,-6}|{ratio:P1}|");
        builder.Append(CultureInfo.InvariantCulture, $"{count:D5} {ratio:F3} {1234567.891:N2}").AppendLine($" {name.AsSpan(0, 3)}!");
        builder.AppendLine(CultureInfo.InvariantCulture, $"{Next()} then {Next()}");
        builder.Append($"plain").Append($"").Append($"{name}");
        Console.Write(builder.ToString());
        Console.WriteLine();

        Span<char> buffer = stackalloc char[24];
        bool fits = buffer.TryWrite(CultureInfo.InvariantCulture, $"{count:X4}-{ratio:F2}", out int written);
        Console.WriteLine(fits + " " + written + " " + buffer.Slice(0, written).ToString());
        bool tooLong = buffer.TryWrite($"{name}{name}{name}{name}{Next()}", out written);
        Console.WriteLine(tooLong + " " + written + " calls " + _calls);

        Console.WriteLine(string.Create(CultureInfo.InvariantCulture, $"{ratio:E2} and {count,8:N1}"));
        Console.WriteLine(string.Create(CultureInfo.InvariantCulture, stackalloc char[8], $"{count}/{Next()}"));

        Debug.Assert(count == 42, $"not evaluated {Next()}");
        Console.WriteLine("calls " + _calls);

        var logger = new Logger { Minimum = 2 };
        logger.Write(1, $"skipped {logger.Count()}");
        logger.Write(3, $"written {logger.Count()} with {ratio:F1} and {name}");
        Console.WriteLine("evaluations " + logger.Evaluations);
        Make("made").Write(Next(), $"once {count}");
    }
}
