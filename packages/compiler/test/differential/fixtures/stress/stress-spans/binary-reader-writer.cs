using System;
using System.Buffers.Binary;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

Span<byte> buffer = stackalloc byte[128];
var writer = new SpanWriter(buffer);
var header = new Header(0xCAFE, 2, 3, 1234567890123L, 0.5);
Codec.WriteHeader(ref writer, in header);
int headerEnd = writer.Position;
var samples = new (string Name, int Level, uint Score)[] { ("ada", -3, 300), ("grace hopper", 12, 5), ("zo\u00EB", 0, 70000) };
foreach (var (name, level, score) in samples)
{
    Span<byte> lengthSlot = writer.Reserve(2);
    int start = writer.Position;
    writer.WriteString(name);
    writer.WriteInt32LittleEndian(level);
    writer.WriteVarUInt(score);
    BinaryPrimitives.WriteUInt16BigEndian(lengthSlot, (ushort)(writer.Position - start));
}
writer.WriteUInt32BigEndian(Codec.Checksum(writer.Written));
ReadOnlySpan<byte> message = writer.Written;
Console.WriteLine($"{message.Length} bytes, header {headerEnd}, free {writer.Free}");
for (int offset = 0; offset < message.Length; offset += 16)
    Console.WriteLine($"{offset:X2}: {Convert.ToHexString(message.Slice(offset, Math.Min(16, message.Length - offset)))}");

Console.WriteLine(Codec.Describe(message));
Span<byte> corrupted = stackalloc byte[message.Length];
message.CopyTo(corrupted);
corrupted[headerEnd + 3] ^= 0x20;
Console.WriteLine(Codec.Describe(corrupted));
corrupted[headerEnd + 3] ^= 0x20;
Console.WriteLine(corrupted.SequenceEqual(message) + " " + Codec.Describe(corrupted[..^5]));
corrupted[0] = 0;
Console.WriteLine(Codec.Describe(corrupted) + " | " + Codec.Describe(default) + " | " + Codec.Describe(message[..10]));

var reader = new SpanReader(message);
bool ok = Codec.TryReadHeader(ref reader, out var decoded);
Console.WriteLine($"{ok} {decoded.Magic:X} v{decoded.Major}.{decoded.Minor} {decoded.Timestamp} {decoded.Scale.ToString(CultureInfo.InvariantCulture)} at {reader.Position} left {reader.Remaining}");
var names = new List<string>();
while (reader.Remaining > 4 && reader.TryReadUInt16BigEndian(out ushort size))
{
    var record = new SpanReader(reader.ReadBytes(size));
    record.TryReadString(out string who);
    record.TryReadInt32LittleEndian(out int level);
    record.TryReadVarUInt(out uint score);
    names.Add($"{who.Replace('\u00EB', 'e')}/{who.Length}:{level}:{score}:{size}:{record.Remaining}");
}
Console.WriteLine(string.Join(" ", names) + " tail " + reader.Remaining);

Span<byte> small = stackalloc byte[6];
var tight = new SpanWriter(small);
Console.WriteLine($"{tight.TryWriteVarUInt(127)} {tight.TryWriteVarUInt(128)} {tight.TryWriteVarUInt(uint.MaxValue)} {tight.Position} {tight.TryWriteVarUInt(2097151)} {tight.Position} {Convert.ToHexString(small)}");
var back = new SpanReader(small);
back.TryReadVarUInt(out uint a);
back.TryReadVarUInt(out uint b);
bool third = back.TryReadVarUInt(out uint c);
Console.WriteLine($"{a} {b} {third} {c} {back.TryReadVarUInt(out uint d)} {d} {back.TryReadInt32LittleEndian(out int e)} {e}");

Span<byte> scratch = stackalloc byte[8];
BinaryPrimitives.WriteInt32LittleEndian(scratch, 0x11223344);
BinaryPrimitives.WriteInt32BigEndian(scratch[4..], 0x11223344);
Console.WriteLine(Convert.ToHexString(scratch) + " " + BinaryPrimitives.ReadInt64BigEndian(scratch).ToString("X16") + " " + BinaryPrimitives.ReverseEndianness((ushort)0x1234).ToString("X4")
    + " " + BinaryPrimitives.ReadUInt16LittleEndian(scratch[1..]) + " " + BinaryPrimitives.TryReadInt64LittleEndian(scratch[1..], out _) + " " + Codec.Checksum(scratch) + " " + Codec.Checksum("abc"u8));

public readonly struct Header
{
    public Header(ushort magic, byte major, byte minor, long timestamp, double scale) { Magic = magic; Major = major; Minor = minor; Timestamp = timestamp; Scale = scale; }
    public ushort Magic { get; }
    public byte Major { get; }
    public byte Minor { get; }
    public long Timestamp { get; }
    public double Scale { get; }
}

