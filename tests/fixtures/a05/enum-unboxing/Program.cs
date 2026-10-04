using System;
using System.Runtime.CompilerServices;

enum SignedByte : sbyte { Minimum = sbyte.MinValue }
enum UnsignedByte : byte { Maximum = byte.MaxValue }
enum SignedShort : short { Minimum = short.MinValue }
enum UnsignedShort : ushort { Maximum = ushort.MaxValue }
enum Choice : int { Minimum = int.MinValue }
enum Other : int { Minimum = int.MinValue }
enum UnsignedInt : uint { Maximum = uint.MaxValue }
enum SignedLong : long { Minimum = long.MinValue }
enum UnsignedLong : ulong { Maximum = ulong.MaxValue }

static class Program
{
    static void Main()
    {
        Console.WriteLine((sbyte)(object)SignedByte.Minimum);
        Console.WriteLine((byte)(object)UnsignedByte.Maximum);
        Console.WriteLine((short)(object)SignedShort.Minimum);
        Console.WriteLine((ushort)(object)UnsignedShort.Maximum);
        Console.WriteLine((int)(object)Choice.Minimum);
        Console.WriteLine((uint)(object)UnsignedInt.Maximum);
        Console.WriteLine((long)(object)SignedLong.Minimum);
        Console.WriteLine((ulong)(object)UnsignedLong.Maximum);
        Console.WriteLine((int)(Choice)(object)17);
        Console.WriteLine((int)(Other)(object)Choice.Minimum);

        object boxed = (Choice)7;
        Unsafe.Unbox<int>(boxed) = 29;
        Console.WriteLine((int)(Other)boxed);
        Console.WriteLine(boxed.GetType().Name);
        Console.WriteLine(boxed.ToString());
        Console.WriteLine(boxed is Choice);
        Console.WriteLine(boxed is Enum);
        Console.WriteLine(boxed is int);
        Console.WriteLine(boxed is Other);
        boxed = 5;
        Unsafe.Unbox<Choice>(boxed) = (Choice)31;
        Console.WriteLine((int)boxed);
        Console.WriteLine(boxed is Choice);

        try { Console.WriteLine((uint)(object)(Choice)1); }
        catch (InvalidCastException) { Console.WriteLine("sign rejected"); }
        try { Console.WriteLine((long)(object)(Choice)1); }
        catch (InvalidCastException) { Console.WriteLine("width rejected"); }
        try { Console.WriteLine((Choice)(object)1U); }
        catch (InvalidCastException) { Console.WriteLine("reverse sign rejected"); }
    }
}
