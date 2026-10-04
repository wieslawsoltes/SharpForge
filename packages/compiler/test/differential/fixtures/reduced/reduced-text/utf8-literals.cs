using System;
using System.Text;

// Reduced from stress-formatting/hex-dump-utf8, stress-formatting/ini-config-parsing and stress-spans/binary-reader-writer:
// UTF-8 string literals are spans over the encoded bytes (no terminating zero in the length).
public static class Program
{
    public static ReadOnlySpan<byte> Magic => "\u0089PNG\r\n"u8[1..];

    private static int Sum(ReadOnlySpan<byte> bytes)
    {
        int total = 0;
        foreach (byte value in bytes) total += value;
        return total;
    }

    public static void Main()
    {
        ReadOnlySpan<byte> ascii = "hello"u8;
        ReadOnlySpan<byte> accented = "héllo €"u8;
        ReadOnlySpan<byte> empty = ""u8;
        ReadOnlySpan<byte> joined = "ab"u8 + "cd"u8;
        ReadOnlySpan<byte> raw = """
            a "quoted" line
            """u8;
        byte[] copy = "xyz"u8.ToArray();
        Console.WriteLine(ascii.Length + " " + accented.Length + " " + empty.Length + " " + joined.Length + " " + raw.Length + " " + copy.Length);
        Console.WriteLine(Sum(ascii) + " " + Sum(accented) + " " + Sum("\0ÿ"u8) + " " + Encoding.UTF8.GetString(joined) + " " + Encoding.UTF8.GetString(raw));
        Console.WriteLine(Magic.Length + " " + (char)Magic[0] + Magic[^1] + " " + ascii.SequenceEqual("hello"u8) + " " + ascii.StartsWith("he"u8) + " " + "write"u8.Length);
        Console.WriteLine(BitConverter.ToString("😀!"u8.ToArray()) + " " + Encoding.UTF8.GetString(accented.Slice(0, 3)));
    }
}
