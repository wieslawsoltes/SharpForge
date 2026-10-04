using System;
using System.Collections.Generic;
using System.Linq;
using Cell = (int Row, int Column);
using Grid = System.Collections.Generic.SortedDictionary<(int Row, int Column), string>;
using Style = (string Open, string Close);
using Widths = int[];

const string Reset = "\e[0m";
Style bold = ("\e[1m", Reset), dim = (Open: "\e[2m", Close: Reset), plain = default;
string title = "Q3 \"draft\"";
string[] header = ["region", "units", "revenue"];
var rows = new (string Region, int Units, int Revenue)[] { ("north", 120, 4800), ("south", 75, 3900), ("east-coast", 310, 9100), ("west", 0, 0) };

Grid grid = new();
for (int column = 0; column < header.Length; column++) grid[(0, column)] = header[column];
foreach (var (index, (region, units, revenue)) in rows.Select((row, i) => (i + 1, row)))
{
    grid[(index, 0)] = region;
    grid[new Cell(index, 1)] = units.ToString();
    grid[(Row: index, Column: 2)] = revenue.ToString();
}
Widths widths = new int[header.Length];
foreach (var (cell, text) in grid) widths[cell.Column] = Math.Max(widths[cell.Column], text.Length);

Cell best = default;
foreach (var ((row, column), text) in grid)
    if (row > 0 && column == 2 && (best == default || int.Parse(text) > int.Parse(grid[best]))) best = (row, column);
(int Row, int Column) sameAsBest = best;
(long, long) widened = best;
var inferred = (grid.Count, title.Length, best.Row);
Console.WriteLine($"{best} {best == (3, 2)} {sameAsBest == best} {widened == (3L, 2L)} {best != (2, 3)} {inferred.Count}/{inferred.Length}/{inferred.Row} {(best, "x") == ((3, 2), "x")} {inferred == (15, 10, 3)}");

var pad = (string text, int width = 8, char fill = ' ') => text.PadRight(width, fill);
var join = (string separator, params string[] parts) => string.Join(separator, parts);
var paint = static (Style style, string text) => style.Open + text + style.Close;
Func<string, string> visible = text => text.Replace("\e", "^");
Func<Cell, Style> styleOf = cell => cell switch { (0, _) => dim, var c when c == best => bold, (_, 0) => plain, _ => (null, null) };
int rowCount = grid.Keys.Max(key => key.Row) + 1;
for (int row = 0; row < rowCount; row++)
{
    var cells = new List<string>();
    for (int column = 0; column < widths.Length; column++)
    {
        Cell at = (row, column);
        cells.Add(paint(styleOf(at), column == 0 ? pad(grid[at], widths[column]) : grid[at].PadLeft(widths[column])));
    }
    Console.WriteLine(visible(join(" | ", cells.ToArray())));
}
Console.WriteLine(visible(pad("total", widths[0], '.') + " " + pad("x") + "|" + join("", "a", "b") + join("-") + "|") + " " + "\e".Length + " " + (int)'\e' + " " + ("\e[1m" == "\u001b[1m") + " " + bold.Open.Length);

var totals = (Units: rows.Sum(r => r.Units), Revenue: rows.Sum(r => r.Revenue));
var (totalUnits, totalRevenue) = totals;
(string Name, (int Units, int Revenue) Stats) top = (rows[best.Row - 1].Region, (rows[best.Row - 1].Units, rows[best.Row - 1].Revenue));
string json = $$"""
    {
      "title": "{{title.Replace("\"", "'")}}",
      "cells": {{grid.Count}},
      "top": { "name": "{{top.Name}}", "share": "{{top.Stats.Revenue * 100 / totalRevenue}}%" },
      "path": "C:\reports\{{top.Name}}.csv",
      "literal": "{not-a-hole} {{{totalUnits}}}"
    }
    """;
Console.WriteLine(json);
string banner = $"""
    <report rows="{rows.Length}" widths="{string.Join(',', widths)}">
      {totals.Units,6} units / {totals.Revenue:D6} "revenue"
    </report>
    """.Replace(",", "_");
Console.WriteLine(banner);
string verbatim = """
      keep "quotes", \n and  indentation
    """;
Console.WriteLine("[" + verbatim + "] " + verbatim.Length + " " + json.Split('\n').Length + " " + """one "line" raw""".Length);

(int a, int b) = (totalUnits, totalRevenue);
(a, b) = (b, a);
var swapped = (First: a, Second: b);
(int, int) unnamed = swapped;
var nine = (1, 2, 3, 4, 5, 6, 7, "eight", (Nine: 9, Ten: 10));
(string Label, int? Value)[] optional = [("set", 5), ("unset", null), (null, 0)];
Console.WriteLine($"{swapped} {unnamed.Item1 - unnamed.Item2} {swapped == (totalRevenue, totalUnits)} {nine.Item8}{nine.Item9.Ten} {nine.Rest.Item2.Nine} {nine == (1, 2, 3, 4, 5, 6, 7, "eight", (9, 10))}"
    + $" {optional.Count(o => o == ("unset", null))} {optional.Count(o => o != default)} {string.Join(";", optional.Select(o => (o.Label ?? "?", o.Value ?? -1)))}");

var byParity = rows.GroupBy(r => (Even: r.Units % 2 == 0, Big: r.Revenue > 4000)).OrderBy(g => g.Key).Select(g => (g.Key, Names: string.Join("+", g.Select(r => r.Region))));
foreach (var (key, names) in byParity) Console.WriteLine($"even={key.Even} big={key.Big}: {names}");
var lookup = new Dictionary<(string, int), Cell> { [("north", 120)] = (1, 0), [("west", 0)] = (4, 0) };
Console.WriteLine(lookup.TryGetValue((rows[0].Region, rows[0].Units), out Cell found) + " " + found.Row + " " + lookup.ContainsKey(("west", 1)) + " " + Report.Describe((2, 2)) + " " + Report.Describe(best) + " " + Report.Describe((0, 7)) + " " + Report.Swap((1, "one")));

public static class Report
{
    public static string Describe(Cell cell) => cell switch
    {
        (0, var column) => "header" + column,
        var (row, column) when row == column => "diagonal",
        { Row: > 2, Column: var column } => "late" + column,
        _ => "body",
    };

    public static (T2 Second, T1 First) Swap<T1, T2>((T1 First, T2 Second) pair) => (pair.Second, pair.First);
}
