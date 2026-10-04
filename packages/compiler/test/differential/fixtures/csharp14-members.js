/**
 * Differential fixtures for C# 14 member features (SF-A02-T87): partial constructors and events, user-defined
 * compound assignment operators, lambda parameter modifiers without types; CS9275-CS9280, CS0751, CS0111, CS0102,
 * CS9308, CS9310, CS0106, CS9340, CS1676, CS1677, CS9260 below C# 14.
 */
import { cs, out, diag, feature } from './kit.js';

export const fixtures = [
  ...feature('partial-constructors-events', [
    out(
      'defining-and-implementing-parts',
      cs`
        using System;
        partial class C
        {
            public partial C(int x, string label = "default");
            public partial event Action Changed;
            public static partial event Action Global;
        }
        partial class C
        {
            int v; string l; Action h; static Action g;
            public partial C(int x, string label) { v = x; l = label; }
            public partial event Action Changed { add { Console.WriteLine("add"); h += value; } remove { h -= value; } }
            public static partial event Action Global { add { g += value; } remove { g -= value; } }
            public void Fire() { if (h != null) h(); if (g != null) g(); Console.WriteLine(v + " " + l); }
        }
        class Program
        {
            static void Main()
            {
                var c = new C(3); Action on = () => Console.WriteLine("changed");
                c.Changed += on; C.Global += () => Console.WriteLine("global"); c.Fire();
                c.Changed -= on; new C(x: 4, label: "named").Fire();
            }
        }
      `,
    ),
    diag(
      'cs9275-cs9276-cs9277-cs9279-cs9280-cs0751',
      cs`
        using System;
        partial class C
        {
            public partial C(int x);
            public partial C(string s);
            public partial C(double d) { }
            public partial C(char a) : this(1);
            public partial C(char a) { }
            public partial event Action NoImpl;
            public partial event Action NoDef { add { } remove { } }
            public partial event Action Two;
            public partial event Action Two;
            public partial event Action Two { add { } remove { } }
        }
        partial class C { public partial C(int x) { } }
        class D { public partial D(); public partial D() { } }
        class Program { static void Main() { } }
      `,
    ),
  ]),
  ...feature('compound-assignment-operators', [
    out(
      'instance-operators-update-in-place',
      cs`
        using System;
        class Acc
        {
            public int V;
            public void operator +=(int x) { Console.WriteLine("+= " + x); V += x; }
            public void operator ++() { V++; }
            public void operator --() { V--; }
            public void operator *=(Acc other) { V *= other.V; }
            public static Acc operator -(Acc a, int x) { return new Acc { V = a.V - x }; }
        }
        class Holder { public Acc Item = new Acc(); public Acc[] Items = { new Acc() }; }
        class Program
        {
            static int Five() { Console.WriteLine("five"); return 5; }
            static void Main()
            {
                var a = new Acc(); var same = a;
                a += Five(); a++; ++a; a--; Console.WriteLine(a.V + " " + (same == a));
                a -= 2; Console.WriteLine(a.V + " " + (same == a));
                a *= a; Console.WriteLine(a.V);
                var h = new Holder(); h.Item += 3; h.Items[0] += 4; h.Items[0]++; Console.WriteLine(h.Item.V + " " + h.Items[0].V);
            }
        }
      `,
    ),
    diag(
      'cs9308-cs9310-cs0106-cs9340-cs0019',
      cs`
        class Acc
        {
            public int V;
            void operator +=(int x) { }
            public int operator -=(int x) { return 0; }
            public static void operator /=(int x) { }
            public void operator %=(string s) { }
        }
        class Program
        {
            static void Main()
            {
                var a = new Acc();
                a %= 1;
                a ^= 1;
            }
        }
      `,
    ),
    diag(
      'cs9260-below-csharp-14',
      cs`
        class Acc { public int V; public void operator +=(int x) { V += x; } }
        class Program { static void Main() { var a = new Acc(); a += 1; } }
      `,
      { langVersion: '13' },
    ),
  ]),
  ...feature('lambda-parameter-modifiers', [
    diag(
      'cs1676-cs1677-against-the-delegate',
      cs`
        using System;
        delegate bool TryParse(string text, out int result);
        delegate void Bump(ref int x);
        delegate int In(in int x);
        class Program
        {
            static void Main()
            {
                TryParse p = (text, out result) => { result = text.Length; return true; };
                Bump b = (ref x) => x++;
                In i = (in x) => x;
                Bump wrong = (out x) => { x = 1; };
                Bump typed = (ref int x) => x++;
                Func<int, int> f = (ref x) => x;
                TryParse q = (text, result) => true;
            }
        }
      `,
    ),
    diag(
      'cs9260-below-csharp-14',
      cs`
        delegate void Bump(ref int x);
        class Program { static void Main() { Bump b = (ref x) => x++; Bump typed = (ref int x) => x++; } }
      `,
      { langVersion: '13' },
    ),
  ]),
];
