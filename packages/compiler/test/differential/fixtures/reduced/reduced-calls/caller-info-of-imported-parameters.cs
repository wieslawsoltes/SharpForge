using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.CompilerServices;

// Reduced from stress-exceptions/exception-kinds-interpreter, stress-iterators/number-streams-toolkit and
// stress-iterators/tokenizer-postfix: caller info attributes on the parameters of a referenced assembly.
public static class Program
{
    private static string Try(Action action)
    {
        try
        {
            action();
            return "ok";
        }
        catch (ArgumentException exception)
        {
            return exception.GetType().Name + " param=" + exception.ParamName;
        }
    }

    private static IEnumerable<int> Take(IEnumerable<int> source, int size)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(size);
        return Core();

        IEnumerable<int> Core()
        {
            foreach (int item in source)
            {
                if (size-- <= 0) yield break;
                yield return item;
            }
        }
    }

    private static string Own(object value, [CallerArgumentExpression(nameof(value))] string text = null, [CallerMemberName] string member = null) =>
        member + ":" + text;

    public static void Main()
    {
        string text = null;
        var holder = new { Items = (List<int>)null, Name = "" };
        int count = -3;
        Console.WriteLine(Try(() => ArgumentNullException.ThrowIfNull(text)));
        Console.WriteLine(Try(() => ArgumentNullException.ThrowIfNull(holder.Items)));
        Console.WriteLine(Try(() => ArgumentNullException.ThrowIfNull(text, "explicit")));
        Console.WriteLine(Try(() => ArgumentException.ThrowIfNullOrEmpty(holder.Name)));
        Console.WriteLine(Try(() => ArgumentException.ThrowIfNullOrWhiteSpace(  text  )));
        Console.WriteLine(Try(() => ArgumentOutOfRangeException.ThrowIfNegative(count)));
        Console.WriteLine(Try(() => ArgumentOutOfRangeException.ThrowIfGreaterThan(count + 10, 5)));
        Console.WriteLine(Try(() => ArgumentOutOfRangeException.ThrowIfZero(count * 0)));
        Console.WriteLine(Try(() => Take(null, 1)));
        Console.WriteLine(Try(() => Take(new[] { 1 }, 0)));
        Console.WriteLine(string.Join(",", Take(new[] { 4, 5, 6 }, 2)));
        Console.WriteLine(Own(count + 1) + " " + Own(text, "given"));
        Debug.Assert(count < 0);
    }
}
