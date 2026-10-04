using System;
using System.Collections.Generic;
using System.Linq;

var before = new Section
{
    Name = "server",
    Settings = new Setting[]
    {
        new Flag("Debug", false), new Number(" Timeout ", 30) { Unit = "s" }, new Limit("workers", 4, 16), new Text("host", "localhost"),
        new Number("port", 8080), new Flag("tls", true), new Text("motd", "hello"), new Text("legacy", "1"),
    },
};
var after = before with
{
    Owner = "platform",
    Settings = new Setting[]
    {
        new Flag("debug", true), new Limit("timeout", 30, 120) { Unit = "s" }, new Limit("workers", 8, 16), new Text("host", "localhost"),
        new Number("port", 8080) { Unit = "tcp" }, new Text("motd", "hello world"), new Number("retries", 3), new Flag("TLS", true),
    },
};

var changes = Differ.Diff(before, after);
foreach (var change in changes) Console.WriteLine(Differ.Describe(change) + "    <" + change.GetType().GetGenericArguments()[0].Name + ">");
Console.WriteLine(changes.Count + " changes, " + changes.Count(c => c.IsAdd) + " added, " + changes.Count(c => c.IsRemove) + " removed; owner " + before.Owner + " -> " + after.Owner);
Console.WriteLine(before.Settings[1] + " | " + after.Settings[1] + " | " + new Versioned<Setting>(after.Settings[0], 2));

var shared = new HashSet<Setting>(before.Settings);
shared.IntersectWith(after.Settings);
var all = new HashSet<Setting>(before.Settings.Concat(after.Settings));
var usage = new Dictionary<Setting, int>();
foreach (var setting in before.Settings.Concat(after.Settings).Concat(new Setting[] { new Text("HOST", "localhost"), new Flag("tls", true), new Flag("tls", false) }))
    usage[setting] = usage.GetValueOrDefault(setting) + 1;
Console.WriteLine(shared.Count + " shared (" + string.Join(",", shared.Select(s => s.Key).OrderBy(k => k, StringComparer.Ordinal)) + "), " + all.Count + " distinct, max use "
    + usage.Values.Max() + " for " + usage.First(pair => pair.Value == usage.Values.Max()).Key.Key + ", tls=" + usage[new Flag("Tls", true)]);

Number number = new Number("timeout", 30) { Unit = "s" };
Number limit = new Limit("timeout", 30, 120) { Unit = "s" };
Console.WriteLine((number == limit) + " " + number.Equals(limit) + " " + limit.Equals(number) + " " + (limit == after.Settings[1]) + " " + (number == before.Settings[1])
    + " " + ((limit with { Value = 31 }) is Limit { Max: 120, Value: 31 }) + " " + (number with { }).GetType().Name + " " + (limit with { }).GetType().Name);

foreach (var attempt in new Func<Setting>[] { () => new Flag("  ", true), () => new Limit("pool", 50, 10), () => new Limit("pool", 5, 10) with { Value = 50 }, () => new Text(null, "x") })
{
    try { Console.WriteLine("created " + attempt()); }
    catch (ArgumentException e) { Console.WriteLine("rejected: " + e.Message); }
}
var v1 = new Versioned<Section>(before, 1);
var v2 = v1.Next(after);
var (current, version) = v2;
Console.WriteLine(version + " " + current.Name + " " + (v1 == new Versioned<Section>(before, 1)) + " " + (v1 == v2) + " " + (before == before with { }) + " " + (before == before with { Settings = before.Settings.ToArray() })
    + " " + default(Versioned<Section>).Version + " " + (default(Versioned<Flag>).Value is null));

public abstract record Setting(string Key)
{
    public string Key { get; init; } = !string.IsNullOrWhiteSpace(Key) ? Key.Trim().ToLowerInvariant() : throw new ArgumentException("key required");
}

public record Flag(string Key, bool On) : Setting(Key);

public record Number(string Key, int Value) : Setting(Key)
{
    public string Unit { get; init; } = "";
}

public sealed record Limit(string Key, int Value, int Max) : Number(Key, Value)
{
    public int Max { get; init; } = Max >= Value ? Max : throw new ArgumentException($"max {Max} below value {Value}");
}

public record Text(string Key, string Value) : Setting(Key);

public record Section
{
    public required string Name { get; init; }
    public required IReadOnlyList<Setting> Settings { get; init; }
    public string Owner { get; init; } = "ops";
}

public abstract record Change(string Key)
{
    public abstract bool IsAdd { get; }
    public abstract bool IsRemove { get; }
}

public sealed record Change<T>(string Key, T Before, T After) : Change(Key) where T : Setting
{
    public override bool IsAdd => Before is null;
    public override bool IsRemove => After is null;
}

public readonly record struct Versioned<T>(T Value, int Version) where T : class
{
    public Versioned<T> Next(T value) => this with { Value = value, Version = Version + 1 };
}

public static class Differ
{
    public static List<Change> Diff(Section before, Section after)
    {
        var old = before.Settings.ToDictionary(s => s.Key);
        var result = new List<Change>();
        foreach (var setting in after.Settings)
        {
            if (!old.Remove(setting.Key, out var previous)) result.Add(Make(null, setting));
            else if (previous != setting) result.Add(Make(previous, setting));
        }
        foreach (var removed in old.Values) result.Add(Make(removed, null));
        result.Sort((a, b) => string.CompareOrdinal(a.Key, b.Key));
        return result;
    }

    private static Change Make(Setting before, Setting after) => (before, after) switch
    {
        (Flag or null, Flag or null) => new Change<Flag>((before ?? after).Key, (Flag)before, (Flag)after),
        (Limit or null, Limit or null) => new Change<Limit>((before ?? after).Key, (Limit)before, (Limit)after),
        (Number or null, Number or null) => new Change<Number>((before ?? after).Key, (Number)before, (Number)after),
        (Text or null, Text or null) => new Change<Text>((before ?? after).Key, (Text)before, (Text)after),
        _ => new Change<Setting>((before ?? after).Key, before, after),
    };

    public static string Describe(Change change) => change switch
    {
        Change<Flag>(var key, { On: var was }, { On: var now }) => $"{key}: {(was ? "on" : "off")} -> {(now ? "on" : "off")}",
        Change<Limit> { Before: { Value: var a, Max: var max }, After: { Value: var b, Max: var newMax } } c when max == newMax => $"{c.Key}: {a} -> {b} of {max} ({(b - a) * 100 / max:+0;-0}%)",
        Change<Number>(_, Limit, not Limit) or Change<Number>(_, not Limit, Limit) => change.Key + ": limit kind changed",
        Change<Number>(var key, Number { Value: var a, Unit: var u1 }, Number { Value: var b, Unit: var u2 }) when a == b => $"{key}: unit '{u1}' -> '{u2}'",
        Change<Number>(var key, null, { Value: var value }) => $"{key}: new number {value}",
        Change<Text>(var key, { Value: var a }, { Value: var b }) when b.StartsWith(a, StringComparison.Ordinal) => $"{key}: appended '{b[a.Length..]}'",
        { IsRemove: true, Key: var key } => key + ": removed",
        { IsAdd: true } => change.Key + ": added",
        _ => change.Key + ": changed",
    };
}
