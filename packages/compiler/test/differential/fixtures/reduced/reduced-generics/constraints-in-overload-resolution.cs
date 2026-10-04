using System;
using System.Collections.Generic;
using System.Linq;
using System.Numerics;

// Reduced from stress-linq/set-operations-comparers and stress-formatting/number-format-conformance: a generic
// candidate whose inferred type arguments violate its constraints is not a candidate (C# 7.3), so `array.Contains(x)`
// over a type that is not IEquatable<T> is the LINQ method and not the span extension; and `nint` satisfies
// `INumber<T>` through the interfaces of IntPtr.
public sealed class Contact
{
    public string Name;
    public string Email;
}

public sealed class EmailComparer : IEqualityComparer<Contact>
{
    public bool Equals(Contact x, Contact y) => string.Equals(x.Email, y.Email, StringComparison.OrdinalIgnoreCase);
    public int GetHashCode(Contact contact) => contact.Email.ToUpperInvariant().GetHashCode();
}

public static class Program
{
    private static string Kind<T>(T value) where T : struct, IComparable<T> => "comparable " + value;
    private static string Kind<T>(T value, int unused = 0) where T : class => "reference " + value;

    private static string RoundTrip<T>(T value) where T : INumber<T> => T.Parse(value.ToString(), null) == value ? value + " ok" : value + " changed";

    private static T Twice<T>(T value) where T : IAdditionOperators<T, T, T> => value + value;

    public static void Main()
    {
        var ada = new Contact { Name = "Ada", Email = "ada@example.org" };
        var crm = new[] { ada, new Contact { Name = "Bob", Email = "bob@example.org" } };
        var probe = new Contact { Name = "A.", Email = "ADA@example.org" };
        Console.WriteLine(crm.Contains(ada) + " " + crm.Contains(probe) + " " + crm.Contains(probe, new EmailComparer()));
        int[] numbers = { 1, 2, 3 };
        Console.WriteLine(numbers.Contains(2) + " " + new[] { "a", "b" }.Contains("c"));
        Console.WriteLine(Kind(5) + ", " + Kind("text") + ", " + Kind(2.5));
        Console.WriteLine(RoundTrip((nint)(-7)) + ", " + RoundTrip((nuint)9) + ", " + RoundTrip(12L) + ", " + Twice((nint)21));
    }
}
