using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;

public sealed class CsvException : FormatException
{
    public CsvException(int line, string message) : base($"line {line}: {message}") { Line = line; }
    public int Line { get; }
}

public static class Csv
{
    public static IEnumerable<string[]> Parse(TextReader reader, char separator = ',')
    {
        var fields = new List<string>();
        var field = new StringBuilder();
        bool quoted = false, any = false;
        int line = 1, next;
        while ((next = reader.Read()) >= 0)
        {
            char c = (char)next;
            any = true;
            if (quoted)
            {
                if (c == '"')
                {
                    if (reader.Peek() == '"') { field.Append('"'); reader.Read(); }
                    else quoted = false;
                }
                else
                {
                    if (c == '\n') line++;
                    field.Append(c);
                }
            }
            else if (c == '"')
            {
                if (field.Length > 0) throw new CsvException(line, "quote inside unquoted field");
                quoted = true;
            }
            else if (c == separator) { fields.Add(field.ToString()); field.Clear(); }
            else if (c == '\r') { }
            else if (c == '\n')
            {
                fields.Add(field.ToString());
                field.Clear();
                yield return fields.ToArray();
                fields.Clear();
                line++;
                any = false;
            }
            else field.Append(c);
        }
        if (quoted) throw new CsvException(line, "unterminated quote");
        if (any) { fields.Add(field.ToString()); yield return fields.ToArray(); }
    }

    public static string Escape(string value) => value.IndexOfAny(new[] { ',', '"', '\n' }) < 0 ? value : "\"" + value.Replace("\"", "\"\"") + "\"";
}

public sealed class Table
{
    private readonly string[] headers;
    private readonly List<string[]> rows = new List<string[]>();
    private readonly bool[] rightAligned;

    public Table(params string[] headers) { this.headers = headers; rightAligned = new bool[headers.Length]; }
    public Table AlignRight(params int[] columns) { foreach (int column in columns) rightAligned[column] = true; return this; }
    public void Add(params object[] cells) => rows.Add(cells.Select(cell => cell is IFormattable f ? f.ToString(null, CultureInfo.InvariantCulture) : cell?.ToString() ?? "").ToArray());

    public string Render()
    {
        var widths = headers.Select((header, index) => Math.Max(header.Length, rows.Count == 0 ? 0 : rows.Max(row => row[index].Length))).ToArray();
        var writer = new StringWriter { NewLine = "\n" };
        string Line(string[] cells) => "| " + string.Join(" | ", cells.Select((cell, index) => rightAligned[index] ? cell.PadLeft(widths[index]) : cell.PadRight(widths[index]))) + " |";
        string rule = "+" + string.Join("+", widths.Select(width => new string('-', width + 2))) + "+";
        writer.WriteLine(rule);
        writer.WriteLine(Line(headers));
        writer.WriteLine(rule.Replace('-', '='));
        foreach (var row in rows) writer.WriteLine(Line(row));
        writer.Write(rule);
        return writer.ToString();
    }
}

public static class Program
{
    private const string Data = "name,qty,price,note\n" +
        "Widget,4,3.50,plain\n" +
        "\"Gadget, large\",10,12.25,\"says \"\"hi\"\"\"\n" +
        "Sprocket,0,0.99,\n" +
        "\"Multi\nline\",2,100,\"x\"\r\n" +
        "Bolt,250,0.035,bulk";

    public static void Main()
    {
        var records = Csv.Parse(new StringReader(Data)).ToList();
        Console.WriteLine(records.Count + " rows, " + string.Join("/", records.Select(r => r.Length)) + " fields; header " + string.Join("+", records[0]));
        var table = new Table("Item", "Qty", "Price", "Total", "Note").AlignRight(1, 2, 3);
        decimal grand = 0;
        foreach (var row in records.Skip(1))
        {
            int quantity = int.Parse(row[1], CultureInfo.InvariantCulture);
            decimal price = decimal.Parse(row[2], CultureInfo.InvariantCulture), total = quantity * price;
            grand += total;
            table.Add(row[0].Replace("\n", "\\n"), quantity, price.ToString("0.000", CultureInfo.InvariantCulture), total.ToString("N2", CultureInfo.InvariantCulture), row[3].Length == 0 ? "-" : row[3]);
        }
        table.Add("TOTAL", records.Skip(1).Sum(r => int.Parse(r[1])), "", grand.ToString("N2", CultureInfo.InvariantCulture), null);
        Console.WriteLine(table.Render());
        Console.WriteLine(new Table("Empty", "Table").Render());
        Console.WriteLine(string.Join(",", records[2].Select(Csv.Escape)) + " " + Csv.Escape("plain") + " " + Csv.Escape("a\nb").Length);
        foreach (var broken in new[] { "a,b\nc,\"open", "ok\nbad\"quote,x", "", "\n", "a;b;c", "x,y\n" })
        {
            try
            {
                var parsed = Csv.Parse(new StringReader(broken), broken.Contains(';') ? ';' : ',').ToList();
                Console.Write($"[{parsed.Count}:{string.Join("|", parsed.Select(r => string.Join("~", r)))}] ");
            }
            catch (CsvException e) { Console.Write($"[error {e.Line} {e.Message}] "); }
        }
        Console.WriteLine();
        using var writer = new StringWriter(CultureInfo.InvariantCulture) { NewLine = "\n" };
        writer.Write("{0}-{1:F1}", 1, 2.25);
        writer.WriteLine();
        writer.Write(true);
        writer.Write('c');
        writer.Write(3.5m);
        writer.WriteLine(new[] { 'x', 'y' });
        writer.WriteLine("{0} {1} {2} {3}", 1, 2, 3, 4);
        using var reader = new StringReader(writer.ToString());
        string line;
        int number = 0;
        while ((line = reader.ReadLine()) != null) Console.Write(++number + ":" + line + " ");
        Console.WriteLine(reader.Peek() + " " + new StringReader("abc").ReadToEnd().Length);
    }
}
