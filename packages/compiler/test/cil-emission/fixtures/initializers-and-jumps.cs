using System;
using System.Collections.Generic;

class Settings
{
    public int Level;
    public string Title { get; set; }
    public List<int> Values = new List<int>();
    public Settings Inner;
    public int[] Slots = new int[3];
}

class Scope : IDisposable
{
    readonly string name;

    public Scope(string name)
    {
        this.name = name;
        Console.WriteLine("enter " + name);
    }

    public void Dispose()
    {
        Console.WriteLine("leave " + name);
    }
}

class Program
{
    static bool TryParse(string text, out int value)
    {
        value = text.Length;
        return text.Length > 2;
    }

    static void Use()
    {
        using var outer = new Scope("outer");
        Console.WriteLine("between");
        using var inner = new Scope("inner");
        Console.WriteLine("body");
    }

    static int FirstMatch(int[,] unused, int[] values, int wanted)
    {
        int index = 0;
    next:
        if (index >= values.Length) goto missing;
        if (values[index] == wanted) return index;
        index++;
        goto next;
    missing:
        return -1;
    }

    static void Main()
    {
        var settings = new Settings
        {
            Level = 2,
            Title = "main",
            Values = { 1, 2, 3 },
            Inner = new Settings { Level = 5, Title = "inner" },
            Slots = { [0] = 7, [2] = 9 },
        };
        Console.WriteLine(settings.Level + settings.Inner.Level + settings.Values.Count);
        Console.WriteLine(settings.Title + " " + settings.Inner.Title);
        Console.WriteLine(settings.Slots[0] + settings.Slots[1] + settings.Slots[2]);
        var nested = new Settings { Inner = new Settings(), Level = 1 };
        nested = new Settings { Inner = nested, Values = { 4 } };
        Console.WriteLine(nested.Inner.Level + nested.Values[0]);
        var list = new List<string> { "a", "b" };
        Console.WriteLine(list.Count + list[1]);
        var map = new Dictionary<string, int> { ["one"] = 1, ["two"] = 2 };
        Console.WriteLine(map["one"] + map["two"]);
        if (TryParse("long text", out var length)) Console.WriteLine(length);
        if (!TryParse("ab", out int shortLength)) Console.WriteLine(shortLength);
        TryParse("ignored", out _);
        Use();
        Console.WriteLine(FirstMatch(null, new int[] { 3, 5, 8 }, 8));
        Console.WriteLine(FirstMatch(null, new int[] { 3, 5, 8 }, 4));
        Console.WriteLine(typeof(Settings).Name);
        for (int i = 0; i < 3; i++)
        {
            for (int j = 0; j < 3; j++)
            {
                if (i * j == 2) goto done;
                Console.WriteLine(i + "," + j);
            }
        }
    done:
        Console.WriteLine("done");
    }
}
