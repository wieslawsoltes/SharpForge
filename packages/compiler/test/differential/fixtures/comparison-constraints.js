/**
 * Differential fixtures for SF-A02-T02 (interface constraints satisfied by simple types): `where T : IComparable<T>`
 * and `where T : IEquatable<T>` over `int`, `double`, `bool`, `string` and classes declared in source, and the same
 * members called directly. The pinned output is what the same program prints on .NET.
 */
import { cs, out, diag, feature } from './kit.js';

const outputs = [
  out(
    'comparable-and-equatable-constraints-over-simple-types',
    cs`
    using System;
    class Version : IComparable<Version>, IEquatable<Version>
    {
        public int Major;
        public Version(int major) { Major = major; }
        public int CompareTo(Version other) { return Major.CompareTo(other.Major); }
        public bool Equals(Version other) { return other != null && Major == other.Major; }
    }
    class Range<T> where T : IComparable<T>
    {
        public T Low;
        public T High;
        public Range(T a, T b) { if (a.CompareTo(b) <= 0) { Low = a; High = b; } else { Low = b; High = a; } }
        public bool Contains(T value) { return Low.CompareTo(value) <= 0 && value.CompareTo(High) <= 0; }
    }
    class Program
    {
        static T Max<T>(T a, T b) where T : IComparable<T> { return a.CompareTo(b) > 0 ? a : b; }
        static int Order<T>(T a, T b) where T : IComparable<T> { return a.CompareTo(b); }
        static bool Same<T>(T a, T b) where T : IEquatable<T> { return a.Equals(b); }
        static int IndexOf<T>(T[] items, T wanted) where T : IEquatable<T>
        {
            for (int i = 0; i < items.Length; i++) if (items[i].Equals(wanted)) return i;
            return -1;
        }
        static void Sort<T>(T[] items) where T : IComparable<T>
        {
            for (int i = 1; i < items.Length; i++)
                for (int j = i; j > 0 && items[j - 1].CompareTo(items[j]) > 0; j--)
                {
                    T held = items[j]; items[j] = items[j - 1]; items[j - 1] = held;
                }
        }
        static void Main()
        {
            double zero = 0.0;
            double nan = zero / zero;
            Console.WriteLine(Max(3, 9));
            Console.WriteLine(Max(2.5, -1.0));
            Console.WriteLine(Max(new Version(2), new Version(5)).Major);
            Console.WriteLine(Order(1, 2) + " " + Order(2, 1) + " " + Order(2, 2));
            Console.WriteLine(Order(false, true) + " " + Order(true, true) + " " + Order(true, false));
            Console.WriteLine(Order(nan, 1.0) + " " + Order(1.0, nan) + " " + Order(nan, nan) + " " + Order(1.5, 1.5) + " " + Order(-2.0, 1.5));
            Console.WriteLine(Same(1, 1) + " " + Same(1, 2) + " " + Same("a", "a") + " " + Same("a", "b") + " " + Same(true, false));
            Console.WriteLine(Same(nan, nan) + " " + Same(1.5, 1.5) + " " + Same(new Version(1), new Version(1)) + " " + Same(new Version(1), null));
            Console.WriteLine(5.CompareTo(7) + " " + "x".Equals("x") + " " + 3.Equals(3) + " " + 1.5.CompareTo(0.5) + " " + true.CompareTo(false));

            int calls = 0;
            int Next() { calls++; return calls; }
            Console.WriteLine(Next().CompareTo(Next()) + " " + calls);

            var numbers = new[] { 4, 1, 3, 2 };
            Sort(numbers);
            Console.WriteLine(numbers[0] + "" + numbers[1] + numbers[2] + numbers[3]);
            var versions = new[] { new Version(3), new Version(1), new Version(2) };
            Sort(versions);
            Console.WriteLine(versions[0].Major + "" + versions[1].Major + versions[2].Major);
            Console.WriteLine(IndexOf(new[] { "a", "b", "c" }, "c") + " " + IndexOf(numbers, 9) + " " + IndexOf(versions, new Version(2)));

            var range = new Range<int>(9, 2);
            Console.WriteLine(range.Low + " " + range.High + " " + range.Contains(5) + " " + range.Contains(10));
            var span = new Range<double>(0.5, 1.5);
            Console.WriteLine(span.Contains(1.0) + " " + span.Contains(nan));

            string missing = null;
            try { Console.WriteLine(Same(missing, "a")); }
            catch (Exception) { Console.WriteLine("null receiver"); }
            Console.WriteLine(Same("a", missing));
        }
    }
  `,
  ),
];

const diagnostics = [
  diag(
    'cs0311-cs0315-comparison-constraints-not-satisfied',
    cs`
    using System;
    class Animal { }
    class Version : IComparable<Version>
    {
        public int CompareTo(Version other) { return 0; }
    }
    class Program
    {
        static T Max<T>(T a, T b) where T : IComparable<T> { return a.CompareTo(b) > 0 ? a : b; }
        static bool Same<T>(T a, T b) where T : IEquatable<T> { return a.Equals(b); }
        static void Text<T>(T a) where T : IEquatable<string> { }
        static void Main()
        {
            Max(new Animal(), new Animal());
            Same(new Version(), new Version());
            Text(5);
            Text("ok");
            Max(1, 2);
            Max(new Version(), new Version());
            string s = Max(1, 2);
        }
    }
  `,
  ),
  diag(
    'cs0535-cs0738-comparison-interfaces-not-implemented',
    cs`
    using System;
    class Missing : IComparable<Missing> { }
    class WrongReturn : IEquatable<WrongReturn>
    {
        public int Equals(WrongReturn other) { return 0; }
    }
    class Fine : IComparable
    {
        public int CompareTo(object obj) { return 0; }
    }
    class Program
    {
        static void Main() { }
    }
  `,
  ),
];

export const fixtures = feature('comparison-constraints', [...outputs, ...diagnostics]);
