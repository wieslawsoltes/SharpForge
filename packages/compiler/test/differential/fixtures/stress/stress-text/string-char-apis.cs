using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text;

public static class TextTools
{
    public static bool IsPalindrome(string text)
    {
        int left = 0, right = text.Length - 1;
        while (left < right)
        {
            if (!char.IsLetterOrDigit(text[left])) { left++; continue; }
            if (!char.IsLetterOrDigit(text[right])) { right--; continue; }
            if (char.ToLowerInvariant(text[left++]) != char.ToLowerInvariant(text[right--])) return false;
        }
        return true;
    }

    public static string TitleCase(string text)
    {
        var builder = new StringBuilder(text.Length);
        bool start = true;
        foreach (char c in text)
        {
            builder.Append(start ? char.ToUpperInvariant(c) : char.ToLowerInvariant(c));
            start = !char.IsLetter(c) && c != '\'';
        }
        return builder.ToString();
    }

    public static string Caesar(string text, int shift) => string.Concat(text.Select(c =>
        char.IsUpper(c) ? (char)('A' + (c - 'A' + shift + 26) % 26) :
        char.IsLower(c) ? (char)('a' + (c - 'a' + shift + 26) % 26) : c));

    public static string RunLength(string text)
    {
        var builder = new StringBuilder();
        for (int i = 0; i < text.Length;)
        {
            int j = i;
            while (j < text.Length && text[j] == text[i]) j++;
            builder.Append(text[i]);
            if (j - i > 1) builder.Append(j - i);
            i = j;
        }
        return builder.ToString();
    }

    public static string Snake(string identifier)
    {
        var builder = new StringBuilder();
        for (int i = 0; i < identifier.Length; i++)
        {
            char c = identifier[i];
            if (char.IsUpper(c) && i > 0 && (char.IsLower(identifier[i - 1]) || (i + 1 < identifier.Length && char.IsLower(identifier[i + 1])))) builder.Append('_');
            builder.Append(char.ToLowerInvariant(c));
        }
        return builder.ToString();
    }

    public static int Levenshtein(string a, string b)
    {
        var previous = new int[b.Length + 1];
        for (int j = 0; j <= b.Length; j++) previous[j] = j;
        for (int i = 1; i <= a.Length; i++)
        {
            var current = new int[b.Length + 1];
            current[0] = i;
            for (int j = 1; j <= b.Length; j++)
                current[j] = Math.Min(Math.Min(current[j - 1], previous[j]) + 1, previous[j - 1] + (a[i - 1] == b[j - 1] ? 0 : 1));
            previous = current;
        }
        return previous[b.Length];
    }
}

