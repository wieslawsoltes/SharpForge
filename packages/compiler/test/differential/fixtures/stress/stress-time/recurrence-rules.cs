using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;

public abstract class Rule
{
    protected Rule(string name) { Name = name; }
    public string Name { get; }
    public HashSet<DateTime> Excluded { get; } = new HashSet<DateTime>();
    protected abstract IEnumerable<DateTime> Candidates(DateTime start);

    public List<DateTime> Expand(DateTime start, DateTime until, int max = 100) =>
        Candidates(start).TakeWhile(d => d <= until).Where(d => d >= start && !Excluded.Contains(d.Date)).Take(max).ToList();
}

public sealed class NthWeekdayRule : Rule
{
    private readonly int nth;
    private readonly DayOfWeek day;
    private readonly int everyMonths;
    public NthWeekdayRule(string name, int nth, DayOfWeek day, int everyMonths = 1) : base(name) { this.nth = nth; this.day = day; this.everyMonths = everyMonths; }

    public static DateTime? Find(int year, int month, int nth, DayOfWeek day, TimeSpan timeOfDay)
    {
        int daysInMonth = DateTime.DaysInMonth(year, month);
        if (nth < 0)
        {
            var last = new DateTime(year, month, daysInMonth);
            return last.AddDays(-(((int)last.DayOfWeek - (int)day + 7) % 7)) + timeOfDay;
        }
        var first = new DateTime(year, month, 1);
        int dayOfMonth = 1 + ((int)day - (int)first.DayOfWeek + 7) % 7 + (nth - 1) * 7;
        return dayOfMonth <= daysInMonth ? new DateTime(year, month, dayOfMonth) + timeOfDay : null;
    }

    protected override IEnumerable<DateTime> Candidates(DateTime start)
    {
        for (var month = new DateTime(start.Year, start.Month, 1); ; month = month.AddMonths(everyMonths))
        {
            DateTime? hit = Find(month.Year, month.Month, nth, day, start.TimeOfDay);
            if (hit.HasValue) yield return hit.Value;
        }
    }
}

public sealed class WeeklyRule : Rule
{
    private readonly int everyWeeks;
    private readonly DayOfWeek[] days;
    public WeeklyRule(string name, int everyWeeks, params DayOfWeek[] days) : base(name) { this.everyWeeks = everyWeeks; this.days = days; }

    protected override IEnumerable<DateTime> Candidates(DateTime start)
    {
        DateTime monday = start.AddDays(-(((int)start.DayOfWeek + 6) % 7));
        for (; ; monday = monday.AddDays(7 * everyWeeks))
            foreach (var d in days.OrderBy(d => ((int)d + 6) % 7))
                yield return monday.AddDays(((int)d + 6) % 7);
    }
}

public sealed class MonthlyDayRule : Rule
{
    private readonly int day;
    private readonly bool clamp;
    public MonthlyDayRule(string name, int day, bool clamp) : base(name) { this.day = day; this.clamp = clamp; }

    protected override IEnumerable<DateTime> Candidates(DateTime start)
    {
        for (int i = 0; ; i++)
        {
            DateTime month = new DateTime(start.Year, start.Month, 1).AddMonths(i);
            int days = DateTime.DaysInMonth(month.Year, month.Month);
            if (day <= days) yield return month.AddDays(day - 1) + start.TimeOfDay;
            else if (clamp) yield return month.AddDays(days - 1) + start.TimeOfDay;
        }
    }
}

public sealed class YearlyRule : Rule
{
    private readonly int month, day;
    public YearlyRule(string name, int month, int day) : base(name) { this.month = month; this.day = day; }

    protected override IEnumerable<DateTime> Candidates(DateTime start)
    {
        for (int year = start.Year; ; year++)
            if (day <= DateTime.DaysInMonth(year, month)) yield return new DateTime(year, month, day) + start.TimeOfDay;
    }
}

public static class Program
{
    private static readonly CultureInfo Inv = CultureInfo.InvariantCulture;
    private static string Short(DateTime d) => d.ToString(d.TimeOfDay == TimeSpan.Zero ? "yyyy-MM-dd" : "yyyy-MM-dd HH:mm", Inv);
    private static void Show(Rule rule, List<DateTime> dates) =>
        Console.WriteLine(rule.Name + " [" + dates.Count + "]: " + string.Join(", ", dates.Select(d => d.ToString("ddd ", Inv) + Short(d))));

