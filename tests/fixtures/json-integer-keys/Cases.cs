using System;
using System.Collections.Generic;
using System.Text.Json;

public class JsonIntegerKeys
{
    public static void Main()
    {
        Console.WriteLine(JsonSerializer.Serialize(new Dictionary<int, string>()));
        Console.WriteLine(JsonSerializer.Serialize(new Dictionary<int, string> { { 1, "a" } }));
        var ordered = new Dictionary<int, string>();
        ordered.Add(2, "two");
        ordered.Add(1, "one");
        ordered.Add(10, "ten");
        ordered.Add(-1, "negative");
        ordered.Add(0, "zero");
        ordered.Add(-2147483648, "minimum");
        ordered.Add(2147483647, "<é+>\n\"");
        Console.WriteLine(JsonSerializer.Serialize(ordered));
        ordered[1] = "updated";
        Console.WriteLine(JsonSerializer.Serialize(ordered));
        ordered.Remove(1);
        ordered.Remove(-1);
        Console.WriteLine(JsonSerializer.Serialize(ordered));
        ordered.Add(3, "last free slot");
        ordered.Add(4, "first free slot");
        Console.WriteLine(JsonSerializer.Serialize(ordered));
        ordered.Remove(2);
        ordered.Add(2, "readded");
        Console.WriteLine(JsonSerializer.Serialize(ordered));
        ordered.Clear();
        ordered.Add(10, "after clear");
        ordered.Add(1, null);
        Console.WriteLine(JsonSerializer.Serialize(ordered));

        Console.WriteLine(JsonSerializer.Serialize(new Dictionary<int, int> {
            { 2, -2147483648 }, { -1, 2147483647 }, { 0, 0 }
        }));
        Console.WriteLine(JsonSerializer.Serialize(new Dictionary<int, double> {
            { 2, -0.0 }, { 1, 1e-7 }, { -1, 1e20 }
        }));
        Console.WriteLine(JsonSerializer.Serialize(new Dictionary<int, bool> {
            { 2, true }, { 1, false }
        }));
        var objects = new Dictionary<int, object>();
        objects.Add(7, null);
        objects.Add(6, "<é+>");
        objects.Add(5, 42);
        objects.Add(4, 1e-7);
        objects.Add(3, true);
        objects.Add(2, false);
        objects.Add(1, '<');
        Console.WriteLine(JsonSerializer.Serialize(objects));

        var nested = new Dictionary<int, object>();
        nested.Add(2, new Dictionary<int, string> { { 3, "nested" }, { 1, null } });
        nested.Add(1, new int[] { 2, 1 });
        Console.WriteLine(JsonSerializer.Serialize(nested));
        Console.WriteLine(JsonSerializer.Serialize(new object[] { nested, null }));

        var reused = new Dictionary<int, int>();
        for (int i = 0; i < 25; i++) reused.Add(i, i);
        for (int i = 0; i < 25; i += 2) reused.Remove(i);
        for (int i = 0; i < 13; i++) reused.Add(100 + i, i);
        Console.WriteLine(JsonSerializer.Serialize(reused));

        Console.WriteLine(JsonSerializer.Serialize(new Dictionary<string, string> {
            { "2", "two" }, { "1", "one" }, { "01", "leading zero" }, { "<é+>", "escaped" }
        }));
        Console.WriteLine(JsonSerializer.Serialize(new Dictionary<string, bool> { { "yes", true }, { "no", false } }));
        var cycle = new Dictionary<int, object>();
        cycle.Add(1, cycle);
        try { Console.WriteLine(JsonSerializer.Serialize(cycle)); }
        catch (JsonException) { Console.WriteLine("JsonException"); }
    }
}
