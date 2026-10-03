using System;
using System.Runtime.InteropServices;

[StructLayout(LayoutKind.Explicit, Size = 12)]
struct Union
{
    [FieldOffset(0)] public int Bits;
    [FieldOffset(0)] public float Real;
    [FieldOffset(1)] public byte Byte;
}

struct Pair { public short Low; public short High; }

[StructLayout(LayoutKind.Explicit)]
struct Nested
{
    [FieldOffset(0)] public Pair Pair;
    [FieldOffset(0)] public int Bits;
}

[StructLayout(LayoutKind.Explicit, Size = 16)]
struct References
{
    [FieldOffset(0)] public object First;
    [FieldOffset(0)] public object Second;
    [FieldOffset(8)] public int Tag;
}

static class Program
{
    static void Update(ref Union value) => value.Byte = 0x80;

    static void Main()
    {
        Union value = default;
        value.Bits = 0x3f800000;
        Union copy = value;
        Update(ref value);
        Console.WriteLine(value.Bits == 0x3f808000);
        Console.WriteLine(copy.Real);
        Union[] array = new Union[2];
        array[0] = copy;
        Update(ref array[0]);
        Console.WriteLine(array[0].Bits == value.Bits);
        Console.WriteLine(array[1].Bits);
        object box = copy;
        copy.Bits = 0;
        Console.WriteLine(((Union)box).Real);
        Nested nested = default;
        nested.Bits = 0x12345678;
        nested.Pair.Low = 5;
        Console.WriteLine(nested.Bits == 0x12340005);
        References references = default;
        references.First = new object();
        GC.Collect();
        Console.WriteLine(references.First == references.Second);
        references.Second = null;
        Console.WriteLine(references.First == null);
    }
}
