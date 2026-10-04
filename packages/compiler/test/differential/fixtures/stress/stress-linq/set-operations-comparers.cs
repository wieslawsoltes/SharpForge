using System;
using System.Collections.Generic;
using System.Linq;

namespace Contacts
{
    public sealed class Contact
    {
        public Contact(string name, string email, string city, int age) { Name = name; Email = email; City = city; Age = age; }
        public string Name { get; }
        public string Email { get; }
        public string City { get; }
        public int Age { get; }
        public override string ToString() => Name;
    }

    // Two contacts are the same person when their e-mail addresses match ignoring case and surrounding spaces.
    public sealed class EmailComparer : IEqualityComparer<Contact>
    {
        public static readonly EmailComparer Instance = new EmailComparer();
        public int EqualsCalls { get; private set; }
        public int HashCalls { get; private set; }
        private static string Normalize(Contact contact) => contact.Email.Trim().ToLowerInvariant();

        public bool Equals(Contact x, Contact y)
        {
            EqualsCalls++;
            if (ReferenceEquals(x, y)) return true;
            if (x is null || y is null) return false;
            return Normalize(x) == Normalize(y);
        }

        public int GetHashCode(Contact obj) { HashCalls++; return obj is null ? 0 : Normalize(obj).Length; }
    }

    public sealed class ModuloComparer : IEqualityComparer<int>
    {
        private readonly int modulus;
        public ModuloComparer(int modulus) { this.modulus = modulus; }
        public bool Equals(int x, int y) => (x - y) % modulus == 0;
        public int GetHashCode(int obj) => ((obj % modulus) + modulus) % modulus;
    }

    public readonly struct Point : IEquatable<Point>
    {
        public Point(int x, int y) { X = x; Y = y; }
        public int X { get; }
        public int Y { get; }
        public bool Equals(Point other) => X == other.X && Y == other.Y;
        public override bool Equals(object obj) => obj is Point other && Equals(other);
        public override int GetHashCode() => X * 31 + Y;
        public override string ToString() => $"({X},{Y})";
    }

    public static class Program
    {
        private static string Show<T>(IEnumerable<T> source) => "[" + string.Join(" ", source) + "]";

