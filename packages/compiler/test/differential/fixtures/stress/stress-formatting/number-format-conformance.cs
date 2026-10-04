using System;
using System.Globalization;
using System.Linq;
using System.Numerics;
using System.Text;

namespace Conformance
{
    public static class Program
    {
        private static readonly CultureInfo Inv = CultureInfo.InvariantCulture;

        private static string Format<T>(T value, string format) where T : IFormattable
        {
            try { return value.ToString(format, Inv); }
            catch (FormatException) { return "(invalid)"; }
        }

        private static void Row<T>(string type, T value, params string[] formats) where T : IFormattable =>
            Console.WriteLine($"{type,-8}" + string.Join(" | ", formats.Select(f => f + "=" + Format(value, f))));

        private static string Limits<T>() where T : IMinMaxValue<T>, IFormattable => T.MinValue.ToString(null, Inv) + ".." + T.MaxValue.ToString(null, Inv);

        private static string RoundTrip<T>(T value) where T : INumber<T>
        {
            string text = value.ToString(null, Inv);
            return text + (T.Parse(text, NumberStyles.Float, Inv) == value ? "" : " (lossy)");
        }

        private static string ViaSpan<T>(T value, string format, int size) where T : ISpanFormattable
        {
            Span<char> buffer = stackalloc char[size];
            return value.TryFormat(buffer, out int written, format, Inv) ? new string(buffer[..written]) + "/" + written.ToString(Inv) : "too small";
        }

        private static string ViaUtf8<T>(T value, string format) where T : IUtf8SpanFormattable
        {
            Span<byte> buffer = stackalloc byte[24];
            return value.TryFormat(buffer, out int written, format, Inv) ? Encoding.ASCII.GetString(buffer[..written]) : "too small";
        }

