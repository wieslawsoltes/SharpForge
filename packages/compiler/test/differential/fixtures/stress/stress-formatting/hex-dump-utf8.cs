using System;
using System.Buffers.Binary;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text;

ReadOnlySpan<byte> payload = "Héllo, wörld! €5 → 𝄞 ok\r\n\tend\0"u8;
Console.WriteLine("-- hex dump of a UTF-8 literal (" + payload.Length + " bytes)");
foreach (string row in HexDump.Rows(payload.ToArray(), 12)) Console.WriteLine(row);

Console.WriteLine("-- decoding by hand");
int ascii = 0, continuation = 0;
var lengths = new int[5];
var codePoints = new List<string>();
for (int i = 0; i < payload.Length;)
{
    byte lead = payload[i];
    int size = lead < 0x80 ? 1 : (lead & 0xE0) == 0xC0 ? 2 : (lead & 0xF0) == 0xE0 ? 3 : 4;
    int codePoint = size == 1 ? lead : lead & (0xFF >> (size + 1));
    for (int k = 1; k < size; k++) { codePoint = (codePoint << 6) | (payload[i + k] & 0x3F); continuation++; }
    if (size == 1) ascii++; else codePoints.Add($"U+{codePoint:X4}/{size}");
    lengths[size]++;
    i += size;
}
string decoded = Encoding.UTF8.GetString(payload);
Console.WriteLine($"ascii={ascii} continuation={continuation} sizes={string.Join(",", lengths.Skip(1))} non-ascii: {string.Join(" ", codePoints)}");
Console.WriteLine($"chars={decoded.Length} runes={decoded.EnumerateRunes().Count()} bytes={Encoding.UTF8.GetByteCount(decoded)} utf16={Encoding.Unicode.GetByteCount(decoded)} charCount={Encoding.UTF8.GetCharCount(payload)} roundtrip={Encoding.UTF8.GetBytes(decoded).AsSpan().SequenceEqual(payload)}");
Console.WriteLine(string.Join(" ", decoded.EnumerateRunes().Where(r => !r.IsAscii).Select(r => $"{r.Value:X}:{r.Utf8SequenceLength}:{r.Utf16SequenceLength}:{(r.IsBmp ? "bmp" : "astral")}:{Rune.GetUnicodeCategory(r)}")));

Console.WriteLine("-- u8 literals as spans");
ReadOnlySpan<byte> header = "GET /index.html HTTP/1.1"u8;
int firstSpace = header.IndexOf((byte)' '), lastSpace = header.LastIndexOf((byte)' ');
ReadOnlySpan<byte> method = header[..firstSpace], path = header[(firstSpace + 1)..lastSpace], version = header[(lastSpace + 1)..];
Console.WriteLine($"{Encoding.ASCII.GetString(method)}|{Encoding.ASCII.GetString(path)}|{Encoding.ASCII.GetString(version)}| {method.SequenceEqual("GET"u8)} {path.StartsWith("/index"u8)} {version.EndsWith("1.0"u8)} {header.IndexOf("HTTP"u8)} {path.Contains((byte)'.')} {header.Count((byte)' ')} {""u8.Length} {"é"u8.Length} {"\\n"u8.Length}");
byte[] owned = "abc"u8.ToArray();
owned[0] ^= 0x20;
Span<byte> upper = stackalloc byte[header.Length];
for (int i = 0; i < header.Length; i++) upper[i] = header[i] is >= (byte)'a' and <= (byte)'z' ? (byte)(header[i] - 32) : header[i];
Console.WriteLine(Encoding.UTF8.GetString(owned) + " " + Encoding.UTF8.GetString(upper) + " " + HexDump.Magic.Length + " " + Convert.ToHexString(HexDump.Magic) + " " + (HexDump.Magic[0] == 0x89) + " " + HexDump.Checksum("123456789"u8).ToString("X8", CultureInfo.InvariantCulture));

