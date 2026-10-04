using System;
using System.Runtime.CompilerServices;

struct Point { public int X; public byte Tiny; }
struct Other { public int X; public byte Tiny; }

static class Program
{
    static void Main()
    {
        Point original = default;
        original.X = 7;
        object boxed = original;
        ref Point interior = ref Unsafe.Unbox<Point>(boxed);
        interior.X = 9;
        interior.Tiny = unchecked((byte)511);
        Point copy = (Point)boxed;
        copy.X = 11;
        Console.WriteLine(original.X);
        Console.WriteLine(((Point)boxed).X);
        Console.WriteLine(copy.X);
        Console.WriteLine(((Point)boxed).Tiny);
        Console.WriteLine(boxed.ToString());
        Console.WriteLine(boxed.GetType().FullName);
        Console.WriteLine(boxed is ValueType);
        Console.WriteLine(boxed is Other);
    }
}
