/**
 * Differential fixtures for SF-A02-T02.6: user-defined generics together with the other lowerings - query
 * expressions over a generic query pattern, lowered async with `Task<T>` over user types and constructions, tuples
 * and iterators. The pinned output is what the same program prints on .NET.
 */
import { cs, out, feature } from './kit.js';

const sequence = `
    class Seq<T>
    {
        T[] items;
        public Seq(T[] items) { this.items = items; }
        public int Count { get { return items.Length; } }
        public T At(int i) { return items[i]; }
        public Seq<T> Where(Func<T, bool> keep)
        {
            int n = 0;
            for (int i = 0; i < items.Length; i++) if (keep(items[i])) n++;
            var kept = new T[n];
            n = 0;
            for (int i = 0; i < items.Length; i++) if (keep(items[i])) { kept[n] = items[i]; n++; }
            return new Seq<T>(kept);
        }
        public Seq<R> Select<R>(Func<T, R> map)
        {
            var mapped = new R[items.Length];
            for (int i = 0; i < items.Length; i++) mapped[i] = map(items[i]);
            return new Seq<R>(mapped);
        }
        public Seq<R> SelectMany<C, R>(Func<T, Seq<C>> inner, Func<T, C, R> result)
        {
            int n = 0;
            for (int i = 0; i < items.Length; i++) n += inner(items[i]).Count;
            var all = new R[n];
            n = 0;
            for (int i = 0; i < items.Length; i++)
            {
                var each = inner(items[i]);
                for (int j = 0; j < each.Count; j++) { all[n] = result(items[i], each.At(j)); n++; }
            }
            return new Seq<R>(all);
        }
    }`;

export const fixtures = feature('generic-interactions', [
  out(
    'queries-over-a-generic-query-pattern',
    cs`
    using System;
    ${sequence}
    class Program
    {
        static void Show<T>(Seq<T> seq) { for (int i = 0; i < seq.Count; i++) Console.WriteLine(seq.At(i)); }
        static void Main()
        {
            var numbers = new Seq<int>(new[] { 1, 2, 3, 4 });
            var words = new Seq<string>(new[] { "x", "yy" });
            Show(from n in numbers where n % 2 == 0 select n * 10);
            Show(from n in numbers select "n" + n);
            Show(from w in words where w.Length > 1 select w.Length);
            Show(from n in numbers from w in words select w + n);
        }
    }
  `,
  ),
  out(
    'tasks-over-user-types-constructions-and-tuples',
    cs`
    using System;
    using System.Threading.Tasks;
    class Animal
    {
        public string Name;
        public Animal(string name) { Name = name; }
    }
    class Box<T>
    {
        public T Value;
        public Box(T value) { Value = value; }
    }
    class Program
    {
        static async Task<Animal> MakeAsync(string name) { await Task.Delay(1); return new Animal(name); }
        static async Task<Box<T>> WrapAsync<T>(T value) { await Task.Delay(1); return new Box<T>(value); }
        static async Task<int[]> RangeAsync(int n) { await Task.Yield(); var a = new int[n]; for (int i = 0; i < n; i++) a[i] = i; return a; }
        static async Task<(int, string)> PairAsync() { await Task.Delay(1); return (1, "t"); }
        static async Task<T> PassAsync<T>(T value) { await Task.Delay(1); return value; }
        static async Task Main()
        {
            Animal owl = await MakeAsync("owl");
            Console.WriteLine(owl.Name);
            Task<Animal> pending = MakeAsync("cat");
            Console.WriteLine((await pending).Name);
            var number = await WrapAsync(3);
            var text = await WrapAsync("s");
            Console.WriteLine(number.Value + text.Value);
            Console.WriteLine((await RangeAsync(3)).Length);
            var pair = await PairAsync();
            Console.WriteLine(pair.Item1 + pair.Item2);
            var passed = await PassAsync(new Box<Animal>(owl));
            Console.WriteLine(passed.Value.Name + (await PassAsync((2, 0.5))).Item2);
        }
    }
  `,
  ),
  out(
    'tuples-and-iterators-over-constructions',
    cs`
    using System;
    using System.Collections.Generic;
    class Slot<T>
    {
        public T Item;
        public Slot(T item) { Item = item; }
        public (T, int) Tagged(int tag) { return (Item, tag); }
    }
    static class Slots
    {
        public static IEnumerable<Slot<T>> Wrap<T>(T[] items) { foreach (var item in items) yield return new Slot<T>(item); }
        public static (A, B) Both<A, B>(Slot<A> a, Slot<B> b) { return (a.Item, b.Item); }
        public static Slot<(A, B)> Zip<A, B>(A a, B b) { return new Slot<(A, B)>((a, b)); }
    }
    class Program
    {
        static void Main()
        {
            foreach (var slot in Slots.Wrap(new[] { "a", "b" })) Console.WriteLine(slot.Item + slot.Tagged(7).Item2);
            foreach (var slot in Slots.Wrap(new[] { 1, 2 })) Console.WriteLine(slot.Tagged(1).Item1 + 1);
            var both = Slots.Both(new Slot<int>(4), new Slot<string>("four"));
            Console.WriteLine(both.Item1 + both.Item2);
            var (number, word) = Slots.Both(new Slot<double>(0.5), new Slot<string>("half"));
            Console.WriteLine(word + number);
            var zipped = Slots.Zip(1, "one");
            Console.WriteLine(zipped.Item.Item2 + zipped.Item.Item1);
            Console.WriteLine(zipped.Item == (1, "one"));
        }
    }
  `,
  ),
]);
