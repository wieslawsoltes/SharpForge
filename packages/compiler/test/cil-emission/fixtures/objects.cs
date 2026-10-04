using System;

class Counter
{
    static int instances;
    static readonly string prefix = "counter";
    int value = 10;
    readonly int step;

    static Counter()
    {
        Console.WriteLine("type initializer");
    }

    public Counter(int step)
    {
        this.step = step;
        instances++;
    }

    public string Name { get; set; } = "unnamed";
    public int Value => value;
    public static int Instances => instances;

    public Counter Advance()
    {
        value += step;
        return this;
    }

    public override string ToString()
    {
        return prefix + " " + Name + " " + value;
    }
}

class Pair
{
    public int Left;
    public int Right;
    public Pair Next;
}

class Program
{
    static void Main()
    {
        Console.WriteLine("start");
        var counter = new Counter(5);
        counter.Name = "first";
        counter.Advance().Advance();
        Console.WriteLine(counter.Value);
        Console.WriteLine(counter.ToString());
        Console.WriteLine(Counter.Instances);
        var pair = new Pair();
        pair.Left = 1;
        pair.Right = 2;
        pair.Next = new Pair();
        pair.Next.Left = pair.Right;
        pair.Next.Left *= 10;
        Console.WriteLine(pair.Left + pair.Next.Left + pair.Next.Right);
        Console.WriteLine(pair.Next.Next == null);
        object boxed = pair.Left;
        Console.WriteLine(boxed);
        object text = "boxed text";
        Console.WriteLine(text);
    }
}