    public static void Main()
    {
        var start = new DateTime(2024, 1, 10, 9, 30, 0);
        var until = new DateTime(2024, 6, 30, 23, 59, 59);

        var patch = new NthWeekdayRule("2nd Tuesday", 2, DayOfWeek.Tuesday);
        Show(patch, patch.Expand(start, until));
        var fifth = new NthWeekdayRule("5th Friday", 5, DayOfWeek.Friday);
        Show(fifth, fifth.Expand(start.Date, new DateTime(2024, 12, 31)));
        var lastFriday = new NthWeekdayRule("last Friday quarterly", -1, DayOfWeek.Friday, 3);
        lastFriday.Excluded.Add(new DateTime(2024, 7, 26));
        Show(lastFriday, lastFriday.Expand(start.Date, new DateTime(2025, 4, 30)));

        var standup = new WeeklyRule("biweekly Mon/Thu/Sun", 2, DayOfWeek.Thursday, DayOfWeek.Sunday, DayOfWeek.Monday);
        standup.Excluded.Add(new DateTime(2024, 1, 22));
        Show(standup, standup.Expand(start, new DateTime(2024, 2, 20), 8));

        var skip31 = new MonthlyDayRule("31st (skip)", 31, clamp: false);
        var clamp31 = new MonthlyDayRule("31st (clamp)", 31, clamp: true);
        Show(skip31, skip31.Expand(start.Date, until));
        Show(clamp31, clamp31.Expand(start.Date, until));
        var leap = new YearlyRule("leap day", 2, 29);
        var leaps = leap.Expand(new DateTime(2095, 1, 1), new DateTime(2110, 1, 1));
        Show(leap, leaps);
        Console.WriteLine("leap gaps (days): " + string.Join(",", leaps.Zip(leaps.Skip(1), (a, b) => (b - a).Days))
            + " | ticks/day check: " + ((leaps[1] - leaps[0]).Ticks / TimeSpan.TicksPerDay) + " | day of year: " + string.Join(",", leaps.Select(d => d.DayOfYear)));

        var all = new Rule[] { patch, standup, clamp31 }.SelectMany(r => r.Expand(start, new DateTime(2024, 3, 31, 23, 0, 0), 12).Select(d => (Rule: r.Name, Date: d))).ToList();
        foreach (var month in all.GroupBy(x => new DateTime(x.Date.Year, x.Date.Month, 1)).OrderBy(g => g.Key))
            Console.WriteLine(month.Key.ToString("MMM yyyy", Inv) + ": " + month.Count() + " events, first " + Short(month.Min(x => x.Date)) + ", last " + Short(month.Max(x => x.Date))
                + ", busiest " + month.GroupBy(x => x.Date.DayOfWeek).OrderByDescending(g => g.Count()).ThenBy(g => g.Key).First().Key);
        var sameDay = all.GroupBy(x => x.Date.Date).Where(g => g.Count() > 1).Select(g => Short(g.Key) + "(" + string.Join("+", g.Select(x => x.Rule).OrderBy(n => n, StringComparer.Ordinal)) + ")");
        Console.WriteLine("collisions: " + string.Join("; ", sameDay.DefaultIfEmpty("none")));

        var kickoff = new DateTimeOffset(2024, 3, 28, 9, 0, 0, TimeSpan.FromHours(1));
        var offsets = new (string City, TimeSpan Offset)[] { ("Lima", TimeSpan.FromHours(-5)), ("Delhi", new TimeSpan(5, 30, 0)), ("Tokyo", TimeSpan.FromHours(9)), ("Apia", TimeSpan.FromHours(13)) };
        for (int week = 0; week < 2; week++)
        {
            DateTimeOffset meeting = kickoff.AddDays(7 * week);
            Console.WriteLine("meeting " + meeting.ToString("yyyy-MM-dd HH:mm zzz", Inv) + " utc=" + meeting.UtcDateTime.ToString("o", Inv) + " kind=" + meeting.UtcDateTime.Kind
                + " unix=" + meeting.ToUnixTimeSeconds());
            Console.WriteLine("  " + string.Join(" | ", offsets.Select(o => o.City + " " + meeting.ToOffset(o.Offset).ToString("ddd HH:mm zzz", Inv))));
        }
        var sameInstant = new DateTimeOffset(2024, 3, 28, 17, 0, 0, TimeSpan.FromHours(9));
        Console.WriteLine("instants: " + (kickoff == sameInstant) + " " + kickoff.EqualsExact(sameInstant) + " " + (kickoff.DateTime == sameInstant.DateTime)
            + " " + (sameInstant - kickoff).Ticks + " " + (kickoff.AddMonths(11) - kickoff).TotalDays.ToString("0", Inv) + " " + kickoff.CompareTo(sameInstant.AddTicks(1))
            + " " + DateTimeOffset.FromUnixTimeSeconds(1_709_164_800).ToString("o", Inv) + " " + DateTimeOffset.ParseExact("2024-02-29T23:15:00-08:00", "yyyy-MM-ddTHH:mm:sszzz", Inv).UtcDateTime.ToString("yyyy-MM-dd HH:mm", Inv));

        var utc = new DateTime(2024, 2, 29, 12, 0, 0, DateTimeKind.Utc);
        var plain = new DateTime(2024, 2, 29, 12, 0, 0);
        Console.WriteLine("kinds: " + utc.Kind + "/" + plain.Kind + " equal=" + (utc == plain) + " o=" + utc.ToString("o", Inv) + " vs " + plain.ToString("o", Inv)
            + " ticks%day=" + (utc.Ticks % TimeSpan.TicksPerDay) + " epochDays=" + (utc - DateTime.UnixEpoch).Days + " roundtrip=" + DateTime.ParseExact("2024-02-29T12:00:00.0000000Z", "o", Inv, DateTimeStyles.RoundtripKind).Kind);
    }
}
