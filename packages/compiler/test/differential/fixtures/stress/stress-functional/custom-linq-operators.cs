using System;
using System.Collections;
using System.Collections.Generic;

namespace MiniLinq
{
    public interface IOrdered<T> : IEnumerable<T>
    {
        IOrdered<T> CreateOrdered<TKey>(Func<T, TKey> key, IComparer<TKey> comparer, bool descending);
    }

    internal sealed class Ordered<T> : IOrdered<T>
    {
        private readonly IEnumerable<T> source;
        private readonly Comparison<T> comparison;
        public Ordered(IEnumerable<T> source, Comparison<T> comparison) { this.source = source; this.comparison = comparison; }

        public IOrdered<T> CreateOrdered<TKey>(Func<T, TKey> key, IComparer<TKey> comparer, bool descending)
        {
            Comparison<T> next = (a, b) => descending ? comparer.Compare(key(b), key(a)) : comparer.Compare(key(a), key(b));
            var previous = comparison;
            return new Ordered<T>(source, (a, b) => previous(a, b) is var first && first != 0 ? first : next(a, b));
        }

        public IEnumerator<T> GetEnumerator()
        {
            var items = new List<(T Item, int Index)>();
            foreach (var item in source) items.Add((item, items.Count));
            items.Sort((a, b) => comparison(a.Item, b.Item) is var order && order != 0 ? order : a.Index.CompareTo(b.Index));
            foreach (var (item, _) in items) yield return item;
        }

        IEnumerator IEnumerable.GetEnumerator() => GetEnumerator();
    }

    public sealed class Grouping<TKey, T> : IEnumerable<T>
    {
        private readonly List<T> items = new List<T>();
        public Grouping(TKey key) { Key = key; }
        public TKey Key { get; }
        internal void Add(T item) => items.Add(item);
        public int Count => items.Count;
        public IEnumerator<T> GetEnumerator() => items.GetEnumerator();
        IEnumerator IEnumerable.GetEnumerator() => GetEnumerator();
    }

    public static class Operators
    {
        public static IEnumerable<T> Where<T>(this IEnumerable<T> source, Func<T, bool> predicate)
        {
            foreach (var item in source) if (predicate(item)) yield return item;
        }

        public static IEnumerable<TResult> Select<T, TResult>(this IEnumerable<T> source, Func<T, TResult> selector)
        {
            foreach (var item in source) yield return selector(item);
        }

        public static IEnumerable<TResult> SelectMany<T, TCollection, TResult>(this IEnumerable<T> source, Func<T, IEnumerable<TCollection>> collection, Func<T, TCollection, TResult> result)
        {
            foreach (var outer in source)
                foreach (var inner in collection(outer))
                    yield return result(outer, inner);
        }

        public static IOrdered<T> OrderBy<T, TKey>(this IEnumerable<T> source, Func<T, TKey> key) => new Ordered<T>(source, (a, b) => Comparer<TKey>.Default.Compare(key(a), key(b)));
        public static IOrdered<T> OrderByDescending<T, TKey>(this IEnumerable<T> source, Func<T, TKey> key) => new Ordered<T>(source, (a, b) => Comparer<TKey>.Default.Compare(key(b), key(a)));
        public static IOrdered<T> ThenBy<T, TKey>(this IOrdered<T> source, Func<T, TKey> key) => source.CreateOrdered(key, Comparer<TKey>.Default, false);
        public static IOrdered<T> ThenByDescending<T, TKey>(this IOrdered<T> source, Func<T, TKey> key) => source.CreateOrdered(key, Comparer<TKey>.Default, true);

        public static IEnumerable<Grouping<TKey, T>> GroupBy<T, TKey>(this IEnumerable<T> source, Func<T, TKey> key) => source.GroupBy(key, item => item);

        public static IEnumerable<Grouping<TKey, TElement>> GroupBy<T, TKey, TElement>(this IEnumerable<T> source, Func<T, TKey> key, Func<T, TElement> element)
        {
            var groups = new Dictionary<TKey, Grouping<TKey, TElement>>();
            var order = new List<Grouping<TKey, TElement>>();
            foreach (var item in source)
            {
                TKey k = key(item);
                if (!groups.TryGetValue(k, out var group)) { groups[k] = group = new Grouping<TKey, TElement>(k); order.Add(group); }
                group.Add(element(item));
            }
            return order;
        }

