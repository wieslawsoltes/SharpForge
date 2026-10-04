using System;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

internal static class Program
{
    private static string Bounded(string value) => value != null && value.Length > 256 ? null : value;

    private static object Summary(string value) => value == null || value.Length <= 256 ? null : new {
        length = value.Length,
        sha256 = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value))).ToLowerInvariant(),
        prefix = value.Substring(0, 16),
        suffix = value.Substring(value.Length - 16)
    };

    private static void Format(string id, string format, object[] arguments)
    {
        string result = null;
        string error = null;
        try { result = string.Format(CultureInfo.InvariantCulture, format, arguments); }
        catch (Exception exception) { error = exception.GetType().Name; }
        var builder = new StringBuilder("prefix|");
        string builderError = null;
        try { builder.AppendFormat(CultureInfo.InvariantCulture, format, arguments); }
        catch (Exception exception) { builderError = exception.GetType().Name; }
        string builderResult = builder.ToString();
        Console.WriteLine(JsonSerializer.Serialize(new {
            id, format, arguments, result = Bounded(result), resultSummary = Summary(result), error,
            builder = Bounded(builderResult), builderSummary = Summary(builderResult), builderError
        }));
    }

    private static void Builder(string id, Func<StringBuilder> operation)
    {
        string result = null;
        string error = null;
        int capacity = -1;
        int maximum = -1;
        try
        {
            var builder = operation();
            result = builder.ToString();
            capacity = builder.Capacity;
            maximum = builder.MaxCapacity;
        }
        catch (Exception exception) { error = exception.GetType().Name; }
        Console.WriteLine(JsonSerializer.Serialize(new { id, result, error, capacity, maximum }));
    }

    private static void Main()
    {
        CultureInfo.CurrentCulture = CultureInfo.InvariantCulture;
        object[] words = { "x", "y", null, "four", "five" };
        string[] formats = {
            "plain", "{{", "}}", "{{{0}}}", "{0}}}", "{{{0}",
            "{0 ,5}", "{ 0}", "{0 }", "{0, 5}", "{0, -5}", "{0,- 5}",
            "{0,+5}", "{0,5 }", "{0, 0005 }", "{0\t}", "{0,\t5}",
            "{00}", "{0000000}", "{1000000}", "{0,1000000}", "{0,-1000000}",
            "{0:}", "{0 :}", "{0,5:}", "{0:yyyy}}}", "{0:}}}", "{0:}}",
            "{0:{{}}}", "{0:{}}", "{0: a b }", "{0:\t}",
            "{", "}", "{0", "{0,}", "{0,-}", "{0:", "before{9}",
            "before{0}after{", "{0}|{1}|{2}|{3}|{4}", "a{{b}}c{0}d"
        };
        for (int index = 0; index < formats.Length; index++) Format("format-" + index, formats[index], words);
        Format("integer-escaped", "{{{0:D3}}}", new object[] { 42 });
        Format("integer-space", "{0 ,5:D3}", new object[] { 42 });
        Format("null-format", null, words);
        Format("null-arguments", "plain", null);
        Builder("default", () => new StringBuilder());
        Builder("capacity", () => new StringBuilder(1));
        Builder("zero-capacity", () => new StringBuilder(0));
        Builder("text-capacity", () => new StringBuilder("abc", 4));
        Builder("negative-capacity", () => new StringBuilder(-1));
        Builder("expanded-four", () => new StringBuilder().AppendFormat("{0}/{1}/{2}/{3}", 1, 2, 3, 4));
        Builder("expanded-eight", () => new StringBuilder().AppendFormat("{0}{1}{2}{3}{4}{5}{6}{7}", 0, 1, 2, 3, 4, 5, 6, 7));
        Builder("explicit-array", () => new StringBuilder().AppendFormat("{0}/{1}/{2}/{3}", new object[] { 1, 2, 3, 4 }));
        Builder("empty-expanded", () => new StringBuilder().AppendFormat("literal"));
    }
}
