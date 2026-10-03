/**
 * Differential fixtures for caller info attributes (SF-A02-T57): the value passed for an omitted argument in
 * methods, accessors, constructors, initializers, lambdas and local functions; C# 10 CallerArgumentExpression;
 * the declaration rules CS4017-CS4022, CS7081, CS8963, CS8965; and the per-iteration foreach variable in closures.
 */
import { cs, out, diag, feature } from './kit.js';

export const fixtures = feature('caller-info', [
  out(
    'member-name-and-line-number',
    cs`
      using System;
      using System.Runtime.CompilerServices;
      class Program
      {
          static void Log(string m, [CallerMemberName] string member = "", [CallerLineNumber] int line = 0)
          {
              Console.WriteLine(m + " " + member + " " + line);
          }
          int P { get { Log("p"); return 1; } }
          Program() { Log("ctor"); }
          static Program() { Log("cctor"); }
          int field = Init();
          static int Init([CallerMemberName] string who = null) { Console.WriteLine("init " + who); return 1; }
          static void Main()
          {
              Log("a");
              Log("b", "explicit");
              Log("c", line: 99);
              var p = new Program();
              var x = p.P;
              Action f = () => Log("lambda");
              f();
              Local();
              void Local() { Log("local"); }
          }
      }
    `,
  ),
  out(
    'argument-expression-and-file-path',
    cs`
      using System;
      using System.Runtime.CompilerServices;
      class Program
      {
          static void Check(bool condition, [CallerArgumentExpression("condition")] string text = null)
          {
              Console.WriteLine(text + " = " + condition);
          }
          static string Path([CallerFilePath] string path = "") { return path; }
          static void Main()
          {
              int a = 1;
              Check(a > 0);
              Check( a   ==  2 );
              Check(condition: a < 0);
              Check(true, "given");
              Console.WriteLine(Path().Length > 0);
          }
      }
    `,
  ),
  out(
    'constructors-indexers-and-operators',
    cs`
      using System;
      using System.Runtime.CompilerServices;
      class Tracer
      {
          public string Who;
          public Tracer([CallerMemberName] string who = "?") { Who = who; }
          public string this[int i, [CallerMemberName] string who = "?"] { get { return who + i; } }
          public static string operator +(Tracer t, int x) { return Name(); }
          static string Name([CallerMemberName] string who = "?") { return who; }
      }
      class Program
      {
          static Tracer field = new Tracer();
          string Prop { get { return new Tracer().Who; } }
          static void Main()
          {
              Console.WriteLine(field.Who);
              Console.WriteLine(new Tracer().Who);
              Console.WriteLine(new Program().Prop);
              Console.WriteLine(new Tracer("given").Who);
              Console.WriteLine(field[1]);
              Console.WriteLine(field + 1);
          }
      }
    `,
  ),
  diag(
    'cs4017-cs4022-cs7081-cs8963-declaration-rules',
    cs`
      using System;
      using System.Runtime.CompilerServices;
      class Program
      {
          static void A([CallerLineNumber] string line = "") { }
          static void B([CallerMemberName] int name = 0) { }
          static void C([CallerFilePath] int path = 0) { }
          static void D([CallerMemberName] string name) { }
          static void E([CallerLineNumber] int line) { }
          static void F([CallerLineNumber] long ok = 0, [CallerLineNumber] object box = null, [CallerLineNumber] int? n = null) { }
          static void G([CallerMemberName, CallerLineNumber] string both = "") { }
          static void H([CallerArgumentExpression("x")] string e = "", int x = 0) { }
          static void I(int x, [CallerArgumentExpression("nope")] string e = "") { }
          static void J(int x, [CallerArgumentExpression("e")] string e = "") { }
          static void Main() { }
      }
    `,
  ),
  out(
    'foreach-variable-is-fresh-per-iteration',
    cs`
      using System;
      class Program
      {
          static void Main()
          {
              Func<int>[] fs = new Func<int>[3];
              int k = 0;
              foreach (var i in new[] { 1, 2, 3 }) { fs[k] = () => i; k++; }
              Console.WriteLine(fs[0]() + " " + fs[1]() + " " + fs[2]());
              Func<int>[] gs = new Func<int>[3];
              for (int i = 0; i < 3; i++) gs[i] = () => i;
              Console.WriteLine(gs[0]() + " " + gs[1]() + " " + gs[2]());
              Func<int>[] hs = new Func<int>[3];
              int n = 0;
              while (n < 3) { int copy = n; hs[n] = () => copy; n++; }
              Console.WriteLine(hs[0]() + " " + hs[1]() + " " + hs[2]());
          }
      }
    `,
  ),
  out(
    'line-directives-remap-line-and-path-and-the-line-converts-to-double',
    cs`
      using System;
      using System.Runtime.CompilerServices;
      class Program
      {
          static void L([CallerLineNumber] int line = 0) { Console.WriteLine(line); }
          static void D([CallerLineNumber] double line = 0) { Console.WriteLine(line + 0.5); }
          static void O([CallerLineNumber] object line = null) { Console.WriteLine(line); }
          static void S([CallerMemberName] string name = "") { Console.WriteLine(name); }
          static void SO([CallerMemberName] object name = null) { Console.WriteLine(name); }
          static void F([CallerFilePath] string path = "") { Console.WriteLine(path); }
          static void Main()
          {
              L(); D(); O(); S(); SO();
      #line 100 "other.cs"
              L(); F();
              D();
      #line hidden
              L();
      #line default
              L();
      #line 7
              L();
          }
      }
    `,
  ),
  diag(
    'cs4017-cs4018-cs4019-which-parameter-types-take-caller-info',
    cs`
      using System;
      using System.Runtime.CompilerServices;
      class Program
      {
          static void A([CallerLineNumber] string line = "") { }
          static void B([CallerMemberName] int name = 0) { }
          static void C([CallerLineNumber] short line = 0) { }
          static void D([CallerLineNumber] byte line = 0) { }
          static void E([CallerFilePath] char path = 'a') { }
          static void F([CallerLineNumber] decimal line = 0) { }
          static void G([CallerLineNumber] float line = 0) { }
          static void H([CallerLineNumber] uint line = 0) { }
          static void I([CallerLineNumber] ulong line = 0) { }
          static void J([CallerLineNumber] long? line = 0) { }
          static void K([CallerMemberName] IComparable name = null) { }
          static void Main() { }
      }
    `,
  ),
]);
