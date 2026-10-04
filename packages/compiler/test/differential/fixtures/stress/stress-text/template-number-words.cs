using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text;

public static class Template
{
    public static string Render(string template, IReadOnlyDictionary<string, object> values)
    {
        var output = new StringBuilder();
        int position = 0;
        while (position < template.Length)
        {
            int open = template.IndexOf("{{", position, StringComparison.Ordinal);
            if (open < 0) { output.Append(template, position, template.Length - position); break; }
            output.Append(template, position, open - position);
            int close = template.IndexOf("}}", open + 2, StringComparison.Ordinal);
            if (close < 0) throw new FormatException("unclosed placeholder at " + open);
            string[] parts = template.Substring(open + 2, close - open - 2).Split('|');
            string name = parts[0].Trim();
            object value = values.TryGetValue(name, out var found) ? found : "<" + name + "?>";
            foreach (string filter in parts.Skip(1).Select(p => p.Trim())) value = Apply(filter, value);
            output.Append(value is IFormattable formattable ? formattable.ToString(null, CultureInfo.InvariantCulture) : value);
            position = close + 2;
        }
        return output.ToString();
    }

    private static object Apply(string filter, object value)
    {
        int colon = filter.IndexOf(':');
        string name = colon < 0 ? filter : filter.Substring(0, colon), argument = colon < 0 ? "" : filter.Substring(colon + 1);
        return name switch
        {
            "upper" => value.ToString().ToUpperInvariant(),
            "lower" => value.ToString().ToLowerInvariant(),
            "len" => value.ToString().Length,
            "pad" => value.ToString().PadLeft(int.Parse(argument)),
            "fmt" when value is IFormattable f => f.ToString(argument, CultureInfo.InvariantCulture),
            "words" when value is int n => Numbers.ToWords(n),
            "roman" when value is int n => Numbers.ToRoman(n),
            "join" when value is IEnumerable<string> items => string.Join(argument, items),
            "default" => value is string s && s.EndsWith("?>") ? argument : value,
            _ => throw new FormatException("unknown filter " + name),
        };
    }
}

public static class Numbers
{
    private static readonly string[] ones = { "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen" };
    private static readonly string[] tens = { "", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety" };
    private static readonly (int Value, string Name)[] scales = { (1_000_000_000, "billion"), (1_000_000, "million"), (1000, "thousand"), (100, "hundred") };
    private static readonly (int Value, string Symbol)[] roman = { (1000, "M"), (900, "CM"), (500, "D"), (400, "CD"), (100, "C"), (90, "XC"), (50, "L"), (40, "XL"), (10, "X"), (9, "IX"), (5, "V"), (4, "IV"), (1, "I") };

    public static string ToWords(int number)
    {
        if (number < 0) return "minus " + ToWords(-number);
        if (number < 20) return ones[number];
        if (number < 100) return tens[number / 10] + (number % 10 > 0 ? "-" + ones[number % 10] : "");
        foreach (var (value, name) in scales)
        {
            if (number < value) continue;
            string rest = number % value == 0 ? "" : (value == 100 ? " and " : " ") + ToWords(number % value);
            return ToWords(number / value) + " " + name + rest;
        }
        throw new InvalidOperationException();
    }

    public static string ToRoman(int number)
    {
        if (number <= 0 || number >= 4000) throw new ArgumentOutOfRangeException(nameof(number));
        var result = new StringBuilder();
        foreach (var (value, symbol) in roman)
            while (number >= value) { result.Append(symbol); number -= value; }
        return result.ToString();
    }

    public static int FromRoman(string text)
    {
        int total = 0, index = 0;
        foreach (var (value, symbol) in roman)
            while (string.CompareOrdinal(text, index, symbol, 0, symbol.Length) == 0) { total += value; index += symbol.Length; }
        return index == text.Length ? total : throw new FormatException("bad numeral " + text);
    }

    public static string ToBase(long value, int radix)
    {
        if (radix < 2 || radix > 36) throw new ArgumentOutOfRangeException(nameof(radix));
        if (value == 0) return "0";
        bool negative = value < 0;
        var digits = new Stack<char>();
        for (ulong rest = negative ? (ulong)(-(value + 1)) + 1 : (ulong)value; rest > 0; rest /= (ulong)radix)
        {
            int digit = (int)(rest % (ulong)radix);
            digits.Push((char)(digit < 10 ? '0' + digit : 'a' + digit - 10));
        }
        return (negative ? "-" : "") + new string(digits.ToArray());
    }

    public static string Ordinal(int n) => n + ((n % 100) is >= 11 and <= 13 ? "th" : (n % 10) switch { 1 => "st", 2 => "nd", 3 => "rd", _ => "th" });
}

public static class Program
{
    public static void Main()
    {
        var values = new Dictionary<string, object>
        {
            ["user"] = "Ada", ["count"] = 1234, ["price"] = 9.5, ["year"] = 1999, ["tags"] = new[] { "x", "y", "z" }, ["when"] = new DateTime(2024, 7, 4), ["empty"] = "",
        };
        string template = "Hello {{ user | upper }}! You have {{count|words}} ({{count|fmt:N0}}) items at {{ price | fmt:F2 | pad:8 }}.\n"
            + "Year {{year|roman}} / {{year|fmt:X}}; tags: {{tags|join:, }}; date {{when|fmt:yyyy-MM-dd}}; [{{empty}}] {{missing}} {{missing|default:n/a}} {{user|len}}{{user|lower|len}}";
        Console.WriteLine(Template.Render(template, values));
        foreach (var broken in new[] { "{{user", "{{user|shout}}", "no placeholders", "{{count|roman}}{{price|roman}}" })
        {
            try { Console.Write(Template.Render(broken, values) + " ; "); }
            catch (FormatException e) { Console.Write("<" + e.Message + "> ; "); }
        }
        Console.WriteLine();
        foreach (int n in new[] { 0, 7, 13, 20, 42, 100, 101, 999, 1000, 1001, 12345, 1_000_000, 2_000_000_019, -15 }) Console.WriteLine(n.ToString(CultureInfo.InvariantCulture).PadLeft(11) + " " + Numbers.ToWords(n));
        Console.WriteLine(string.Join(" ", new[] { 1, 4, 9, 14, 40, 90, 400, 1994, 2024, 3999 }.Select(Numbers.ToRoman)) + " " + string.Join(",", new[] { "MCMXCIV", "XLII", "IV" }.Select(Numbers.FromRoman)) + " " + Enumerable.Range(1, 3999).All(n => Numbers.FromRoman(Numbers.ToRoman(n)) == n));
        try { Numbers.FromRoman("IIX!"); } catch (FormatException e) { Console.WriteLine(e.Message); }
        try { Numbers.ToRoman(4000); } catch (ArgumentOutOfRangeException e) { Console.WriteLine(e.ParamName); }
        Console.WriteLine(string.Join(" ", Numbers.ToBase(255, 2), Numbers.ToBase(255, 16), Numbers.ToBase(-255, 8), Numbers.ToBase(0, 7), Numbers.ToBase(long.MaxValue, 36), Numbers.ToBase(long.MinValue, 16), Numbers.ToBase(35, 36), Convert.ToString(-255, 16), Convert.ToInt64("zz", 36 - 20).ToString() is var s ? s.Length : 0));
        Console.WriteLine(string.Join(" ", new[] { 1, 2, 3, 4, 11, 12, 13, 21, 22, 101, 111, 112, 1003 }.Select(Numbers.Ordinal)));
    }
}