Console.WriteLine("-- encodings, hex and base64");
string sample = "naïve café ☕";
byte[] utf8 = Encoding.UTF8.GetBytes(sample), utf16 = Encoding.Unicode.GetBytes(sample), latin = Encoding.Latin1.GetBytes(sample), asciiBytes = Encoding.ASCII.GetBytes(sample);
Console.WriteLine($"{sample.Length} chars -> utf8 {utf8.Length}, utf16 {utf16.Length}, latin1 {latin.Length}, ascii {asciiBytes.Length} | {Encoding.ASCII.GetString(asciiBytes)} | {Encoding.Latin1.GetString(latin).Replace('?', '_').Length} | {Encoding.UTF8.GetString(utf8, 0, 6) == sample[..5]}");
string hex = Convert.ToHexString(utf8), base64 = Convert.ToBase64String(utf8);
Console.WriteLine(hex + " " + Convert.ToHexStringLower(utf8.AsSpan(0, 4)) + " " + base64 + " " + (Encoding.UTF8.GetString(Convert.FromHexString(hex)) == sample) + " " + (Encoding.UTF8.GetString(Convert.FromBase64String(base64)) == sample) + " " + BitConverter.ToString(utf8, 2, 3) + " " + Convert.FromHexString("00ff7F").Sum(b => b));
Span<byte> number = stackalloc byte[8];
BinaryPrimitives.WriteInt32BigEndian(number, 0x12345678);
BinaryPrimitives.WriteUInt16LittleEndian(number[4..], 0xBEEF);
Console.WriteLine(Convert.ToHexString(number) + " " + BinaryPrimitives.ReadInt32LittleEndian(number).ToString("X8", CultureInfo.InvariantCulture) + " " + BinaryPrimitives.ReadUInt16BigEndian(number[4..]).ToString("X4", CultureInfo.InvariantCulture) + " " + BinaryPrimitives.ReverseEndianness(0x11223344).ToString("X", CultureInfo.InvariantCulture));
Span<byte> encoded = stackalloc byte[16];
Console.WriteLine(Encoding.UTF8.TryGetBytes("añb", encoded, out int bytesWritten) + " " + bytesWritten + " " + Convert.ToHexString(encoded[..bytesWritten]) + " " + Encoding.UTF8.TryGetBytes(sample, encoded[..4], out _) + " " + Encoding.UTF8.GetString(new byte[] { 0x41, 0xFF, 0x42 }).Select(c => ((int)c).ToString("X", CultureInfo.InvariantCulture)).Aggregate((a, b) => a + "," + b));

Console.WriteLine("-- string.Create with state and char classification");
string masked = string.Create(sample.Length, sample, (span, state) => { for (int i = 0; i < span.Length; i++) span[i] = char.IsAscii(state[i]) ? (char.IsLetter(state[i]) ? char.ToUpperInvariant(state[i]) : '_') : '?'; });
string hexLine = string.Create(utf8.Length * 3 - 1, utf8, static (span, bytes) =>
{
    for (int i = 0; i < bytes.Length; i++)
    {
        if (i > 0) span[i * 3 - 1] = i % 4 == 0 ? '|' : ' ';
        bytes[i].TryFormat(span.Slice(i * 3, 2), out _, "x2", CultureInfo.InvariantCulture);
    }
});
Console.WriteLine(masked + " " + hexLine + " " + string.Create(5, 'z', (span, c) => span.Fill(c)) + string.Create(0, 0, (span, _) => { }).Length);
foreach (char c in "aZ5 _\t€é١Ⅷ")
    Console.WriteLine($"  U+{(int)c:X4} {char.GetUnicodeCategory(c),-22} letter={char.IsLetter(c),-5} digit={char.IsDigit(c),-5} asciiDigit={char.IsAsciiDigit(c),-5} number={char.IsNumber(c),-5} white={char.IsWhiteSpace(c),-5} upper={char.IsUpper(c),-5} punct={char.IsPunctuation(c),-5} value={char.GetNumericValue(c).ToString(CultureInfo.InvariantCulture)}");
string clef = char.ConvertFromUtf32(0x1D11E);
Console.WriteLine(clef.Length + " " + char.IsSurrogatePair(clef, 0) + " " + char.IsHighSurrogate(clef[0]) + char.IsLowSurrogate(clef[1]) + " " + char.ConvertToUtf32(clef, 0).ToString("X", CultureInfo.InvariantCulture) + " " + ((int)clef[0]).ToString("X", CultureInfo.InvariantCulture) + " " + new Rune(0x20AC).ToString().Length
    + " " + char.IsAsciiHexDigit('f') + char.IsAsciiHexDigit('g') + " " + char.IsBetween('m', 'a', 'z') + " " + char.IsControl('\0') + char.IsSeparator(' ') + char.IsSymbol('+') + " " + (char)('a' + 25) + (char)('A' ^ ' ') + " " + char.ToUpperInvariant('q') + char.ToLowerInvariant('Q') + char.IsAsciiLetterUpper('Q'));

public static class HexDump
{
    public static ReadOnlySpan<byte> Magic => "\u0089PNG\r\n"u8[1..];

    public static IEnumerable<string> Rows(byte[] data, int width)
    {
        var line = new StringBuilder();
        for (int offset = 0; offset < data.Length; offset += width)
        {
            line.Clear().Append(offset.ToString("X4", CultureInfo.InvariantCulture)).Append("  ");
            for (int i = 0; i < width; i++)
            {
                if (offset + i < data.Length) line.Append(data[offset + i].ToString("X2", CultureInfo.InvariantCulture)); else line.Append("  ");
                line.Append(i == width / 2 - 1 ? "  " : " ");
            }
            line.Append('|');
            for (int i = 0; i < width && offset + i < data.Length; i++) line.Append(data[offset + i] is >= 0x20 and < 0x7F ? (char)data[offset + i] : '.');
            yield return line.Append('|').ToString();
        }
    }

    // CRC-32 (IEEE), bit by bit.
    public static uint Checksum(ReadOnlySpan<byte> data)
    {
        uint crc = 0xFFFFFFFF;
        foreach (byte b in data)
        {
            crc ^= b;
            for (int bit = 0; bit < 8; bit++) crc = (crc & 1) != 0 ? (crc >> 1) ^ 0xEDB88320 : crc >> 1;
        }
        return ~crc;
    }
}
