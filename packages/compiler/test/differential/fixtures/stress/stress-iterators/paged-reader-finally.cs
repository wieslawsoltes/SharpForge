using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;

var log = new List<string>();
string Drain() { string text = string.Join(" ", log); log.Clear(); return text; }

var source = new PagedSource<string>(new[] { "ant", "bee", "cat", "dog", "eel", "fox", "gnu" }, pageSize: 3);
var reader = new PagedReader<string>(source, log);

Console.WriteLine("all: " + string.Join(",", reader) + " | " + Drain() + " | fetches=" + source.Fetches);
foreach (string item in reader) { if (item == "dog") break; }
Console.WriteLine("break at dog: " + Drain() + " | fetches=" + source.Fetches);
Console.WriteLine("first: " + reader.First() + " | " + Drain());
Console.WriteLine("stop at eel: " + string.Join(",", new PagedReader<string>(source, log, item => item == "eel")) + " | " + Drain());

IEnumerable<string> query = reader.Where(item => item.Contains('e')).Select(item => item.ToUpperInvariant());
int before = source.Fetches;
Console.WriteLine("query built: fetched " + (source.Fetches - before) + " pages, log=[" + Drain() + "]");
Console.WriteLine("query: " + string.Join(",", query.Take(2)) + " | " + Drain() + " | fetched " + (source.Fetches - before));

IEnumerator<string> manual = reader.GetEnumerator();
log.Add("created");
manual.MoveNext();
manual.MoveNext();
log.Add("at:" + manual.Current);
manual.Dispose();
log.Add("moveNext-after-dispose:" + manual.MoveNext());
IEnumerator<string> untouched = reader.GetEnumerator();
untouched.Dispose();
Console.WriteLine("manual: " + Drain());

source.FailOnPage = 1;
var partial = new List<string>();
try { foreach (string item in reader) partial.Add(item); }
catch (TimeoutException e) { log.Add("caught:" + e.Message); }
Console.WriteLine("failure: got " + partial.Count + " | " + Drain());
source.FailOnPage = -1;

Console.WriteLine("pages: " + string.Join(" / ", reader.Pages().Select(page => page.Count + ":" + string.Join("", page.Select(item => item[0])))) + " | " + Drain());
var numbers = new PagedReader<int>(new PagedSource<int>(Enumerable.Range(1, 5).ToArray(), 2), log);
Console.WriteLine("zip: " + string.Join(" ", reader.Zip(numbers, (name, number) => name + number)) + " | " + Drain());

var cursor = new Cursor<string>(reader);
Console.WriteLine("batches: [" + string.Join(",", cursor.Next(2)) + "] [" + string.Join(",", cursor.Next(4)) + "] [" + string.Join(",", cursor.Next(4)) + "] [" + string.Join(",", cursor.Next(1)) + "] finished=" + cursor.Finished);
Console.WriteLine("cursor log: " + Drain());

IEnumerable<int> Countdown(int n)
{
    while (n > 0) yield return n--;
}
int served = 0;
IEnumerable<int> Tickets(int count)
{
    for (int i = 0; i < count; i++) yield return ++served;
}
IEnumerable<int> countdown = Countdown(3), tickets = Tickets(2);
Console.WriteLine("parameter copy restarts: " + string.Join("", countdown) + " " + string.Join("", countdown) + "; captured local continues: " + string.Join("", tickets) + " " + string.Join("", tickets) + " served=" + served);

var window = new Window { Start = 5, Length = 3 };
IEnumerable<int> indices = window.Indices();
window.Start = 100;
Console.WriteLine("struct iterator uses copy: " + string.Join(",", indices) + " then " + string.Join(",", window.Indices()) + " touched=" + window.Touched);

static IEnumerable<string> Nested(List<string> log, int rows, int columns)
{
    for (int r = 0; r < rows; r++)
    {
        try
        {
            for (int c = 0; c < columns; c++)
            {
                try
                {
                    if (c > r) break;
                    yield return r + "" + c;
                }
                finally { log.Add("cell" + r + c); }
            }
        }
        finally { log.Add("row" + r); }
    }
}
Console.WriteLine("nested: " + string.Join(" ", Nested(log, 3, 3)));
Console.WriteLine("  " + Drain());
Console.WriteLine("nested take 2: " + string.Join(" ", Nested(log, 3, 3).Take(2)) + " | " + Drain());

sealed class PagedSource<T>
{
    private readonly T[] items;
    private readonly int pageSize;
    public int Fetches { get; private set; }
    public int FailOnPage { get; set; } = -1;
    public PagedSource(T[] items, int pageSize) { this.items = items; this.pageSize = pageSize; }

    public (T[] Items, int? Next) Fetch(int page)
    {
        Fetches++;
        if (page == FailOnPage) throw new TimeoutException("page " + page + " unavailable");
        T[] slice = items.Skip(page * pageSize).Take(pageSize).ToArray();
        return (slice, (page + 1) * pageSize < items.Length ? page + 1 : null);
    }
}

sealed class PagedReader<T> : IEnumerable<T>
{
    private readonly PagedSource<T> source;
    private readonly List<string> log;
    private readonly Func<T, bool> stop;
    public PagedReader(PagedSource<T> source, List<string> log, Func<T, bool> stop = null) { this.source = source; this.log = log; this.stop = stop; }

    public IEnumerator<T> GetEnumerator()
    {
        log.Add("open");
        try
        {
            int? page = 0;
            while (page is int current)
            {
                var (items, next) = source.Fetch(current);
                log.Add("page" + current);
                try
                {
                    foreach (T item in items)
                    {
                        if (stop != null && stop(item)) yield break;
                        yield return item;
                    }
                }
                finally { log.Add("done" + current); }
                page = next;
            }
            log.Add("exhausted");
        }
        finally { log.Add("close"); }
    }

    IEnumerator IEnumerable.GetEnumerator() => GetEnumerator();

    public IEnumerable<IReadOnlyList<T>> Pages()
    {
        for (int? page = 0; page.HasValue;)
        {
            (T[] items, page) = source.Fetch(page.Value);
            yield return items;
        }
    }
}

sealed class Cursor<T>
{
    private readonly IEnumerator<T> position;
    public bool Finished { get; private set; }
    public Cursor(IEnumerable<T> sequence) { position = sequence.GetEnumerator(); }

    public List<T> Next(int count)
    {
        var batch = new List<T>();
        while (batch.Count < count && !Finished)
        {
            if (position.MoveNext()) batch.Add(position.Current);
            else { Finished = true; position.Dispose(); }
        }
        return batch;
    }
}

struct Window
{
    public int Start, Length, Touched;
    public IEnumerable<int> Indices()
    {
        Touched++;
        for (int i = 0; i < Length; i++) yield return Start + i;
    }
}
