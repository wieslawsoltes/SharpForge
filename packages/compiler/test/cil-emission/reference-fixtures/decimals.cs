using System;
using System.Globalization;

class Program
{
    static void Main()
    {
        int[] arr = { 1, 2, 3, 4, 5 };
        var inv = CultureInfo.InvariantCulture;
        { decimal total = 0; foreach (var x in arr) total += x * 1.5m; Console.WriteLine(total.ToString(inv) + (total > 20 ? ">" : "<")); }
        { decimal a = 10; long big = 5; decimal b = big; Console.WriteLine((a + b).ToString(inv) + (a / 4).ToString(inv) + (a % 3).ToString(inv)); }
        { decimal price = 19.99m; int whole = (int)price; double approx = (double)price; Console.WriteLine(whole + approx.ToString(inv) + ((long)price) + ((byte)price)); }
        { decimal fromDouble = (decimal)2.5; decimal fromFloat = (decimal)1.25f; Console.WriteLine((fromDouble + fromFloat).ToString(inv)); }
        { decimal d = 1.10m; d++; d -= 0.1m; d *= 2; Console.WriteLine(d.ToString(inv) + (-d).ToString(inv) + (d == 4.00m) + (d != 4m) + (d <= 4m)); }
        { decimal? maybe = null; maybe = 2.5m; Console.WriteLine((maybe + 1).Value.ToString(inv) + (maybe ?? 0m).ToString(inv) + maybe.HasValue); }
        { Console.WriteLine(decimal.Round(2.345m, 2).ToString(inv) + decimal.Zero + decimal.One + decimal.MinusOne + Math.Max(1.5m, 2.5m).ToString(inv)); }
        { Console.WriteLine((1m / 3m).ToString(inv).Length + decimal.Truncate(-2.7m).ToString(inv) + decimal.Parse("3.14", inv).ToString(inv) + 12345.678m.ToString("N2", inv)); }
        { char c = 'A'; decimal fromChar = c; uint u = 7; decimal fromUint = u; Console.WriteLine(fromChar + fromUint); }
        { const decimal Rate = 0.25m; decimal tax = 200 * Rate; Console.WriteLine(tax.ToString(inv) + (Rate * 4 == 1m)); }
        { DayOfWeek day = (DayOfWeek)3m; decimal back = (decimal)day; Console.WriteLine(day + back.ToString(inv)); }
    }
}
