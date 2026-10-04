using System;
using System.Collections.Generic;

// Reduced from stress-iterators/paged-reader-finally: a conditional expression or a switch expression without a
// natural type as an element of a tuple literal takes its type from the tuple type the literal is converted to.
public static class Program
{
    private static (int[] Items, int? Next) Fetch(int page, int count)
    {
        int[] slice = new int[count];
        return (slice, (page + 1) * 3 < 7 ? page + 1 : null);
    }

    private static (string Name, long? Size, object Extra) Describe(int kind)
    {
        return (kind > 0 ? "positive" : null, kind switch { 0 => null, 1 => 1, _ => kind * 10L }, kind == 2 ? new List<int> { kind } : "none");
    }

    private static (int? A, (double? B, string C) Inner) Nested(bool flag) => (flag ? 1 : default, (flag ? null : 2.5, flag ? "yes" : null));

    public static void Main()
    {
        for (int page = 0; page < 3; page++)
        {
            (int[] items, int? next) = Fetch(page, page + 1);
            Console.WriteLine(items.Length + " next=" + (next.HasValue ? next.Value.ToString() : "none"));
        }
        for (int kind = 0; kind < 3; kind++)
        {
            var described = Describe(kind);
            Console.WriteLine((described.Name ?? "null") + " " + (described.Size?.ToString() ?? "null") + " " + described.Extra.GetType().Name);
        }
        var on = Nested(true);
        var off = Nested(false);
        Console.WriteLine(on.A + "|" + on.Inner.B + "|" + on.Inner.C + "|" + off.A + "|" + off.Inner.B + "|" + (off.Inner.C ?? "null"));
        (int? Left, string Right) local = (two() > 1 ? 5 : null, null);
        Console.WriteLine(local.Left + " " + (local.Right == null));
        static int two() => 2;
    }
}
