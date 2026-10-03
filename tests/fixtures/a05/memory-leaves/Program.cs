using System;
using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;

enum Choice { Seven = 7 }
[StructLayout(LayoutKind.Sequential, Pack = 1)]
struct Packed { public byte Tag; public int X; public short Y; }

static class Program
{
    static unsafe void Main()
    {
        Span<int> values = stackalloc int[4] { 1, 2, 3, 4 };
        Span<int> slice = values.Slice(1, 2);
        slice[1] = 9;
        Console.WriteLine(values[2]);
        ReadOnlySpan<int> readonlyValues = values;
        Console.WriteLine(readonlyValues.Slice(1)[1]);
        try { Console.WriteLine(values[4]); }
        catch (IndexOutOfRangeException) { Console.WriteLine("bounds"); }

        int[] array = new int[3];
        fixed (int* pointer = array) { pointer[1] = 7; GC.Collect(); Console.WriteLine(pointer[1]); }
        Console.WriteLine(array[1]);

        int bits = 0x3f800000;
        ref float single = ref Unsafe.As<int, float>(ref bits);
        Console.WriteLine(single);
        single = 2;
        Console.WriteLine(bits);
        byte[] bytes = BitConverter.GetBytes(0x12345678);
        Console.WriteLine(bytes[0]);
        Console.WriteLine(BitConverter.ToInt32(bytes, 0));
        Console.WriteLine(sizeof(Packed));

        int? empty = null;
        int? full = 12;
        object? boxedEmpty = empty;
        object boxedFull = full;
        Console.WriteLine(boxedEmpty == null);
        Console.WriteLine((int)boxedFull);
        Console.WriteLine(((int?)boxedFull).Value);
        Console.WriteLine((int)(object)Choice.Seven);
        try { Console.WriteLine((long)boxedFull); }
        catch (InvalidCastException) { Console.WriteLine("boxed-type"); }
    }
}
