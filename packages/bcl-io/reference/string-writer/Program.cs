using System;
using System.IO;
using System.Text;

class Program
{
    public static void Main()
    {
        var writer = new StringWriter();
        Console.WriteLine(writer.NewLine == "\n");
        writer.Write("a"); writer.Write((string)null);
        writer.WriteLine("b"); writer.WriteLine();
        Console.WriteLine(writer.ToString() == "ab\n\n");
        writer.NewLine = "\r\n";
        writer.WriteLine("c"); writer.WriteLine((string)null);
        Console.WriteLine(writer.ToString() == "ab\n\nc\r\n\r\n");
        writer.NewLine = ""; writer.WriteLine("end"); writer.WriteLine();
        Console.WriteLine(writer.ToString() == "ab\n\nc\r\n\r\nend");
        writer.NewLine = null;
        Console.WriteLine(writer.NewLine == "\n");

        var buffer = new StringBuilder("seed");
        var shared = new StringWriter(buffer);
        Console.WriteLine(Object.ReferenceEquals(buffer, shared.GetStringBuilder()));
        shared.Write("!"); buffer.Append("?");
        Console.WriteLine(shared.ToString());
        shared.Close(); shared.Dispose(); shared.Flush();
        Console.WriteLine(Object.ReferenceEquals(buffer, shared.GetStringBuilder()));
        shared.GetStringBuilder().Append("after");
        Console.WriteLine(shared.ToString());
        shared.NewLine = "custom";
        Console.WriteLine(shared.NewLine);
        shared.NewLine = null;
        Console.WriteLine(shared.NewLine == "\n");

        var units = new StringWriter();
        units.Write("\0\uD83D\uDE00\uD800X\uDC00");
        Console.WriteLine(units.ToString() == "\0\uD83D\uDE00\uD800X\uDC00");
        Console.WriteLine(units.GetStringBuilder().Length);
        using (units) { units.Write("last"); }
        Console.WriteLine(units.ToString() == "\0\uD83D\uDE00\uD800X\uDC00last");
    }
}
