using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;

var inv = CultureInfo.InvariantCulture;
string[] punches =
{
    "ada|2024-02-26 08:30|2024-02-26 17:15|00:45",
    "ada|2024-02-27 08:00|2024-02-27 19:30|01:00",
    "ada|2024-02-28 09:00|2024-02-28 17:07|00:30",
    "ada|2024-02-29 22:00|2024-03-01 06:30|00:30",
    "ada|2024-03-03 10:00|2024-03-03 14:00|00:00",
    "bo|2024-02-26 06:00|2024-02-26 14:00|00:30",
    "bo|2024-12-31 20:00|2025-01-01 04:00|00:20",
    "bo|2024-12-30 04:30|2024-12-30 12:52|00:15",
    "cy|2024-03-01 09:00|2024-03-01 08:00|00:00",
    "cy|2024-03-01 9am|2024-03-01 17:00|00:00",
};

var shifts = new List<Shift>();
foreach (var line in punches)
{
    if (Shift.TryParse(line, out var shift, out var error)) shifts.Add(shift);
    else Console.WriteLine("skip [" + line.Substring(0, line.IndexOf('|')) + "]: " + error);
}

string Clock(TimeSpan span) => (span < TimeSpan.Zero ? "-" : "") + ((int)span.Duration().TotalHours).ToString("00", inv) + ":" + span.Duration().Minutes.ToString("00", inv);
string Money(decimal amount) => amount.ToString("0.00", inv);

var standardDay = TimeSpan.FromHours(8);
var quarter = TimeSpan.FromMinutes(15);
var rates = new Dictionary<string, decimal> { ["ada"] = 32.50m, ["bo"] = 27.80m };

foreach (var s in shifts)
{
    TimeSpan rounded = Payroll.RoundTo(s.Worked, quarter);
    TimeSpan overtime = rounded > standardDay ? rounded - standardDay : TimeSpan.Zero;
    Console.WriteLine(s.Worker.PadRight(4) + s.Start.ToString("ddd yyyy-MM-dd HH:mm", inv) + " -> " + s.End.ToString("MM-dd HH:mm", inv)
        + " gross=" + (s.End - s.Start).ToString("hh\\:mm", inv) + " worked=" + s.Worked.ToString("c", inv) + " rounded=" + Clock(rounded)
        + " ot=" + Clock(overtime) + " night=" + Clock(s.NightTime()) + " week=" + ISOWeek.GetYear(s.Start) + "-W" + ISOWeek.GetWeekOfYear(s.Start).ToString("00", inv)
        + (s.Start.Date != s.End.Date ? " overnight" : "") + (s.Start.DayOfWeek == DayOfWeek.Sunday ? " sunday" : ""));
}

foreach (var worker in shifts.GroupBy(s => s.Worker).OrderBy(g => g.Key))
{
    decimal rate = rates[worker.Key];
    decimal pay = 0m;
    TimeSpan total = TimeSpan.Zero, overtimeTotal = TimeSpan.Zero, nightTotal = TimeSpan.Zero;
    foreach (var s in worker)
    {
        TimeSpan rounded = Payroll.RoundTo(s.Worked, quarter);
        TimeSpan overtime = rounded > standardDay ? rounded - standardDay : TimeSpan.Zero;
        TimeSpan regular = rounded - overtime;
        decimal multiplier = s.Start.DayOfWeek == DayOfWeek.Sunday ? 2m : 1m;
        pay += (decimal)regular.TotalHours * rate * multiplier + (decimal)overtime.TotalHours * rate * 1.5m * multiplier
            + (decimal)s.NightTime().TotalMinutes / 60m * rate * 0.25m;
        total += rounded;
        overtimeTotal += overtime;
        nightTotal += s.NightTime();
    }
    int count = worker.Count();
    TimeSpan average = total / count;
    Console.WriteLine(worker.Key + ": shifts=" + count + " total=" + Clock(total) + " (" + total.TotalHours.ToString("0.00", inv) + "h, " + total.Days + "d "
        + total.Hours + "h " + total.Minutes + "m) avg=" + average.ToString("hh\\:mm\\:ss", inv) + " ot=" + Clock(overtimeTotal) + " night=" + Clock(nightTotal)
        + " pay=" + Money(Math.Round(pay, 2, MidpointRounding.ToEven)) + " balance=" + Clock(total - standardDay * count)
        + " ratio=" + (total / (standardDay * count)).ToString("0.000", inv));
    foreach (var week in worker.GroupBy(s => (Year: ISOWeek.GetYear(s.Start), Week: ISOWeek.GetWeekOfYear(s.Start))).OrderBy(g => g.Key))
    {
        TimeSpan weekTotal = week.Aggregate(TimeSpan.Zero, (sum, s) => sum + s.Worked);
        DateTime monday = ISOWeek.ToDateTime(week.Key.Year, week.Key.Week, DayOfWeek.Monday);
        Console.WriteLine("  week " + week.Key.Year + "-W" + week.Key.Week.ToString("00", inv) + " starting " + monday.ToString("yyyy-MM-dd", inv) + ": "
            + weekTotal.ToString("d\\.hh\\:mm", inv) + " first=" + week.Min(s => s.Start).ToString("HH:mm", inv) + " longest=" + Clock(week.Max(s => s.Worked)));
    }
}

