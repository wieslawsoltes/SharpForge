using System;
using System.IO;

class Program
{
    public static void Main()
    {
        var reader = new StringReader("a\rb\r\nc\n");
        Console.WriteLine(reader.Peek());
        Console.WriteLine(reader.Peek());
        Console.WriteLine(reader.ReadLine());
        Console.WriteLine(reader.ReadLine());
        Console.WriteLine(reader.ReadLine());
        Console.WriteLine(reader.ReadLine() == null);
        Console.WriteLine(reader.Read());
        Console.WriteLine(reader.Peek());
        Console.WriteLine(reader.ReadToEnd() == "");

        var empty = new StringReader("");
        Console.WriteLine(empty.ReadLine() == null);
        Console.WriteLine(empty.Read());
        Console.WriteLine(empty.ReadToEnd() == "");
        var lines = new StringReader("\r\n\n\rx\ry\nz\r\nlast");
        Console.WriteLine(lines.ReadLine() == "");
        Console.WriteLine(lines.ReadLine() == "");
        Console.WriteLine(lines.ReadLine() == "");
        Console.WriteLine(lines.ReadLine());
        Console.WriteLine(lines.ReadLine());
        Console.WriteLine(lines.ReadLine());
        Console.WriteLine(lines.ReadLine());
        Console.WriteLine(lines.ReadLine() == null);

        var units = new StringReader("\0\uD83D\uDE00\uD800X\uDC00\u0085\u2028\u2029");
        Console.WriteLine(units.Read());
        Console.WriteLine(units.Peek());
        Console.WriteLine(units.Read());
        Console.WriteLine(units.Read());
        Console.WriteLine(units.Read());
        Console.WriteLine(units.Read());
        Console.WriteLine(units.Read());
        Console.WriteLine(units.ReadLine() == "\u0085\u2028\u2029");
        Console.WriteLine(units.ReadLine() == null);

        var remainder = new StringReader("start\r\nrest\r\ntail");
        Console.WriteLine(remainder.Read());
        Console.WriteLine(remainder.ReadLine());
        Console.WriteLine(remainder.ReadToEnd() == "rest\r\ntail");
        Console.WriteLine(remainder.ReadToEnd() == "");
        Console.WriteLine(remainder.ReadLine() == null);
        reader.Close();
        reader.Close();
        reader.Dispose();
        empty.Dispose();
        empty.Dispose();
        Console.WriteLine("disposed twice");
    }
}
