using System;
using System.Text;

class Program
{
    static void Main()
    {
        string text = "Hello, World";
        Console.WriteLine(text.IndexOf('o'));
        Console.WriteLine(text.IndexOf("World"));
        Console.WriteLine(text.LastIndexOf('o'));
        Console.WriteLine(text.Contains('W'));
        Console.WriteLine(text.Contains("lo, "));
        Console.WriteLine(text.Replace('l', 'L'));
        Console.WriteLine(text.Replace("World", "there"));
        Console.WriteLine(text.Split(',').Length);
        Console.WriteLine(text.Split(", ")[1]);
        Console.WriteLine(text.Trim('H', 'd'));
        Console.WriteLine(text.TrimEnd('d').TrimStart('H'));
        Console.WriteLine(text.PadLeft(14, '*'));
        Console.WriteLine(text.StartsWith('H') && text.EndsWith("ld"));
        Console.WriteLine(text.Substring(7).ToUpperInvariant());
        Console.WriteLine(text[4]);
        Console.WriteLine(string.Join('-', "a", "b", "c"));
        Console.WriteLine(string.Join(", ", new[] { 1, 2, 3 }));
        Console.WriteLine(string.Concat("x", "y", "z", "w", "v"));
        Console.WriteLine(new string('z', 3));
        Console.WriteLine(string.IsNullOrWhiteSpace("  "));
        Console.WriteLine(string.Compare("a", "B", StringComparison.OrdinalIgnoreCase));
        Console.WriteLine(string.Equals("a", "A", StringComparison.OrdinalIgnoreCase));
        Console.WriteLine(char.IsDigit('7') && char.IsLetter('x') && char.ToUpper('q') == 'Q');
        Console.WriteLine(text.ToCharArray().Length);
        Console.WriteLine(text.Insert(5, "!").Remove(0, 1));

        var builder = new StringBuilder();
        builder.Append("a").Append('b').Append(3).Append(1.5).Append(true).AppendLine();
        builder.AppendFormat("{0}-{1}", 1, "two");
        builder.Insert(0, "[").Append(']');
        builder.Replace('a', 'A');
        Console.WriteLine(builder.Length);
        Console.WriteLine(builder.ToString());
        Console.WriteLine(builder[1]);
        builder.Clear();
        Console.WriteLine(builder.Length);
    }
}