var span = new TimeSpan(1, 2, 3, 4, 5);
var negative = -span;
Console.WriteLine("span " + span.ToString("c", inv) + " ticks=" + span.Ticks + " totalSeconds=" + span.TotalSeconds.ToString("0.000", inv)
    + " ms=" + span.Milliseconds + " neg=" + negative.ToString("c", inv) + " negHours=" + negative.Hours + " duration=" + negative.Duration().ToString("g", inv));
Console.WriteLine("scale " + (span * 2).ToString("c", inv) + " " + (span / 4).ToString("c", inv) + " " + (span * 0.5).ToString("c", inv)
    + " " + (TimeSpan.FromDays(1) / TimeSpan.FromMinutes(90)).ToString("0.###", inv) + " " + (0.25 * TimeSpan.FromHours(1)).TotalMinutes.ToString("0", inv));
Console.WriteLine("from " + TimeSpan.FromSeconds(3661).ToString("c", inv) + " " + TimeSpan.FromMinutes(-90).ToString("c", inv) + " " + TimeSpan.FromMilliseconds(1500).ToString("c", inv)
    + " " + TimeSpan.FromTicks(TimeSpan.TicksPerDay + 1).ToString("c", inv) + " " + TimeSpan.FromHours(36.5).ToString("c", inv) + " " + TimeSpan.FromDays(0.5).TotalHours.ToString("0", inv));
Console.WriteLine("compare " + (span > negative) + " " + (span == -negative) + " " + span.CompareTo(TimeSpan.FromDays(2)) + " " + TimeSpan.Compare(quarter, quarter)
    + " " + (TimeSpan.Zero == default(TimeSpan)) + " " + (quarter + quarter == TimeSpan.FromMinutes(30)) + " " + TimeSpan.FromHours(1).Equals(TimeSpan.FromMinutes(60)));
Console.WriteLine("parse " + TimeSpan.ParseExact("07:45", "hh\\:mm", inv).TotalMinutes.ToString("0", inv) + " " + TimeSpan.Parse("1.02:03:04", inv).TotalSeconds.ToString("0", inv)
    + " " + TimeSpan.TryParseExact("25:00", "hh\\:mm", inv, out _) + " " + TimeSpan.TryParseExact("-01:30", "hh\\:mm", inv, TimeSpanStyles.AssumeNegative, out var assumed) + "/" + assumed.TotalMinutes.ToString("0", inv));
Console.WriteLine("round " + string.Join(" ", new[] { 7, 8, 22, 23, 37, 52, 53 }.Select(m => Clock(Payroll.RoundTo(TimeSpan.FromMinutes(m), quarter))))
    + " | " + Clock(Payroll.RoundTo(TimeSpan.FromMinutes(-38), quarter)) + " " + Clock(Payroll.RoundTo(new TimeSpan(0, 7, 30), quarter)));

public sealed record Shift(string Worker, DateTime Start, DateTime End, TimeSpan Break)
{
    public TimeSpan Worked => End - Start - Break;

    public static bool TryParse(string line, out Shift shift, out string error)
    {
        var inv = CultureInfo.InvariantCulture;
        var parts = line.Split('|');
        shift = null;
        error = null;
        if (!DateTime.TryParseExact(parts[1], "yyyy-MM-dd HH:mm", inv, DateTimeStyles.None, out var start)) { error = "bad start '" + parts[1] + "'"; return false; }
        var end = DateTime.ParseExact(parts[2], "yyyy-MM-dd HH:mm", inv);
        var pause = TimeSpan.ParseExact(parts[3], "hh\\:mm", inv);
        if (end <= start) { error = "ends " + (start - end).TotalMinutes.ToString("0", inv) + " minutes before it starts"; return false; }
        shift = new Shift(parts[0], start, end, pause);
        return true;
    }

    public TimeSpan NightTime()
    {
        TimeSpan night = TimeSpan.Zero;
        for (DateTime day = Start.Date.AddDays(-1); day <= End.Date; day = day.AddDays(1))
        {
            DateTime from = day.AddHours(22), to = day.AddDays(1).AddHours(6);
            DateTime lower = Start > from ? Start : from, upper = End < to ? End : to;
            if (upper > lower) night += upper - lower;
        }
        return night;
    }
}

public static class Payroll
{
    public static TimeSpan RoundTo(TimeSpan value, TimeSpan unit) =>
        TimeSpan.FromTicks((long)Math.Round(value.Ticks / (double)unit.Ticks, MidpointRounding.AwayFromZero) * unit.Ticks);
}
