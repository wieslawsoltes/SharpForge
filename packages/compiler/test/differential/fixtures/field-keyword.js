/**
 * Differential fixtures for the C# 14 `field` keyword (SF-A02-T84): accessors over the synthesized backing field,
 * mixed with auto-implemented accessors, initializers, static and generic owners, lazy getters, lambdas in
 * accessors; CS9258 when a member named `field` is in scope, CS0103 outside a property accessor, CS8050, CS9273.
 */
import { cs, out, diag, feature } from './kit.js';

export const fixtures = feature('field-keyword', [
  out(
    'accessors-initializers-static-and-generic',
    cs`
      using System;
      using System.Collections.Generic;
      class Settings<T>
      {
          public T Value { get => field; set { Console.WriteLine("set " + value); field = value; } }
          public string Name { get; set => field = value.Trim(); } = "x";
          public int Clamped { get => field; set => field = value < 0 ? 0 : value; }
          public int Lazy { get { if (field == 0) { Console.WriteLine("compute"); field = 42; } return field; } }
          public int Doubled { get => field * 2; init => field = value; } = 3;
          public List<int> Items { get => field ??= new List<int>(); }
          public int Twice { get { Func<int> f = () => field * 2; return f(); } set => field = value; }
          public static int Count { get => field; set => field = value + 1; }
      }
      class Program
      {
          static void Main()
          {
              var s = new Settings<string> { Doubled = 5 };
              s.Value = "v"; Console.WriteLine(s.Value);
              Console.WriteLine(s.Name); s.Name = "  hi "; Console.WriteLine(s.Name + "|");
              s.Clamped = -5; Console.WriteLine(s.Clamped); s.Clamped += 7; Console.WriteLine(s.Clamped);
              Console.WriteLine(s.Lazy + s.Lazy);
              Console.WriteLine(s.Doubled + " " + new Settings<int>().Doubled);
              s.Items.Add(1); s.Items.Add(2); Console.WriteLine(s.Items.Count);
              s.Twice = 4; Console.WriteLine(s.Twice);
              Settings<string>.Count = 1; Settings<string>.Count++; Console.WriteLine(Settings<string>.Count);
          }
      }
    `,
  ),
  out(
    'cs9258-member-named-field',
    cs`
      using System;
      class C { int field = 5; public int P { get { return field; } set { field = value; } } public int Old { get { return this.field; } } }
      class Program { static void Main() { var c = new C(); Console.WriteLine(c.P); c.P = 7; Console.WriteLine(c.P + " " + c.Old); } }
    `,
  ),
  diag(
    'cs9258-warnings',
    cs`
      class C
      {
          int @field = 9;
          public int P { get => field; set => field = value; }
          public int Esc { get { return @field; } }
      }
      class Program { static void Main() { } }
    `,
  ),
  diag(
    'cs0103-cs8050-outside-property-accessors',
    cs`
      using System;
      class C
      {
          public int A { get { return 1; } } = 1;
          int M() { return field; }
          public event Action Ev { add { field = 1; } remove { } }
          public int this[int i] { get => field; }
          public int Ok { get => field; } = 2;
      }
      class Program { static void Main() { } }
    `,
  ),
  // Below C# 14 `field` is an ordinary name: it binds to a member named `field`, or to nothing.
  out(
    'csharp13-member-named-field',
    cs`
      using System;
      class C
      {
          int field = 5;
          public int P { get { return field; } set { field = value * 2; } }
          public int Q { get => field + 1; }
      }
      class Program { static void Main() { var c = new C(); Console.WriteLine(c.P); c.P = 7; Console.WriteLine(c.P + " " + c.Q); } }
    `,
    { langVersion: '13' },
  ),
  diag(
    'csharp13-no-member-named-field',
    cs`
      class C
      {
          public int P { get { return field; } set { field = value; } }
          public int Mixed { get; set => field = value; }
          public int Local { get { int field = 1; return field; } }
      }
      class Program { static void Main() { } }
    `,
    { langVersion: '13' },
  ),
]);
