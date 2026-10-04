using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;

public sealed record Department(int Id, string Name, int? ParentId);
public sealed record Employee(int Id, string Name, int DepartmentId, decimal Salary, DateTime Hired, string[] Skills);
public sealed record Project(string Code, int LeadId, int[] MemberIds, double Budget);

public static class Program
{
    private static readonly Department[] departments =
    {
        new(1, "Engineering", null), new(2, "Compilers", 1), new(3, "Runtime", 1), new(4, "Sales", null), new(5, "Empty", 4),
    };

    private static readonly Employee[] employees =
    {
        new(1, "Ada", 2, 9200m, new DateTime(2015, 3, 1), new[] { "c#", "parsing", "il" }),
        new(2, "Grace", 2, 8700m, new DateTime(2018, 7, 15), new[] { "cobol", "parsing" }),
        new(3, "Linus", 3, 9900m, new DateTime(2012, 1, 20), new[] { "c", "gc", "il" }),
        new(4, "Ken", 3, 7600m, new DateTime(2021, 11, 2), new[] { "c", "go" }),
        new(5, "Barbara", 1, 11000m, new DateTime(2010, 5, 5), new[] { "clu", "management" }),
        new(6, "Dale", 4, 5400m, new DateTime(2019, 9, 9), new string[0]),
        new(7, "Zig", 4, 5400m, new DateTime(2022, 2, 2), new[] { "closing" }),
    };

    private static readonly Project[] projects =
    {
        new("SF", 1, new[] { 1, 2, 3 }, 120_000), new("GC", 3, new[] { 3, 4 }, 80_000.5), new("CRM", 6, new[] { 6, 7, 5 }, 40_000), new("IDLE", 99, new int[0], 0),
    };

    private static string Money(decimal value) => value.ToString("#,0.00", CultureInfo.InvariantCulture);

    public static void Main()
    {
        var bySalary = from e in employees
                       join d in departments on e.DepartmentId equals d.Id
                       orderby e.Salary descending, e.Name
                       select new { e.Name, Department = d.Name, e.Salary };
        foreach (var row in bySalary.Take(4)) Console.WriteLine($"{row.Name,-8}{row.Department,-12}{Money(row.Salary),10}");

        var totals = from d in departments
                     join e in employees on d.Id equals e.DepartmentId into staff
                     let total = staff.Sum(s => s.Salary)
                     where staff.Any() || d.ParentId != null
                     orderby total descending
                     select (d.Name, Count: staff.Count(), Total: total, Average: staff.Select(s => s.Salary).DefaultIfEmpty().Average());
        foreach (var (name, count, total, average) in totals) Console.WriteLine($"{name}: {count} people, {Money(total)} total, {Money(average)} average");

        var hierarchy = from child in departments
                        join parent in departments on child.ParentId equals parent.Id into parents
                        from parent in parents.DefaultIfEmpty()
                        select child.Name + " <- " + (parent?.Name ?? "(root)");
        Console.WriteLine(string.Join("; ", hierarchy));

        var skills = from e in employees
                     from skill in e.Skills
                     group e.Name by skill into g
                     where g.Count() > 1
                     orderby g.Count() descending, g.Key
                     select g.Key + "(" + string.Join("+", g.OrderBy(n => n)) + ")";
        Console.WriteLine(string.Join(" ", skills));

        var decades = employees.GroupBy(e => e.Hired.Year / 10 * 10, e => e, (decade, hires) => new { decade, Names = hires.OrderBy(h => h.Hired).Select(h => h.Name).ToList() }).OrderBy(g => g.decade);
        Console.WriteLine(string.Join(" ", decades.Select(g => g.decade + "s:" + string.Join(",", g.Names))));

        var staffing = from p in projects
                       let lead = employees.SingleOrDefault(e => e.Id == p.LeadId)
                       let members = (from id in p.MemberIds join e in employees on id equals e.Id select e).ToList()
                       select new
                       {
                           p.Code,
                           Lead = lead?.Name ?? "nobody",
                           Cost = members.Sum(m => m.Salary),
                           PerHead = members.Count == 0 ? double.NaN : p.Budget / members.Count,
                           Departments = members.Select(m => m.DepartmentId).Distinct().Count(),
                       };
        foreach (var s in staffing) Console.WriteLine($"{s.Code,-5}{s.Lead,-8}{Money(s.Cost),10} {s.PerHead.ToString("F1", CultureInfo.InvariantCulture),9} {s.Departments}");

        var pairs = from a in employees
                    from b in employees
                    where a.Id < b.Id && a.Skills.Intersect(b.Skills).Any()
                    select $"{a.Name}&{b.Name}:{string.Join("/", a.Skills.Intersect(b.Skills))}";
        Console.WriteLine(string.Join(" ", pairs));

        var statistics = employees.Aggregate(
            (Min: decimal.MaxValue, Max: decimal.MinValue, Sum: 0m, Count: 0),
            (acc, e) => (Math.Min(acc.Min, e.Salary), Math.Max(acc.Max, e.Salary), acc.Sum + e.Salary, acc.Count + 1));
        var median = employees.Select(e => e.Salary).OrderBy(s => s).Skip(employees.Length / 2).First();
        Console.WriteLine($"{Money(statistics.Min)} {Money(statistics.Max)} {Money(statistics.Sum / statistics.Count)} {Money(median)}");
        Console.WriteLine(string.Join(" ", employees.OrderBy(e => e.Skills.Length).ThenByDescending(e => e.Name).Select(e => e.Name[0])) + " "
            + employees.ToLookup(e => e.Salary >= 9000)[true].Count() + " "
            + employees.Select(e => e.Hired.DayOfWeek).Distinct().Count() + " "
            + employees.MaxBy(e => e.Hired).Name + " " + employees.MinBy(e => e.Salary).Name + " "
            + employees.Chunk(3).Select(chunk => chunk.Length).Aggregate("", (t, n) => t + n) + " "
            + string.Join("", employees.Select(e => e.DepartmentId).Except(new[] { 1, 4 }).Union(new[] { 9 }).OrderByDescending(x => x)) + " "
            + employees.Zip(projects, (e, p) => e.Name[0] + p.Code).Last() + " "
            + employees.TakeLast(2).First().Name + employees.SkipLast(6).Single().Name + employees.ElementAt(^2).Name + " "
            + employees.DistinctBy(e => e.DepartmentId).Count() + employees.CountBy(e => e.DepartmentId).Max(pair => pair.Value));
    }
}
