#nullable enable
using System;
using System.Collections.Generic;
using System.Diagnostics.CodeAnalysis;
using System.Linq;

public sealed class Employee
{
    public Employee(string name, Employee? manager = null, int? age = null) { Name = name; Manager = manager; Age = age; }
    public string Name { get; }
    public Employee? Manager { get; }
    public int? Age { get; }
    public string? Nickname { get; set; }
    public List<string>? Skills { get; set; }
    public decimal? Bonus;
}

public static class Program
{
    private static bool TryFind(IEnumerable<Employee> staff, string name, [NotNullWhen(true)] out Employee? found)
    {
        found = staff.FirstOrDefault(e => e.Name == name);
        return found is not null;
    }

    private static string Chain(Employee? employee)
    {
        var parts = new List<string>();
        for (var current = employee; current != null; current = current.Manager) parts.Add(current.Nickname ?? current.Name);
        return parts.Count == 0 ? "<nobody>" : string.Join(" > ", parts);
    }

    private static int? ParseAge(string? text) => int.TryParse(text, out int value) && value >= 0 ? value : null;

    private static string Describe(int? value) => value switch
    {
        null => "unknown",
        < 18 => "minor",
        >= 18 and < 65 => "adult " + value.Value,
        var v => "senior " + v,
    };

    private static T OrDefault<T>(T? value, T fallback) where T : struct => value ?? fallback;
    private static T OrThrow<T>(T? value) where T : class => value ?? throw new ArgumentNullException(nameof(value));

    public static void Main()
    {
        var ceo = new Employee("Ada", age: 61) { Nickname = "boss", Skills = new List<string> { "strategy" } };
        var lead = new Employee("Grace", ceo, 45) { Bonus = 1500.5m };
        var dev = new Employee("Linus", lead) { Skills = new List<string>() };
        var staff = new[] { ceo, lead, dev };

        Console.WriteLine(Chain(dev) + " | " + Chain(null) + " | " + dev.Manager?.Manager?.Name + " | " + (ceo.Manager?.Name ?? "top") + " | " + dev.Manager?.Manager?.Manager?.Name?.Length);
        Console.WriteLine(dev.Skills?.Count + " " + lead.Skills?.Count + " " + (lead.Skills?.Count ?? -1) + " " + ceo.Skills?[0] + " " + (dev.Skills?.FirstOrDefault() ?? "none") + " " + ceo.Nickname?.ToUpperInvariant() + " " + lead.Nickname?.ToUpperInvariant().Length);

        int? a = 5, b = null, c = 7;
        Console.WriteLine($"{a + b} {a + c} {a * c - b} {a > b} {a < c} {a == b} {b == null} {b != null} {a >= c} {b <= c} {(a ?? 0) + (b ?? 0)} {a.HasValue} {b.GetValueOrDefault(9)} {b.GetValueOrDefault()}");
        bool? yes = true, no = false, maybe = null;
        Console.WriteLine($"{yes & maybe} {no & maybe} {yes | maybe} {no | maybe} {!maybe} {yes ^ no} {maybe == true} {maybe != true} {(maybe ?? yes)} {yes & no} {no | no}");
        Console.WriteLine(string.Join(",", staff.Select(e => Describe(e.Age))) + " " + Describe(ParseAge("12")) + " " + Describe(ParseAge("-3")) + " " + Describe(ParseAge(null)) + " " + Describe(70));

        b ??= a + 10;
        a ??= 100;
        string? text = null;
        text ??= "initial";
        text ??= "ignored";
        Console.WriteLine(b + " " + a + " " + text + " " + OrDefault<int>(null, 3) + " " + OrDefault<double>(2.5, 1) + " " + OrDefault(lead.Bonus, 0m) + " " + OrDefault(dev.Bonus, -1m));

        if (TryFind(staff, "Grace", out var found)) Console.WriteLine(found.Name + " reports to " + found.Manager!.Name);
        Console.WriteLine(TryFind(staff, "Nobody", out var missing) + " " + (missing is null));
        try { OrThrow<string>(null); }
        catch (ArgumentNullException e) { Console.WriteLine("null " + e.ParamName); }
        try { int? none = null; Console.WriteLine(none!.Value); }
        catch (InvalidOperationException) { Console.WriteLine("no value"); }

        object?[] objects = { 1, null, "s", 2.5, (int?)null, (int?)4, new int?[] { 1, null } };
        foreach (var o in objects)
        {
            string kind = o switch
            {
                int n when n > 3 => "big int " + n,
                int n => "int " + n,
                string { Length: 1 } s => "char-like " + s,
                null => "null",
                int?[] array => "array with " + array.Count(item => item is null) + " null",
                _ => o.GetType().Name,
            };
            Console.Write(kind + "; ");
        }
        Console.WriteLine();
        int? boxedSource = 3;
        object boxed = boxedSource;
        object? boxedNull = (int?)null;
        Console.WriteLine(boxed.GetType().Name + " " + (boxedNull == null) + " " + ((int?)boxed + 1) + " " + (boxed is int?) + " " + Nullable.GetUnderlyingType(typeof(int?))!.Name + " " + default(int?).HasValue + " " + new int?(3).Equals(3) + " " + Nullable.Compare<int>(null, 1));
        DateTime? when = null;
        var day = when?.DayOfWeek;
        TimeSpan? span = when - new DateTime(2020, 1, 1);
        Console.WriteLine((day == null) + " " + (span?.Days ?? -1) + " " + (when ?? new DateTime(2000, 2, 3)).Month + " " + (lead.Bonus > 1000) + " " + (dev.Bonus > 1000) + " " + (dev.Bonus <= 1000) + " " + lead.Bonus?.ToString("0.0"));
    }
}
