// Authored BCL behaviour cases; common.cs supplies culture and canonical result capture.
static partial class Oracle
{
    public static void Main()
    {
        Begin("time");
        Case("time-leap-day", () => new DateTime(2024, 2, 29, 13, 14, 15, DateTimeKind.Utc).ToString("O", CultureInfo.InvariantCulture));
        Case("time-leap-century", () => DateTime.IsLeapYear(2000));
        Case("time-common-century", () => DateTime.IsLeapYear(1900));
        Case("time-february-leap-days", () => DateTime.DaysInMonth(2024, 2));
        Case("time-february-common-days", () => DateTime.DaysInMonth(2023, 2));
        Case("time-invalid-month", () => new DateTime(2024, 13, 1));
        Case("time-invalid-leap-day", () => new DateTime(2023, 2, 29));
        Case("time-add-day-leap", () => new DateTime(2024, 2, 28).AddDays(1).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture));
        Case("time-add-day-year", () => new DateTime(2023, 12, 31).AddDays(1).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture));
        Case("time-add-month-clamps-day", () => new DateTime(2024, 1, 31).AddMonths(1).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture));
        Case("time-add-year-clamps-leap", () => new DateTime(2024, 2, 29).AddYears(1).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture));
        Case("time-max-add-tick", () => DateTime.MaxValue.AddTicks(1));
        Case("time-min-subtract-tick", () => DateTime.MinValue.AddTicks(-1));
        Case("time-parse-roundtrip-kind", () => DateTime.ParseExact("2024-01-02T03:04:05.0000000Z", "O", CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind).Kind.ToString());
        Case("time-parse-invalid-date", () => DateTime.ParseExact("2023-02-29", "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None));
        Case("time-compare-dates", () => DateTime.Compare(new DateTime(2024, 1, 1), new DateTime(2024, 1, 2)));
        Case("time-subtract-dates-ticks", () => (new DateTime(2024, 1, 2) - new DateTime(2024, 1, 1)).Ticks);
        Case("time-specify-kind", () => DateTime.SpecifyKind(new DateTime(2024, 1, 2, 3, 4, 5), DateTimeKind.Utc).ToString("O", CultureInfo.InvariantCulture));
        Case("time-offset-preserved", () => new DateTimeOffset(2024, 1, 2, 3, 4, 5, TimeSpan.FromHours(2)).ToString("O", CultureInfo.InvariantCulture));
        Case("time-offset-equal-instants", () => new DateTimeOffset(2024, 1, 2, 3, 4, 5, TimeSpan.FromHours(2)) == new DateTimeOffset(2024, 1, 2, 1, 4, 5, TimeSpan.Zero));
        Case("time-unix-epoch", () => DateTimeOffset.FromUnixTimeSeconds(0).ToString("O", CultureInfo.InvariantCulture));
        Case("time-unix-before-epoch", () => new DateTimeOffset(1969, 12, 31, 23, 59, 59, TimeSpan.Zero).ToUnixTimeSeconds());
        Case("time-offset-conversion", () => new DateTimeOffset(2024, 1, 2, 3, 4, 5, TimeSpan.FromHours(2)).ToOffset(TimeSpan.FromMinutes(-330)).ToString("O", CultureInfo.InvariantCulture));
        Case("time-offset-invalid-range", () => new DateTimeOffset(2024, 1, 2, 3, 4, 5, TimeSpan.FromHours(15)));
        Case("time-span-zero", () => TimeSpan.Zero.ToString("c", CultureInfo.InvariantCulture));
        Case("time-span-components", () => new TimeSpan(1, 2, 3, 4, 5).ToString("c", CultureInfo.InvariantCulture));
        Case("time-span-negative-ticks", () => TimeSpan.FromTicks(-10000001).ToString("c", CultureInfo.InvariantCulture));
        Case("time-span-add", () => new TimeSpan(1, 30, 0).Add(TimeSpan.FromMinutes(45)).ToString("c", CultureInfo.InvariantCulture));
        Case("time-span-subtract", () => TimeSpan.FromHours(2).Subtract(TimeSpan.FromMinutes(30)).Ticks);
        Case("time-span-duration-negative", () => TimeSpan.FromTicks(-12345).Duration().Ticks);
        Case("time-span-duration-min", () => TimeSpan.MinValue.Duration());
        Case("time-span-add-overflow", () => TimeSpan.MaxValue.Add(TimeSpan.FromTicks(1)));
        Case("time-span-parse-exact", () => TimeSpan.ParseExact("1.02:03:04.0050000", "c", CultureInfo.InvariantCulture).Ticks);
        Case("time-span-parse-invalid", () => TimeSpan.Parse("not-a-time", CultureInfo.InvariantCulture));
        Case("time-dateonly-from-datetime", () => DateOnly.FromDateTime(new DateTime(2024, 2, 29, 23, 59, 59, DateTimeKind.Utc)).ToString("O", CultureInfo.InvariantCulture));
        Case("time-dateonly-first-day", () => DateOnly.FromDayNumber(0).ToString("O", CultureInfo.InvariantCulture));
        Case("time-dateonly-overflow", () => DateOnly.MaxValue.AddDays(1));
        Case("time-timeonly-wrap", () => new TimeOnly(23, 30).AddHours(2).ToString("O", CultureInfo.InvariantCulture));
        Case("time-timeonly-invalid-hour", () => new TimeOnly(24, 0));
        Case("time-culture-full-format", () => new DateTime(2024, 12, 31, 13, 14, 15).ToString("f", CultureInfo.CurrentCulture));
    }
}
