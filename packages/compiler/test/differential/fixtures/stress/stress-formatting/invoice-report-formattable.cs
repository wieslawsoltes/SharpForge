using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;

namespace Invoicing
{
    // Formats: "G" 1,234.50 EUR | "S" symbol first | "A" accounting parentheses | "M" minor units | anything else is a numeric picture.
    public readonly struct Money : IFormattable, ISpanFormattable
    {
        public Money(decimal amount, string currency) { Amount = amount; Currency = currency; }
        public decimal Amount { get; }
        public string Currency { get; }
        public static Money operator +(Money a, Money b) => a.Currency == b.Currency ? new Money(a.Amount + b.Amount, a.Currency) : throw new InvalidOperationException("currency mismatch");
        public static Money operator *(Money a, decimal factor) => new Money(decimal.Round(a.Amount * factor, 2, MidpointRounding.AwayFromZero), a.Currency);
        private string Symbol => Currency switch { "EUR" => "E ", "USD" => "$", "GBP" => "L", _ => Currency + " " };
        public override string ToString() => ToString("G", CultureInfo.InvariantCulture);

        public string ToString(string format, IFormatProvider formatProvider)
        {
            formatProvider ??= CultureInfo.InvariantCulture;
            switch (string.IsNullOrEmpty(format) ? "G" : format)
            {
                case "G": return Amount.ToString("#,##0.00", formatProvider) + " " + Currency;
                case "S": return Symbol + Amount.ToString("#,##0.00", formatProvider);
                case "A": return Amount.ToString("#,##0.00;(#,##0.00);-", formatProvider);
                case "M": return ((long)(Amount * 100)).ToString("D", formatProvider) + (Currency == "USD" ? "c" : "m");
                default: return Amount.ToString(format, formatProvider);
            }
        }

        public bool TryFormat(Span<char> destination, out int charsWritten, ReadOnlySpan<char> format, IFormatProvider provider)
        {
            string text = ToString(format.ToString(), provider);
            charsWritten = text.TryCopyTo(destination) ? text.Length : 0;
            return charsWritten == text.Length;
        }
    }

    // Adds report-specific format specifiers to composite formatting: {0:id} {0:pct} {0:cut8} {0:stars}.
    public sealed class ReportFormatter : IFormatProvider, ICustomFormatter
    {
        public List<string> Seen { get; } = new List<string>();
        public object GetFormat(Type formatType) => formatType == typeof(ICustomFormatter) ? this : CultureInfo.InvariantCulture.GetFormat(formatType);

        public string Format(string format, object arg, IFormatProvider formatProvider)
        {
            Seen.Add(format ?? "-");
            switch (format, arg)
            {
                case ("id", int number): return "INV-" + number.ToString("D6", CultureInfo.InvariantCulture);
                case ("pct", decimal rate): return (rate * 100).ToString("0.#", CultureInfo.InvariantCulture) + "%";
                case ("stars", int count): return new string('*', count).PadRight(5, '.');
                case ({ } f, string text) when f.StartsWith("cut", StringComparison.Ordinal):
                    int width = int.Parse(f.AsSpan(3), NumberStyles.None, CultureInfo.InvariantCulture);
                    return text.Length <= width ? text : string.Concat(text.AsSpan(0, width - 2), "..");
                case (_, IFormattable formattable): return formattable.ToString(format, CultureInfo.InvariantCulture);
                default: return arg?.ToString() ?? "(none)";
            }
        }
    }

    public sealed record Line(string Description, int Quantity, Money Unit, decimal Discount, int Rating)
    {
        public Money Total => Unit * Quantity * (1 - Discount);
    }

    public static class Program
    {
        private static readonly CultureInfo Inv = CultureInfo.InvariantCulture;