        public static void Main()
        {
            var crm = new[]
            {
                new Contact("Ann", "ann@example.org", "Oslo", 31), new Contact("Bo", "BO@example.org", "Rome", 45),
                new Contact("Cy", "cy@example.org", "Oslo", 28), new Contact("Ann2", " Ann@Example.org ", "Bern", 31),
            };
            var newsletter = new[]
            {
                new Contact("Robert", "bo@example.org", "Rome", 45), new Contact("Di", "di@example.org", "Lima", 52),
                new Contact("Cyrus", "CY@EXAMPLE.ORG", "Oslo", 29), new Contact("Ed", "ed@example.org", "Bern", 19),
            };

            Console.WriteLine("-- custom comparer on reference types");
            Console.WriteLine(Show(crm.Distinct()) + " " + Show(crm.Distinct(EmailComparer.Instance)));
            Console.WriteLine(Show(crm.Union(newsletter, EmailComparer.Instance)));
            Console.WriteLine(Show(crm.Intersect(newsletter, EmailComparer.Instance)) + " " + Show(newsletter.Intersect(crm, EmailComparer.Instance)));
            Console.WriteLine(Show(crm.Except(newsletter, EmailComparer.Instance)) + " " + Show(newsletter.Except(crm, EmailComparer.Instance)));
            Console.WriteLine(crm.Contains(newsletter[0]) + " " + crm.Contains(newsletter[0], EmailComparer.Instance) + " " + crm.Contains(null, EmailComparer.Instance));
            Console.WriteLine("comparer was used: " + (EmailComparer.Instance.EqualsCalls > 0 && EmailComparer.Instance.HashCalls > 0));

            Console.WriteLine("-- *By operators");
            Console.WriteLine(Show(crm.Concat(newsletter).DistinctBy(c => c.City)) + " " + Show(crm.Concat(newsletter).DistinctBy(c => c.Age / 10)));
            Console.WriteLine(Show(crm.UnionBy(newsletter, c => c.Email.Trim(), StringComparer.OrdinalIgnoreCase)));
            Console.WriteLine(Show(crm.IntersectBy(newsletter.Select(c => c.City), c => c.City)) + " " + Show(crm.ExceptBy(new[] { "Oslo", "Lima" }, c => c.City)));
            Console.WriteLine(Show(newsletter.ExceptBy(crm.Select(c => c.Age), c => c.Age)) + " " + Show(crm.IntersectBy(new[] { "ROME" }, c => c.City, StringComparer.OrdinalIgnoreCase)));

            Console.WriteLine("-- value types and custom equality");
            int[] left = { 1, 2, 2, 3, 14, 5, 5 }, right = { 5, 3, 3, 8, 13 };
            Console.WriteLine(Show(left.Distinct()) + Show(left.Union(right)) + Show(left.Intersect(right)) + Show(left.Except(right)) + Show(right.Except(left)));
            var mod10 = new ModuloComparer(10);
            Console.WriteLine(Show(left.Distinct(mod10)) + Show(left.Union(right, mod10)) + Show(left.Intersect(right, mod10)) + Show(left.Except(right, mod10)));
            Point[] path = { new Point(0, 0), new Point(1, 0), new Point(1, 1), new Point(1, 0), new Point(0, 0) };
            Console.WriteLine(Show(path.Distinct()) + " revisits=" + (path.Length - path.Distinct().Count()) + " " + Show(path.Except(new[] { new Point(1, 0) })));
            (string, int)[] pairs = { ("a", 1), ("b", 2), ("a", 1), ("a", 2) };
            Console.WriteLine(Show(pairs.Distinct()) + " " + Show(new[] { new { K = 1, V = "x" }, new { K = 1, V = "x" }, new { K = 2, V = "x" } }.Distinct().Select(a => a.K)));
            string[] words = { "Tea", "tea", "TEA", "milk", "Milk" };
            Console.WriteLine(Show(words.Distinct()) + Show(words.Distinct(StringComparer.OrdinalIgnoreCase)) + Show(words.Except(new[] { "MILK" }, StringComparer.OrdinalIgnoreCase)));

            Console.WriteLine("-- ToHashSet / ToDictionary / ToLookup with comparers");
            HashSet<Contact> unique = crm.Concat(newsletter).ToHashSet(EmailComparer.Instance);
            Console.WriteLine(unique.Count + " " + unique.Contains(new Contact("?", "ED@example.org", "", 0)) + " " + unique.Add(new Contact("?", "new@example.org", "", 0)) + " " + unique.Add(crm[3]));
            Dictionary<string, int> ages = crm.DistinctBy(c => c.Name[0]).ToDictionary(c => c.Name, c => c.Age, StringComparer.OrdinalIgnoreCase);
            Console.WriteLine(ages["ANN"] + " " + ages.ContainsKey("cy") + " " + ages.ContainsKey("Ann2") + " " + ages.Count);
            try { crm.ToDictionary(c => c, c => c.Age, EmailComparer.Instance); }
            catch (ArgumentException) { Console.WriteLine("duplicate key under comparer"); }
            ILookup<string, string> byCity = crm.Concat(newsletter).ToLookup(c => c.City, c => c.Name, StringComparer.OrdinalIgnoreCase);
            Console.WriteLine(string.Join(" ", byCity.OrderBy(g => g.Key, StringComparer.Ordinal).Select(g => g.Key + "=" + string.Join("+", g))) + " " + byCity["OSLO"].Count());
            HashSet<int> primes = Enumerable.Range(2, 40).Where(n => Enumerable.Range(2, n - 2).All(d => n % d != 0)).ToHashSet();
            Console.WriteLine(Show(Enumerable.Range(1, 12).Select(n => n * n + 1).Where(primes.Contains)) + " " + primes.Count);

            Console.WriteLine("-- SequenceEqual and set equality");
            Console.WriteLine(left.SequenceEqual(left.ToList()) + " " + left.Distinct().SequenceEqual(new[] { 1, 2, 3, 14, 5 }) + " " + new[] { 11, 22 }.SequenceEqual(new[] { 1, 2 }, mod10)
                + " " + words.Take(3).SequenceEqual(new[] { "TEA", "TEA", "tea" }, StringComparer.OrdinalIgnoreCase) + " " + left.SequenceEqual(left.Append(0)));
            bool sameSet = !left.Except(right).Any() && !right.Except(left).Any();
            Console.WriteLine(sameSet + " " + left.ToHashSet().SetEquals(left.AsEnumerable().Reverse()) + " " + crm.Select(c => c.City).ToHashSet().IsSubsetOf(newsletter.Select(c => c.City).Append("Bern")));
            Console.WriteLine(Show(left.Union(right).Except(left.Intersect(right)).Order()) + " " + Show(crm.Select(c => c.Age).Concat(newsletter.Select(c => c.Age)).Distinct().OrderDescending()));
        }
    }
}
