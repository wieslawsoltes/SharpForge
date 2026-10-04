using System;
using System.Collections.Generic;

public static class Program
{
    private static string Try<T>(Func<T> compute)
    {
        try { return compute().ToString(); }
        catch (OverflowException) { return "OVF"; }
        catch (DivideByZeroException) { return "DIV0"; }
    }

    private static int AddChecked(int a, int b) => checked(a + b);
    private static int AddUnchecked(int a, int b) => unchecked(a + b);

    private static long Factorial(int n, bool safe)
    {
        long result = 1;
        for (int i = 2; i <= n; i++)
        {
            if (safe) checked { result *= i; }
            else unchecked { result *= i; }
        }
        return result;
    }

    public static void Main()
    {
        sbyte sb = sbyte.MaxValue; byte b = byte.MaxValue; short s = short.MinValue; ushort us = ushort.MaxValue;
        int i = int.MaxValue; uint u = uint.MaxValue; long l = long.MinValue; ulong ul = ulong.MaxValue; char c = char.MaxValue;
        nint n = int.MaxValue; nuint nu = 5;
        int root = 46341, minusOne = -1, forty = 40000; uint threeBillion = 3000000000u; long twoTo32 = 4294967296L; decimal largest = decimal.MaxValue; double e30 = 1e30;

        Console.WriteLine(string.Join(" ", Try(() => checked((sbyte)(sb + 1))), Try(() => checked((byte)(b + 1))), Try(() => checked((short)(s - 1))), Try(() => checked((ushort)(us + 1))),
            Try(() => checked(i + 1)), Try(() => checked(u + 1)), Try(() => checked(l - 1)), Try(() => checked(ul + 1)), Try(() => checked((char)(c + 1))), Try(() => checked(-l)), Try(() => checked(-i - 2))));
        unchecked
        {
            Console.WriteLine(string.Join(" ", (sbyte)(sb + 1), (byte)(b + 1), (short)(s - 1), (ushort)(us + 1), i + 1, u + 1, l - 1, ul + 1, (int)(char)(c + 1), -l, i * 2, l * 3, (int)l, (int)ul, (uint)i + 1));
        }
        Console.WriteLine(string.Join(" ", Try(() => checked(i * 2)), Try(() => checked(u * 2)), Try(() => checked(l * -1)), Try(() => checked(ul * ul)), Try(() => checked(root * root)), Try(() => checked((root - 1) * (root - 1))), Try(() => checked(threeBillion * 2)), Try(() => checked(twoTo32 * twoTo32))));

        long big = 5_000_000_000; double huge = 1e20, negative = -1.5, nan = double.NaN; decimal money = 300.7m; float f = 3e9f;
        Console.WriteLine(string.Join(" ", Try(() => checked((int)big)), Try(() => checked((uint)big)), Try(() => checked((int)huge)), Try(() => checked((long)huge)), Try(() => checked((uint)negative)), Try(() => checked((byte)money)),
            Try(() => checked((int)nan)), Try(() => checked((int)f)), Try(() => checked((ulong)(long)minusOne)), Try(() => checked((long)ul)), Try(() => checked((short)forty)), Try(() => checked((sbyte)b)), Try(() => checked((char)minusOne + 0)), Try(() => (byte)money)));
        unchecked
        {
            Console.WriteLine(string.Join(" ", (int)big, (uint)big, (short)big, (byte)big, (ulong)-1L, (long)ul, (short)40000, (sbyte)b, (char)65601, (ushort)-1, (uint)-1, (int)3000000000u, (byte)-1.9, (sbyte)127.9, (int)negative));
        }

        int zero = 0;
        Console.WriteLine(string.Join(" ", Try(() => 1 / zero), Try(() => 1 % zero), Try(() => 1.0 / zero), Try(() => -1.0 / zero), Try(() => 0.0 / zero), Try(() => 1m / zero), Try(() => int.MinValue / (zero - 1)), Try(() => unchecked(int.MinValue % (zero - 1))), Try(() => l / (zero - 1L))));
        Console.WriteLine(Try(() => AddChecked(i, 1)) + " " + AddUnchecked(i, 1) + " " + Try(() => Factorial(20, true)) + " " + Try(() => Factorial(21, true)) + " " + Factorial(21, false) + " " + Try(() => checked((int)Factorial(13, true))));

        Console.WriteLine(string.Join(" ", Try(() => checked(n + 1)), Try(() => checked(nu - 6)), unchecked((int)(n + 1)) < 0 || IntPtr.Size == 8, Try(() => largest + 1), Try(() => largest * 2m), Try(() => (decimal)e30), Try(() => Math.Abs(int.MinValue)), Try(() => Convert.ToInt32(3e10)), Try(() => Convert.ToByte(256)), Try(() => int.Parse("99999999999")), Try(() => checked((int)u))));
        int shifted = 1;
        var compound = new List<string>();
        checked
        {
            try { shifted <<= 31; compound.Add(shifted.ToString()); shifted += shifted; compound.Add("unreachable"); }
            catch (OverflowException) { compound.Add("compound overflow"); }
            byte counter = 250;
            try { for (int k = 0; k < 10; k++) counter++; }
            catch (OverflowException) { compound.Add("byte++ at " + counter); }
            short narrow = 100;
            try { narrow *= 400; }
            catch (OverflowException) { compound.Add("short*= kept " + narrow); }
            uint unsigned = 0;
            try { unsigned--; }
            catch (OverflowException) { compound.Add("uint-- kept " + unsigned); }
            try { int minimum = int.MinValue; int negated = -minimum; compound.Add(negated.ToString()); }
            catch (OverflowException) { compound.Add("negate overflow"); }
        }
        Console.WriteLine(string.Join("; ", compound));
        const int ConstantSum = unchecked(int.MaxValue + 1);
        const byte ConstantByte = unchecked((byte)300);
        Console.WriteLine(ConstantSum + " " + ConstantByte + " " + unchecked((int)0xFFFFFFFF) + " " + unchecked((short)0x8000) + " " + (0x7FFFFFFF + 0) + " " + uint.MaxValue / 2 * 2 + " " + (long)int.MaxValue * 2 + " " + int.MaxValue / -1 + " " + 7 / 2 * 2 + " " + -7 / 2 + " " + -7 % 2 + " " + 7 % -2 + " " + 7u / 2 + " " + -7.5 % 2);
    }
}
