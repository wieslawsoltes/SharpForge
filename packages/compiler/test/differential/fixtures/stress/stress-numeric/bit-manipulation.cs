using System;
using System.Collections.Generic;
using System.Numerics;
using System.Text;

[Flags]
public enum Permissions : ushort { None = 0, Read = 1, Write = 2, Execute = 4, Delete = 8, Admin = 0x8000, ReadWrite = Read | Write }

public struct BitSet
{
    private ulong bits;
    public bool this[int index]
    {
        readonly get => (bits & (1UL << index)) != 0;
        set { if (value) bits |= 1UL << index; else bits &= ~(1UL << index); }
    }
    public readonly int Count => BitOperations.PopCount(bits);
    public void Toggle(int index) => bits ^= 1UL << index;
    public readonly BitSet Union(BitSet other) => new BitSet { bits = bits | other.bits };
    public readonly IEnumerable<int> Members()
    {
        ulong rest = bits;
        while (rest != 0)
        {
            int index = BitOperations.TrailingZeroCount(rest);
            yield return index;
            rest &= rest - 1;
        }
    }
    public readonly override string ToString() => "{" + string.Join(",", Members()) + "}";
}

public static class Bits
{
    public static string Binary(uint value, int width = 8)
    {
        var text = new StringBuilder(width);
        for (int i = width - 1; i >= 0; i--) text.Append((value >> i & 1) == 1 ? '1' : '0');
        return text.ToString();
    }
    public static uint Reverse(uint value)
    {
        uint result = 0;
        for (int i = 0; i < 32; i++) { result = result << 1 | value & 1; value >>= 1; }
        return result;
    }
    public static int PopCount(ulong value)
    {
        int count = 0;
        for (; value != 0; value &= value - 1) count++;
        return count;
    }
    public static bool IsPowerOfTwo(long value) => value > 0 && (value & (value - 1)) == 0;
    public static uint RotateLeft(uint value, int shift) => value << shift | value >> (32 - shift);
    public static int Sign(int value) => value >> 31 | (int)((uint)-value >> 31);
    public static uint Pack(byte r, byte g, byte b, byte a = 255) => (uint)(a << 24 | r << 16 | g << 8 | b);
    public static (byte R, byte G, byte B, byte A) Unpack(uint color) => ((byte)(color >> 16), (byte)(color >> 8), (byte)color, (byte)(color >> 24));
    public static uint Gray(uint n) => n ^ n >> 1;
    public static int Log2(uint value) { int log = -1; while (value != 0) { value >>= 1; log++; } return log; }
    public static ulong Interleave(uint x, uint y)
    {
        ulong result = 0;
        for (int i = 0; i < 32; i++) result |= (ulong)(x >> i & 1) << 2 * i | (ulong)(y >> i & 1) << 2 * i + 1;
        return result;
    }
    public static uint Crc32(ReadOnlySpan<byte> data)
    {
        uint crc = 0xFFFFFFFF;
        foreach (byte item in data)
        {
            crc ^= item;
            for (int bit = 0; bit < 8; bit++) crc = (crc & 1) != 0 ? crc >> 1 ^ 0xEDB88320 : crc >> 1;
        }
        return ~crc;
    }
}

public static class Program
{
    public static void Main()
    {
        int a = 0b1100_1010, b = 0x0F;
        Console.WriteLine($"{a & b} {a | b} {a ^ b} {~a} {a << 3} {a >> 2} {-a >> 2} {-a >>> 28} {a >>> 2} {~0u} {~0L} {a & ~b} {(a ^ b) & 0xFF:X2} {1 << 33} {1L << 33} {1 << -1} {-1 >> 40}");
        Console.WriteLine(Bits.Binary(0xA5) + " " + Bits.Binary(0x3, 4) + " " + Bits.Reverse(1).ToString("X8") + " " + Bits.Reverse(0xF0F0F0F0).ToString("X8") + " " + Bits.PopCount(ulong.MaxValue) + Bits.PopCount(0x8000_0000_0000_0001) + " " + Bits.IsPowerOfTwo(1024) + Bits.IsPowerOfTwo(1000) + Bits.IsPowerOfTwo(0) + Bits.IsPowerOfTwo(long.MinValue));
        Console.WriteLine(Bits.RotateLeft(0x80000001, 4).ToString("X8") + " " + BitOperations.RotateRight(0x80000001, 4).ToString("X8") + " " + Bits.Sign(-9) + Bits.Sign(0) + Bits.Sign(9) + " " + Bits.Log2(1) + Bits.Log2(255) + Bits.Log2(256) + Bits.Log2(0) + " " + BitOperations.LeadingZeroCount(1u) + " " + BitOperations.Log2(1000) + " " + Bits.Interleave(0b1010, 0b0101).ToString("X"));
        uint color = Bits.Pack(0x12, 0xAB, 0xFF);
        var (r, g, blue, alpha) = Bits.Unpack(color);
        Console.WriteLine(color.ToString("X8") + " " + r + " " + g + " " + blue + " " + alpha + " " + Bits.Pack(1, 2, 3, 0) + " " + string.Join(",", new uint[] { 0, 1, 2, 3, 4, 5, 6, 7 }.AsSpan().ToArray().Length) + " " + Bits.Gray(5) + Bits.Gray(6) + Bits.Gray(7));
        Console.WriteLine(Bits.Crc32(Encoding.ASCII.GetBytes("123456789")).ToString("X8") + " " + Bits.Crc32(ReadOnlySpan<byte>.Empty) + " " + Bits.Crc32(new byte[] { 0 }).ToString("X8"));

        var set = new BitSet();
        foreach (int index in new[] { 0, 3, 5, 63, 3 }) set[index] = true;
        set.Toggle(5);
        set.Toggle(7);
        var other = new BitSet { [1] = true, [63] = true };
        Console.WriteLine(set + " " + set.Count + " " + set[3] + set[5] + " " + set.Union(other) + " " + other.Count);

        var permissions = Permissions.Read | Permissions.Execute;
        permissions |= Permissions.Admin;
        permissions &= ~Permissions.Execute;
        permissions ^= Permissions.Write;
        Console.WriteLine(permissions + " " + (int)permissions + " " + permissions.HasFlag(Permissions.ReadWrite) + " " + ((permissions & Permissions.Delete) == 0) + " " + (Permissions)3 + " " + (Permissions)16 + " " + (permissions & Permissions.ReadWrite) + " " + (ushort)~Permissions.Admin);

        byte small = 0b1111_0000;
        sbyte signed = unchecked((sbyte)small);
        short wide = (short)(small << 4);
        ulong mask = 1UL << 63 | 1;
        long shifted = long.MinValue >> 63;
        small >>= 2; small |= 1; small ^= 0xFF;
        Console.WriteLine($"{small} {signed} {signed >> 2} {(byte)signed >> 2} {wide} {mask:X} {shifted} {(uint)shifted >> 30} {~small} {(byte)~small} {(sbyte)-128 >> 7} {(char)('a' ^ ' ')} {'a' & 0x5F} {true ^ true} {true & false | true} {(5 & 3) == 1}");
        ulong hash = 14695981039346656037UL;
        foreach (char c in "bit manipulation") hash = unchecked((hash ^ c) * 1099511628211UL);
        uint state = 2463534242;
        for (int i = 0; i < 5; i++) { state ^= state << 13; state ^= state >> 17; state ^= state << 5; }
        Console.WriteLine(hash.ToString("X16") + " " + state + " " + (hash >> 60) + " " + (int)(hash & 0xFFFF) + " " + unchecked((int)hash) + " " + BigInteger.Pow(2, 100).ToString("X"));
    }
}
