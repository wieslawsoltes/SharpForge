using System;
using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;

public static class InspectUtf8
{
    private static int checksum;
    private static void Dump(string name, ReadOnlySpan<byte> value)
    {
        ref byte first = ref MemoryMarshal.GetReference(value);
        Console.WriteLine(name + ":" + value.Length + ":" + Convert.ToHexString(value) + ":" + Unsafe.Add(ref first, value.Length));
    }
    // Keep the measured calls intact even when the tested compiler does not emit MethodImpl attributes.
    [MethodImpl(MethodImplOptions.NoInlining | MethodImplOptions.NoOptimization)]
    private static int ReadMany()
    {
        int sum = 0;
        for (int index = 0; index < 10000; index++)
        {
            ReadOnlySpan<byte> value = Utf8Literals.Ascii();
            sum += value[index % value.Length];
        }
        return sum;
    }
    public static void Main()
    {
        Dump("empty", Utf8Literals.Empty());
        Dump("ascii", Utf8Literals.Ascii());
        Dump("unicode", Utf8Literals.Unicode());
        Dump("embedded", Utf8Literals.Embedded());
        Dump("concat", Utf8Literals.Concatenated());
        Dump("raw", Utf8Literals.Raw());
        Dump("one", Utf8Literals.One());
        Dump("three", Utf8Literals.Three());
        Dump("seven", Utf8Literals.Seven());
        Dump("eight", Utf8Literals.Eight());
        Dump("generic", Utf8Literals.Generic<int>());
        Console.WriteLine("same:" + Unsafe.AreSame(ref MemoryMarshal.GetReference(Utf8Literals.Ascii()),
            ref MemoryMarshal.GetReference(Utf8Literals.Duplicate())));
        Console.WriteLine("local:" + Utf8Literals.Local());
        Console.WriteLine("initializer:" + Utf8Literals.Initializer);
        Console.WriteLine("ctor:" + new Utf8Constructor().Value);
        Console.WriteLine("stack:" + Utf8Literals.StackOperand());
        foreach (int value in Utf8Literals.Iterator()) Console.WriteLine("iterator:" + value);
        ReadOnlySpan<byte> saved = Utf8Literals.Unicode();
        GC.Collect(2, GCCollectionMode.Forced);
        Dump("after-gc", saved);
        for (int warm = 0; warm < 10; warm++) checksum = ReadMany();
        long before = GC.GetAllocatedBytesForCurrentThread();
        checksum = ReadMany();
        long allocated = GC.GetAllocatedBytesForCurrentThread() - before;
        Console.WriteLine("allocated:" + allocated);
        Console.WriteLine("checksum:" + checksum);
    }
}
