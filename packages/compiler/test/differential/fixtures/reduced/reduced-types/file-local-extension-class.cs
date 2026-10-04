using System;
using System.Collections.Generic;
using System.Linq;

namespace Metering;

// Reduced from stress-language/static-abstract-partial: extension methods of a `file static class` are in scope in
// their file, as a method group, an invocation and through a generic receiver.
file sealed record Alarm(string Sensor, int Value);

file static class Thresholds
{
    private static readonly int[] Levels = { 10, 50 };
    public static IEnumerable<Alarm> Above(this IEnumerable<Alarm> alarms, int level) => alarms.Where(alarm => alarm.Value >= Levels[level]);
    public static string Describe(this Alarm alarm) => alarm.Sensor + "=" + alarm.Value;
    public static T Largest<T>(this IReadOnlyList<T> items, Func<T, int> key) => items.OrderByDescending(key).First();
}

public static class Program
{
    public static void Main()
    {
        var events = new List<Alarm> { new("door", 5), new("smoke", 60), new("heat", 20) };
        Func<Alarm, string> describe = Thresholds.Describe;
        Console.WriteLine(string.Join(" ", events.Above(0).Select(alarm => alarm.Describe())) + " | " + string.Join(" ", events.Above(1).Select(describe)));
        Console.WriteLine(events.Largest(alarm => alarm.Value).Describe() + " " + events[0].Describe());
    }
}
