/**
 * Differential fixtures for the `string` members the framework registry has, bound and run through the semantic
 * generator (the interface declaration keeps the programs outside the execution profile): every instance and static
 * member, behind `?.` as well, and the parameter arrays of `string.Format`, `string.Concat` and `string.Join` in
 * expanded form.
 */
import { cs, out, feature } from './kit.js';

export const fixtures = [
  ...feature('string-members', [
    out(
      'registry-members-direct-and-null-conditional',
      cs`
        using System;
        interface IMarker { }
        class Program
        {
            static void Main()
            {
                string s = "  Hello World  ";
                string none = null;
                Console.WriteLine(s.Trim() + "|" + s.TrimStart() + "|" + s.TrimEnd() + "|");
                Console.WriteLine(s.ToUpper() + s.ToLower() + s.ToUpperInvariant() + s.ToLowerInvariant());
                Console.WriteLine(s.Trim().Substring(6) + " " + s.Trim().Substring(0, 5));
                Console.WriteLine(s.Contains("World") + " " + s.IndexOf("World") + " " + s.IndexOf("o", 7) + " " + s.LastIndexOf("o"));
                Console.WriteLine(s.Trim().StartsWith("Hello") + " " + s.Trim().EndsWith("World"));
                Console.WriteLine(s.Replace("World", "There") + s.Trim().PadLeft(13) + "|" + s.Trim().PadRight(13) + "|");
                Console.WriteLine(s.Trim().Insert(5, ",") + " " + s.Trim().Remove(5) + " " + s.Trim().Remove(1, 4));
                Console.WriteLine(s.Trim().Split(" ").Length + " " + s.Trim().Split(" ", 1)[0] + " " + s.Length);
                Console.WriteLine(s.Equals(s) + " " + s.ToString().Length + " " + string.Empty.Length);
                Console.WriteLine(string.IsNullOrEmpty(none) + " " + string.IsNullOrWhiteSpace("  ") + " " + string.Equals("a", "b"));
                Console.WriteLine(string.CompareOrdinal("a", "b") + " " + string.Join("-", new[] { 1, 2 }));

                Console.WriteLine(s?.Trim());
                Console.WriteLine(s?.ToUpper());
                Console.WriteLine(none?.ToLower() ?? "none");
                Console.WriteLine(s?.Trim().Substring(6));
                Console.WriteLine(s?.Replace("World", "There").Trim().ToUpper());
                Console.WriteLine(none?.TrimStart()?.PadLeft(3) ?? "none");
                Console.WriteLine(s?.Trim().Length);
                Console.WriteLine(none?.Split(" ").Length ?? -1);
                Console.WriteLine($"{s?.Trim()}|{none?.ToUpper()}|");
            }
        }
      `,
    ),
    out(
      'format-concat-join-parameter-arrays',
      cs`
        using System;
        interface IMarker { }
        class Program
        {
            static void Main()
            {
                Console.WriteLine(string.Format("none"));
                Console.WriteLine(string.Format("{0}", 1));
                Console.WriteLine(string.Format("{0} {1} {2} {3}", 1, 2.5, true, "s"));
                Console.WriteLine(string.Format("{0} {1} {2} {3} {4}", 1, 2.5, true, "s", null));
                Console.WriteLine(string.Format("{0} {1} {2} {3} {4} {5}", 1, 2, 3, 4, 5, 6));
                Console.WriteLine(string.Format("{0}{1}", new object[] { "in", "order" }));
                Console.WriteLine(string.Concat("a"));
                Console.WriteLine(string.Concat("a", "b"));
                Console.WriteLine(string.Concat("a", "b", "c"));
                Console.WriteLine(string.Concat("a", "b", "c", "d", "e"));
                Console.WriteLine(string.Concat(new[] { "x", "y" }));
                Console.WriteLine(string.Join(",", "a", "b", "c"));
                Console.WriteLine(string.Join(",", new[] { "a", "b" }));
            }
        }
      `,
    ),
  ]),
];
