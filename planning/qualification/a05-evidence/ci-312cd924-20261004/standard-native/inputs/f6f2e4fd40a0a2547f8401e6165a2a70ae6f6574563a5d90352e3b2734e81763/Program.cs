using System;
using System.Runtime.InteropServices;

[StructLayout(LayoutKind.Sequential)]
struct Cell<T> { public byte Tag; public T Value; }

[StructLayout(LayoutKind.Sequential, Pack = 1)]
struct Packed { public byte Tag; public int Value; }

[StructLayout(LayoutKind.Explicit, Pack = 1, Size = 7)]
struct Union
{
    [FieldOffset(0)] public int Bits;
    [FieldOffset(0)] public float Real;
    [FieldOffset(1)] public byte Byte;
}

class Owner<T> { public static unsafe int ElementSize() => sizeof(T); }

static class Program
{
    static unsafe int Size<T>() => sizeof(T);
    static unsafe int WrapperSize<T>() => sizeof(Cell<T>);

    static unsafe void Main()
    {
        Console.WriteLine(sizeof(Cell<int>));
        Console.WriteLine(sizeof(Cell<Cell<int>>));
        Console.WriteLine(sizeof(Packed));
        Console.WriteLine(sizeof(Union));
        Console.WriteLine(sizeof(byte?));
        Console.WriteLine(sizeof(int?));
        Console.WriteLine(sizeof(long?));
        Console.WriteLine(Size<int>());
        Console.WriteLine(Size<string>() == sizeof(nint));
        Console.WriteLine(Owner<long>.ElementSize());
        Console.WriteLine(Owner<string>.ElementSize() == sizeof(nint));
        Console.WriteLine(WrapperSize<int>());
        Console.WriteLine(sizeof(object) == sizeof(nint));
        Console.WriteLine(sizeof(int[]) == sizeof(nint));
    }
}
