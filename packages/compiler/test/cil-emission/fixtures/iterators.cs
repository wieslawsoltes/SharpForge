using System;
using System.Collections;
using System.Collections.Generic;

class Resource : IDisposable
{
    readonly string name;
    public Resource(string name) { this.name = name; Console.WriteLine("open " + name); }
    public void Dispose() { Console.WriteLine("close " + name); }
}

struct Range3
{
    public int Start;
    public IEnumerable<int> Values()
    {
        for (int i = 0; i < 3; i++) yield return Start + i;
    }
}

class Tree : IEnumerable<string>
{
    readonly string[] items;
    readonly int scale = 2;
    public Tree(params string[] items) { this.items = items; }

    public IEnumerator<string> GetEnumerator()
    {
        foreach (string item in items)
        {
            if (item.Length == 0) continue;
            yield return item;
        }
    }
    IEnumerator IEnumerable.GetEnumerator() { return GetEnumerator(); }

    public IEnumerable<int> Scaled(int count)
    {
        int total = 0;
        for (int i = 1; i <= count; i++)
        {
            total += i * scale;
            yield return total;
        }
    }
}

class Program
{
    static IEnumerable<int> Numbers(int limit)
    {
        Console.WriteLine("started with " + limit);
        for (int i = 0; i < limit; i++)
        {
            if (i == 2) continue;
            if (i == 5) yield break;
            yield return i * i;
        }
        Console.WriteLine("ran to the end");
    }

    static IEnumerable Untyped()
    {
        yield return 1;
        yield return "two";
        yield return 3.5;
    }

    static IEnumerable<string> Guarded(bool fail)
    {
        using (Resource resource = new Resource("outer"))
        {
            yield return "first";
            try
            {
                yield return "second";
                if (fail) throw new InvalidOperationException("failed inside");
                yield return "third";
            }
            finally
            {
                Console.WriteLine("inner finally");
            }
            yield return "fourth";
        }
        Console.WriteLine("after using");
    }

    static IEnumerable<int> Flatten(IEnumerable<IEnumerable<int>> groups)
    {
        foreach (IEnumerable<int> group in groups)
        {
            foreach (int value in group) yield return value;
        }
    }

    static IEnumerable<Func<int>> Captures(int count)
    {
        for (int i = 0; i < count; i++)
        {
            int copy = i * 10;
            yield return () => copy + count;
        }
    }

    static IEnumerable<int> Switched(int[] codes)
    {
        foreach (int code in codes)
        {
            switch (code)
            {
                case 0:
                    yield return -1;
                    break;
                case 1:
                    yield return 100;
                    yield return 101;
                    break;
                default:
                    int doubled = code * 2;
                    yield return doubled;
                    break;
            }
        }
    }

    static void Show<T>(string label, IEnumerable<T> values)
    {
        string text = label + ":";
        foreach (T value in values) text += " " + value;
        Console.WriteLine(text);
    }

    static void Main()
    {
        IEnumerable<int> numbers = Numbers(4);
        Console.WriteLine("created, nothing ran");
        Show("numbers", numbers);
        Show("again", numbers);
        Show("stopped", Numbers(9));

        IEnumerator<int> first = numbers.GetEnumerator();
        IEnumerator<int> second = numbers.GetEnumerator();
        Console.WriteLine("same object: " + ReferenceEquals(numbers, first) + " " + ReferenceEquals(first, second));
        Console.WriteLine(first.MoveNext() + " " + first.Current + ", " + second.MoveNext() + " " + second.Current);
        Console.WriteLine(first.MoveNext() + " " + first.Current);

        string untyped = "";
        foreach (object item in Untyped()) untyped += item + ";";
        Console.WriteLine(untyped);
        IEnumerator plain = Untyped().GetEnumerator();
        plain.MoveNext();
        Console.WriteLine("boxed " + plain.Current);

        Show("guarded", Guarded(false));
        foreach (string item in Guarded(false))
        {
            Console.WriteLine("saw " + item);
            if (item == "second") break;
        }
        try
        {
            foreach (string item in Guarded(true)) Console.WriteLine("got " + item);
        }
        catch (InvalidOperationException e)
        {
            Console.WriteLine("caught " + e.Message);
        }
        IEnumerator<string> manual = Guarded(false).GetEnumerator();
        manual.MoveNext();
        manual.Dispose();
        Console.WriteLine("after dispose: " + manual.MoveNext());
        IEnumerator<string> unstarted = Guarded(false).GetEnumerator();
        unstarted.Dispose();
        Console.WriteLine("unstarted disposed: " + unstarted.MoveNext());

        Tree tree = new Tree("a", "", "b", "c");
        Show("tree", tree);
        Show("scaled", tree.Scaled(4));
        Range3 range = new Range3 { Start = 7 };
        IEnumerable<int> values = range.Values();
        range.Start = 100;
        Show("struct copy", values);
        Show("flatten", Flatten(new[] { Numbers(2), tree.Scaled(2), range.Values() }));
        int sum = 0;
        foreach (Func<int> function in Captures(3)) sum += function();
        Console.WriteLine("captures " + sum);
        Show("switched", Switched(new[] { 1, 0, 7 }));
    }
}
