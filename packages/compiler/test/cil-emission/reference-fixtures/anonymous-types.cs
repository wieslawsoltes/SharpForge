using System;
using System.Collections.Generic;
using System.Linq;

// Anonymous types as real generic classes: construction, member reads, value equality and hashing (dictionary and
// GroupBy keys), ToString, unification by member names and types, projections in LINQ, what reflection sees, and
// anonymous types over the type parameters of generic methods and classes (also in lambdas and iterators).

class Person
{
    public string Name;
    public int Age;
    public string City { get; set; }
}

class Box<U>
{
    public U Held;
    public string Describe<T>(T extra)
    {
        var pair = new { Held, extra };
        Func<string> text = () => new { pair, Again = extra }.ToString() + pair.extra;
        return text();
    }
}

static class Program
{
    static int calls;
    static int Next() { return ++calls; }

    static void Basics()
    {
        var point = new { X = 1, Y = 2 };
        var same = new { X = 1, Y = 2 };
        var other = new { X = 1, Y = 3 };
        var swapped = new { Y = 2, X = 1 };
        Console.WriteLine(point + " " + point.X + point.Y);
        Console.WriteLine(point.Equals(same) + " " + point.Equals(other) + " " + point.Equals(swapped) + " " + point.Equals(null) + " " + (point == same));
        Console.WriteLine((point.GetHashCode() == same.GetHashCode()) + " " + (point.GetType() == same.GetType()) + " " + (point.GetType() == swapped.GetType()));
        point = same;
        Console.WriteLine(point == same);
        var order = new { First = Next(), Second = Next(), Third = Next() };
        Console.WriteLine(order);
    }

    static void Shapes()
    {
        var person = new Person { Name = "Ann", Age = 30, City = null };
        int local = 7;
        var projected = new { person.Name, person.Age, person.City, local };
        Console.WriteLine(projected);
        var nested = new { Inner = new { Value = 1.5 }, Items = new[] { 1, 2 }, Flag = true, Letter = 'c', Nothing = (string)null };
        Console.WriteLine(nested.Inner.Value + " " + nested.Items.Length + " " + nested.Inner + " " + nested.Nothing);
        Console.WriteLine(new { });
        Console.WriteLine(new { }.Equals(new { }));
        var wide = new { A = 1, B = 2L, C = "three", D = 4.0, E = 5m, F = (byte)6, G = new DateTime(2020, 1, 2).Year, H = (int?)null };
        Console.WriteLine(wide);
        var mixed = new { Text = "s", Count = 1 };
        var typed = new { Text = (object)"s", Count = 1 };
        Console.WriteLine(mixed.Equals(typed) + " " + (mixed.GetType().GetGenericTypeDefinition() == typed.GetType().GetGenericTypeDefinition()));
    }

    static void Collections()
    {
        var people = new List<Person>
        {
            new Person { Name = "Ann", Age = 30, City = "Oslo" },
            new Person { Name = "Bob", Age = 25, City = "Rome" },
            new Person { Name = "Cid", Age = 30, City = "Oslo" },
        };
        var rows = people.Select(person => new { person.Name, Decade = person.Age / 10 }).ToList();
        Console.WriteLine(string.Join("; ", rows));
        var groups = people.GroupBy(person => new { person.City, person.Age }).Select(group => new { group.Key, Count = group.Count() });
        foreach (var group in groups) Console.WriteLine(group.Key.City + " " + group.Key.Age + " " + group.Count + " " + group);
        var counts = new Dictionary<object, int>();
        foreach (var person in people)
        {
            var key = new { person.City };
            counts[key] = counts.TryGetValue(key, out var seen) ? seen + 1 : 1;
        }
        Console.WriteLine(counts.Count + " " + counts[new { City = "Oslo" }]);
        var query = from person in people
                    let initial = person.Name[0]
                    where person.Age > 26
                    orderby person.Name descending
                    select new { initial, person.City };
        Console.WriteLine(string.Join(" ", query));
        var array = new[] { new { Key = 2 }, new { Key = 1 } };
        Console.WriteLine(array.OrderBy(entry => entry.Key).First().Key + " " + array.Length);
    }

    static void Reflection()
    {
        var value = new { Name = "x", Age = 3 };
        var type = value.GetType();
        Console.WriteLine(type.IsGenericType + " " + type.IsSealed + " " + type.IsNotPublic + " " + type.GetGenericArguments().Length);
        Console.WriteLine(string.Join(",", type.GetProperties().Select(property => property.Name + ":" + property.PropertyType.Name + ":" + property.CanWrite)));
        Console.WriteLine(type.GetProperty("Age").GetValue(value) + " " + type.GetConstructors()[0].GetParameters().Length);
        Func<int, object> make = number => new { Number = number, Twice = number * 2 };
        Console.WriteLine(make(4));
    }

    static string Show<T>(T value) { var pair = new { value, Twice = 2 }; return pair.ToString() + pair.value; }
    static List<string> Project<T>(IEnumerable<T> items)
    {
        return items.Select(item => new { item, Text = item.ToString() }).Where(row => row.Text.Length > 0).Select(row => row.ToString()).ToList();
    }
    static IEnumerable<string> Iterate<T>(T value) { var held = new { value }; yield return held.ToString(); yield return held.value.ToString(); }

    static void Generics()
    {
        Console.WriteLine(Show(3) + " " + Show("s"));
        Console.WriteLine(string.Join("|", Project(new[] { 1, 2 })));
        Console.WriteLine(new Box<int> { Held = 5 }.Describe("e"));
        Console.WriteLine(string.Join("|", Iterate(2.5)));
    }

    static void Main()
    {
        Generics();
        Basics();
        Shapes();
        Collections();
        Reflection();
    }
}
