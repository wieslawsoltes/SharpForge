using System;

static class Program
{
    static void Main()
    {
        Console.WriteLine(IntPtr.Size);
        Console.WriteLine(UIntPtr.Size);
        nint negative = -1;
        int increment = 2;
        Console.WriteLine((long)(negative + increment));
        Console.WriteLine((long)(negative << 40));

        long limit = IntPtr.Size == 4 ? int.MaxValue : long.MaxValue;
        nint maximum = checked((nint)limit);
        Console.WriteLine((long)maximum);
        try { Console.WriteLine((long)checked(maximum + increment)); }
        catch (OverflowException) { Console.WriteLine("signed-overflow"); }
        nint minimum = unchecked(maximum + (nint)1);
        Console.WriteLine((long)minimum);
        try { Console.WriteLine((long)checked(minimum - (nint)1)); }
        catch (OverflowException) { Console.WriteLine("signed-underflow"); }

        nuint unsignedMaximum = unchecked((nuint)ulong.MaxValue);
        Console.WriteLine((ulong)unsignedMaximum);
        try { Console.WriteLine((ulong)checked(unsignedMaximum + (nuint)1)); }
        catch (OverflowException) { Console.WriteLine("unsigned-overflow"); }
        try { Console.WriteLine((long)checked((nint)4294967295L)); }
        catch (OverflowException) { Console.WriteLine("conversion-overflow"); }

        nint[] values = new nint[2];
        values[0] = maximum;
        ref nint slot = ref values[0];
        slot = negative + increment;
        Console.WriteLine((long)values[0]);
        Console.WriteLine((long)values[1]);
    }
}
