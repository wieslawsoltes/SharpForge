using System;
using System.Text.Json;

public class JsonInt64Cases
{
    public static void Main()
    {
        string[] values = new string[] {
            "0", "-0", "1", "-1", "2147483647", "2147483648", "-2147483649",
            "9007199254740991", "9007199254740992", "9007199254740993",
            "-9007199254740993", "9223372036854775807", "-9223372036854775808",
            "9223372036854775808", "-9223372036854775809", "18446744073709551615",
            "999999999999999999999999999999999999999999999999999999999999",
            "1.0", "-0.0", "1e0", "1E+1", "1e-1", "1e309",
            "  9007199254740993\r\n", "null", "true", "false", "\"42\"", "[]", "{}"
        };
        foreach (string value in values) Check(value);

        var document = JsonDocument.Parse("{\"n\":9007199254740993,\"a\":[-9223372036854775808]}");
        Console.WriteLine(document.RootElement.GetProperty("n").GetInt64());
        Console.WriteLine(document.RootElement.GetProperty("a")[0].GetInt64());
        document.Dispose();
        var disposedDocument = JsonDocument.Parse("123");
        var disposedElement = disposedDocument.RootElement;
        disposedDocument.Dispose();
        try { Console.WriteLine(disposedElement.GetInt64()); }
        catch (ObjectDisposedException) { Console.WriteLine("ObjectDisposedException"); }
    }

    private static void Check(string text)
    {
        var document = JsonDocument.Parse(text);
        var element = document.RootElement;
        Console.WriteLine(element.GetRawText());
        try { Console.WriteLine(element.GetInt64()); }
        catch (FormatException) { Console.WriteLine("FormatException"); }
        catch (InvalidOperationException) { Console.WriteLine("InvalidOperationException"); }
        document.Dispose();
    }
}
