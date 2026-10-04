using System;
struct Point { public int X; public byte Tiny; }
struct Outer { public Point Inner; public int Tag; }
class Holder { public Point Value; }
static class Program
{
    static Point saved;
    static void Main()
    {
        Point a = default;
        a.X = 11;
        Point b = a;
        a.X = 22;
        Console.WriteLine(b.X);
        Console.WriteLine(a.X);
        b = a;
        a = default;
        Console.WriteLine(b.X);
        Console.WriteLine(a.X);
        Outer outer = default;
        outer.Inner.X = 33;
        Console.WriteLine(outer.Inner.X);
        saved = b;
        saved.X = 44;
        Console.WriteLine(saved.X);
        Point[] array = new Point[2];
        array[0] = b;
        array[0].X = 55;
        Console.WriteLine(array[0].X);
        Console.WriteLine(array[1].X);
        Console.WriteLine(b.X);
        Holder holder = new Holder();
        holder.Value.X = 66;
        Console.WriteLine(holder.Value.X);
    }
}
