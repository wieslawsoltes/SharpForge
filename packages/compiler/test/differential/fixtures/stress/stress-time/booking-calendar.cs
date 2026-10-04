using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;

public sealed class Booking
{
    public string Guest { get; init; }
    public DateOnly CheckIn { get; init; }
    public DateOnly CheckOut { get; init; }
    public DateTime? ConfirmedUtc { get; set; }
    public int Nights => CheckOut.DayNumber - CheckIn.DayNumber;
    public bool Overlaps(Booking other) => CheckIn < other.CheckOut && other.CheckIn < CheckOut;
    public IEnumerable<DateOnly> NightDates()
    {
        for (var night = CheckIn; night < CheckOut; night = night.AddDays(1)) yield return night;
    }
    public override string ToString() =>
        Guest + " " + CheckIn.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) + ".." + CheckOut.ToString("MM-dd", CultureInfo.InvariantCulture) + " (" + Nights + "n)";
}

public static class BusinessCalendar
{
    private static readonly HashSet<DateOnly> Holidays = new HashSet<DateOnly>
    {
        new DateOnly(2024, 1, 1), new DateOnly(2024, 3, 29), new DateOnly(2024, 12, 25), new DateOnly(2024, 12, 26), new DateOnly(2025, 1, 1),
    };

    public static bool IsWeekend(DateOnly day) => day.DayOfWeek is DayOfWeek.Saturday or DayOfWeek.Sunday;
    public static bool IsHoliday(DateOnly day) => Holidays.Contains(day);
    public static bool IsBusinessDay(DateOnly day) => !IsWeekend(day) && !IsHoliday(day);

    public static int BusinessDaysBetween(DateOnly from, DateOnly to)
    {
        int count = 0;
        for (var day = from; day < to; day = day.AddDays(1)) if (IsBusinessDay(day)) count++;
        return count;
    }

    public static DateOnly AddBusinessDays(DateOnly start, int days)
    {
        int step = Math.Sign(days);
        var current = start;
        for (int left = Math.Abs(days); left > 0;)
        {
            current = current.AddDays(step);
            if (IsBusinessDay(current)) left--;
        }
        return current;
    }

    public static DateOnly LastBusinessDayOfMonth(int year, int month)
    {
        var day = new DateOnly(year, month, DateTime.DaysInMonth(year, month));
        while (!IsBusinessDay(day)) day = day.AddDays(-1);
        return day;
    }

    public static DateOnly NextWeekday(DateOnly from, DayOfWeek target) => from.AddDays(((int)target - (int)from.DayOfWeek + 7) % 7);
}

public static class Program
{
    private static readonly CultureInfo Inv = CultureInfo.InvariantCulture;
    private static string D(DateOnly d) => d.ToString("yyyy-MM-dd", Inv);
    private static string D(DateTime d) => d.ToString("yyyy-MM-dd", Inv);

    private static decimal Price(Booking booking)
    {
        decimal total = 0m;
        foreach (var night in booking.NightDates())
        {
            decimal rate = night.DayOfWeek is DayOfWeek.Friday or DayOfWeek.Saturday ? 150m : 120m;
            if (BusinessCalendar.IsHoliday(night)) rate *= 1.25m;
            total += rate;
        }
        return booking.Nights >= 7 ? Math.Round(total * 0.9m, 2) : total;
    }

