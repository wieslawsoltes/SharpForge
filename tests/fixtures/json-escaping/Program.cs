using System;
using System.Collections.Generic;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

internal static class Program
{
    private static int[] Units(string value)
    {
        if (value == null) return null;
        int[] units = new int[value.Length];
        for (int index = 0; index < units.Length; index++) units[index] = value[index];
        return units;
    }

    private static void Capture(string id, string value)
    {
        Console.WriteLine(JsonSerializer.Serialize(new {
            id, units = Units(value),
            scalar = JsonSerializer.Serialize(value),
            array = JsonSerializer.Serialize(new string[] { value, "tail", null }),
            dictionary = JsonSerializer.Serialize(new Dictionary<string, string> { { "key" + value, value } })
        }));
    }

    private static void Boundary(string id, int count)
    {
        string value = JsonSerializer.Serialize(new string('<', count));
        Console.WriteLine(JsonSerializer.Serialize(new {
            id, repeat = 60, count, length = value.Length,
            sha256 = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value))).ToLowerInvariant(),
            prefix = value.Substring(0, 16), suffix = value.Substring(value.Length - 16)
        }));
    }

    private static void Main()
    {
        for (int code = 0; code < 128; code++) Capture("ascii-" + code, new string((char)code, 1));
        Capture("empty", "");
        Capture("null", null);
        Capture("html", "<é>&'\"+`/\\=");
        Capture("latin", "éàöß\u007f\u0080\u00a0");
        Capture("combining", "e\u0301");
        Capture("scripts", "λ漢字한글العربية");
        Capture("separators", "\u2028\u2029\u202f\u3000");
        Capture("noncharacters", "\ufffe\uffff");
        Capture("astral", "\ud83d\ude00\ud800\udc00\udbff\udfff");
        Capture("high-surrogate", "\ud800");
        Capture("low-surrogate", "\udc00");
        Capture("broken-surrogates", "\ud800a\udc00\ud800\ud800\udc00");
        Capture("escaped-looking", "\\u003C\\\"\\n");
        Capture("literal-controls", "\0\b\t\n\v\f\r\u001f");
        Boundary("within-host-budget", 166666);
        Boundary("above-host-budget", 166667);
    }
}
