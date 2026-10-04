using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text;

namespace Tables
{
    public enum Align { Left, Right, Center }

    public sealed class Column
    {
        public Column(string title, Align align = Align.Left, string format = null) { Title = title; Align = align; Format = format; }
        public string Title { get; }
        public Align Align { get; }
        public string Format { get; }
    }

    // Renders rows of arbitrary objects as an aligned text table, entirely through one StringBuilder.
    public sealed class TableFormatter
    {
        private readonly List<Column> columns = new List<Column>();
        private readonly List<string[]> rows = new List<string[]>();
        public TableFormatter Add(Column column) { columns.Add(column); return this; }

        public TableFormatter Row(params object[] cells)
        {
            rows.Add(cells.Select((cell, i) => cell switch
            {
                null => "",
                IFormattable formattable => formattable.ToString(columns[i].Format, CultureInfo.InvariantCulture),
                _ => cell.ToString(),
            }).ToArray());
            return this;
        }

        private static void Pad(StringBuilder sb, string text, int width, Align align)
        {
            int space = width - text.Length, left = align == Align.Right ? space : align == Align.Center ? space / 2 : 0;
            sb.Append(' ', left).Append(text).Append(' ', space - left);
        }

        public string Render()
        {
            int[] widths = columns.Select((c, i) => Math.Max(c.Title.Length, rows.Count == 0 ? 0 : rows.Max(r => r[i].Length))).ToArray();
            var sb = new StringBuilder();
            string rule = new StringBuilder().Append('+').AppendJoin('+', widths.Select(w => new string('-', w + 2))).Append('+').ToString();
            sb.AppendLine(rule).Append('|');
            for (int i = 0; i < columns.Count; i++) { sb.Append(' '); Pad(sb, columns[i].Title, widths[i], Align.Center); sb.Append(" |"); }
            sb.AppendLine().AppendLine(rule);
            foreach (string[] row in rows)
            {
                sb.Append('|');
                for (int i = 0; i < row.Length; i++) { sb.Append(' '); Pad(sb, row[i], widths[i], columns[i].Align); sb.Append(" |"); }
                sb.AppendLine();
            }
            return sb.Append(rule).ToString();
        }
    }

    public static class Program
    {
        private static readonly CultureInfo Inv = CultureInfo.InvariantCulture;
        private static string Visible(StringBuilder sb) => sb.ToString().Replace("\r\n", "\n").Replace("\n", "\\n").Replace("\t", "\\t");

