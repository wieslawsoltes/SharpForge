using System;
using System.Buffers.Binary;
using System.Globalization;
using System.Linq;
using System.Numerics;

static string Hex<T>(T value) where T : IBinaryInteger<T> => value.ToString("X", CultureInfo.InvariantCulture);
static string Bits(ulong value, int width) => string.Concat(Enumerable.Range(0, width).Select(i => ((value >> (width - 1 - i)) & 1) == 1 ? '1' : '0'));
static string TypeOf<T>(T value) => typeof(T).Name;

// Pack and unpack a 32-bit frame header: version(4) | flags(6) | length(12, signed) | id(10).
static uint Pack(int version, int flags, int length, int id) =>
    ((uint)version & 0xF) << 28 | ((uint)flags & 0x3F) << 22 | ((uint)length & 0xFFF) << 10 | ((uint)id & 0x3FF);
static (int Version, int Flags, int Length, int Id) Unpack(uint header) =>
    ((int)(header >> 28), (int)(header >> 22 & 0x3F), (int)(header << 10) >> 20, (int)(header & 0x3FF));

foreach (var (version, flags, length, id) in new[] { (1, 0b101010, 100, 7), (15, 63, -1, 1023), (2, 1, -2048, 0), (17, 64, 4095, 1024) })
{
    uint header = Pack(version, flags, length, id);
    var fields = Unpack(header);
    Console.WriteLine("header " + Hex(header).PadLeft(8, '0') + " " + Bits(header, 32) + " -> v" + fields.Version + " f" + fields.Flags + " len" + fields.Length + " id" + fields.Id
        + " bigEndian=" + Hex(BinaryPrimitives.ReverseEndianness(header)).PadLeft(8, '0'));
}

// Shifts on every width: the small types are promoted to int, the count is masked by the operand width.
sbyte sb = -128; byte ub = 0x81; short ss = -2; ushort us = 0x8001; int si = -8; uint ui = 0x8000_0001; long sl = -8; ulong ul = 0x8000_0000_0000_0001;
int count33 = 33, count65 = 65, minusOne = -1;
Console.WriteLine("sar: " + (sb >> 1) + " " + (ub >> 1) + " " + (ss >> 1) + " " + (us >> 1) + " " + (si >> 1) + " " + (ui >> 1) + " " + (sl >> 1) + " " + (ul >> 1));
Console.WriteLine("shr: " + (sb >>> 1) + " " + (ub >>> 1) + " " + (ss >>> 1) + " " + (us >>> 1) + " " + (si >>> 1) + " " + (ui >>> 1) + " " + (sl >>> 1) + " " + (ul >>> 1));
Console.WriteLine("narrowed shr: " + (sbyte)(sb >>> 1) + " " + (short)(ss >>> 1) + " " + (byte)(sb >>> 4) + " " + (ushort)(ss >>> 12) + " " + (sl >>> 60) + " " + (si >>> 28) + " " + (-1 >>> 31) + " " + (-1L >>> 63));
Console.WriteLine("shl: " + (sb << 1) + " " + (ub << 24) + " " + (ub << 25) + " " + (ss << 31) + " " + (us << 16) + " " + (1 << 31) + " " + (1u << 31) + " " + (1L << 63) + " " + (1UL << 63));
Console.WriteLine("masked counts: " + (1 << count33) + " " + (1 << 32) + " " + (1L << count65) + " " + (1L << 64) + " " + (si >> count33) + " " + (1 << minusOne) + " " + (ui >> minusOne) + " " + (ul << count65)
    + " " + (0x100 >> 40) + " " + (-1 >>> count33));
Console.WriteLine("result types: " + TypeOf(sb >> 1) + " " + TypeOf(ub << 1) + " " + TypeOf(us >>> 1) + " " + TypeOf(ui >> 1) + " " + TypeOf(sl << 1) + " " + TypeOf(ul >>> 1)
    + " " + TypeOf(~ub) + " " + TypeOf(ub & us) + " " + TypeOf(ui & si) + " " + TypeOf(ui | 1) + " " + TypeOf(sb ^ ss) + " " + TypeOf(ui & ul));

