using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;

public abstract class Exporter
{
    private static int created;
    protected readonly List<string> Trace = new List<string>();
    public readonly string Banner;

    protected Exporter(string title)
    {
        Id = ++created;
        Title = title;
        Banner = BuildBanner(); // virtual call from the constructor: derived constructor bodies have not run yet
        Trace.Add("base-ctor(" + Rows + " rows)");
    }

    public int Id { get; }
    public string Title { get; }
    public abstract string Extension { get; }
    public abstract string this[int row] { get; }
    public abstract int Rows { get; }
    public virtual string Separator => ",";
    public virtual int Width { get; set; } = 10;
    private protected virtual int Priority => 0;
    protected virtual string BuildBanner() => "== " + Title + " ==";
    protected abstract string FormatRow(int index, string content);
    protected virtual string Header() => Title;
    protected virtual string Footer() => Rows + " rows";
    protected internal virtual string Escape(string text) => text;

    public string Export()
    {
        var output = new StringBuilder(Header()).Append(" | ");
        for (int i = 0; i < Rows; i++) output.Append(FormatRow(i, Escape(this[i]))).Append(" | ");
        Trace.Add("export");
        return output.Append(Footer()).ToString();
    }

    public virtual string Describe() => "Exporter#" + Id + "(" + Extension + ")";
    public override string ToString() => Describe() + " p" + Priority + " w" + Width;
    public string History => string.Join(">", Trace);
    public static string Kind() => "exporter";
}

public class CsvExporter : Exporter
{
    private readonly string[] rows;
    private readonly string prefix = "csv"; // field initializers run before the base constructor
    private readonly string suffix;         // assigned in the constructor body, so still null inside BuildBanner

    public CsvExporter(string title, params string[] rows) : base(title)
    {
        this.rows = rows;
        suffix = "!";
        Trace.Add("csv-ctor(" + Rows + " rows)");
    }

    public override string Extension => ".csv";
    public override string this[int row] => rows[row];
    public override int Rows => rows?.Length ?? -1;
    private protected override int Priority => 1;
    protected override string BuildBanner() => prefix + ":" + base.BuildBanner() + ":" + (suffix ?? "<unset>");
    protected override string FormatRow(int index, string content) => index + Separator + content;
    protected internal override string Escape(string text) => text.Contains(',') ? "\"" + text + "\"" : text;
    public override string Describe() => "Csv:" + base.Describe();
    public string CurrentBanner => BuildBanner();
    public new static string Kind() => "csv " + Exporter.Kind();
}

public class TsvExporter : CsvExporter
{
    public TsvExporter(string title, params string[] rows) : base(title, rows) { Trace.Add("tsv-ctor"); }
    public override string Extension => ".tsv";
    public override string Separator => "\\t";
    public override int Width { get => base.Width * 2; set => base.Width = value + 1; }
    public sealed override string Describe() => "Tsv:" + base.Describe();
    protected sealed override string FormatRow(int index, string content) => "T" + base.FormatRow(index, content);
    protected override string Footer() => base.Footer() + " (tsv)";
}

public class FancyExporter : TsvExporter
{
    public FancyExporter(string title, params string[] rows) : base(title, rows) { }
    public new string Describe() => "Fancy(hides " + base.Describe() + ")";
    public new virtual string Separator => ";";
    protected override string Header() => base.Header().ToUpperInvariant();
    protected override string BuildBanner() => "fancy/" + base.BuildBanner();
    protected override string Footer() => "[" + base.Footer() + "]";
}

public class UltraExporter : FancyExporter
{
    public UltraExporter(string title, params string[] rows) : base(title, rows) { }
    public override string Separator => "::";
    public new int Width { get; set; } = 99;
    private protected override int Priority => base.Priority + 41;
    protected internal sealed override string Escape(string text) => base.Escape(text).Replace(" ", "_");
}

