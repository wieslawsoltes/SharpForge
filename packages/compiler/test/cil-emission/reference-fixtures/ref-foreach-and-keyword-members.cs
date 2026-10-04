using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

// `foreach (ref var x in ...)` and `foreach (ref readonly var x in ...)` over spans and over a source enumerator
// whose `Current` returns by reference, and static members named through the keywords of the built-in types
// (`nint.Size`, `int.MaxValue`, `string.Empty`, `char.IsDigit`, ...), bound against the real libraries.

struct Cell { public int Value; }

class Grid
{
    int[] data = { 1, 2, 3 };
    public Enumerator GetEnumerator() { return new Enumerator(data); }
    public struct Enumerator
    {
        int[] data; int index;
        public Enumerator(int[] data) { this.data = data; index = -1; }
        public bool MoveNext() { return ++index < data.Length; }
        public ref int Current { get { return ref data[index]; } }
    }
}

class Program
{
    static void Main()
    {
        Span<int> span = new int[] { 1, 2, 3 };
        foreach (ref var x in span) x *= 2;
        foreach (ref int y in span) y += 1;
        foreach (ref readonly var z in span) Console.Write(z + " ");
        Console.WriteLine();
        ReadOnlySpan<int> read = span;
        foreach (ref readonly var r in read) Console.Write(r + " ");
        Console.WriteLine();
        var grid = new Grid();
        foreach (ref var g in grid) g += 10;
        foreach (var g in grid) Console.Write(g + " ");
        Console.WriteLine();
        Span<Cell> cells = new Cell[2];
        foreach (ref var cell in cells) cell.Value = 7;
        Console.WriteLine(cells[0].Value + cells[1].Value);
        var list = new List<int> { 1, 2 };
        foreach (ref var item in CollectionsMarshal.AsSpan(list)) item++;
        Console.WriteLine(list[0] + " " + list[1]);

        Console.WriteLine(nint.Size + " " + nuint.Size + " " + IntPtr.Size + " " + (nint.MaxValue > 0) + " " + nint.Zero + " " + nuint.MinValue);
        Console.WriteLine(int.MaxValue + " " + long.MinValue + " " + byte.MaxValue + " " + double.Epsilon + " " + float.NaN + " " + char.MaxValue + (int)char.MinValue);
        Console.WriteLine(string.Empty.Length + " " + char.IsDigit('5') + " " + char.ToUpper('a') + " " + int.Parse("42") + " " + double.IsNaN(0.0 / 0.0) + " " + bool.TrueString + " " + decimal.One + " " + object.ReferenceEquals(null, null));
        Console.WriteLine(string.IsNullOrEmpty("") + " " + string.Join(",", 1, 2) + " " + int.TryParse("7", out var seven) + seven + " " + uint.MaxValue + " " + short.MinValue + " " + ulong.MaxValue + " " + sbyte.MinValue + " " + ushort.MaxValue);
        Console.WriteLine(nint.Parse("5") + " " + nuint.MaxValue.Equals(nuint.MaxValue) + " " + long.Abs(-3) + " " + int.Max(1, 2) + " " + double.Pi.ToString("F2") + " " + decimal.MaxValue + " " + float.Epsilon + " " + object.Equals(1, 1));
    }
}
