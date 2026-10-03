/**
 * Differential fixtures for SF-A02-T02 (framework generics over type parameters and user types): `List<T>`,
 * `Dictionary<string, T>`, `HashSet<T>`, `Queue<T>`, `Stack<T>` and `Task<T>` inside generic code and over classes
 * declared in source. The registry lists closed instantiations only; a construction over a reference type runs on the
 * instantiation over `object`. The pinned output is what the same program prints on .NET.
 */
import { cs, out, diag, feature } from './kit.js';

const animal = `
    class Animal
    {
        public string Name;
        public int Legs;
        public Animal(string name, int legs) { Name = name; Legs = legs; }
    }`;

const outputs = [
  out(
    'collections-over-a-user-class',
    cs`
    using System;
    using System.Collections.Generic;
    ${animal}
    class Program
    {
        static void Main()
        {
            var list = new List<Animal>();
            list.Add(new Animal("cat", 4));
            list.Add(new Animal("bird", 2));
            Console.WriteLine(list.Count);
            Console.WriteLine(list[0].Name);
            foreach (var a in list) Console.WriteLine(a.Name + a.Legs);
            list[0] = new Animal("dog", 4);
            list.Insert(0, new Animal("ant", 6));
            list.RemoveAt(2);
            Console.WriteLine(list[0].Name + " " + list[1].Name + " " + list.IndexOf(list[1]) + " " + list.Contains(null));

            var byName = new Dictionary<string, Animal>();
            byName["a"] = list[0];
            byName.Add("b", list[1]);
            Console.WriteLine(byName["a"].Name + byName.Count + byName.ContainsKey("b") + byName.ContainsKey("c"));
            foreach (var key in byName.Keys) Console.WriteLine(key);
            var byNumber = new Dictionary<int, Animal>();
            byNumber[7] = list[1];
            Console.WriteLine(byNumber[7].Name + byNumber.Remove(7) + byNumber.Count);

            var queue = new Queue<Animal>();
            queue.Enqueue(list[0]);
            queue.Enqueue(list[1]);
            Console.WriteLine(queue.Peek().Name + queue.Dequeue().Name + queue.Count);
            var stack = new Stack<Animal>();
            stack.Push(list[0]);
            stack.Push(list[1]);
            Console.WriteLine(stack.Peek().Name + stack.Pop().Name + stack.Count);

            var set = new HashSet<Animal>();
            Console.WriteLine(set.Add(list[0]));
            Console.WriteLine(set.Add(list[0]));
            Console.WriteLine(set.Contains(list[0]) + " " + set.Contains(list[1]) + " " + set.Count);

            var array = new Animal[] { new Animal("a0", 0), new Animal("a1", 1) };
            var copy = new List<Animal>(array);
            copy.AddRange(array);
            Console.WriteLine(copy.Count + copy[3].Name);
            copy.Remove(array[0]);
            copy.Reverse();
            Console.WriteLine(copy[0].Name + copy[2].Name);
            copy.Clear();
            Console.WriteLine(copy.Count);
            var fromArray = new HashSet<Animal>(array);
            Console.WriteLine(fromArray.Count + " " + fromArray.Remove(array[0]) + " " + fromArray.Count);

            var enumerator = list.GetEnumerator();
            while (enumerator.MoveNext()) Console.WriteLine(enumerator.Current.Name);
            list[0].Legs = 8;
            list[1].Legs += 1;
            Console.WriteLine(list[0].Legs + list[1].Legs);
        }
    }
  `,
  ),
  out(
    'collections-inside-a-generic-class',
    cs`
    using System;
    using System.Collections.Generic;
    ${animal}
    class Box<T> { public T Value; public Box(T value) { Value = value; } }
    class Registry<T>
    {
        static List<T> all = new List<T>();
        Dictionary<string, T> map = new Dictionary<string, T>();
        HashSet<T> seen = new HashSet<T>();
        Queue<T> queue = new Queue<T>();
        Stack<T> stack = new Stack<T>();
        public static int Total { get { return all.Count; } }
        public void Put(string key, T value)
        {
            map[key] = value;
            seen.Add(value);
            queue.Enqueue(value);
            stack.Push(value);
            all.Add(value);
        }
        public T Get(string key) { return map[key]; }
        public bool Has(T value) { return seen.Contains(value); }
        public T Next() { return queue.Dequeue(); }
        public T Top() { return stack.Pop(); }
        public int Count { get { return map.Count; } }
        public List<T> All()
        {
            var result = new List<T>();
            foreach (var value in seen) result.Add(value);
            return result;
        }
    }
    class Program
    {
        static void Main()
        {
            var cat = new Animal("cat", 4);
            var animals = new Registry<Animal>();
            animals.Put("k", cat);
            animals.Put("j", new Animal("jay", 2));
            Console.WriteLine(animals.Get("j").Name + animals.Has(cat) + animals.Next().Name + animals.Top().Name + animals.Count);
            foreach (var a in animals.All()) Console.WriteLine(a.Name);

            var numbers = new Registry<int>();
            numbers.Put("one", 1);
            numbers.Put("two", 2);
            Console.WriteLine(numbers.Get("two") + numbers.Next() + numbers.Top() + numbers.Count);
            Console.WriteLine(numbers.Has(2) + " " + numbers.Has(3));

            var words = new Registry<string>();
            words.Put("one", "uno");
            Console.WriteLine(words.Get("one") + words.Has("uno") + words.Has("dos"));

            var boxes = new Registry<Box<int>>();
            boxes.Put("b", new Box<int>(5));
            Console.WriteLine(boxes.Get("b").Value + boxes.All().Count);

            var arrays = new Registry<int[]>();
            arrays.Put("a", new int[3]);
            Console.WriteLine(arrays.Get("a").Length);

            Console.WriteLine(Registry<Animal>.Total + " " + Registry<int>.Total + " " + Registry<string>.Total + " " + Registry<double>.Total);
        }
    }
  `,
  ),
  out(
    'collections-in-generic-methods-and-nested-constructions',
    cs`
    using System;
    using System.Collections.Generic;
    ${animal}
    class Box<T> { public T Value; public Box(T value) { Value = value; } }
    static class Util
    {
        public static List<T> Repeat<T>(T value, int count)
        {
            var list = new List<T>(count);
            for (int i = 0; i < count; i++) list.Add(value);
            return list;
        }
        public static T Last<T>(List<T> list) { return list[list.Count - 1]; }
        public static Dictionary<string, List<T>> Group<T>(string key, T value)
        {
            var groups = new Dictionary<string, List<T>>();
            groups[key] = new List<T> { value, value };
            return groups;
        }
        public static int Drain<T>(Stack<T> stack)
        {
            int count = 0;
            while (stack.Count > 0) { stack.Pop(); count++; }
            return count;
        }
    }
    class Zoo
    {
        public List<Animal> Animals = new List<Animal>();
        public Dictionary<string, List<Animal>> ByKind { get; } = new Dictionary<string, List<Animal>>();
        public void Add(string kind, Animal animal)
        {
            Animals.Add(animal);
            if (!ByKind.ContainsKey(kind)) ByKind[kind] = new List<Animal>();
            ByKind[kind].Add(animal);
        }
    }
    class Program
    {
        static int Sum(List<int> values) { int sum = 0; foreach (var value in values) sum += value; return sum; }
        static void Main()
        {
            var zoo = new Zoo();
            zoo.Add("cat", new Animal("tom", 4));
            zoo.Add("cat", new Animal("felix", 4));
            zoo.Add("dog", new Animal("rex", 4));
            Console.WriteLine(zoo.Animals.Count + " " + zoo.ByKind["cat"].Count + " " + zoo.ByKind["dog"][0].Name);

            var same = Util.Repeat(zoo.Animals[0], 3);
            Console.WriteLine(same.Count + Util.Last(same).Name + Util.Last(Util.Repeat(4, 2)) + Util.Last(Util.Repeat("s", 1)));
            var grouped = Util.Group("k", zoo.Animals[1]);
            Console.WriteLine(grouped["k"].Count + grouped["k"][1].Name + Util.Group("n", 5)["n"][0]);
            var stack = new Stack<Animal>();
            stack.Push(zoo.Animals[0]);
            stack.Push(zoo.Animals[1]);
            Console.WriteLine(Util.Drain(stack) + " " + stack.Count);

            var boxes = new List<Box<int>> { new Box<int>(5), new Box<int>(6) };
            Console.WriteLine(boxes[1].Value + boxes.Count);
            var nested = new List<List<int>>();
            nested.Add(new List<int> { 1, 2, 3 });
            nested.Add(new List<int> { 4 });
            int total = 0;
            foreach (var inner in nested) total += Sum(inner);
            Console.WriteLine(total);
            var rows = new List<string[]>();
            rows.Add(new[] { "p", "q" });
            Console.WriteLine(rows[0][1] + rows[0].Length);
            var mixed = new List<object>();
            mixed.Add(zoo.Animals[0]);
            mixed.Add(1);
            mixed.Add("text");
            Console.WriteLine(mixed.Count);
        }
    }
  `,
  ),
  out(
    'tasks-collections-closures-and-iterators',
    cs`
    using System;
    using System.Collections.Generic;
    using System.Threading.Tasks;
    ${animal}
    class Cache<T> where T : class
    {
        static List<T> all = new List<T>();
        Dictionary<string, T> byKey = new Dictionary<string, T>();
        public static int Total { get { return all.Count; } }
        public T Find(string key) { return byKey.ContainsKey(key) ? byKey[key] : null; }
        public void Store(string key, T value) { byKey[key] = value; all.Add(value); }
        public async Task<List<T>> Snapshot()
        {
            await Task.Delay(1);
            var copy = new List<T>();
            foreach (var item in all) copy.Add(item);
            return copy;
        }
        public IEnumerable<T> Each() { for (int i = 0; i < all.Count; i++) yield return all[i]; }
    }
    class Program
    {
        static async Task<Animal> Make(string name) { await Task.Yield(); return new Animal(name, 4); }
        static int Legs(List<Animal> animals) { int legs = 0; foreach (var a in animals) legs += a.Legs; return legs; }
        static async Task Main()
        {
            var cache = new Cache<Animal>();
            cache.Store("cat", new Animal("tom", 4));
            cache.Store("bird", new Animal("tweety", 2));
            Console.WriteLine(Cache<Animal>.Total + " " + Cache<string>.Total);
            Console.WriteLine(cache.Find("bird").Name + (cache.Find("dog") == null));
            var snapshot = await cache.Snapshot();
            snapshot[0].Legs = 3;
            snapshot[1].Legs += 1;
            Console.WriteLine(Legs(snapshot) + " " + snapshot[0].Name);
            foreach (var each in cache.Each()) Console.WriteLine(each.Name + each.Legs);

            var pending = Make("rex");
            var made = await pending;
            Console.WriteLine(made.Name + pending.IsCompleted + pending.Result.Legs + pending.IsFaulted + pending.IsCanceled);

            var counts = new Dictionary<string, int>();
            var names = new List<string> { "a", "b", "a" };
            foreach (var name in names)
            {
                if (!counts.ContainsKey(name)) counts[name] = 0;
                counts[name] += 1;
            }
            Console.WriteLine(counts["a"] + " " + counts["b"]);

            Func<Animal, bool> small = a => a.Legs < 4;
            var kept = new List<Animal>();
            Action<Animal> keep = a => { if (small(a)) kept.Add(a); };
            foreach (var a in snapshot) keep(a);
            Console.WriteLine(kept.Count + kept[0].Name);

            List<Animal> none = null;
            Console.WriteLine((none?.Count ?? -1) + " " + (snapshot[0] ?? made).Name + " " + (kept.Count > 1 ? kept[1] : made).Name);

            var queue = new Queue<Task<Animal>>();
            queue.Enqueue(Make("q1"));
            queue.Enqueue(Make("q2"));
            while (queue.Count > 0) Console.WriteLine((await queue.Dequeue()).Name);

            var texts = new Cache<string>();
            texts.Store("k", "v");
            Console.WriteLine(texts.Find("k") + Cache<string>.Total + (await texts.Snapshot()).Count);
        }
    }
  `,
  ),
];

const diagnostics = [
  diag(
    'cs0029-cs0200-cs1061-members-of-constructed-collections',
    cs`
    using System.Collections.Generic;
    class Animal { public string Name; }
    class Program
    {
        static void Main()
        {
            var list = new List<Animal>();
            string text = list[0];
            list.Count = 3;
            int n = list[0].Nope;
            List<object> objects = list;
            var map = new Dictionary<string, Animal>();
            int value = map["k"];
            foreach (string s in list) { }
        }
    }
  `,
  ),
  diag(
    'cs0029-cs0266-members-of-collections-over-type-parameters',
    cs`
    using System.Collections.Generic;
    class Bag<T>
    {
        List<T> items = new List<T>();
        Dictionary<string, T> map = new Dictionary<string, T>();
        public int First() { return items[0]; }
        public T Count() { return items.Count; }
        public string Key() { return map["k"]; }
        public Queue<int> Queue() { return new Queue<T>(); }
    }
    class Program
    {
        static void Main() { }
    }
  `,
  ),
];

export const fixtures = feature('framework-generics', [...outputs, ...diagnostics]);
