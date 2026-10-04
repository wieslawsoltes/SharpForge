using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

public readonly struct Token
{
    public Token(int start, int length, bool isNumber) { Start = start; Length = length; IsNumber = isNumber; }
    public int Start { get; }
    public int Length { get; }
    public bool IsNumber { get; }
}

public static class Lexer
{
    public static List<Token> Tokenize(ReadOnlySpan<char> text)
    {
        var tokens = new List<Token>();
        int i = 0;
        while (i < text.Length)
        {
            if (char.IsWhiteSpace(text[i]) || text[i] == ',') { i++; continue; }
            int start = i;
            bool number = char.IsDigit(text[i]) || (text[i] == '-' && i + 1 < text.Length && char.IsDigit(text[i + 1]));
            i++;
            while (i < text.Length && !char.IsWhiteSpace(text[i]) && text[i] != ',') i++;
            tokens.Add(new Token(start, i - start, number));
        }
        return tokens;
    }

    public static int CountVowels(ReadOnlySpan<char> word)
    {
        int count = 0;
        foreach (char c in word)
        {
            switch (char.ToLowerInvariant(c))
            {
                case 'a': case 'e': case 'i': case 'o': case 'u': count++; break;
            }
        }
        return count;
    }

    public static void Reverse(Span<char> buffer)
    {
        for (int low = 0, high = buffer.Length - 1; low < high; low++, high--)
        {
            (buffer[low], buffer[high]) = (buffer[high], buffer[low]);
        }
    }
}

public static class Program
{
    private static string Center(string text, int width, char fill = '.')
    {
        if (text.Length >= width) return text;
        int left = (width - text.Length) / 2;
        return new string(fill, left) + text + new string(fill, width - text.Length - left);
    }

    public static void Main()
    {
        var invariant = CultureInfo.InvariantCulture;
        string input = "alpha 42, beta -7 3.25 Gamma,delta 1000000 0x1F  omega";
        ReadOnlySpan<char> span = input.AsSpan();
        var builder = new StringBuilder();
        double sum = 0;
        foreach (var token in Lexer.Tokenize(span))
        {
            ReadOnlySpan<char> slice = span.Slice(token.Start, token.Length);
            if (token.IsNumber && double.TryParse(slice, NumberStyles.Float, invariant, out double number))
            {
                sum += number;
                builder.Append('[').Append(number.ToString("N2", invariant)).Append(']');
            }
            else
            {
                builder.Append(slice).Append(':').Append(Lexer.CountVowels(slice));
            }
            builder.Append(' ');
        }
        Console.WriteLine(builder.ToString().TrimEnd());
        Console.WriteLine(string.Format(invariant, "sum={0:F3} |{0,12:E2}| {1:P1} {2:X4} {2:D6} {3:C}", sum, 0.1234, 255, 12.5m));

        Span<char> scratch = stackalloc char[16];
        "stressed".AsSpan().CopyTo(scratch);
        Lexer.Reverse(scratch.Slice(0, 8));
        Console.WriteLine(new string(scratch.Slice(0, 8)) + "|" + scratch.Slice(0, 8).ToString().ToUpperInvariant());

        char[] array = "hello world".ToCharArray();
        Span<char> word = array.AsSpan(6);
        word[0] = 'W';
        word.Slice(1).Fill('*');
        Console.WriteLine(new string(array) + " " + word.Length + " " + array.AsSpan(0, 5).SequenceEqual("hello"));

        builder.Clear();
        builder.AppendLine("header").AppendFormat(invariant, "{0}-{1:00}-{2:000.0}", 1, 2, 3.14159).Insert(0, ">> ").Replace("head", "HEAD");
        builder.Append(true).Append(1.5f).Append(2L).Append((object)null).Append('x', 3);
        Console.WriteLine(builder.ToString().Replace("\r\n", "\n").Replace("\n", "\\n") + " len=" + builder.Length);

        var date = new DateTime(2024, 2, 29, 13, 5, 9, DateTimeKind.Utc);
        Console.WriteLine(date.ToString("yyyy-MM-dd HH:mm:ss", invariant) + " " + date.ToString("ddd, dd MMM yyyy", invariant) + " " + date.DayOfYear + " " + date.AddDays(1).ToString("o", invariant));
        var duration = new TimeSpan(1, 26, 3, 4, 5);
        Console.WriteLine(duration.ToString("c", invariant) + " " + duration.TotalHours.ToString("F4", invariant) + " " + (date - new DateTime(2024, 1, 1)).Days);

        int value = 42;
        double pi = Math.PI;
        Console.WriteLine($"{value,6}|{value,-6}|{value:D5}|{pi:F4}|{pi,10:0.00}|{-pi:+0.0;-0.0}|{1234567.891:N1}|{value:X}|{0.5:P0}|{(value > 40 ? "big" : "small")}");
        Console.WriteLine($"{{literal}} {value}{{{value}}} {"nested " + $"{value * 2}"} {'c'} {null} {1.0f / 3} {decimal.MaxValue} {long.MinValue}");
        Console.WriteLine(Center("mid", 11) + Center("even", 10, '-') + Center("toolongtext", 4));
        Console.WriteLine(string.Join("|", "a,b;;c".Split(new[] { ',', ';' }, StringSplitOptions.RemoveEmptyEntries)) + " " + "  pad ".Trim().PadLeft(6, '0').PadRight(9, '!'));
        Console.WriteLine(string.Concat("x", 1, 'y', 2.5, null, true) + " " + string.Compare("apple", "Apple", StringComparison.OrdinalIgnoreCase) + " " + string.CompareOrdinal("a", "b"));
        Console.WriteLine(1e20.ToString(invariant) + " " + 1e-7.ToString(invariant) + " " + 0.1f.ToString(invariant) + " " + (0.1 + 0.2).ToString("R", invariant) + " " + double.NaN + " " + float.PositiveInfinity + " " + (-0.0).ToString(invariant));
        Console.WriteLine(int.Parse("-123", invariant) + long.Parse("9000000000") + " " + Convert.ToString(255, 2) + " " + Convert.ToInt32("ff", 16) + " " + 3.7.ToString("0") + " " + 2.5.ToString("0") + " " + ((int)'A') + (char)98);
    }
}