        public static void Main()
        {
            var lines = new List<Line>
            {
                new Line("Mechanical keyboard, tenkeyless", 2, new Money(89.90m, "EUR"), 0.10m, 5),
                new Line("USB-C cable", 12, new Money(4.25m, "EUR"), 0m, 3),
                new Line("27 inch monitor arm (refurbished)", 1, new Money(1249.00m, "EUR"), 0.125m, 4),
                new Line("Refund", 1, new Money(-35.50m, "EUR"), 0m, 0),
            };
            var report = new ReportFormatter();

            Console.WriteLine(string.Format(report, "{0:id}  customer {1,-8}|  terms {2:pct}  |{3,6}|", 42, "ACME", 0.025m, null));
            Console.WriteLine(string.Format(Inv, "{0,-22}|{1,4}|{2,10}|{3,6}|{4,12}", "item", "qty", "unit", "disc", "total"));
            Console.WriteLine(new string('-', 22) + "+" + new string('-', 4) + "+" + new string('-', 10) + "+" + new string('-', 6) + "+" + new string('-', 12));
            foreach (Line line in lines)
                Console.WriteLine(string.Format(report, "{0,-22:cut20}|{1,4:D}|{2,10:S}|{3,6:pct}|{4,12:A} {5:stars}", line.Description, line.Quantity, line.Unit, line.Discount, line.Total, line.Rating));
            Money net = lines.Select(l => l.Total).Aggregate((a, b) => a + b);
            Money vat = net * 0.21m;
            Console.WriteLine(string.Format(Inv, "{0,-10}|{1,8:F2}|{2,14}|{3,-14:S}|{4:M}", "net/vat", vat.Amount, net, vat, net + vat));
            Console.WriteLine("formatter saw: " + string.Join(" ", report.Seen.Distinct()) + " (" + report.Seen.Count + " calls)");

            Console.WriteLine("-- interpolation with alignment and specifiers");
            foreach (Line line in lines)
                Console.WriteLine(string.Create(Inv, $"{line.Description[..Math.Min(12, line.Description.Length)],-12}|{line.Quantity,3}|{line.Unit.Amount,9:N2}|{line.Discount,7:P1}|{line.Total,14:S}|{line.Total,10:A}|{line.Total:M}"));
            Console.WriteLine(FormattableString.Invariant($"{"TOTAL",-12}|{lines.Sum(l => l.Quantity),3}|{lines.Average(l => l.Unit.Amount),9:N2}|{lines.Max(l => l.Discount),7:P1}|{net,14}|{vat,10:0.0}|{(net + vat):M}"));
            Console.WriteLine($"{net} | {net:S} | {net,16:G}| {net,-16:A}| {new Money(0m, "USD"):A} | {new Money(-0.05m, "USD"):M} | {new Money(1e6m, "JPY"):S} | {new Money(2.5m, "GBP"):000.000}");

            Console.WriteLine("-- nested and conditional interpolation");
            foreach (Line line in lines.Take(3))
                Console.WriteLine($"{line.Quantity} x {(line.Description.Length > 14 ? $"{line.Description[..11]}..." : line.Description),-14} = {$"{line.Total:S}",12} {(line.Discount > 0 ? $"(saved {string.Create(Inv, $"{line.Discount:P0}")}{(line.Discount > 0.1m ? $", {"big",5}!" : "")})" : "")}");
            string summary = $"{lines.Count} lines, {lines.Count(l => l.Total.Amount < 0)} refund{(lines.Count(l => l.Total.Amount < 0) == 1 ? "" : "s")}, best: {$"{lines.MaxBy(l => l.Rating).Description.Split(',')[0].ToUpperInvariant()}"} [{string.Join("", lines.Select(l => $"{l.Rating:D1}"))}]";
            Console.WriteLine(summary);
            FormattableString template = $"due {net + vat:S} on day {30,3} ({0.21m:P0} VAT, {"net",5} {net:A})";
            Console.WriteLine(template.Format + " <- " + template.ArgumentCount + " args: " + template.ToString(Inv) + " / " + template.ToString(report));

            Console.WriteLine("-- composite format edge cases");
            Console.WriteLine(string.Format(Inv, "{0}{1}{0} {{0}} {{{0}}} {2,3}|{2,-3}|{3:X4}|{3,8:N0}|{4:yyyy-MM-dd}|{5:hh\\:mm}", "ab", 'c', 7, 48879, new DateTime(2024, 2, 29), new TimeSpan(7, 5, 0)));
            Console.WriteLine(string.Format(Inv, "{0,6:F1}|{0,-8:E1}|{0:0.0%}|{1:#,##0}|{1:0.###E+0}|{2,5}|{3,-6}|{4:G}", 0.4567, 1234567L, true, null, DayOfWeek.Friday));
            object[] values = { "x", 2, 3.5, 'c', 10m };
            Console.WriteLine(string.Format(Inv, "{4:F2} {3} {2:F2} {1:D3} {0}", values) + " | " + string.Format(Inv, "{0:G} {1:S}", net, vat) + " | " + string.Format(report, "{0} {1:pct} {2:cut5} {3:id}", vat, "n/a", "abcdefgh", 7L));
            foreach (string broken in new[] { "{0} {1}", "{0", "{0:id", "}" })
            {
                try { Console.WriteLine(string.Format(Inv, broken, 1)); }
                catch (FormatException) { Console.WriteLine("format error in \"" + broken + "\""); }
            }
            Span<char> buffer = stackalloc char[12];
            Console.WriteLine(net.TryFormat(buffer, out int written, "A", Inv) + " " + written + " [" + buffer[..written].ToString() + "] " + net.TryFormat(buffer[..4], out written, "G", Inv) + " " + written + " " + buffer.TryWrite(Inv, $"{vat:S}!", out written) + " [" + buffer[..written].ToString() + "]");
        }
    }
}