        public static void Main()
        {
            var table = new TableFormatter().Add(new Column("planet")).Add(new Column("moons", Align.Right, "D")).Add(new Column("mass (10^24 kg)", Align.Right, "#,##0.000")).Add(new Column("day", Align.Center, "0.0h")).Add(new Column("rings", Align.Center));
            table.Row("Mercury", 0, 0.330, 4222.6, false).Row("Earth", 1, 5.972, 24.0, false).Row("Jupiter", 95, 1898.13, 9.9m, true).Row("Pluto?", 5, 0.0130, null, null);
            foreach (string line in table.Render().Replace("\r\n", "\n").Split('\n')) Console.WriteLine(line);

            Console.WriteLine("-- Append overloads");
            var sb = new StringBuilder();
            sb.Append(true).Append('c').Append('-', 3).Append("str").Append("substring", 3, 6).Append(new[] { 'a', 'b' }).Append(new[] { 'x', 'y', 'z' }, 1, 2).Append((string)null).Append((object)null);
            sb.Append((sbyte)1).Append((byte)2).Append((short)3).Append((ushort)4).Append(5).Append(6u).Append(7L).Append(8ul).Append(9f).Append(10d).Append(11m).Append((object)'o').Append("span".AsSpan(1, 2)).Append(new StringBuilder("sb")).Append(new StringBuilder("range"), 1, 3);
            Console.WriteLine(sb + " length=" + sb.Length);
            sb.Clear().Append(Inv, $"{1.5:F2}|{-2,4}|{"x",-3}|{255:X}|{0.5:P0}").Append(' ').AppendFormat(Inv, "{0:N1} {1,5:F1} {2}", 1234.56, 2.25m, 'q').Append(' ').AppendFormat(Inv, "{0}-{1}-{2}-{3}", 1, "two", 3.0, null);
            Console.WriteLine(sb + " length=" + sb.Length);
            sb.Clear().AppendJoin(", ", new[] { "a", "b", "c" }).Append(" | ").AppendJoin('/', 1, 2, 3).Append(" | ").AppendJoin("; ", new List<int> { 4, 5 }.Select(n => n * n)).Append(" | ").AppendJoin('+', new object[] { "o", 'c', 1L }).Append(" | ").AppendJoin("", Enumerable.Empty<string>()).AppendLine().AppendLine("tail").Append('\t');
            Console.WriteLine(Visible(sb));

            Console.WriteLine("-- editing in place");
            sb.Clear().Append("The quick brown fox");
            sb.Insert(4, "very ").Insert(0, 42).Insert(2, ' ').Insert(sb.Length, '!').Insert(3, "ab", 2).Insert(0, true).Insert(4, new[] { '[', ']' });
            Console.WriteLine(sb);
            sb.Remove(0, 6).Replace("quick", "slow").Replace('o', '0').Replace("b", "B", 0, 8).Remove(sb.Length - 1, 1);
            sb[0] = char.ToLowerInvariant(sb[0]);
            sb[^1] = 'X';
            Console.WriteLine(sb + " | " + sb[5] + sb[sb.Length - 2] + " " + sb.ToString(4, 6) + " " + sb.Equals(new StringBuilder(sb.ToString())) + " " + sb.ToString().IndexOf("sl0w", StringComparison.Ordinal));
            sb.Length = 10;
            Console.WriteLine("[" + sb + "] " + sb.Length);
            sb.Length = 13;
            sb.Replace('\0', '.').Append("end").Replace("..", ":");
            Console.WriteLine("[" + sb + "] " + sb.Length + " " + (sb.Capacity >= sb.Length) + " " + new StringBuilder("seed", 64).Append('!').Length + " " + new StringBuilder("0123456789", 2, 5, 16) + " " + (sb.Clear().Length == 0 && sb.ToString() == ""));
            var chunks = new StringBuilder(4);
            for (int i = 0; i < 40; i++) chunks.Append((char)('a' + i % 26));
            var copy = new char[5];
            chunks.CopyTo(24, copy, 0, 5);
            int chunkTotal = 0;
            foreach (ReadOnlyMemory<char> chunk in chunks.GetChunks()) chunkTotal += chunk.Length;
            Console.WriteLine(new string(copy) + " " + chunkTotal + " " + chunks.ToString(36, 4) + " " + chunks.Remove(5, 30).Insert(5, "..").ToString());

            Console.WriteLine("-- raw, verbatim and interpolated literals");
            string name = "report"; int width = 7; double ratio = 2.0 / 3;
            string raw = $$"""
                {"name": "{{name}}", "path": "C:\temp\{{name}}.txt", "braces": "{}", "ratio": {{ratio.ToString("F3", Inv)}},
                 "quote": "she said ""hi"" twice", "width": {{width,4}}}
                """;
            foreach (string line in raw.Split('\n')) Console.WriteLine(line.TrimEnd('\r'));
            Console.WriteLine($@"C:\logs\{name}_{width:D3}.txt ""{name.ToUpperInvariant()}"" {{w}}" + " | " + @$"\\server\{name}\" + " | " + """one "two" \three\""" + " | " + $"""{name}: "{width}" """.TrimEnd() + " | " + @"tab\there ""q""");
            string multi = """
                first
                  indented
                last
                """;
            Console.WriteLine(multi.Replace("\r\n", "\n").Replace("\n", "/") + " | " + $"{name[..3]}{$"{width}{$"{width + 1}"}"}{(width > 5 ? "+" : "-")}" + " | " + $"{{{name}}}" + $"{name,-8}|{name,8}|{width:000}|{ratio.ToString("P1", Inv)}");

            Console.WriteLine("-- string helpers used by the formatter");
            string csv = " alpha, beta ,,gamma , ,delta ";
            Console.WriteLine(string.Join("|", csv.Split(',')) + " # " + string.Join("|", csv.Split(',', StringSplitOptions.RemoveEmptyEntries)) + " # " + string.Join("|", csv.Split(',', StringSplitOptions.TrimEntries)) + " # " + string.Join("|", csv.Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries))
                + " # " + string.Join("|", csv.Split(',', 3)) + " # " + string.Join("|", "a--b-c".Split("--")) + " # " + string.Join("|", "k=v;x=y z".Split(new[] { '=', ';', ' ' })) + " # " + csv.Split(new[] { ", ", " ," }, StringSplitOptions.None).Length);
            Console.WriteLine("[" + "42".PadLeft(6) + "][" + "42".PadLeft(6, '0') + "][" + "42".PadRight(6, '.') + "][" + "toolong".PadLeft(3) + "][" + "  x y  ".Trim() + "][" + "  x y  ".TrimStart() + "][" + "  x y  ".TrimEnd() + "][" + "--x-y--".Trim('-') + "][" + "xyxhixy".Trim('x', 'y') + "]");
            string text = "Banana bandana BANANA";
            Console.WriteLine(string.Join(" ", text.IndexOf("ana", StringComparison.Ordinal), text.IndexOf("ana", 2, StringComparison.Ordinal), text.LastIndexOf("ana", StringComparison.Ordinal), text.IndexOf("ANA", StringComparison.OrdinalIgnoreCase), text.IndexOf("BANANA", StringComparison.Ordinal),
                text.IndexOf('d'), text.IndexOfAny(new[] { 'd', 'B' }, 1), text.LastIndexOf('a'), text.Contains("DAN", StringComparison.OrdinalIgnoreCase), text.StartsWith("banana", StringComparison.Ordinal), text.EndsWith("banana", StringComparison.OrdinalIgnoreCase),
                string.Compare("a", "B", StringComparison.Ordinal) > 0, string.Compare("a", "B", StringComparison.OrdinalIgnoreCase) < 0, string.Equals("Ok", "oK", StringComparison.OrdinalIgnoreCase), string.CompareOrdinal("abc", "abd") < 0));
            Console.WriteLine(text.Replace("ana", "ANA", StringComparison.Ordinal) + " | " + text.Replace("banana", "*", StringComparison.OrdinalIgnoreCase) + " | " + text.Replace('a', 'o') + " | " + text.Replace("an", "") + " | " + text.Remove(6) + text.Remove(0, 15).ToLowerInvariant() + " | " + text.Insert(6, "!") .Substring(4, 5)
                + " | " + string.Join(",", "a1b22c333".Split(new[] { '1', '2', '3' }, StringSplitOptions.RemoveEmptyEntries)) + " | " + string.Concat(Enumerable.Repeat("ab", 3)) + string.Concat("x", "y", "z", "w") + " | " + string.Join("-", 1, 'c', "s", 2L, true) + " | " + string.IsNullOrWhiteSpace(" \t") + string.IsNullOrEmpty(" "));
        }
    }
}