        public static IEnumerable<TResult> Join<TOuter, TInner, TKey, TResult>(this IEnumerable<TOuter> outer, IEnumerable<TInner> inner, Func<TOuter, TKey> outerKey, Func<TInner, TKey> innerKey, Func<TOuter, TInner, TResult> result)
        {
            var lookup = inner.GroupBy(innerKey);
            foreach (var left in outer)
                foreach (var group in lookup)
                    if (EqualityComparer<TKey>.Default.Equals(group.Key, outerKey(left)))
                        foreach (var right in group) yield return result(left, right);
        }

        public static TAccumulate Aggregate<T, TAccumulate>(this IEnumerable<T> source, TAccumulate seed, Func<TAccumulate, T, TAccumulate> fold)
        {
            foreach (var item in source) seed = fold(seed, item);
            return seed;
        }

        public static int Count<T>(this IEnumerable<T> source) => source.Aggregate(0, (count, _) => count + 1);
        public static int Sum<T>(this IEnumerable<T> source, Func<T, int> selector) => source.Aggregate(0, (sum, item) => sum + selector(item));
        public static string Joined<T>(this IEnumerable<T> source, string separator = ",") => string.Join(separator, source);
        public static List<T> ToList<T>(this IEnumerable<T> source) => new List<T>(source);
        public static IEnumerable<int> To(this int from, int to) { for (int i = from; i <= to; i++) yield return i; }
        public static IEnumerable<T> Cast<T>(this IEnumerable source) { foreach (object item in source) yield return (T)item; }
    }
}

namespace App
{
    using MiniLinq;

    public sealed record City(string Name, string Country, int Population);

    public static class Program
    {
        public static void Main()
        {
            var cities = new[]
            {
                new City("Oslo", "NO", 700), new City("Bergen", "NO", 285), new City("Lyon", "FR", 520), new City("Paris", "FR", 2100),
                new City("Nice", "FR", 340), new City("Porto", "PT", 230), new City("Lisbon", "PT", 545), new City("Turku", "FI", 195),
            };
            var countries = new[] { (Code: "FR", Name: "France"), (Code: "NO", Name: "Norway"), (Code: "PT", Name: "Portugal"), (Code: "SE", Name: "Sweden") };

            var large = from city in cities where city.Population > 300 orderby city.Country, city.Population descending select city.Name;
            Console.WriteLine(large.Joined());

            var perCountry = from city in cities
                             group city by city.Country into g
                             orderby g.Count descending, g.Key
                             select g.Key + ":" + g.Count + ":" + g.Sum(c => c.Population);
            Console.WriteLine(perCountry.Joined(" "));

            var joined = from country in countries
                         join city in cities on country.Code equals city.Country
                         where city.Name.Length <= 5
                         orderby country.Name descending, city.Name
                         select $"{city.Name} ({country.Name})";
            Console.WriteLine(joined.Joined("; "));

            var pairs = from a in 1.To(4) from b in a.To(4) where (a + b) % 2 == 1 let product = a * b orderby product descending, a select (a, b, product);
            Console.WriteLine(pairs.Joined(" "));

            var grouped = from city in cities group city.Name[0] by city.Population / 250 into buckets orderby buckets.Key select buckets.Key + "=" + buckets.Joined("");
            Console.WriteLine(grouped.Joined(" ") + " " + cities.Count() + " " + 1.To(100).Where(n => n % 7 == 0).Count() + " " + cities.OrderBy(c => c.Name.Length).ThenByDescending(c => c.Name).Select(c => c.Name[0]).Joined(""));
            object[] boxed = { 1, 2, 3 };
            Console.WriteLine(boxed.Cast<int>().Sum(n => n * n) + " " + (from int n in boxed where n != 2 select n * 10).ToList().Count + " " + 1.To(5).Aggregate("", (text, n) => n + text));
        }
    }
}
