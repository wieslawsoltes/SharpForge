using System;
using System.Globalization;

public static class Program
{
    private const int Kilo = 1 << 10;
    private const long PastInt = int.MaxValue + 1L;
    private const uint AllOnes = unchecked((uint)-1);
    private const int Wrapped = unchecked(int.MaxValue + Kilo);
    private const double Third = 1.0 / 3;
    private const byte Nibble = 0xAB & 0x0F | 0x10;
    private const char NextLetter = (char)('a' + 1);
    private const decimal Price = 19.99m * 3 + 0.03m;

    private static readonly CultureInfo Inv = CultureInfo.InvariantCulture;
    private static string T<TValue>(TValue value) => typeof(TValue).Name;
    private static string Row(params object[] cells) => string.Join(" ", Array.ConvertAll(cells, c => Convert.ToString(c, Inv)));
    private static string Try(Func<object> convert)
    {
        try { return Convert.ToString(convert(), Inv); }
        catch (OverflowException) { return "OVF"; }
    }

    // Unchecked conversions from each integral source to every other width: truncation, wrapping, sign and zero extension.
    private static string From(sbyte v) => Row((byte)v, (short)v, (ushort)v, (int)v, (uint)v, (long)v, (ulong)v, (int)(char)v, (float)v, (double)v, (decimal)v);
    private static string From(byte v) => Row((sbyte)v, (short)v, (ushort)v, (int)v, (uint)v, (long)v, (ulong)v, (int)(char)v, (float)v, (double)v, (decimal)v);
    private static string From(short v) => Row((sbyte)v, (byte)v, (ushort)v, (int)v, (uint)v, (long)v, (ulong)v, (int)(char)v, (float)v, (double)v, (decimal)v);
    private static string From(ushort v) => Row((sbyte)v, (byte)v, (short)v, (int)v, (uint)v, (long)v, (ulong)v, (int)(char)v, (float)v, (double)v, (decimal)v);
    private static string From(int v) => Row((sbyte)v, (byte)v, (short)v, (ushort)v, (uint)v, (long)v, (ulong)v, (int)(char)v, (float)v, (double)v, (decimal)v);
    private static string From(uint v) => Row((sbyte)v, (byte)v, (short)v, (ushort)v, (int)v, (long)v, (ulong)v, (int)(char)v, (float)v, (double)v, (decimal)v);
    private static string From(long v) => Row((sbyte)v, (byte)v, (short)v, (ushort)v, (int)v, (uint)v, (ulong)v, (int)(char)v, (float)v, (double)v, (decimal)v);
    private static string From(ulong v) => Row((sbyte)v, (byte)v, (short)v, (ushort)v, (int)v, (uint)v, (long)v, (int)(char)v, (float)v, (double)v, (decimal)v);
    private static string From(char v) => Row((sbyte)v, (byte)v, (short)v, (ushort)v, (int)v, (uint)v, (long)v, (ulong)v, (float)v, (double)v, (decimal)v);

    // The same conversions in a checked context: each cell is either the value or OVF.
    private static string Checked(long v) => Row(Try(() => checked((sbyte)v)), Try(() => checked((byte)v)), Try(() => checked((short)v)), Try(() => checked((ushort)v)),
        Try(() => checked((int)v)), Try(() => checked((uint)v)), Try(() => checked((ulong)v)), Try(() => (int)checked((char)v)));
    private static string Checked(ulong v) => Row(Try(() => checked((sbyte)v)), Try(() => checked((byte)v)), Try(() => checked((short)v)), Try(() => checked((ushort)v)),
        Try(() => checked((int)v)), Try(() => checked((uint)v)), Try(() => checked((long)v)), Try(() => (int)checked((char)v)));
    private static string Checked(double v) => Row(Try(() => checked((sbyte)v)), Try(() => checked((byte)v)), Try(() => checked((short)v)), Try(() => checked((ushort)v)),
        Try(() => checked((int)v)), Try(() => checked((uint)v)), Try(() => checked((long)v)), Try(() => checked((ulong)v)), Try(() => (decimal)v));
    private static string Checked(decimal v) => Row(Try(() => (sbyte)v), Try(() => (byte)v), Try(() => (short)v), Try(() => (ushort)v), Try(() => unchecked((int)v)), Try(() => (uint)v),
        Try(() => (long)v), Try(() => (ulong)v), Try(() => (int)(char)v), Try(() => (float)v), Try(() => (double)v));

