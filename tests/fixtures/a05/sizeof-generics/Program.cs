using System;
using System.Runtime.InteropServices;

[StructLayout(LayoutKind.Sequential)]
struct Cell<T>
{
    public byte Tag;
    public T Value;
    public static unsafe int ElementSize() => sizeof(T);
}

static class Program
{
    static unsafe int Size<T>() => sizeof(T);

    static unsafe void Main()
    {
        Console.WriteLine(sizeof(Cell<int>));
        Console.WriteLine(sizeof(Cell<Cell<int>>));
        Console.WriteLine(sizeof(byte?));
        Console.WriteLine(sizeof(int?));
        Console.WriteLine(sizeof(long?));
        Console.WriteLine(Size<int>());
        Console.WriteLine(Size<string>() == sizeof(nint));
        Console.WriteLine(Size<Cell<int>>());
        Console.WriteLine(Cell<long>.ElementSize());
        Console.WriteLine(Cell<string>.ElementSize() == sizeof(nint));
        Console.WriteLine(sizeof(object) == sizeof(nint));
        Console.WriteLine(sizeof(int[]) == sizeof(nint));
    }
}
