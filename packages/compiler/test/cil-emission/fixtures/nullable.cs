using System;

class Node
{
    public int Count;
    public string Name;
    public Node Next;

    public int Twice()
    {
        return Count * 2;
    }
}

class Program
{
    static int? Find(int[] values, int wanted)
    {
        for (int i = 0; i < values.Length; i++)
            if (values[i] == wanted) return i;
        return null;
    }

    static string Show(int? value)
    {
        return value.HasValue ? "some " + value.Value : "none";
    }

    static void Main()
    {
        int? a = 5, b = null;
        int c = 2;
        Console.WriteLine(Show(a + c));
        Console.WriteLine(Show(a + b));
        Console.WriteLine(Show(-a));
        Console.WriteLine(a == b);
        Console.WriteLine(a != b);
        Console.WriteLine(b == null);
        Console.WriteLine(a < c);
        Console.WriteLine(a > c);
        Console.WriteLine(b > c);
        Console.WriteLine(a ?? 7);
        Console.WriteLine(b ?? 7);
        Console.WriteLine(a.GetValueOrDefault() + b.GetValueOrDefault());
        long? wide = a;
        Console.WriteLine(wide.Value + 1);
        int plain = (int)a;
        Console.WriteLine(plain);
        Console.WriteLine(Show(Find(new int[] { 4, 8 }, 8)));
        Console.WriteLine(Show(Find(new int[] { 4, 8 }, 9)));
        object boxed = a;
        Console.WriteLine(boxed);
        object empty = b;
        Console.WriteLine(empty == null);
        int? back = (int?)boxed;
        Console.WriteLine(Show(back));
        if (a is int value) Console.WriteLine("value " + value);
        if (b is null) Console.WriteLine("b is null");
        b ??= 9;
        Console.WriteLine(Show(b));
        try
        {
            int? none = null;
            Console.WriteLine(none.Value);
        }
        catch (InvalidOperationException)
        {
            Console.WriteLine("no value");
        }

        Node node = new Node { Count = 3, Name = "first" };
        Node missing = null;
        Console.WriteLine(Show(node?.Count));
        Console.WriteLine(Show(missing?.Count));
        Console.WriteLine(node?.Name ?? "unnamed");
        Console.WriteLine(missing?.Name ?? "unnamed");
        Console.WriteLine(node?.Next?.Name ?? "no next");
        Console.WriteLine(Show(node?.Twice()));
        Console.WriteLine(missing?.Twice() ?? -1);
        string text = null;
        text ??= "assigned";
        text ??= "again";
        Console.WriteLine(text);
        Console.WriteLine(text?.Length ?? 0);
    }
}
