using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;

public enum Small : sbyte { Min = -128, Minus = -1, Zero, One, Max = 127 }
public enum Level : long { Low = 1, High = 1L << 40, Top = long.MaxValue }
public enum Color : uint { Red = 0xFF0000, Green = 0x00FF00, Blue = 0x0000FF, White = Red | Green | Blue }
public enum Weekday { Mon = 1, Tue, Wed, Thu, Fri, Sat = 10, Sun }

public static class Program
{
    private static string TypeOf<T>(T value) => typeof(T).Name;
    private static string Describe<TEnum>(TEnum value) where TEnum : struct, Enum
        => $"{value}={Convert.ToInt64(value, CultureInfo.InvariantCulture)}:{Enum.GetUnderlyingType(typeof(TEnum)).Name}:{Enum.IsDefined(value)}";

    public static void Main()
    {
        byte b = 200; sbyte sb = -100; short s = -30000; ushort us = 60000; int i = -2_000_000_000; uint u = 4_000_000_000; long l = -9_000_000_000_000_000_000; ulong ul = 18_000_000_000_000_000_000; char c = 'A';
        Console.WriteLine(string.Join(" ",
            TypeOf(b + b), TypeOf(sb + b), TypeOf(s + us), TypeOf(i + u), TypeOf(u + l), TypeOf(b + 1L), TypeOf(c + c), TypeOf(c + 1u), TypeOf(-b), TypeOf(-u), TypeOf(~us), TypeOf(b << 1), TypeOf(u << 1), TypeOf(l >> 1), TypeOf(b & sb), TypeOf(u | b), TypeOf(1 + 1.0f), TypeOf(1L + 1.0f), TypeOf(1.0f + 1.0), TypeOf(1 + 1m), TypeOf(b * 1.0), TypeOf(ul + b), TypeOf(c + 0.5), TypeOf(true ? b : s), TypeOf(true ? 1 : 2L), TypeOf(true ? c : 1)));
        Console.WriteLine(string.Join(" ",
            b + b, sb + b, s + us, i + u, u + l, -b, -u, ~us, b << 1, u << 1, l >> 1, b & sb, u | b, ul + b, c + c, c + 1, (char)(c + 1), b / 3, sb / 3, sb % 3, s >> 2, us >> 2, i / 7, i % 7, u / 7, l / i, ul / u));
        long widened = i; double fromLong = l; float fromInt = i; decimal fromUlong = ul; double doubleFromUlong = ul; int fromChar = c; ulong fromByte = b; float fromUint = u;
        Console.WriteLine(string.Join(" ",
            widened, fromLong.ToString("R", CultureInfo.InvariantCulture), fromInt.ToString("R", CultureInfo.InvariantCulture), fromUlong, doubleFromUlong.ToString("R", CultureInfo.InvariantCulture), fromChar, fromByte, fromUint.ToString("R", CultureInfo.InvariantCulture), (long)fromLong == l, (int)fromInt == i, (double)(float)0.1 == 0.1));
        unchecked
        {
            Console.WriteLine(string.Join(" ",
            (byte)sb, (sbyte)b, (short)us, (ushort)s, (int)u, (uint)i, (long)ul, (ulong)l, (byte)i, (sbyte)i, (short)i, (char)i, (int)l, (uint)l, (byte)c, (char)b, (char)sb == 'ﾜ', (int)(char)s, (short)(char)us, (ulong)sb, (uint)sb, (long)(uint)sb, (ulong)(int)u, (int)(short)(byte)sb));
        }
        Console.WriteLine(string.Join(" ",
            (int)3.99, (int)-3.99, (int)3.5f, (long)-0.9, (uint)3.99, (byte)255.9, (int)1e9, (long)1e18, (int)(decimal)7.9m, (int)Math.Round(2.5), (int)Math.Round(3.5), (int)Math.Floor(-2.5), Convert.ToInt32(2.5), Convert.ToInt32(3.5), Convert.ToInt32(-2.5), Convert.ToInt32("42"), Convert.ToInt32('7'), Convert.ToInt32(true), Convert.ToByte("ff", 16), Convert.ToChar(97), Convert.ToDouble("1.5", CultureInfo.InvariantCulture), Convert.ToBoolean(2), Convert.ToInt64(1e15), Convert.ToUInt16(us), Convert.ToString(-8, 2).Length, Convert.ToSByte(-5)));
        Console.WriteLine(string.Join(" ",
            int.MaxValue, int.MinValue, uint.MaxValue, long.MaxValue, long.MinValue, ulong.MaxValue, short.MinValue, ushort.MaxValue, byte.MaxValue, sbyte.MinValue, (int)char.MaxValue, 0x7FFF_FFFF, 0b1111, 1_000, 0xFFu, 10L, 10UL, 1e3, 1.5f, 1.5m, 'x', '\x41', 0x80000000, 0xFFFFFFFFFFFFFFFF, 2147483648, -2147483648));
        Console.WriteLine(string.Join(" ",
            TypeOf(2147483647), TypeOf(2147483648), TypeOf(4294967296), TypeOf(0x80000000), TypeOf(0xFFFFFFFFFFFFFFFF), TypeOf(-2147483648), TypeOf(1u), TypeOf(1L), TypeOf(1UL), TypeOf(1f), TypeOf(1d), TypeOf(1m), TypeOf(1e0), TypeOf('1'), TypeOf(9223372036854775808), TypeOf(-9223372036854775808)));

        Console.WriteLine(string.Join(" ",
            Describe(Small.Min), Describe(Small.Max), Describe((Small)5), Describe(Level.High), Describe(Level.Top), Describe(Color.White), Describe((Color)0xFFFF00), Describe(Weekday.Sun), Describe((Weekday)6), Describe(default(Weekday))));
        Weekday day = Weekday.Fri;
        day++;
        var next = day + 4;
        int distance = Weekday.Sun - Weekday.Mon;
        Small small = Small.Max;
        unchecked { small++; }
        Color mixed = Color.Red | Color.Blue;
        Level level = (Level)(1L << 40);
        Console.WriteLine(string.Join(" ",
            day, (int)day, next, distance, small, (sbyte)small, mixed, (uint)mixed, mixed.ToString("X"), level, level == Level.High, (Level)2, Weekday.Tue < Weekday.Sat, Weekday.Tue.CompareTo(Weekday.Mon), (Weekday)Enum.ToObject(typeof(Weekday), 11), Enum.GetName(typeof(Weekday), 3), Enum.GetValues<Small>().Length, string.Join("", Enum.GetValues<Weekday>().Select(d => (int)d)), (object)Weekday.Mon is Weekday, (object)Weekday.Mon is int, Weekday.Mon.Equals(1), Weekday.Mon.Equals(Weekday.Mon), Weekday.Mon.GetHashCode(), (Weekday)1 == Weekday.Mon, Weekday.Mon ^ Weekday.Tue, ~Weekday.Mon, Weekday.Wed & Weekday.Tue, 0 == Weekday.Mon - 1));
        Console.WriteLine(string.Join(" ",
            Enum.TryParse<Weekday>("Sat", out var parsed) && parsed == Weekday.Sat, Enum.TryParse<Weekday>("11", out var numeric) ? numeric.ToString() : "-", Enum.TryParse<Color>("Red, Blue", out var flags) ? ((uint)flags).ToString("X") : "-", Enum.TryParse<Weekday>("nope", out _), Enum.Parse(typeof(Small), "Minus"), Enum.Format(typeof(Weekday), 2, "G"), Enum.Format(typeof(Color), Color.Green, "D"), $"{Weekday.Wed:D}{Weekday.Wed:G}{Weekday.Wed:X}", Weekday.Mon.ToString("F"), Small.Minus.ToString("X"), ((Weekday)99).ToString(), Enum.GetNames<Level>().Length));
        var totals = new Dictionary<Weekday, int>();
        foreach (Weekday d in Enum.GetValues(typeof(Weekday))) totals[d] = (int)d * (d >= Weekday.Sat ? 2 : 1);
        var switchSum = 0;
        foreach (var d in totals.Keys)
        {
            switch (d)
            {
                case Weekday.Mon: case Weekday.Tue: switchSum += 1; break;
                case Weekday.Sat or Weekday.Sun: switchSum += 100; break;
                case > Weekday.Tue and < Weekday.Sat: switchSum += 10; break;
            }
        }
        Console.WriteLine(totals.Values.Sum() + " " + switchSum + " " + totals.Where(p => p.Key.HasFlag(Weekday.Tue)).Count() + " " + sizeof(Small) + sizeof(Level) + sizeof(Color) + sizeof(Weekday) + " " + (int)(Weekday.Mon | (Weekday)8));
    }
}
