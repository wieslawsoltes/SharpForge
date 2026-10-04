using System;
using System.Runtime.CompilerServices;

static class Program
{
    [MethodImpl(MethodImplOptions.NoInlining)]
    static ulong ToUnsigned(uint value) => (ulong)value;

    [MethodImpl(MethodImplOptions.NoInlining)]
    static long ToSigned(uint value) => (long)value;

    [MethodImpl(MethodImplOptions.NoInlining)]
    static long SignExtend(int value) => (long)value;

    static void Main()
    {
        uint x = 0xFFFFFFFF;
        Console.WriteLine((ulong)x);
        Console.WriteLine((long)x);
        Console.WriteLine(ToUnsigned(x));
        Console.WriteLine(ToSigned(x));
        Console.WriteLine(ToUnsigned(0x80000000));
        Console.WriteLine(ToSigned(0x80000000));
        Console.WriteLine(SignExtend(-1));
    }
}
