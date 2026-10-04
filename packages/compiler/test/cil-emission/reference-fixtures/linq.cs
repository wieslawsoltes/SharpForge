using System;
using System.Collections.Generic;
using System.Linq;

class Person
{
    public string Name;
    public int Age;
    public string City;
}

class Program
{
    static void Main()
    {
        var numbers = new List<int> { 5, 3, 8, 1, 4, 8 };
        int[] array = { 10, 20, 30 };

        Console.WriteLine(numbers.Where(n => n % 2 == 0).Sum());
        Console.WriteLine(string.Join(",", numbers.Select(n => n * 2)));
        Console.WriteLine(numbers.Count(n => n > 3));
        Console.WriteLine(numbers.Count);
        Console.WriteLine(numbers.Any(n => n > 7) && numbers.All(n => n > 0));
        Console.WriteLine(numbers.First(n => n > 5) + numbers.Last());
        Console.WriteLine(numbers.FirstOrDefault(n => n > 100));
        Console.WriteLine(numbers.Max() - numbers.Min());
        Console.WriteLine(numbers.Average());
        Console.WriteLine(string.Join(",", numbers.Distinct().OrderByDescending(n => n).Take(3)));
        Console.WriteLine(string.Join(",", numbers.Skip(2).Reverse()));
        Console.WriteLine(numbers.Aggregate(0, (total, n) => total + n));
        Console.WriteLine(numbers.Contains(8));
        Console.WriteLine(array.Select((value, index) => value * index).Sum());
        Console.WriteLine(array.Concat(numbers).Count());
        Console.WriteLine(array.Zip(numbers, (a, b) => a + b).ToArray().Length);
        Console.WriteLine(string.Join(",", Enumerable.Range(1, 5).Select(n => n * n)));
        Console.WriteLine(Enumerable.Repeat("ab", 3).Aggregate((a, b) => a + b));
        Console.WriteLine(array.ToList().IndexOf(20));
        Console.WriteLine(array.SequenceEqual(new[] { 10, 20, 30 }));

        var people = new[]
        {
            new Person { Name = "Ann", Age = 31, City = "Oslo" },
            new Person { Name = "Bob", Age = 27, City = "Rome" },
            new Person { Name = "Cy", Age = 45, City = "Oslo" },
        };
        foreach (var group in people.GroupBy(p => p.City).OrderBy(g => g.Key))
            Console.WriteLine(group.Key + ": " + string.Join("+", group.Select(p => p.Name)) + " " + group.Sum(p => p.Age));
        var byName = people.ToDictionary(p => p.Name, p => p.Age);
        Console.WriteLine(byName["Bob"]);
        Console.WriteLine(people.OrderBy(p => p.Age).ThenBy(p => p.Name).First().Name);
        Console.WriteLine(people.Single(p => p.Age > 40).Name);
        Console.WriteLine(people.SelectMany(p => p.Name).Count(c => c == 'n'));

        var query = from p in people
                    where p.Age > 30
                    orderby p.Name descending
                    select p.Name + "@" + p.City;
        foreach (var line in query) Console.WriteLine(line);

        var pairs = from n in numbers
                    join a in array on n * 10 equals a
                    select n + a;
        Console.WriteLine(string.Join(",", pairs));

        IEnumerable<object> objects = people;
        Console.WriteLine(objects.OfType<Person>().Count());
        Console.WriteLine(new object[] { 1, "x", 2 }.OfType<int>().Sum());
        IEnumerable<int> lazy = numbers;
        IReadOnlyList<int> fixedList = numbers;
        ICollection<int> collection = numbers;
        Console.WriteLine(lazy.Count() + fixedList[0] + collection.Count);
    }
}