    public static void Main()
    {
        string[] raw =
        {
            "Ines|2024-02-27|2024-03-02|2024-01-15 09:30:00", "Omar|2024-03-01|2024-03-04|",
            "Lena|2024-12-23|2025-01-02|2024-11-30 23:59:59", "Kofi|2024-02-28|2024-02-29|2024-02-28 07:05:00",
            "Bad|2023-02-29|2023-03-01|", "Worse|2024-13-01|2024-13-02|",
        };
        var bookings = new List<Booking>();
        foreach (var line in raw)
        {
            var parts = line.Split('|');
            if (!DateOnly.TryParseExact(parts[1], "yyyy-MM-dd", Inv, DateTimeStyles.None, out var checkIn))
            {
                Console.WriteLine("rejected " + parts[0] + ": " + parts[1]);
                continue;
            }
            var checkOut = DateOnly.ParseExact(parts[2], "yyyy-MM-dd", Inv);
            DateTime? confirmed = parts[3].Length == 0
                ? null
                : DateTime.SpecifyKind(DateTime.ParseExact(parts[3], "yyyy-MM-dd HH:mm:ss", Inv), DateTimeKind.Utc);
            bookings.Add(new Booking { Guest = parts[0], CheckIn = checkIn, CheckOut = checkOut, ConfirmedUtc = confirmed });
        }

        var checkInTime = new TimeOnly(15, 0);
        var checkOutTime = new TimeOnly(11, 0);
        foreach (var b in bookings.OrderBy(x => x.CheckIn).ThenBy(x => x.Guest))
        {
            DateTime arrive = b.CheckIn.ToDateTime(checkInTime), leave = b.CheckOut.ToDateTime(checkOutTime);
            TimeSpan stay = leave - arrive;
            string confirmed = b.ConfirmedUtc.HasValue ? b.ConfirmedUtc.Value.ToString("o", Inv) : "pending";
            int? lead = b.ConfirmedUtc is DateTime c ? (int)(arrive - c).TotalDays : null;
            Console.WriteLine(b + " " + b.CheckIn.DayOfWeek + "->" + b.CheckOut.DayOfWeek + " doy=" + b.CheckIn.DayOfYear
                + " stay=" + stay.ToString("c", Inv) + " hours=" + stay.TotalHours.ToString("0.#", Inv)
                + " price=" + Price(b).ToString("0.00", Inv) + " confirmed=" + confirmed + " lead=" + (lead?.ToString() ?? "-"));
        }

        for (int i = 0; i < bookings.Count; i++)
            for (int j = i + 1; j < bookings.Count; j++)
                if (bookings[i].Overlaps(bookings[j])) Console.WriteLine("overlap: " + bookings[i].Guest + " & " + bookings[j].Guest);

        var nightsByMonth = bookings.SelectMany(b => b.NightDates().Select(n => (b.Guest, Night: n)))
            .GroupBy(x => x.Night.ToString("yyyy-MM", Inv)).OrderBy(g => g.Key);
        foreach (var g in nightsByMonth)
            Console.WriteLine(g.Key + ": " + g.Count() + " nights, guests=" + string.Join(",", g.Select(x => x.Guest).Distinct().OrderBy(x => x))
                + ", weekend=" + g.Count(x => BusinessCalendar.IsWeekend(x.Night)));

        var cutoff = new DateTime(2024, 2, 1, 0, 0, 0, DateTimeKind.Utc);
        Console.WriteLine("confirmed before cutoff: " + bookings.Count(b => b.ConfirmedUtc < cutoff) + ", after: " + bookings.Count(b => b.ConfirmedUtc >= cutoff)
            + ", unknown: " + bookings.Count(b => b.ConfirmedUtc == null) + ", latest: " + bookings.Max(b => b.ConfirmedUtc)?.ToString("yyyy-MM-dd HH:mm:ss", Inv));

        var start = new DateOnly(2024, 3, 27);
        Console.WriteLine("business days 03-27..04-03: " + BusinessCalendar.BusinessDaysBetween(start, new DateOnly(2024, 4, 3))
            + ", +3bd=" + D(BusinessCalendar.AddBusinessDays(start, 3)) + ", -5bd=" + D(BusinessCalendar.AddBusinessDays(start, -5))
            + ", +250bd=" + D(BusinessCalendar.AddBusinessDays(new DateOnly(2024, 1, 1), 250)));
        Console.WriteLine("last business days: " + string.Join(" ", new[] { 2, 3, 6, 8, 11, 12 }.Select(m => D(BusinessCalendar.LastBusinessDayOfMonth(2024, m)))));
        Console.WriteLine("next weekdays from 2024-02-29: " + string.Join(" ",
            Enum.GetValues<DayOfWeek>().Select(d => d.ToString().Substring(0, 2) + "=" + BusinessCalendar.NextWeekday(new DateOnly(2024, 2, 29), d).ToString("MM-dd", Inv))));

        var jan31 = new DateTime(2024, 1, 31);
        var leapDay = new DateTime(2024, 2, 29);
        Console.WriteLine("month ends: " + D(jan31.AddMonths(1)) + " " + D(jan31.AddMonths(1).AddMonths(1)) + " " + D(jan31.AddMonths(2)) + " " + D(jan31.AddMonths(13))
            + " " + D(jan31.AddMonths(-2)) + " | leap: " + D(leapDay.AddYears(1)) + " " + D(leapDay.AddYears(4)) + " " + D(leapDay.AddYears(-124)) + " " + D(leapDay.AddDays(366)));
        Console.WriteLine("leap years: " + string.Join(",", new[] { 1900, 2000, 2023, 2024, 2100, 2400 }.Where(DateTime.IsLeapYear))
            + " | feb days: " + string.Join(",", new[] { 1900, 2000, 2023, 2024 }.Select(y => DateTime.DaysInMonth(y, 2)))
            + " | 2024 days: " + Enumerable.Range(1, 12).Sum(m => DateTime.DaysInMonth(2024, m)));

        var fromStamp = DateOnly.FromDateTime(new DateTime(2024, 12, 31, 23, 59, 59));
        var late = new TimeOnly(22, 30);
        Console.WriteLine("date only: " + D(fromStamp) + " +1=" + D(fromStamp.AddDays(1)) + " dayNumber diff=" + (fromStamp.DayNumber - new DateOnly(2024, 1, 1).DayNumber)
            + " | time only: " + late.AddHours(3).ToString("HH:mm", Inv) + " " + (checkOutTime - late).ToString("hh\\:mm", Inv)
            + " " + late.IsBetween(checkInTime, checkOutTime) + " " + new TimeOnly(12, 0).IsBetween(checkInTime, checkOutTime) + " " + (checkInTime > checkOutTime));
    }
}