    public static void Main()
    {
        Console.WriteLine("sbyte -1    : " + From((sbyte)-1));
        Console.WriteLine("byte 200    : " + From((byte)200));
        Console.WriteLine("short min   : " + From(short.MinValue));
        Console.WriteLine("ushort max  : " + From(ushort.MaxValue));
        Console.WriteLine("int -2^31+7 : " + From(int.MinValue + 7));
        Console.WriteLine("uint 4e9    : " + From(4_000_000_123u));
        Console.WriteLine("long -9e12  : " + From(-9_000_000_000_123L));
        Console.WriteLine("ulong max-1 : " + From(ulong.MaxValue - 1));
        Console.WriteLine("char e-acute: " + From('é'));
        Console.WriteLine("checked long 200     : " + Checked(200L));
        Console.WriteLine("checked long -1      : " + Checked(-1L));
        Console.WriteLine("checked long 70000   : " + Checked(70_000L));
        Console.WriteLine("checked long 2^31    : " + Checked(PastInt));
        Console.WriteLine("checked ulong 2^63   : " + Checked(1UL << 63));
        Console.WriteLine("checked double -0.9  : " + Checked(-0.9));
        Console.WriteLine("checked double 255.9 : " + Checked(255.9));
        Console.WriteLine("checked double -129  : " + Checked(-129.0));
        Console.WriteLine("checked double 2^31  : " + Checked(2147483648.0));
        Console.WriteLine("checked double 2^63  : " + Checked(9223372036854775808.0));
        Console.WriteLine("checked double 1e30  : " + Checked(1e30));
        Console.WriteLine("checked double NaN   : " + Checked(double.NaN));
        Console.WriteLine("decimal 127.99       : " + Checked(127.99m));
        Console.WriteLine("decimal -0.5         : " + Checked(-0.5m));
        Console.WriteLine("decimal 4294967296.5 : " + Checked(4294967296.5m));

        // Floating-point narrowing, widening and truncation toward zero.
        double d = 100.99, negative = -100.99, tiny = 1e-50, precise = 0.1;
        float f = (float)precise, fromInt = 16777217, fromLong = long.MaxValue;
        double widened = f, fromLongD = long.MaxValue;
        Console.WriteLine("truncate: " + Row((sbyte)d, (byte)d, (short)d, (ushort)d, (int)d, (uint)d, (long)d, (ulong)d, (int)(char)d, (sbyte)negative, (short)negative, (int)negative, (long)negative, (int)-0.99, (int)0.99f));
        Console.WriteLine("floats: " + Row(f, widened, (float)tiny, (float)double.MaxValue, (double)float.MaxValue, fromInt, fromLong, fromLongD, (float)precise == precise, (double)0.5f == 0.5,
            0.1f + 0.2f, 0.1 + 0.2, (float)(0.1 + 0.2), (decimal)f, (decimal)precise, (double)0.1m, (float)1.1m, 1e16 + 1 == 1e16, 16777216f + 1 == 16777216f));

        // Binary numeric promotions: the static type of each expression.
        sbyte sb = 1; byte b = 2; short s = 3; ushort us = 4; int i = 5; uint u = 6; long l = 7; ulong ul = 8; char c = 'c'; float fl = 9; double db = 10; decimal m = 11; nint n = 12; nuint nu = 13;
        Console.WriteLine("promotions: " + Row(T(b + b), T(sb + b), T(s * us), T(c + c), T(c + 1), T(-b), T(+c), T(~s), T(i + u), T(-u), T(u + u), T(u + l), T(i + l), T(ul + u), T(ul + b), T(ul + c)));
        Console.WriteLine("promotions: " + Row(T(i + fl), T(l + fl), T(fl + db), T(ul + db), T(i + m), T(ul + m), T(c + m), T(b / fl), T(i / 2), T(i / 2.0), T(i / 2f), T(i / 2m), T(n + i), T(n + l), T(nu + u), T(nu + b), T(n * n), T(-n)));
        Console.WriteLine("conditional: " + Row(T(i > 0 ? b : s), T(i > 0 ? i : l), T(i > 0 ? u : 7), T(i > 0 ? u : l), T(i > 0 ? c : us), T(i > 0 ? 1 : 2.5), T(i > 0 ? b : 300), T(i > 0 ? 'a' : 0), T(i > 0 ? fl : m > 0 ? db : i), T(i > 0 ? b : us), T(sb << 2), T(l << i), T(u >> 1)));
        Console.WriteLine("literals: " + Row(T(1), T(2147483647), T(2147483648), T(4294967295), T(4294967296), T(9223372036854775808), T(-2147483648), T(-9223372036854775808), T(0x7FFFFFFF), T(0xFFFFFFFF), T(0x1_0000_0000),
            T(0xFFFFFFFFFFFFFFFF), T(0b1000_0000), T(1u), T(1L), T(1UL), T(1Lu), T(1f), T(1d), T(1m), T(1e3), T(1.5e3f), T(.5), T('a'), T(Kilo), T(PastInt), T(Third), T(Nibble), T(NextLetter)));
        Console.WriteLine("constants: " + Row(Kilo, PastInt, AllOnes, Wrapped, Third, Nibble, NextLetter, Price, int.MaxValue + 1L, uint.MaxValue + 1UL, unchecked((byte)(Kilo + 255)), unchecked((sbyte)0x80), unchecked((short)AllOnes),
            7 / 2, -7 / 2, -7 % 2, 7 % -2, 7.5 % 2, -7.5 % 2, 1 / 2 * 2.0, 1 / 2.0 * 2, 10 / 4 * 4, 'a' + 'b', (char)('a' + 'b' - 'a'), "" + 'a' + 'b', 1 + 2 + "3" + 4 + 5, sizeof(long) * sizeof(short), 5 / 2f));

        // Compound assignment silently converts back to the left-hand type; ++ and -- wrap in an unchecked context.
        b += 255; sb -= 100; sb -= 100; s <<= 14; s <<= 1; us -= 5; c += (char)3; c++; i += 'a'; l *= int.MaxValue; l *= 4; u -= 7; fl /= 4; fl += 0.1f; db += fl; m *= 1.10m; i /= 3; i %= 7; i <<= 30; n <<= 2; nu -= 3;
        byte wrapByte = 255; wrapByte++; sbyte wrapSbyte = sbyte.MinValue; wrapSbyte--; ushort wrapUshort = 0; wrapUshort--; int wrapInt = int.MaxValue; wrapInt++; uint wrapUint = 0; --wrapUint; long wrapLong = long.MinValue; wrapLong--;
        Console.WriteLine("compound: " + Row(b, sb, s, us, c, i, l, u, fl, db, m, n, nu) + " | wraps: " + Row(wrapByte, wrapSbyte, wrapUshort, wrapInt, wrapUint, wrapLong));

        // Overflow detection per width, in checked expressions and checked blocks.
        byte maxByte = byte.MaxValue; sbyte minSbyte = sbyte.MinValue; short maxShort = short.MaxValue; ushort zeroUshort = 0; int minInt = int.MinValue; uint zeroUint = 0; long maxLong = long.MaxValue; ulong maxUlong = ulong.MaxValue;
        nint bigNative = int.MaxValue; int minusOne = -1; char lastChar = char.MaxValue;
        Console.WriteLine("checked ops: " + Row(Try(() => checked((byte)(maxByte + 1))), Try(() => checked(maxByte + 1)), Try(() => checked((sbyte)(minSbyte - 1))), Try(() => checked((short)(maxShort * 2))),
            Try(() => checked((ushort)(zeroUshort - 1))), Try(() => checked(-minInt)), Try(() => checked(minInt - 1)), Try(() => checked(Math.Abs(minInt + 1))), Try(() => checked(zeroUint - 1)), Try(() => checked(maxLong + 1)),
            Try(() => checked(maxLong * minusOne)), Try(() => checked(maxUlong + 1)), Try(() => checked(maxUlong * 2)), Try(() => checked((int)bigNative)), Try(() => checked((nuint)minusOne)), Try(() => checked((char)(lastChar + 1))),
            Try(() => minInt / minusOne), Try(() => checked((uint)minusOne)), Try(() => checked((int)(uint)minusOne)), Try(() => checked((long)maxUlong)), Try(() => checked((ulong)minInt))));
        int blocks = 0;
        try { checked { maxByte++; } } catch (OverflowException) { blocks |= 1; }
        try { checked { minSbyte--; } } catch (OverflowException) { blocks |= 2; }
        try { checked { maxShort += 1; } } catch (OverflowException) { blocks |= 4; }
        try { checked { zeroUshort -= 1; } } catch (OverflowException) { blocks |= 8; }
        try { checked { minInt = -minInt; } } catch (OverflowException) { blocks |= 16; }
        try { checked { --zeroUint; } } catch (OverflowException) { blocks |= 32; }
        try { checked { maxLong <<= 1; unchecked { maxLong += long.MaxValue; } maxLong *= 2; } } catch (OverflowException) { blocks |= 64; }
        try { checked { maxUlong = unchecked(maxUlong + 2) + ulong.MaxValue; } } catch (OverflowException) { blocks |= 128; }
        try { checked { lastChar++; } } catch (OverflowException) { blocks |= 256; }
        Console.WriteLine("checked blocks: " + Convert.ToString(blocks, 2) + " state: " + Row(maxByte, minSbyte, maxShort, zeroUshort, minInt, zeroUint, maxLong, maxUlong, (int)lastChar)
            + " | unchecked: " + Row(unchecked((byte)(maxByte + 1)), unchecked(minInt - 1), unchecked(maxUlong + maxUlong), unchecked((int)(uint)minusOne), unchecked((uint)minusOne), unchecked(-minInt), unchecked((ushort)minusOne)));

        // char <-> integers and native-sized integers.
        char letter = (char)66; int code = letter; ushort unit = letter; short signedUnit = (short)letter;
        nint native = (nint)3.9; nuint unsignedNative = (nuint)code; long fromNative = native * 1000; int backToInt = (int)(native - 10);
        Console.WriteLine("chars: " + Row(letter, code, unit, signedUnit, (char)(letter + 1), (char)(letter | 0x20), letter + 1, (char)code == letter, 'a' < 'b', (int)'0', (char)('0' + 7), '9' - '0', unchecked((byte)'Ł'), char.MaxValue + 0,
            (int)unchecked((char)-1), "x" + (char)97, letter.ToString() + 1) + " | native: " + Row(native, unsignedNative, fromNative, backToInt, (nint)(-7) / 2, (nint)(-7) % 2, (nuint)7 >> 1, native == 3, T(native + 1), T(unsignedNative + 1u), T((long)native + 1)));
    }
}
