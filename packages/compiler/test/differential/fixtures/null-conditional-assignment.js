/**
 * Differential fixtures for C# 14 null-conditional assignment (SF-A02-T85): simple, compound, `??=` and event
 * assignments through `?.` and `?[]`; the right side is skipped for a null receiver and the receiver is evaluated
 * once; the value of the assignment; CS9260 below C# 14, CS1059 for increments, CS0131, CS0200, CS1656, CS8978.
 */
import { cs, out, diag, feature } from './kit.js';

export const fixtures = feature('null-conditional-assignment', [
  out(
    'members-elements-and-events',
    cs`
      using System;
      using System.Collections.Generic;
      class C
      {
          public int P; public string S; public int[] A = new int[2]; public event Action E; public C Next;
          public List<int> L = new List<int>(); public int Q { get; set; }
          public void Fire() { if (E != null) E(); }
      }
      class Program
      {
          static int Side() { Console.WriteLine("side"); return 4; }
          static C Get(C c) { Console.WriteLine("get"); return c; }
          static void Main()
          {
              C d = null; C c = new C();
              d?.P = Side(); c?.P = Side(); Console.WriteLine(c.P);
              c?.P += 2; d?.P += Side(); Console.WriteLine(c.P);
              c?.A[1] = 5; d?.A[1] = Side(); Console.WriteLine(c.A[1]);
              c?.A[Side() - 4] -= 3; Console.WriteLine(c.A[0]);
              c?.E += () => Console.WriteLine("ev"); c.Fire();
              d?.E += () => Console.WriteLine("never");
              Get(c)?.Q = 3; Get(d)?.Q = Side(); Console.WriteLine(c.Q);
              Get(c)?.Q *= 5; Console.WriteLine(c.Q);
              c?.S ??= "s"; c?.S += "t"; c?.S ??= "unused"; Console.WriteLine(c.S);
              c.Next = new C(); c?.Next?.P = 8; c.Next?.Next?.P = Side(); Console.WriteLine(c.Next.P);
              c.L.Add(0); c?.L[0] = 1; d?.L[0] = Side(); Console.WriteLine(c.L[0]);
          }
      }
    `,
  ),
  out(
    'value-of-the-assignment',
    cs`
      using System;
      class C { public int P; public string S; public C Next; }
      class Program
      {
          static void Main()
          {
              C c = new C(), d = null;
              string r = c?.S = "new"; Console.WriteLine(r);
              Console.WriteLine((d?.S = "x") ?? "null");
              Console.WriteLine((c?.S += "er") ?? "null");
              Console.WriteLine((d?.P = 6) ?? -1);
              Console.WriteLine((c?.P = 6) ?? -1);
              Console.WriteLine((c?.P = 7) == 7);
              Console.WriteLine((d?.P = 7) == 7);
              Console.WriteLine((d?.P = 7) == null);
              var next = c?.Next = new C(); Console.WriteLine(next == c.Next);
              Console.WriteLine($"{c?.P += 1}|{d?.P += 1}|");
          }
      }
    `,
  ),
  out(
    'generic-targets',
    cs`
      using System;
      class Box<T> { public T V; public T[] Items = new T[1]; }
      class Program
      {
          static void Set<T>(Box<T> box, T value) { box?.V = value; box?.Items[0] = value; }
          static void Main()
          {
              var numbers = new Box<int>(); Set(numbers, 3); Console.WriteLine(numbers.V + numbers.Items[0]);
              var texts = new Box<string>(); Set(texts, "t"); Console.WriteLine(texts.V + texts.Items[0]);
              Set<int>(null, 4);
          }
      }
    `,
  ),
  diag(
    'cs9260-below-csharp-14',
    cs`
      class C { public int P; public int[] A = new int[1]; public string S; }
      class Program
      {
          static void Main()
          {
              C c = new C();
              c?.P = 1;
              c?.A[0] += 1;
              c?.S ??= "s";
          }
      }
    `,
    { langVersion: '13' },
  ),
  diag(
    'cs1059-increment-and-decrement',
    cs`
      class C { public int P; public int[] A; }
      class Program
      {
          static void Main()
          {
              C c = new C();
              c?.P++;
              --c?.P;
              c?.A[0]++;
          }
      }
    `,
  ),
  diag(
    'cs0200-cs1656-cs0131-cs0029-targets',
    cs`
      class C { public int P; public int G { get { return 1; } } public void M() { } public C N; }
      class Program
      {
          static void Main()
          {
              C c = new C();
              c?.G = 2;
              c?.M = 3;
              c?.N?.G += 1;
              c?.P = "s";
              c?.M() = 3;
              (c?.P, c?.N) = (1, null);
          }
      }
    `,
  ),
  diag(
    'cs0131-member-of-nullable-struct',
    cs`
      struct S { public int X; public int Y { get; set; } }
      class Program
      {
          static void Main()
          {
              S? s = new S();
              s?.X = 1;
              s?.Y = 2;
          }
      }
    `,
  ),
  diag(
    'cs8978-type-parameter-value',
    cs`
      class Box<T> { public T V; }
      class Program
      {
          static void Set<T>(Box<T> box, T value) { box?.V = value; }
          static T Get<T>(Box<T> box, T value) { return (box?.V = value); }
          static void Main() { Set(new Box<int>(), 1); }
      }
    `,
  ),
]);
