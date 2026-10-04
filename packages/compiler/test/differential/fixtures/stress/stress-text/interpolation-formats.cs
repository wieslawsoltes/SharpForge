using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text;

public readonly struct Temperature : IFormattable
{
    public Temperature(double celsius) { Celsius = celsius; }
    public double Celsius { get; }
    public override string ToString() => ToString("C", CultureInfo.InvariantCulture);
    public string ToString(string format, IFormatProvider provider) => (format ?? "C") switch
    {
        "C" => Celsius.ToString("0.#", provider) + "°C",
        "F" => (Celsius * 9 / 5 + 32).ToString("0.#", provider) + "°F",
        "K" => (Celsius + 273.15).ToString("0.##", provider) + "K",
        _ => throw new FormatException("unknown format " + format),
    };
}

public sealed class Person
{
    public string Name { get; init; }
    public int Age { get; init; }
    public override string ToString() => Name + "/" + Age;
}

public sealed class UpperProvider : IFormatProvider, ICustomFormatter
{
    public object GetFormat(Type formatType) => formatType == typeof(ICustomFormatter) ? this : null;
    public string Format(string format, object arg, IFormatProvider formatProvider) =>
        arg is string s ? s.ToUpperInvariant() : arg is IFormattable f ? f.ToString(format, CultureInfo.InvariantCulture) : arg?.ToString() ?? "(null)";
}

public static class Program
{
    private static string Invariant(FormattableString text) => text.ToString(CultureInfo.InvariantCulture);
    private static string Describe(FormattableString text) => text.Format + " <- " + text.ArgumentCount + ": " + string.Join(",", text.GetArguments().Select(a => a?.GetType().Name ?? "null"));

    public static void Main()
    {
        int count = 42; double ratio = 2.0 / 3; decimal price = 1234.5m; string name = "Ada"; string missing = null; char letter = 'q'; bool flag = true;
        object boxed = 7; int? maybe = null; long big = 123456789012; DateTime date = new DateTime(2024, 12, 25, 8, 30, 0); TimeSpan span = TimeSpan.FromMinutes(135.5);
        var temperature = new Temperature(21.5);
        var person = new Person { Name = "Grace", Age = 85 };

        Console.WriteLine($"{count} {ratio} {price} {name} [{missing}] {letter} {flag} {boxed} [{maybe}] {big} {person} {temperature}");
        Console.WriteLine($"|{count,6}|{count,-6}|{name,5}|{name,-5}|{name,2}|{flag,7}|{letter,3}|{missing,4}|{temperature,10}|{temperature,-10:F}|");
        Console.WriteLine(Invariant($"{count:D6} {count:X} {count:x8} {count:N0} {count:E2} {count:P0} {count:C} {count:F2} {count:G} {count:0000.0} {count:#,##0} {-count:(0);[0]}"));
        Console.WriteLine(Invariant($"{ratio:F3} {ratio:P1} {ratio:E} {ratio:0.00000} {ratio:G3} {ratio:R} {price:N} {price:C1} {price:0,0.000} {price:#.#} {big:N0} {big:#,#,,.0M} {big:e3}"));
        Console.WriteLine(Invariant($"{date:yyyy-MM-dd} {date:HH:mm:ss} {date:dddd, MMMM d} {date:t} {date:hh tt} {date:yy/M/d} {date:o} {span} {span:hh\\:mm} {span:g} {date.DayOfWeek,-10}| {date:MMM}{date:%d}"));
        Console.WriteLine($"{temperature:C} {temperature:F} {temperature:K} {new Temperature(-40):F} {(count > 40 ? "big" : "small")} {(flag ? count : -count):+0;-0} {person.Name.ToUpperInvariant()[..2]} {person?.Age ?? 0} {new[] { 1, 2, 3 }.Sum()} {string.Join("/", name.Reverse())}");
        Console.WriteLine($"{{}} {{{count}}} {{{{{count}}}}} {"}"} {'{'} {"{0}"} {$"{name}:{$"{count}"}"} {$"{$"{$"{letter}"}"}"}");
        Console.WriteLine($@"C:\{name}\{count:D4}.txt ""quoted"" {{literal}}" + " " + @$"{letter}\n" + " " + $"""raw "{name}" {count:X}""" + " " + $$"""{{{count}}} {single} {{name}}""");
        Console.WriteLine($"""
            multi {name}
              line {count,5}|
            """.Replace("\n", "\\n"));
        const string greeting = "hi";
        const string constant = $"{greeting}, {nameof(Program)}";
        Console.WriteLine(constant + " " + $"{nameof(person.Name)}={person.Name}" + " " + $"{count}{count}{count}{count}{count}".Length + " " + $"" .Length + " " + $"{null}".Length + " " + $"{(object)null ?? "fallback"}");

        Console.WriteLine(Describe($"{count} and {name,-3} and {ratio:F1} and {missing}") + " | " + Invariant($"{1234.5:N1} {date:d}") + " | " + FormattableString.Invariant($"{0.5:P0}"));
        var upper = new UpperProvider();
        Console.WriteLine(string.Format(upper, "{0} {1:F1} {2} {3}", name, ratio, null, flag) + " " + string.Format("{0}{1}{0}", "a", "b") + " " + string.Format("{0,4:D2}|{1,-4}|{{{2}}}", 7, "x", 9) + " " + string.Format(CultureInfo.InvariantCulture, "{0:N1}", 1e6));
        try { Console.WriteLine($"{temperature:Q}"); } catch (FormatException e) { Console.WriteLine(e.Message); }
        try { Console.WriteLine(string.Format("{0} {1}", 1)); } catch (FormatException) { Console.WriteLine("format exception"); }

        var builder = new StringBuilder();
        builder.Append($"{count:D3}").Append(CultureInfo.InvariantCulture, $"|{ratio:F2}|").AppendLine($"{name}").AppendFormat(CultureInfo.InvariantCulture, "{0:F1}{1}", 2.25, letter);
        builder.AppendJoin(", ", new[] { 1, 2, 3 }).Append(' ').AppendJoin('-', "a", "b");
        Console.WriteLine(builder.ToString().Replace("\r", "").Replace("\n", "\\n"));
        var rows = new (string Item, int Qty, decimal Unit)[] { ("bolt", 250, 0.035m), ("gear", 4, 12.5m), ("sprocket", 12, 3m) };
        foreach (var (item, qty, unit) in rows) Console.WriteLine(Invariant($"{item,-10}{qty,5}{unit,8:F3}{qty * unit,10:N2}"));
        Console.WriteLine(Invariant($"{"TOTAL",-10}{rows.Sum(r => r.Qty),5}{"",8}{rows.Sum(r => r.Qty * r.Unit),10:N2}"));
        Span<char> buffer = stackalloc char[32];
        bool ok = buffer.TryWrite(CultureInfo.InvariantCulture, $"{count:X4}-{ratio:F2}", out int written);
        Console.WriteLine(ok + " " + written + " " + buffer.Slice(0, written).ToString() + " " + string.Create(CultureInfo.InvariantCulture, $"{price:N1}") + " " + count.TryFormat(buffer, out int digits, "D5") + digits + buffer.Slice(0, digits).ToString());
    }
}