public static class Program
{
    public static void Main()
    {
        string text = "  The Quick brown FOX, jumps over the lazy dog!  ";
        string trimmed = text.Trim();
        Console.WriteLine($"[{trimmed}] {trimmed.Length} [{text.TrimStart()}] [{text.TrimEnd(' ', '!')}] {trimmed.ToUpperInvariant()} {trimmed.ToLowerInvariant()}");
        Console.WriteLine(string.Join(" ", trimmed.IndexOf("the"), trimmed.IndexOf("the", StringComparison.OrdinalIgnoreCase), trimmed.LastIndexOf('o'), trimmed.IndexOf('z', 5), trimmed.IndexOf("cat"), trimmed.IndexOfAny(new[] { 'x', 'q', 'Q' }), trimmed.Contains("FOX"), trimmed.Contains("fox", StringComparison.OrdinalIgnoreCase), trimmed.StartsWith("The"), trimmed.EndsWith("dog"), trimmed.EndsWith('!')));
        Console.WriteLine(string.Join("|", trimmed.Substring(4, 5), trimmed.Substring(40), trimmed.Remove(3, 6), trimmed.Insert(3, "*"), trimmed.Replace("the", "THE").Replace('o', '0'), trimmed.Split(' ').Length, trimmed.Split(new[] { ", ", " " }, StringSplitOptions.None)[3], string.Join("-", trimmed.Split(' ', 3))));
        Console.WriteLine(string.Join(" ", "a,b,,c".Split(',').Length, "a,b,,c".Split(',', StringSplitOptions.RemoveEmptyEntries).Length, " a , b ".Split(',', StringSplitOptions.TrimEntries)[1] + "!", "abc".PadLeft(6, '*') + "abc".PadRight(6, '-') + "|", "x".PadLeft(0) + "y", new string('=', 5), string.Concat(Enumerable.Repeat("ab", 3)), string.Empty.Length, string.IsNullOrEmpty(null), string.IsNullOrWhiteSpace(" \t\n"), "Abc".Equals("abc", StringComparison.OrdinalIgnoreCase), string.Equals(null, null), "a" == "a", (object)"a" == (object)new string('a', 1)));
        Console.WriteLine(string.Join(" ", string.Compare("a", "B", StringComparison.Ordinal) > 0, string.Compare("a", "B", StringComparison.OrdinalIgnoreCase) < 0, "apple".CompareTo("apple"), string.CompareOrdinal("abc", 1, "xbc", 1, 2), "b".CompareTo(null), "résumé".Length, "résumé".ToUpperInvariant(), "\u00e9" == "e\u0301"));

        char c = 'x';
        Console.WriteLine(string.Join(" ", char.IsLetter(c), char.IsDigit('7'), char.IsWhiteSpace('\t'), char.IsPunctuation('!'), char.IsUpper('É'), char.IsLetterOrDigit('_'), char.IsSymbol('+'), char.IsControl('\n'), char.IsSurrogate("😀"[0]), char.GetNumericValue('8'), char.ToUpper(c), (int)c, (char)(c + 1), c - 'a', (char)('0' + 7), char.MaxValue == '\uffff', 'a' < 'b', c.CompareTo('y'), char.Parse("q"), c.ToString() + c, "" + c + 1, c + 1, char.IsBetween('m', 'a', 'z'), char.IsAsciiHexDigit('F')));
        string emoji = "a😀b";
        Console.WriteLine(emoji.Length + " " + char.ConvertToUtf32(emoji, 1).ToString("X") + " " + char.ConvertFromUtf32(0x1F600).Length + " " + new StringInfo(emoji).LengthInTextElements + " " + Encoding.UTF8.GetByteCount(emoji) + " " + string.Join(",", Encoding.UTF8.GetBytes("é€")) + " " + Encoding.UTF8.GetString(new byte[] { 0xE2, 0x82, 0xAC }) + " " + Encoding.Unicode.GetBytes("A").Length + " " + Convert.ToBase64String(Encoding.ASCII.GetBytes("hello")) + " " + Encoding.ASCII.GetString(Convert.FromBase64String("aGk=")) + " " + Convert.ToHexString(new byte[] { 1, 171 }));

        Console.WriteLine(string.Join(" ", new[] { "A man, a plan, a canal: Panama", "hello", "", "No 'x' in Nixon" }.Select(TextTools.IsPalindrome)) + " " + TextTools.TitleCase("the o'neil-smith REPORT of 2024") + " " + TextTools.Caesar("Hello, World!", 3) + " " + TextTools.Caesar(TextTools.Caesar("Round Trip", 11), -11));
        Console.WriteLine(TextTools.RunLength("aaabccddddde") + " " + TextTools.RunLength("") + " " + TextTools.Snake("parseHTTPResponseCode") + " " + TextTools.Snake("XMLReader") + " " + TextTools.Snake("simple") + " " + TextTools.Levenshtein("kitten", "sitting") + TextTools.Levenshtein("", "abc") + TextTools.Levenshtein("same", "same"));
        string verbatim = @"C:\path\to ""file""
second line";
        string raw = """
            {"key": "va\lue"}
              indented
            """;
        string escapes = "tab\there\\ \"q\" \x41\u0042\U00000043 \0end".Replace("\0", "<nul>");
        Console.WriteLine(verbatim.Replace("\r", "").Replace("\n", "<nl>") + " | " + raw.Replace("\n", "<nl>") + " | " + escapes + " | " + $@"{1 + 1}\n{{x}}" + " | " + "line1\nline2".Split('\n').Length + " | " + "a\tb".Length);
        var words = "the rain in spain stays mainly in the plain".Split(' ');
        var frequency = words.SelectMany(w => w).GroupBy(ch => ch).OrderByDescending(g => g.Count()).ThenBy(g => g.Key).Take(4).Select(g => $"{g.Key}{g.Count()}");
        Console.WriteLine(string.Join("", frequency) + " " + string.Join(" ", words.Where(w => w.Contains("ain")).Select(w => w.Replace("ain", "AIN")).Distinct()) + " " + words.Max(w => w.Length) + " " + string.Join("", words.Select(w => w[0])).ToUpperInvariant() + " " + new string(words[3].Reverse().ToArray()) + " " + string.Concat(words.OrderBy(w => w, StringComparer.Ordinal).First(), "|", words.Aggregate((a, b) => a.Length >= b.Length ? a : b)) + " " + "x".Equals((object)"x") + "abc".GetHashCode().Equals("abc".GetHashCode()) + " " + string.Intern("q") + ("ab" + "c" == "abc") + " " + string.Format("{0,5}|{0,-5}|{1:000}", "ab", 7));
    }
}