// Sign extension versus zero extension when widening, and what the complement does on small types.
Console.WriteLine("extend: " + (int)sb + " " + (uint)sb + " " + (ulong)sb + " " + (ushort)sb + " " + (long)ui + " " + (long)(int)ui + " " + (ulong)si + " " + (uint)ss + " " + (int)us + " " + (short)us
    + " " + (char)(us >> 9) + (int)(char)ss + " " + (long)(ushort)ss + " " + Hex((ulong)(long)sb) + " " + Hex((uint)(sbyte)ub));
Console.WriteLine("complement: " + ~ub + " " + (byte)~ub + " " + ~sb + " " + (ushort)~us + " " + ~ui + " " + ~si + " " + ~sl + " " + ~ul + " " + Hex(~0u) + " " + (~0 == -1) + " " + (byte)(~ub & 0xF0));

// Compound assignments implicitly narrow back to the declared type.
byte reg8 = 0xF0; reg8 >>= 2; reg8 |= 1; reg8 ^= 0xFF; byte afterXor = reg8; reg8 <<= 4; reg8 += 250; reg8++;
sbyte sreg8 = 0x40; sreg8 <<= 1; sbyte afterShift = sreg8; sreg8 >>= 3; sreg8 >>>= 1; sreg8 -= 100;
short reg16 = 0x4000; reg16 <<= 1; short wrapped = reg16; reg16 >>>= 4; reg16 |= 0x0F; reg16 *= 3;
ushort ureg16 = 0xFFFF; ureg16 += 2; ureg16 <<= 15; ureg16 >>= 15; ureg16--; ureg16--;
char letter = 'a'; letter += (char)2; letter++; letter -= ' ';
Console.WriteLine("compound: " + afterXor + " " + reg8 + " " + afterShift + " " + sreg8 + " " + wrapped + " " + reg16 + " " + ureg16 + " " + letter);

// System.Numerics.BitOperations and the generic-math bit helpers on every width.
uint sample = 0x00F0_1234;
ulong board = 0x0000_0010_0800_0000;
Console.WriteLine("bitops: pop=" + BitOperations.PopCount(sample) + "/" + BitOperations.PopCount(ul) + " lzc=" + BitOperations.LeadingZeroCount(sample) + "/" + BitOperations.LeadingZeroCount(board)
    + "/" + BitOperations.LeadingZeroCount(0u) + " tzc=" + BitOperations.TrailingZeroCount(sample) + "/" + BitOperations.TrailingZeroCount(board) + "/" + BitOperations.TrailingZeroCount(0)
    + " log2=" + BitOperations.Log2(sample) + " rol=" + Hex(BitOperations.RotateLeft(sample, 12)) + " ror=" + Hex(BitOperations.RotateRight(sample, 4)) + " rol64=" + Hex(BitOperations.RotateLeft(ul, 1))
    + " pow2=" + BitOperations.RoundUpToPowerOf2(1000u) + "/" + BitOperations.IsPow2(4096) + "/" + BitOperations.IsPow2(sample));
Console.WriteLine("per width: " + byte.PopCount(ub) + " " + sbyte.LeadingZeroCount(1) + " " + byte.TrailingZeroCount(0) + " " + Hex(byte.RotateLeft(ub, 1)) + " " + Hex(ushort.RotateRight(us, 1))
    + " " + short.PopCount(ss) + " " + sbyte.RotateLeft(sb, 1) + " " + long.LeadingZeroCount(sl) + " " + ulong.TrailingZeroCount(ul << 4) + " " + int.Log2(1 << 20) + " " + uint.IsPow2(ui - 1)
    + " " + Hex(UInt128.RotateLeft(UInt128.One, 127)) + " " + Int128.LeadingZeroCount(Int128.One) + " " + Hex((Int128.MinValue >> 126) >>> 120) + " " + char.IsAsciiHexDigit((char)(ub >> 1 | 1)));

