using System;
using System.Runtime.CompilerServices;

struct Point
{
    public int X;
    public int Y;
    public Point(int x) { X = x; Y = 0; }
    public void Add(int delta) { GC.Collect(); X += delta; }
    public void Forward(int delta) { Add(delta); }
    public int Get() { return X; }
}

struct Envelope
{
    public Point Value;
}

static class Program
{
    static void Main()
    {
        Point value = new Point(3);
        Point copy = value;
        value.Forward(4);
        Console.WriteLine(copy.Get());
        Console.WriteLine(value.Get());
        value.Y = 99;
        Console.WriteLine(value.Y);
        Point[] array = new Point[1];
        array[0] = new Point(42);
        array[0].Forward(1);
        Console.WriteLine(array[0].Get());
        object boxed = value;
        Unsafe.Unbox<Point>(boxed).Add(2);
        Console.WriteLine(((Point)boxed).Get());
        Console.WriteLine(value.Get());
        Envelope envelope = default;
        envelope.Value = new Point(55);
        Console.WriteLine(envelope.Value.Get());
    }
}