        public static void Main()
        {
            sbyte small = -100; byte tiny = 200; short narrow = -12345; ushort wide = 54321; int whole = 1234567; uint unsigned = 4000000000;
            long big = -9007199254740993; ulong huge = ulong.MaxValue; float single = 3.14159274f; double real = 12345.6789; decimal money = 1234567.891m; nint native = 123456; char letter = 'A';

            Console.WriteLine("-- standard formats per type");
            Row("sbyte", small, "G", "D5", "X", "B", "N0", "F1");
            Row("byte", tiny, "G", "D5", "X4", "x", "B", "N2", "P0");
            Row("short", narrow, "G", "N0", "X", "B", "D8", "E2");
            Row("ushort", wide, "G", "X8", "x", "N0", "F", "R");
            Row("int", whole, "N2", "X8", "E3", "P1", "D5", "F", "G", "G3", "B");
            Row("int", -42, "N2", "X8", "E3", "D5", "F", "G", "B");
            Row("uint", unsigned, "G", "N0", "X", "E3", "D12");
            Row("long", big, "G", "N0", "X", "E3", "D20");
            Row("ulong", huge, "G", "N0", "X", "E", "F0");
            Row("float", single, "G", "R", "F", "F3", "E3", "N2", "P1", "G3", "B");
            Row("double", real, "G", "R", "F", "F1", "E3", "N2", "P1", "G4", "X");
            Row("decimal", money, "G", "F", "N2", "E3", "P1", "F0", "D");
            Row("nint", native, "G", "N0", "X", "D8", "E1");
            Row("int128", Int128.MaxValue, "G", "E4", "X");
            Row("half", (Half)1.5, "G", "F2", "E2");
            Console.WriteLine("char    " + letter.ToString(Inv) + " " + ((int)letter).ToString("X4", Inv) + " " + ((int)letter).ToString("B8", Inv) + " " + char.GetNumericValue('7').ToString("F1", Inv) + " " + ((char)(letter + 2)).ToString() + " " + (letter + 2).ToString(Inv));

            Console.WriteLine("-- custom picture formats");
            Row("int", whole, "0.00", "#,##0", "000000000", "#", "0,0.0", "#,##0,", "0.0,,M", "(#)", "'#'0", "0 units");
            Row("double", real, "0.00", "#,##0", "#.#", "0.000000", "00000", "0.##E+00", "0.0e-0", "#,#.00", "0%", "0.0\\%");
            Row("decimal", money, "0.00", "#,##0", "#,##0.0000", "0,,.00M", "#.##########");
            foreach (double value in new[] { 1234.5, -1234.5, 0.0 }) Row("sections", value, "#,##0.00;(#,##0.00);zero", "+0.0;-0.0", "0;minus 0", "up;down;flat");
            Row("small", 0.000123, "G", "E2", "F6", "0.0000", "#.#", "P2", "0.##E+0");
            Row("zero", 0, "#", "0", "#.#", "D3", "N1", "P0", "X2");

            Console.WriteLine("-- special values and rounding");
            Console.WriteLine(string.Join(" ", new[] { double.NaN, double.PositiveInfinity, double.NegativeInfinity, -0.0, double.Epsilon, double.MaxValue, 1e21, 1e-7, 123456789012345678.0, 0.1 + 0.2 }.Select(d => d.ToString(Inv))));
            Console.WriteLine(string.Join(" ", new[] { 0.5, 1.5, 2.5, 3.5, -2.5, 0.125, 0.375, 1.005, 2.675, 9.995 }.Select(d => d.ToString("F0", Inv) + "/" + d.ToString("F2", Inv) + "/" + Math.Round(d).ToString(Inv))));
            Console.WriteLine(string.Join(" ", new[] { 0.5m, 1.5m, 2.5m, -2.5m, 1.005m, 2.675m, 1.10m, 100m, 0.000m }.Select(d => d.ToString("F0", Inv) + "/" + d.ToString("F2", Inv) + "/" + d.ToString(Inv) + "/" + Math.Round(d, MidpointRounding.ToEven).ToString(Inv))));
            Console.WriteLine(string.Join(" ", float.MaxValue.ToString(Inv), (1f / 3).ToString(Inv), ((double)(1f / 3)).ToString(Inv), 16777217f.ToString(Inv), 0.1f.ToString("G9", Inv), 0.1.ToString("G17", Inv), (1.0 / 3).ToString("R", Inv), 100000000000000000000m.ToString(Inv), (1m / 3).ToString(Inv)));

            Console.WriteLine("-- limits through generic math");
            Console.WriteLine("sbyte " + Limits<sbyte>() + " byte " + Limits<byte>() + " short " + Limits<short>() + " ushort " + Limits<ushort>() + " char " + (int)char.MinValue + ".." + (int)char.MaxValue);
            Console.WriteLine("int " + Limits<int>() + " uint " + Limits<uint>() + " long " + Limits<long>());
            Console.WriteLine("ulong " + Limits<ulong>() + " float " + Limits<float>() + " double " + Limits<double>());
            Console.WriteLine("decimal " + Limits<decimal>());
            Console.WriteLine(string.Join(" ", RoundTrip(float.MaxValue), RoundTrip(0.1f), RoundTrip(double.Epsilon), RoundTrip(1.0 / 3), RoundTrip(decimal.MaxValue), RoundTrip(long.MinValue), RoundTrip(ulong.MaxValue), RoundTrip((short)-1), RoundTrip((byte)255), RoundTrip((nint)(-7))));

            Console.WriteLine("-- TryFormat into spans");
            Console.WriteLine(string.Join(" ", ViaSpan(whole, "N0", 16), ViaSpan(whole, "N0", 8), ViaSpan(tiny, "X2", 2), ViaSpan(real, "E2", 12), ViaSpan(money, "#,##0.0", 16), ViaSpan(big, "D", 17), ViaSpan(single, "F4", 6), ViaSpan(huge, "x", 16), ViaSpan(letter, null, 1), ViaSpan(native, "D7", 7)));
            Console.WriteLine(string.Join(" ", ViaUtf8(whole, "X"), ViaUtf8(real, "F2"), ViaUtf8(money, "N1"), ViaUtf8(narrow, "D6"), ViaUtf8(huge, "E3"), ViaUtf8(small, "B")));
            Span<char> line = stackalloc char[40];
            int used = 0;
            foreach (int part in new[] { 192, 168, 0, 17 })
            {
                if (used > 0) line[used++] = '.';
                part.TryFormat(line[used..], out int digits, "D3", Inv);
                used += digits;
            }
            line[used++] = ':';
            ((ushort)8080).TryFormat(line[used..], out int port, default, Inv);
            Console.WriteLine(line[..(used + port)].ToString() + " length " + (used + port).ToString(Inv));
        }
    }
}
