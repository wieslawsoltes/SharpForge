/**
 * Differential fixtures for partial methods (SF-A02-T54): the two parts are one method, a call to a method that has
 * only its defining declaration is removed together with its arguments, callers use the definition's parameter names
 * and default values, and the C# 9 extended form (accessibility, return values, `out`) must be implemented.
 * Declaration rules: CS0751, CS0756, CS0757, CS0759, CS0758, CS0762, CS0763, CS8795-CS8800, CS8817, CS8818.
 */
import { cs, out, diag, feature } from './kit.js';

export const fixtures = feature('partial-methods', [
  out(
    'unimplemented-calls-are-removed',
    cs`
      using System;
      partial class C
      {
          partial void Log(string s);
          partial void Skip(int x);
          static partial void Stat(int x);
          public void Run() { Log("a"); Skip(F()); Stat(2); Console.WriteLine("run"); }
          static int F() { Console.WriteLine("F"); return 1; }
      }
      partial class C
      {
          partial void Log(string s) { Console.WriteLine("log " + s); }
          static partial void Stat(int x) { Console.WriteLine("stat " + x); }
      }
      class Program
      {
          static void Main() { new C().Run(); }
      }
    `,
  ),
  out(
    'definition-names-defaults-and-extended-forms',
    cs`
      using System;
      partial class C
      {
          partial void Impl(int a, int b = 5) { Console.WriteLine("impl " + a + " " + b); }
          partial void Impl(int first, int second = 7);
          partial void Gone(int x);
          private partial int Twice(int v);
          private partial int Twice(int v) => v * 2;
          public partial bool TryGet(out int value);
          public partial bool TryGet(out int value) { value = 9; return true; }
          public void Run()
          {
              Impl(1);
              Impl(second: 3, first: 2);
              int n = 0;
              Gone(n = 5);
              Gone(Side());
              Console.WriteLine(n);
              Console.WriteLine(Twice(4));
              int got;
              Console.WriteLine(TryGet(out got) + " " + got);
              Action a = () => Gone(1);
              a();
              for (int i = 0; i < 2; Gone(i), i++) Console.Write(i);
              Console.WriteLine();
          }
          static int Side() { Console.WriteLine("side"); return 1; }
      }
      partial class C
      {
          static partial void Hello();
          static partial void Hello() { Console.WriteLine("hello"); }
          public static void Go() { Hello(); }
      }
      class Program
      {
          static void Main() { new C().Run(); C.Go(); }
      }
    `,
  ),
  diag(
    'cs0756-cs0757-cs0759-parts-that-do-not-pair',
    cs`
      partial class C
      {
          partial void A();
          partial void A();
          partial void B() { }
          partial void B() { }
          partial void NoDef() { }
          partial void T(int x);
          partial void T(long x) { }
          partial void G<T>();
          partial void G<U>() { }
          partial void N(int a);
          partial void N(int b) { }
      }
      class D
      {
          partial void M();
      }
      class Program { static void Main() { } }
    `,
  ),
  diag(
    'cs8795-cs8796-cs8797-cs8798-what-needs-accessibility',
    cs`
      partial class C
      {
          partial int R();
          partial int Both();
          partial int Both() { return 1; }
          public partial void Pub();
          protected partial void Abs();
          public partial int Need();
          partial void O(out int x);
          virtual partial void V();
      }
      class Program { static void Main() { } }
    `,
  ),
  diag(
    'cs0763-cs0758-cs8799-cs8800-cs8817-cs8818-parts-that-disagree',
    cs`
      partial class C
      {
          partial void S(int x);
          static partial void S(int x) { }
          partial void Par(params int[] x);
          partial void Par(int[] x) { }
          partial void Opt(int x = 1);
          partial void Opt(int x = 2) { }
          public partial int A();
          private partial int A() { return 1; }
          public partial int B();
          public partial long B() { return 1; }
          public virtual partial void V();
          public partial void V() { }
          public partial ref int Rf();
          public partial int Rf() { return 0; }
      }
      class Program { static void Main() { } }
    `,
  ),
  diag(
    'cs0762-cs0029-uses-of-an-unimplemented-method',
    cs`
      using System;
      partial class C
      {
          partial void M();
          partial void N(int x);
          void Use()
          {
              M();
              this.M();
              N(1);
              Action a = M;
              Action<int> b = this.N;
              var c = new Action(M);
              string s = nameof(M);
              Console.WriteLine(s + a + b + c);
              int x = M();
          }
          static void Main() { }
      }
    `,
  ),
  diag(
    'cs8400-extended-partial-methods-in-csharp-8',
    cs`
      partial class C
      {
          public partial int Get();
          public partial int Get() { return 1; }
          partial void M();
          static void Main() { }
      }
    `,
    { langVersion: '8' },
  ),
]);