// Classic bit tricks: lowest set bit, bit reversal, Gray code, Morton interleave, parity and a CRC-8.
static uint Reverse(uint value, int width)
{
    uint result = 0;
    for (int i = 0; i < width; i++, value >>= 1) result = (result << 1) | (value & 1);
    return result;
}
static uint Morton(ushort x, ushort y)
{
    static uint Spread(uint v)
    {
        v = (v | (v << 8)) & 0x00FF00FF; v = (v | (v << 4)) & 0x0F0F0F0F; v = (v | (v << 2)) & 0x33333333; v = (v | (v << 1)) & 0x55555555;
        return v;
    }
    return Spread(x) | Spread(y) << 1;
}
static byte Crc8(ReadOnlySpan<byte> data)
{
    byte crc = 0;
    foreach (byte item in data)
    {
        crc ^= item;
        for (int bit = 0; bit < 8; bit++) crc = (crc & 0x80) != 0 ? (byte)((crc << 1) ^ 0x07) : (byte)(crc << 1);
    }
    return crc;
}
Console.WriteLine("tricks: lowest=" + Hex(sample & (~sample + 1)) + " cleared=" + Hex(sample & (sample - 1)) + " isolate signed=" + (si & -si) + " reverse8=" + Bits(Reverse(0b1101_0010, 8), 8)
    + " reverse16=" + Hex(Reverse(0x1234, 16)) + " gray=" + string.Join(",", Enumerable.Range(0, 8).Select(i => Bits((ulong)(i ^ (i >> 1)), 3))) + " morton=" + Hex(Morton(0xFFFF, 0)) + "/" + Hex(Morton(5, 3))
    + " parity=" + (BitOperations.PopCount(sample) & 1) + " crc8=" + Hex(Crc8(new byte[] { 0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39 })));
int swapA = 0x1234, swapB = -0x5678;
swapA ^= swapB; swapB ^= swapA; swapA ^= swapB;
ulong knights = 0;
foreach (int shift in new[] { 17, 15, 10, 6 }) knights |= board << shift | board >> shift;
Console.WriteLine("swap=" + swapA + "/" + swapB + " knightMoves=" + BitOperations.PopCount(knights) + " abs=" + ((si ^ (si >> 31)) - (si >> 31)) + " avg=" + ((si & 6) + ((si ^ 6) >> 1))
    + " sameSign=" + ((si ^ sl) >= 0) + " bytes=" + string.Join("-", BitConverter.GetBytes(BinaryPrimitives.ReverseEndianness((ushort)0xBEEF)).Select(x => Hex(x))));

// Raw IEEE bit patterns of Half, float and double.
Half half = (Half)1.5f;
Console.WriteLine("ieee: half=" + Hex(BitConverter.HalfToUInt16Bits(half)) + " " + ((float)(Half)65504f).ToString(CultureInfo.InvariantCulture) + " " + Half.IsInfinity((Half)70000f) + " " + ((double)(Half)0.1f).ToString("R", CultureInfo.InvariantCulture)
    + " single=" + Hex(BitConverter.SingleToUInt32Bits(-0f)) + "/" + Hex(BitConverter.SingleToInt32Bits(1f)) + " double=" + Hex(BitConverter.DoubleToInt64Bits(-2.0)) + " exp=" + ((BitConverter.DoubleToInt64Bits(1024.0) >> 52 & 0x7FF) - 1023)
    + " fromBits=" + BitConverter.Int64BitsToDouble(0x4009_21FB_5444_2D18).ToString("R", CultureInfo.InvariantCulture) + " nan=" + float.IsNaN(BitConverter.UInt32BitsToSingle(0x7FC0_0000)));