public abstract class MarkupExporter : Exporter
{
    protected MarkupExporter(string title) : base(title) { }
    protected abstract string Tag { get; }
    public abstract override string Describe();
    protected sealed override string FormatRow(int index, string content) => "<" + Tag + " n='" + index + "'>" + content + "</" + Tag + ">";
    protected internal override string Escape(string text) => text.Replace("&", "&amp;").Replace("<", "&lt;");
    protected override string Header() => "<" + Tag + "s title='" + base.Header() + "'>";
    protected override string Footer() => "</" + Tag + "s>";
}

public sealed class XmlExporter : MarkupExporter
{
    private readonly SortedDictionary<int, string> items = new SortedDictionary<int, string>();
    public XmlExporter(string title) : base(title) { }
    public override string Extension => ".xml";
    protected override string Tag => Rows > 2 ? "entry" : "item";
    public override int Rows => items.Count;
    public override string this[int row] => items[row];
    public override string Describe() => "Xml#" + Id;
    public XmlExporter Add(string text) { items[items.Count] = text; return this; }
    protected override string BuildBanner() => "<!-- " + Title + " (" + Rows + ") -->";
}

public static class Program
{
    public static void Main()
    {
        var csv = new CsvExporter("Sales", "apples,pears", "plums");
        var tsv = new TsvExporter("Stock", "nuts", "a,b");
        var fancy = new FancyExporter("Fancy", "x y");
        var ultra = new UltraExporter("Ultra", "p q", "r,s t");
        var xml = new XmlExporter("Notes").Add("a < b").Add("R&D");
        var all = new Exporter[] { csv, tsv, fancy, ultra, xml };

        foreach (Exporter exporter in all)
        {
            Console.WriteLine(exporter + " | " + exporter.Banner);
            Console.WriteLine("  " + exporter.Export());
            Console.WriteLine("  sep=" + exporter.Separator + " ext=" + exporter.Extension + " first=" + exporter[0] + " escape=" + exporter.Escape("1 < 2, ok") + " history=" + exporter.History);
        }

        Console.WriteLine("banner now: " + csv.CurrentBanner + " / " + ultra.CurrentBanner);
        xml.Add("third").Add("fourth");
        Console.WriteLine("xml again: " + xml.Export() + " | " + xml.History);

        // Hiding versus overriding: the answer depends on the static type of the reference.
        Exporter asBase = ultra; CsvExporter asCsv = ultra; TsvExporter asTsv = ultra; FancyExporter asFancy = ultra;
        Console.WriteLine("describe: " + asBase.Describe() + " | " + asTsv.Describe() + " | " + asFancy.Describe() + " | " + ultra.Describe() + " | " + ((Exporter)fancy).Describe());
        Console.WriteLine("separator: " + asBase.Separator + " " + asCsv.Separator + " " + asTsv.Separator + " " + asFancy.Separator + " " + ultra.Separator + " " + fancy.Separator + " " + ((TsvExporter)fancy).Separator);

        asBase.Width = 4;
        ultra.Width += 1;
        tsv.Width = 7;
        csv.Width *= 3;
        Console.WriteLine("width: " + asBase.Width + " " + asTsv.Width + " " + asFancy.Width + " " + ultra.Width + " | tsv " + tsv.Width + " " + ((Exporter)tsv).Width + " | csv " + csv.Width + " | xml " + xml.Width);
        Console.WriteLine("static: " + Exporter.Kind() + " / " + CsvExporter.Kind() + " / " + TsvExporter.Kind() + " / " + UltraExporter.Kind());
        Console.WriteLine("types: " + string.Join(" ", all.Select(e => e.GetType().Name + ":" + e.GetType().BaseType.Name + (e is CsvExporter ? "+csv" : "") + (e is MarkupExporter ? "+markup" : ""))));
        Console.WriteLine("ids: " + string.Join(",", all.Select(e => e.Id)) + " by extension: " + string.Join(" ", all.GroupBy(e => e.Extension).OrderBy(g => g.Key).Select(g => g.Key + "=" + g.Count()))
            + " total rows: " + all.Sum(e => e.Rows) + " widest: " + all.OrderByDescending(e => e.Width).ThenBy(e => e.Id).First().Title);
    }
}