public ref struct SpanWriter
{
    private readonly Span<byte> _buffer;
    private int _position;
    public SpanWriter(Span<byte> buffer) { _buffer = buffer; _position = 0; }
    public readonly int Position => _position;
    public readonly int Free => _buffer.Length - _position;
    public readonly ReadOnlySpan<byte> Written => _buffer[.._position];

    public Span<byte> Reserve(int count)
    {
        var slot = _buffer.Slice(_position, count);
        _position += count;
        return slot;
    }

    public void WriteByte(byte value) => _buffer[_position++] = value;
    public void WriteUInt16BigEndian(ushort value) => BinaryPrimitives.WriteUInt16BigEndian(Reserve(2), value);
    public void WriteUInt32BigEndian(uint value) => BinaryPrimitives.WriteUInt32BigEndian(Reserve(4), value);
    public void WriteInt32LittleEndian(int value) => BinaryPrimitives.WriteInt32LittleEndian(Reserve(sizeof(int)), value);
    public void WriteInt64BigEndian(long value) => BinaryPrimitives.WriteInt64BigEndian(Reserve(sizeof(long)), value);
    public void WriteDouble(double value) => BinaryPrimitives.WriteDoubleLittleEndian(Reserve(sizeof(double)), value);
    public void WriteVarUInt(uint value) { if (!TryWriteVarUInt(value)) throw new InvalidOperationException("buffer full"); }

    public bool TryWriteVarUInt(uint value)
    {
        Span<byte> encoded = stackalloc byte[5];
        int count = 0;
        do
        {
            byte low = (byte)(value & 0x7F);
            value >>= 7;
            encoded[count++] = value != 0 ? (byte)(low | 0x80) : low;
        } while (value != 0);
        if (count > Free) return false;
        encoded[..count].CopyTo(_buffer[_position..]);
        _position += count;
        return true;
    }

    public void WriteString(string text)
    {
        int length = Encoding.UTF8.GetByteCount(text);
        WriteVarUInt((uint)length);
        _position += Encoding.UTF8.GetBytes(text, _buffer.Slice(_position, length));
    }
}

public ref struct SpanReader
{
    private readonly ReadOnlySpan<byte> _data;
    private int _position;
    public SpanReader(ReadOnlySpan<byte> data) { _data = data; _position = 0; }
    public readonly int Position => _position;
    public readonly int Remaining => _data.Length - _position;

    public ReadOnlySpan<byte> ReadBytes(int count)
    {
        var slice = _data.Slice(_position, count);
        _position += count;
        return slice;
    }

    public bool TryReadUInt16BigEndian(out ushort value) => BinaryPrimitives.TryReadUInt16BigEndian(Take(2), out value);
    public bool TryReadInt32LittleEndian(out int value) => BinaryPrimitives.TryReadInt32LittleEndian(Take(4), out value);
    public bool TryReadInt64BigEndian(out long value) => BinaryPrimitives.TryReadInt64BigEndian(Take(8), out value);
    public bool TryReadDouble(out double value) => BinaryPrimitives.TryReadDoubleLittleEndian(Take(8), out value);
    private ReadOnlySpan<byte> Take(int count) => Remaining >= count ? ReadBytes(count) : default;

    public bool TryReadVarUInt(out uint value)
    {
        value = 0;
        int start = _position;
        for (int shift = 0; shift < 35 && _position < _data.Length; shift += 7)
        {
            byte next = _data[_position++];
            value |= (uint)(next & 0x7F) << shift;
            if ((next & 0x80) == 0) return true;
        }
        _position = start;
        value = 0;
        return false;
    }

    public bool TryReadString(out string text)
    {
        text = null;
        if (!TryReadVarUInt(out uint length) || length > Remaining) return false;
        text = Encoding.UTF8.GetString(ReadBytes((int)length));
        return true;
    }
}

public static class Codec
{
    public static void WriteHeader(ref SpanWriter writer, in Header header)
    {
        writer.WriteUInt16BigEndian(header.Magic);
        writer.WriteByte(header.Major);
        writer.WriteByte(header.Minor);
        writer.WriteInt64BigEndian(header.Timestamp);
        writer.WriteDouble(header.Scale);
    }

    public static bool TryReadHeader(ref SpanReader reader, out Header header)
    {
        header = default;
        if (!reader.TryReadUInt16BigEndian(out ushort magic) || magic != 0xCAFE || reader.Remaining < 18) return false;
        ReadOnlySpan<byte> version = reader.ReadBytes(2);
        reader.TryReadInt64BigEndian(out long timestamp);
        reader.TryReadDouble(out double scale);
        header = new Header(magic, version[0], version[1], timestamp, scale);
        return true;
    }

    public static uint Checksum(ReadOnlySpan<byte> data)
    {
        uint a = 1, b = 0;
        foreach (byte value in data)
        {
            a = (a + value) % 65521;
            b = (b + a) % 65521;
        }
        return b << 16 | a;
    }

    public static string Describe(ReadOnlySpan<byte> message)
    {
        if (message.Length < 24) return "too short (" + message.Length + ")";
        uint stored = BinaryPrimitives.ReadUInt32BigEndian(message[^4..]), actual = Checksum(message[..^4]);
        var reader = new SpanReader(message);
        if (!TryReadHeader(ref reader, out _)) return "bad header";
        return stored == actual ? "valid, checksum " + actual.ToString("X8") : $"checksum mismatch {stored:X8} != {actual:X8}";
    }
}
