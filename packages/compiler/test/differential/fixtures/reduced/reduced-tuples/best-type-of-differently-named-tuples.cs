using System;

// Reduced from stress-arrays/jagged-array-methods: tuple literals whose inferred element names differ still have a
// best common type (the names both sides share are kept), so a switch or conditional expression over them has a type.

public static class Program
{
    private static (int, int) Pair(int n) => (n, n + 1);

    public static void Main()
    {
        for (int unit = 0; unit < 27; unit += 9)
        {
            int i = unit / 3 + 1;
            var cell = (unit / 9) switch { 0 => (unit, i), 1 => (i, unit - 9), _ => ((unit - 18) / 3 * 3 + i / 3, i % 3) };
            var (row, column) = (unit / 9) switch { 0 => (unit, i), 1 => (i, unit - 9), _ => ((unit - 18) / 3 * 3 + i / 3, i % 3) };
            (int a, int b) = unit > 9 ? (1, 2) : (3, 4);
            var (c, d) = unit > 9 ? Pair(unit) : (0, 0);
            (long e, string f) = unit switch { 0 => (1, "zero"), _ => (unit, null) };
            Console.WriteLine(cell + " " + row + "," + column + " " + a + b + " " + c + d + " " + e + (f ?? "-"));
        }
    }
}
