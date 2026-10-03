/**
 * Differential fixtures for null-conditional access (SF-A02-T59): single evaluation of the receiver, chains,
 * element access, statement forms, and value-typed results consumed by `??`, comparisons, boxing, concatenation and
 * interpolation; CS0023, CS0119, CS0201, CS0266, CS0815, CS1061, CS8978.
 */
import { cs, out, diag, feature } from './kit.js';

export const fixtures = feature('null-conditional', [
  out(
    'receivers-chains-and-value-typed-results',
    cs`
      using System;
      using System.Collections.Generic;
      class Node { public Node Next; public string Name; public int V; public int[] Arr; public string Get() { return Name; } public int Count() { Console.WriteLine("count"); return 2; } public void Do() { Console.WriteLine("do " + Name); } public Node Self() { return this; } public bool Has() { return V > 0; } }
      class Program
      {
          static Node Make() { Console.WriteLine("make"); return new Node { Name = "n", V = 7 }; }
          static int Three() { Console.WriteLine("three"); return 3; }
          static void Main()
          {
              Node n = null;
              Console.WriteLine(n?.Name == null);
              string s = n?.Next?.Name;
              Console.WriteLine(s ?? "null");
              n?.Do();
              n?.Next?.Do();
              n = Make();
              n?.Do();
              n?.Next?.Do();
              n?.Self()?.Do();
              Console.WriteLine(n?.Get());
              Console.WriteLine(Make()?.Name.Substring(0));
              Console.WriteLine(n?.Next?.Get() ?? "none");
              Console.WriteLine(n?.Name?.Substring(0) ?? "none");
              Console.WriteLine(n?.Name.Substring(0)?.Length ?? -1);
              Console.WriteLine(n?.Arr?[0] ?? -1);
              n.Arr = new[] { 4, 5 };
              Console.WriteLine(n?.Arr?[0] ?? -1);
              Console.WriteLine(n?.Arr[1] ?? -1);
              Console.WriteLine(n?.Name.Length);
              Console.WriteLine(n?.Name.Length == 1);
              Console.WriteLine(1 == n?.Name.Length);
              Console.WriteLine(n?.Next?.Name.Length > 0);
              Console.WriteLine(n?.Next?.V != 7);
              Console.WriteLine(n?.V != 7);
              Console.WriteLine(n?.V >= Three());
              Console.WriteLine(n?.Next?.Count() < Three());
              Console.WriteLine(n?.Count() == null);
              Console.WriteLine(n?.Next?.Count() == null);
              Console.WriteLine(n?.V != null);
              Console.WriteLine("len " + n?.Next?.Name.Length + "|" + n?.Name.Length);
              Console.WriteLine($"{n?.Name.Length} [{n?.Next?.Name.Length}] {n?.V,4:D3}");
              object o = n?.V;
              Console.WriteLine(o);
              object p = n?.Next?.V;
              Console.WriteLine(p == null);
              Action act = null;
              act?.Invoke();
              act = () => Console.WriteLine("invoked");
              act?.Invoke();
              var list = new List<int> { 1, 2 };
              Console.WriteLine(list?.Count);
              Console.WriteLine(list?[1]);
              list = null;
              Console.WriteLine(list?.Count ?? -5);
              string t = null;
              Console.WriteLine(t?.Length ?? 0);
              Console.WriteLine((t?.Length ?? 0) + (n?.Name.Length ?? 0));
              Console.WriteLine(n?.V > 5);
              Console.WriteLine("b " + (n?.V > 5) + n?.Has() + n?.Next?.Has() + "|");
              object bx = n?.Has();
              Console.WriteLine(bx);
              Console.WriteLine($"{n?.Has()}");
              bool b = n?.V > 5 && n?.Next?.V == null;
              Console.WriteLine(b);
          }
      }
    `,
  ),
  diag(
    'cs0023-cs0201-cs8978-invalid-accesses',
    cs`
      using System;
      class Node { public int V; public string Name; public void Do() { } }
      class Program
      {
          static T Get<T>(T x) { return x; }
          static void Main()
          {
              Node n = null;
              int i = 1;
              var a = i?.ToString();
              int v = n?.V;
              var m = n?.Do();
              var g = n?.Missing;
              string s = null?.ToString();
              var d = n?.Do;
              int? ok = n?.V;
              var x = Main?.ToString();
              n?.Name;
          }
      }
    `,
  ),
]);
